from flask import Flask, render_template, jsonify, request, send_from_directory
import schedule
import json
import requests
import os
import time
import threading
import sqlite3
import logging
import secrets
from pywebpush import webpush, WebPushException

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Налаштування класу та VAPID.
CLASS_NAME = os.environ.get("CLASS_NAME", "9-А")
DATABASE_PATH = os.environ.get("DATABASE_PATH", "data/push_subscriptions.db")
PUSH_ADMIN_TOKEN = os.environ.get("PUSH_ADMIN_TOKEN", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY_PATH = os.environ.get("VAPID_PRIVATE_KEY_PATH", "vapid_private.pem")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")


def get_db():
    db_dir = os.path.dirname(os.path.abspath(DATABASE_PATH))
    os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT NOT NULL UNIQUE,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


def get_from_api(data):
    if data == "schedule":
        endpoint = "entries"
    elif data == "bells":
        endpoint = "bells"
    else:
        raise ValueError("data must be 'schedule' or 'bells'")

    response = requests.get(
        f"https://school.shm.in.net/api/schedule/{endpoint}",
        params={"class_name": CLASS_NAME},
        timeout=15,
    )
    response.raise_for_status()

    os.makedirs("data", exist_ok=True)
    with open(os.path.join("data", f"{endpoint}.json"), "w", encoding="utf-8") as file:
        json.dump(response.json(), file, ensure_ascii=False, indent=4)


def run_scheduler():
    # Початкове завантаження; помилка одного endpoint не блокує інший.
    for item in ("schedule", "bells"):
        try:
            get_from_api(item)
        except Exception:
            logger.exception("Не вдалося завантажити %s під час запуску", item)

    schedule.every().day.at("07:00").do(safe_refresh, "schedule")
    schedule.every().day.at("07:00").do(safe_refresh, "bells")

    while True:
        schedule.run_pending()
        time.sleep(1)


def safe_refresh(item):
    try:
        get_from_api(item)
        logger.info("Оновлено %s", item)
    except Exception:
        logger.exception("Помилка оновлення %s", item)


def save_subscription(subscription):
    endpoint = subscription["endpoint"]
    keys = subscription["keys"]
    with get_db() as conn:
        conn.execute("""
            INSERT INTO push_subscriptions (endpoint, p256dh, auth)
            VALUES (?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth
        """, (endpoint, keys["p256dh"], keys["auth"]))


def delete_subscription(endpoint):
    with get_db() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))


def send_push_to_all(title, body, url="/"):
    """Надсилає push усім збереженим браузерним підпискам та повертає статистику."""
    if not VAPID_PUBLIC_KEY or not os.path.exists(VAPID_PRIVATE_KEY_PATH):
        logger.error("Не налаштовані VAPID keys; push не надіслано")
        return {"total": 0, "sent": 0, "failed": 0, "error": "VAPID keys не налаштовані"}

    with get_db() as conn:
        subscriptions = conn.execute(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions"
        ).fetchall()

    stats = {"total": len(subscriptions), "sent": 0, "failed": 0}
    payload = json.dumps({"title": title, "body": body, "url": url}, ensure_ascii=False)

    for row in subscriptions:
        subscription_info = {
            "endpoint": row["endpoint"],
            "keys": {"p256dh": row["p256dh"], "auth": row["auth"]},
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY_PATH,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
            stats["sent"] += 1
        except WebPushException as exc:
            stats["failed"] += 1
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            logger.warning("Push error (HTTP %s): %s", status_code, exc)
            if status_code in (404, 410):
                delete_subscription(row["endpoint"])
        except Exception:
            stats["failed"] += 1
            logger.exception("Не вдалося надіслати push")

    return stats


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/sw.js")
def service_worker():
    # Кореневий scope потрібен, щоб SW контролював весь сайт.
    return send_from_directory(app.static_folder, "sw.js",
                               mimetype="application/javascript")


@app.get("/api/push/public-key")
def push_public_key():
    if not VAPID_PUBLIC_KEY:
        return jsonify({"error": "VAPID_PUBLIC_KEY не налаштований"}), 500
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})


@app.post("/api/push/subscribe")
def push_subscribe():
    subscription = request.get_json(silent=True)
    if not isinstance(subscription, dict):
        return jsonify({"error": "Очікувався JSON"}), 400
    if not subscription.get("endpoint") or not isinstance(subscription.get("keys"), dict):
        return jsonify({"error": "Некоректна push-підписка"}), 400
    if not subscription["keys"].get("p256dh") or not subscription["keys"].get("auth"):
        return jsonify({"error": "У підписці відсутні ключі"}), 400

    save_subscription(subscription)
    return jsonify({"ok": True})


@app.post("/api/push/send-test")
def push_send_test():
    # Не залишай відкритий endpoint масової розсилки без авторизації.
    if not PUSH_ADMIN_TOKEN:
        return jsonify({"error": "PUSH_ADMIN_TOKEN не налаштований на сервері"}), 503

    supplied_token = request.headers.get("X-Admin-Token", "")
    if not secrets.compare_digest(supplied_token, PUSH_ADMIN_TOKEN):
        return jsonify({"error": "Невірний admin token"}), 403

    stats = send_push_to_all(
        "Тестове сповіщення",
        "Якщо ти бачиш це повідомлення — push працює!",
        url="/",
    )
    status = 200 if "error" not in stats else 503
    return jsonify(stats), status


@app.post("/api/push/unsubscribe")
def push_unsubscribe():
    data = request.get_json(silent=True) or {}
    endpoint = data.get("endpoint")
    if not endpoint:
        return jsonify({"error": "Відсутній endpoint"}), 400
    delete_subscription(endpoint)
    return jsonify({"ok": True})


@app.get("/api/get_schedule")
def get_schedule():
    try:
        with open(os.path.join("data", "entries.json"), "r", encoding="utf-8") as file:
            return jsonify(json.load(file))
    except FileNotFoundError:
        return jsonify({"error": "Розклад ще не завантажений"}), 503


@app.get("/api/get_bells")
def get_bells():
    try:
        with open(os.path.join("data", "bells.json"), "r", encoding="utf-8") as file:
            return jsonify(json.load(file))
    except FileNotFoundError:
        return jsonify({"error": "Дзвінки ще не завантажені"}), 503


init_db()

if __name__ == "__main__":
    # У debug-режимі scheduler запускається лише в дочірньому процесі reloader.
    app.debug = True
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        threading.Thread(target=run_scheduler, daemon=True).start()
    app.run(host='0.0.0.0', port=5000, debug=True)
