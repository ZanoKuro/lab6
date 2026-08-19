"""
Notification Service — Consumer
Subscribe kênh "order_created" trên Redis Pub/Sub.
Khi nhận event: giả lập gửi email thông báo cho khách hàng.
⚠ Giả lập lỗi ngẫu nhiên (50%) để chứng minh fault isolation.
Publish processing logs lên "service_logs" channel để hiển thị trên web UI.
"""

import json
import random
import time
from datetime import datetime, timezone

import redis

CHANNEL_ORDER = "order_created"
CHANNEL_LOGS = "service_logs"
FAILURE_RATE = 0.5  # 50% xác suất lỗi


def publish_log(log_client, level, message, order_id=None):
    """Publish structured log to service_logs channel for real-time UI display."""
    log_data = json.dumps({
        "service": "notification_service",
        "level": level,
        "message": message,
        "order_id": order_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }, ensure_ascii=False)
    try:
        log_client.publish(CHANNEL_LOGS, log_data)
    except Exception:
        pass


def handle_order_created(event, log_client):
    """Xử lý event order_created — gửi email thông báo (giả lập)."""
    data = event["data"]
    order_id = data["order_id"]
    customer_name = data["customer_name"]
    total = data["total"]

    print(f"[NOTIFICATION] 📧 Received order {order_id} for customer '{customer_name}'")
    publish_log(log_client, "info", f"📧 Preparing email for '{customer_name}'...", order_id)

    # Giả lập xử lý
    time.sleep(1)

    # Giả lập lỗi ngẫu nhiên
    if random.random() < FAILURE_RATE:
        error_msg = f"❌ Failed to send email to '{customer_name}' — SMTP server unavailable"
        print(f"[NOTIFICATION] {error_msg}")
        publish_log(log_client, "error", error_msg, order_id)
        publish_log(log_client, "warning", "⚡ Service still running — waiting for next event...", order_id)
        print(f"[NOTIFICATION] ⚡ Service still running — waiting for next event...")
        print("-" * 60)
        return

    msg = f"✅ Email sent to '{customer_name}': 'Your order {order_id[:8]}... (total: {total:,.0f}) confirmed!'"
    print(f"[NOTIFICATION] {msg}")
    publish_log(log_client, "success", msg, order_id)
    print("-" * 60)


def main():
    print("[NOTIFICATION] 🚀 Notification Service started. Waiting for events...")
    print(f"[NOTIFICATION] ⚠️  Simulated failure rate: {FAILURE_RATE * 100:.0f}%")

    sub_client = redis.Redis(host="redis", port=6379, decode_responses=True)
    pubsub = sub_client.pubsub()
    pubsub.subscribe(CHANNEL_ORDER)

    log_client = redis.Redis(host="redis", port=6379, decode_responses=True)

    for message in pubsub.listen():
        if message["type"] == "message":
            try:
                event = json.loads(message["data"])
                handle_order_created(event, log_client)
            except Exception as e:
                print(f"[NOTIFICATION] ❌ ERROR: {e}")
                publish_log(log_client, "error", f"❌ Unexpected error: {e}")
                print(f"[NOTIFICATION] ⚡ Service still running — waiting for next event...")
                print("-" * 60)


if __name__ == "__main__":
    main()
