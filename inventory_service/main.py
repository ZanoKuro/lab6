"""
Inventory Service — Consumer
Subscribe kênh "order_created" trên Redis Pub/Sub.
Khi nhận event: giả lập trừ tồn kho cho từng sản phẩm trong đơn hàng.
Hoạt động bình thường (không lỗi, không chậm).
Publish processing logs lên "service_logs" channel để hiển thị trên web UI.
"""

import json
import time
from datetime import datetime, timezone

import redis

CHANNEL_ORDER = "order_created"
CHANNEL_LOGS = "service_logs"


def publish_log(log_client, level, message, order_id=None):
    """Publish structured log to service_logs channel for real-time UI display."""
    log_data = json.dumps({
        "service": "inventory_service",
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
    """Xử lý event order_created — trừ tồn kho."""
    data = event["data"]
    order_id = data["order_id"]
    items = data["items"]

    print(f"[INVENTORY] 📦 Received order {order_id}")
    publish_log(log_client, "info", f"📦 Received order {order_id[:8]}...", order_id)

    for item in items:
        # Giả lập thời gian xử lý nhẹ
        time.sleep(0.5)
        msg = f"✅ Stock updated: {item['product']} → deducted {item['quantity']} unit(s)"
        print(f"[INVENTORY] {msg}")
        publish_log(log_client, "success", msg, order_id)

    print(f"[INVENTORY] ✅ Inventory update completed for order {order_id}")
    publish_log(log_client, "success", f"🎉 Inventory update completed for order {order_id[:8]}...", order_id)
    print("-" * 60)


def main():
    print("[INVENTORY] 🚀 Inventory Service started. Waiting for events...")

    # Connection for subscribing to order_created
    sub_client = redis.Redis(host="redis", port=6379, decode_responses=True)
    pubsub = sub_client.pubsub()
    pubsub.subscribe(CHANNEL_ORDER)

    # Separate connection for publishing logs
    log_client = redis.Redis(host="redis", port=6379, decode_responses=True)

    for message in pubsub.listen():
        if message["type"] == "message":
            try:
                event = json.loads(message["data"])
                handle_order_created(event, log_client)
            except Exception as e:
                print(f"[INVENTORY] ❌ Error processing event: {e}")
                publish_log(log_client, "error", f"❌ Error: {e}")


if __name__ == "__main__":
    main()
