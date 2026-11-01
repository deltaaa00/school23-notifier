# Flask Web Push integration

## 1. Install
```bash
pip install -r requirements.txt
```

## 2. Generate VAPID keys (once)
```bash
python generate_vapid.py
```
Copy the printed `VAPID_PUBLIC_KEY` value into your server environment. Keep
`vapid_private.pem` on the server and never publish it.

Example:
```bash
export CLASS_NAME='9-А'
export VAPID_PUBLIC_KEY='PASTE_PUBLIC_KEY_HERE'
export VAPID_PRIVATE_KEY_PATH='vapid_private.pem'
export VAPID_SUBJECT='mailto:your-email@example.com'
```

## 3. Run
```bash
python main.py
```
Push requires HTTPS in production (localhost is allowed for development).
Users must press “Увімкнути сповіщення” and allow notifications.

Subscriptions are stored in SQLite in `push_subscriptions.db`.

## 4. Send a test notification from Python
For example, temporarily add this after `init_db()` or call it from your own
trusted server-side logic:
```python
send_push_to_all("Тест", "Push працює!")
```
Do not expose an unauthenticated public route that lets anyone send messages.

`send_push_to_all(title, body, url="/")` sends to all stored subscriptions.
Expired subscriptions (HTTP 404/410) are removed automatically.
