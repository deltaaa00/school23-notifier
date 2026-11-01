/* ============================================================
   Class Schedule — frontend app
   Single-class schedule viewer with live clock and day switching.
   Data sources:
     GET /api/get_schedule  — lessons for the class
     GET /api/get_bells     — bell (period) times
   ============================================================ */

// ---------- Bell schedule ----------
// Loaded from /api/get_bells:
//   [{ number, starts_at: "HH:MM:SS", ends_at: "HH:MM:SS", id }]
// Mapped at runtime to: BELL_SCHEDULE[number] = { start: "HH:MM", end: "HH:MM" }
let BELL_SCHEDULE = {};

// ---------- Day-of-week config ----------
// Backend uses day_of_week: 1 = Monday ... 5 = Friday.
const DAYS = {
  1: { short: "Mon", full: "Monday", jsDay: 1 },
  2: { short: "Tue", full: "Tuesday", jsDay: 2 },
  3: { short: "Wed", full: "Wednesday", jsDay: 3 },
  4: { short: "Thu", full: "Thursday", jsDay: 4 },
  5: { short: "Fri", full: "Friday", jsDay: 5 },
};
const DAY_ORDER = [1, 2, 3, 4, 5];

// ---------- App state ----------
const state = {
  lessons: [],        // raw lessons from API
  className: "",      // single class from API
  activeDay: 1,       // currently selected day_of_week
};

// ---------- DOM refs ----------
const el = {
  clockTime: document.getElementById("clockTime"),
  clockDate: document.getElementById("clockDate"),
  classLabel: document.getElementById("classLabel"),
  dayTabs: document.getElementById("dayTabs"),
  dayTitle: document.getElementById("dayTitle"),
  lessonCount: document.getElementById("lessonCount"),
  lessonList: document.getElementById("lessonList"),
  status: document.getElementById("status"),
  bellList: document.getElementById("bellList"),
};

// ============================================================
// Utilities
// ============================================================

/** Parse "HH:MM" or "HH:MM:SS" into minutes since midnight. */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Trim "HH:MM:SS" to "HH:MM". */
function shortTime(t) {
  return String(t).slice(0, 5);
}

/** Return bell times { start, end } for a given lesson number, or null. */
function getBellTimes(lessonNo) {
  return BELL_SCHEDULE[lessonNo] || null;
}

/** Get current time-of-day in minutes (local). */
function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

/** Get the current JS weekday mapped to backend day (1..5) or null on weekend. */
function todayBackendDay(date = new Date()) {
  const jsDay = date.getDay(); // 0 = Sunday
  const match = Object.entries(DAYS).find(([, d]) => d.jsDay === jsDay);
  return match ? Number(match[0]) : null;
}

