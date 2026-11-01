const button = document.getElementById("enablePushButton");
const statusText = document.getElementById("pushStatus");

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Цей браузер не підтримує Push-повідомлення.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Дозвіл на сповіщення не надано.");
  }

  const keyResponse = await fetch("/api/push/public-key");
  if (!keyResponse.ok) throw new Error("Не вдалося отримати VAPID public key.");
  const { publicKey } = await keyResponse.json();

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Не вдалося зберегти підписку.");
  }

  statusText.textContent = "Сповіщення увімкнено!";
  button.textContent = "Сповіщення увімкнено";
  button.disabled = true;
}

button?.addEventListener("click", async () => {
  button.disabled = true;
  statusText.textContent = "Підключаємо сповіщення…";
  try {
    await enablePush();
  } catch (error) {
    statusText.textContent = error.message;
    button.disabled = false;
  }
});
