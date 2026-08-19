"""
Order Service — FastAPI
Nhận request tạo đơn hàng, publish event "order_created" lên Redis Pub/Sub,
trả response ngay lập tức mà không chờ consumer xử lý.
Phục vụ giao diện web dashboard và SSE endpoint cho live event stream.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import redis
import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Order Service", version="1.0.0")

# ── Redis connection (sync — for publishing) ─────────────────────────────────
redis_client = redis.Redis(host="redis", port=6379, decode_responses=True)

CHANNEL_ORDER = "order_created"
CHANNEL_LOGS = "service_logs"

HTML_PATH = Path(__file__).parent / "index.html"


# ── Models ────────────────────────────────────────────────────────────────────
class OrderItem(BaseModel):
    product: str
    quantity: int
    price: float


class CreateOrderRequest(BaseModel):
    customer_name: str
    items: list[OrderItem]


# ── In-memory store (prototype) ──────────────────────────────────────────────
orders_db: dict[str, dict] = {}


# ── Helper: publish log to service_logs channel ─────────────────────────────
def publish_log(level: str, message: str, order_id: str | None = None):
    """Publish a structured log message to the service_logs Redis channel."""
    log_data = json.dumps({
        "service": "order_service",
        "level": level,
        "message": message,
        "order_id": order_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }, ensure_ascii=False)
    try:
        redis_client.publish(CHANNEL_LOGS, log_data)
    except Exception:
        pass  # Don't let log publishing break the main flow


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/")
def serve_dashboard():
    """Serve the web dashboard UI."""
    return FileResponse(HTML_PATH, media_type="text/html")


@app.get("/events")
async def sse_events():
    """
    SSE endpoint — streams real-time log events from all services.
    Frontend connects via EventSource to receive live updates.
    """
    async def event_generator():
        r = aioredis.Redis(host="redis", port=6379, decode_responses=True)
        pubsub = r.pubsub()
        await pubsub.subscribe(CHANNEL_LOGS)
        try:
            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if message and message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                else:
                    # Send keepalive comment every cycle to detect disconnects
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(CHANNEL_LOGS)
            await r.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/orders")
def create_order(request: CreateOrderRequest):
    """
    Tạo đơn hàng mới:
    1. Tạo order_id, tính total
    2. Lưu vào in-memory store
    3. Publish event lên Redis channel
    4. Trả response NGAY LẬP TỨC (không chờ consumer)
    """
    order_id = str(uuid.uuid4())
    total = sum(item.price * item.quantity for item in request.items)

    # Lưu đơn hàng
    order_data = {
        "order_id": order_id,
        "customer_name": request.customer_name,
        "items": [item.model_dump() for item in request.items],
        "total": total,
        "status": "created",
    }
    orders_db[order_id] = order_data

    # Tạo event
    event = {
        "event_id": str(uuid.uuid4()),
        "event_type": "order_created",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": order_data,
    }

    # Publish log to UI
    items_str = ", ".join(f"{i.product} x{i.quantity}" for i in request.items)
    publish_log("info", f"📦 Creating order for '{request.customer_name}': {items_str}", order_id)

    # Publish event lên Redis — bất đồng bộ với consumer
    event_json = json.dumps(event, ensure_ascii=False)
    num_subscribers = redis_client.publish(CHANNEL_ORDER, event_json)

    publish_log("success", f"✅ Order {order_id[:8]}... created — event sent to {num_subscribers} subscriber(s)", order_id)

    print(f"[ORDER SERVICE] ✅ Order {order_id} created successfully")
    print(f"[ORDER SERVICE] 📤 Event published to '{CHANNEL_ORDER}' — {num_subscribers} subscriber(s) received")

    # Trả response ngay — KHÔNG chờ consumer xử lý
    return {
        "message": "Order created successfully. Processing in background.",
        "order_id": order_id,
        "total": total,
        "subscribers_notified": num_subscribers,
    }


@app.get("/orders")
def list_orders():
    """Liệt kê tất cả đơn hàng (hỗ trợ demo)."""
    return {"orders": list(orders_db.values())}


@app.get("/orders/{order_id}")
def get_order(order_id: str):
    """Lấy thông tin đơn hàng theo ID."""
    if order_id not in orders_db:
        return {"error": "Order not found"}, 404
    return orders_db[order_id]