/** Format a Date to "HH:MM:SS". */
function formatClock(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Format a Date to a readable date line, e.g. "Monday, 3 February". */
function formatDate(d) {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Escape HTML to safely inject backend strings. */
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================
// Live clock
// ============================================================
function tickClock() {
  const now = new Date();
  el.clockTime.textContent = formatClock(now);
  el.clockDate.textContent = formatDate(now);
  refreshLiveStates(now);
}

// ============================================================
// Data loading
// ============================================================

/** Load bell times from /api/get_bells. */
async function loadBells() {
  const res = await fetch("/api/get_bells", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data)) throw new Error("Invalid bells data");

  // Map to: number -> { start: "HH:MM", end: "HH:MM" }
  BELL_SCHEDULE = {};
  data.forEach((b) => {
    BELL_SCHEDULE[b.number] = {
      start: shortTime(b.starts_at),
      end: shortTime(b.ends_at),
    };
  });
}

async function loadSchedule() {
  el.status.className = "status show";
  el.status.textContent = "Loading schedule…";

  // Load bell times first (non-fatal if unavailable).
  try {
    await loadBells();
    renderBells();
  } catch (bellErr) {
    console.warn("Could not load bell times:", bellErr);
  }

  try {
    const res = await fetch("/api/get_schedule", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Empty schedule");
    }

    state.lessons = data;
    state.className = data[0].class_name || "—";
    el.classLabel.textContent = `Class ${state.className}`;

    // Decide which day to open first.
    const today = todayBackendDay();
    const daysWithLessons = [...new Set(data.map((l) => l.day_of_week))];
    if (today && daysWithLessons.includes(today)) {
      state.activeDay = today;
    } else {
      state.activeDay = daysWithLessons.sort((a, b) => a - b)[0] || 1;
    }

    el.status.className = "status";
    renderDayTabs();
    render();
  } catch (err) {
    console.error(err);
    el.status.className = "status show error";
    el.status.textContent =
      "Could not load the schedule. Please try again later.";
  }
}

// ============================================================
// Day tabs
// ============================================================
function renderDayTabs() {
  const today = todayBackendDay();
  el.dayTabs.innerHTML = "";

  DAY_ORDER.forEach((dayNum) => {
    const info = DAYS[dayNum];
    const btn = document.createElement("button");
    btn.className = "day-tab";
    btn.type = "button";
    btn.setAttribute("role", "tab");
    if (dayNum === state.activeDay) btn.classList.add("active");
    if (dayNum === today) btn.classList.add("today");
    btn.dataset.day = String(dayNum);
    btn.setAttribute(
      "aria-selected",
      dayNum === state.activeDay ? "true" : "false"
    );

    btn.innerHTML = `
      <span class="dow-short">${info.short}</span>
      <span class="dow-full">${info.full}</span>
    `;

    btn.addEventListener("click", () => {
      state.activeDay = dayNum;
      renderDayTabs();
      render();
    });

    el.dayTabs.appendChild(btn);
  });
}

// ============================================================
// Bell schedule (all lesson slots)
// ============================================================
function renderBells() {
  if (!el.bellList) return;

  const numbers = Object.keys(BELL_SCHEDULE)
    .map(Number)
    .sort((a, b) => a - b);

  el.bellList.innerHTML = "";

  numbers.forEach((no) => {
    const b = BELL_SCHEDULE[no];
    const li = document.createElement("li");
    li.className = "bell";
    li.dataset.bell = String(no);
    li.innerHTML = `
      <span class="bell-no">${no}</span>
      <span class="bell-time">${b.start}–${b.end}</span>
    `;
    el.bellList.appendChild(li);
  });
}

// ============================================================
// Render lessons for active day
// ============================================================
function render() {
  const dayInfo = DAYS[state.activeDay];
  el.dayTitle.textContent = dayInfo ? dayInfo.full : "";

  const lessons = state.lessons
    .filter((l) => l.day_of_week === state.activeDay)
    .sort((a, b) => a.lesson_no - b.lesson_no);

  el.lessonCount.textContent =
    lessons.length === 0
      ? "No lessons"
      : `${lessons.length} lesson${lessons.length > 1 ? "s" : ""}`;

  el.lessonList.innerHTML = "";

  if (lessons.length === 0) {
    const li = document.createElement("li");
    li.className = "lesson";
    li.style.gridTemplateColumns = "1fr";
    li.style.justifyItems = "center";
    li.style.textAlign = "center";
    li.style.color = "var(--text-dim)";
    li.textContent = "No lessons scheduled for this day.";
    el.lessonList.appendChild(li);
    return;
  }

  lessons.forEach((lesson, idx) => {
    const li = buildLessonItem(lesson, idx);
    el.lessonList.appendChild(li);
  });

  refreshLiveStates(new Date());
}

/** Build a single <li> for a lesson. */
function buildLessonItem(lesson, index) {
  const li = document.createElement("li");
  li.className = "lesson";
  li.dataset.id = String(lesson.id);
  li.style.animationDelay = `${Math.min(index * 0.04, 0.4)}s`;

  const bell = getBellTimes(lesson.lesson_no);
  const startStr = bell ? bell.start : "—:—";
  const endStr = bell ? bell.end : "—:—";

  // Teacher: prefer short name, fall back to full.
  const teacher = lesson.teacher_short || lesson.teacher_full || "";
  const room = lesson.classroom || "";
  const onlineUrl = lesson.online_url;

  const subjectHtml = escapeHtml(lesson.subject || "—");
  const teacherHtml = teacher ? escapeHtml(teacher) : "";

  const metaParts = [];
  if (teacherHtml) {
    metaParts.push(`
      <span class="meta-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        ${teacherHtml}
      </span>`);
  }

  const sideBadges = [];
  if (onlineUrl) {
    sideBadges.push(`
      <a class="online-link" href="${escapeHtml(onlineUrl)}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        </svg>
        Join
      </a>`);
  }

  li.innerHTML = `
    <div class="lesson-time">
      <span class="lno">Lesson ${lesson.lesson_no}</span>
      <span class="start">${startStr}</span>
      <span class="end">${endStr}</span>
    </div>
    <div class="lesson-info">
      <span class="lesson-subject">${subjectHtml}</span>
      ${
        metaParts.length
          ? `<span class="lesson-meta">${metaParts.join("")}</span>`
          : ""
      }
    </div>
    <div class="lesson-side">
      <span class="badge live" hidden>Now</span>
      ${
        room
          ? `<span class="badge room">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"></path>
              </svg>
              Room ${escapeHtml(room)}
            </span>`
          : ""
      }
      ${sideBadges.join("")}
    </div>
  `;

  return li;
}

// ============================================================
// Live lesson highlighting (past / now)
// ============================================================
function refreshLiveStates(now) {
  // Live highlighting only applies to the current weekday.
  const isActiveDayToday = todayBackendDay(now) === state.activeDay;
  const currentMin = nowMinutes(now);

  document.querySelectorAll("#lessonList .lesson").forEach((li) => {
    const id = li.dataset.id;
    const lesson = state.lessons.find((l) => String(l.id) === id);
    if (!lesson) return;

    const bell = getBellTimes(lesson.lesson_no);
    const liveBadge = li.querySelector(".badge.live");
    li.classList.remove("now", "past");
    if (liveBadge) liveBadge.hidden = true;

    if (!bell || !isActiveDayToday) return;

    const start = toMinutes(bell.start);
    const end = toMinutes(bell.end);

    if (currentMin >= start && currentMin < end) {
      li.classList.add("now");
      if (liveBadge) liveBadge.hidden = false;
    } else if (currentMin >= end) {
      li.classList.add("past");
    }
  });
}

// ============================================================
// Boot
// ============================================================
tickClock();
setInterval(tickClock, 1000);
loadSchedule();
