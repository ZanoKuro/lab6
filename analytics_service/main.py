"""
Analytics Service — Consumer
Subscribe kênh "order_created" trên Redis Pub/Sub.
Khi nhận event: giả lập phân tích dữ liệu đơn hàng.
⏳ Giả lập xử lý CHẬM (5-8 giây) để chứng minh async.
Publish processing logs lên "service_logs" channel để hiển thị trên web UI.
"""

import json
import random
import time
from datetime import datetime, timezone

import redis

CHANNEL_ORDER = "order_created"
CHANNEL_LOGS = "service_logs"
MIN_DELAY = 5  # giây
MAX_DELAY = 8  # giây


def publish_log(log_client, level, message, order_id=None):
    """Publish structured log to service_logs channel for real-time UI display."""
    log_data = json.dumps({
        "service": "analytics_service",
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
    """Xử lý event order_created — ghi nhận phân tích (giả lập chậm)."""
    data = event["data"]
    order_id = data["order_id"]
    customer_name = data["customer_name"]
    total = data["total"]
    num_items = len(data["items"])

    delay = random.uniform(MIN_DELAY, MAX_DELAY)

    print(f"[ANALYTICS] 📊 Received order {order_id}")
    publish_log(log_client, "info", f"📊 Received order {order_id[:8]}...", order_id)
    publish_log(log_client, "warning", f"⏳ Heavy processing started (estimated: {delay:.1f}s)...", order_id)

    print(f"[ANALYTICS] ⏳ Processing analytics (simulated delay: {delay:.1f}s)...")

    # Giả lập xử lý chậm — heavy computation / batch processing
    time.sleep(delay)

    # Ghi nhận phân tích
    result_msg = (
        f"✅ Analytics complete — "
        f"Customer: {customer_name}, "
        f"Total: {total:,.0f}, "
        f"Items: {num_items}, "
        f"Processed in {delay:.1f}s"
    )
    print(f"[ANALYTICS] {result_msg}")
    publish_log(log_client, "success", result_msg, order_id)
    print("-" * 60)


def main():
    print("[ANALYTICS] 🚀 Analytics Service started. Waiting for events...")
    print(f"[ANALYTICS] ⏳ Simulated processing delay: {MIN_DELAY}-{MAX_DELAY}s per event")

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
                print(f"[ANALYTICS] ❌ Error processing event: {e}")
                publish_log(log_client, "error", f"❌ Error: {e}")


if __name__ == "__main__":
    main()
