const button = document.getElementById("enablePushButton");
const statusText = document.getElementById("pushStatus");

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function getRegistration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Цей браузер не підтримує Push-повідомлення.");
  }
  await navigator.serviceWorker.register("/sw.js");
  return await navigator.serviceWorker.ready;
}

async function saveSubscriptionOnServer(subscription) {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Не вдалося зберегти підписку на сервері.");
  }
}

async function enablePush() {
  if (!("Notification" in window)) {
    throw new Error("Цей браузер не підтримує сповіщення.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Дозвіл на сповіщення не надано.");
  }

  const keyResponse = await fetch("/api/push/public-key");
  if (!keyResponse.ok) throw new Error("Не вдалося отримати VAPID public key.");
  const { publicKey } = await keyResponse.json();

  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  // Кожного разу синхронізуємо існуючу підписку з SQLite на сервері.
  await saveSubscriptionOnServer(subscription);
  showSubscribed();
}

function showSubscribed() {
  if (statusText) statusText.textContent = "Сповіщення увімкнено й підписка збережена.";
  if (button) {
    button.textContent = "Сповіщення увімкнено";
    button.disabled = true;
  }
}

async function restoreSubscriptionState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") {
      // Після перезавантаження сторінки повторно реєструємо підписку на сервері.
      await saveSubscriptionOnServer(subscription);
      showSubscribed();
    } else if (Notification.permission === "denied") {
      if (statusText) statusText.textContent = "Сповіщення заблоковані в налаштуваннях браузера.";
    }
  } catch (error) {
    console.error("Не вдалося відновити стан push-підписки:", error);
    if (statusText) statusText.textContent = "Не вдалося перевірити підписку. Спробуй увімкнути сповіщення ще раз.";
  }
}

button?.addEventListener("click", async () => {
  button.disabled = true;
  if (statusText) statusText.textContent = "Підключаємо сповіщення…";
  try {
    await enablePush();
  } catch (error) {
    if (statusText) statusText.textContent = error.message;
    button.disabled = false;
  }
});

// Команда для DevTools Console: send_test()
// Вона попросить секретний токен адміністратора і відправить тест усім підписникам.
window.send_test = async function () {
  const token = window.prompt("Введи PUSH_ADMIN_TOKEN:");
  if (!token) return console.info("Тестову розсилку скасовано.");

  const response = await fetch("/api/push/send-test", {
    method: "POST",
    headers: { "X-Admin-Token": token }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  console.info(`Тестовий push: надіслано ${result.sent} із ${result.total}; помилок: ${result.failed}.`);
  return result;
};

restoreSubscriptionState();
