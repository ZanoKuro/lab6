# 📦 Event-Driven Architecture — Sales System Prototype

## 1. Mô tả

Prototype hệ thống bán hàng áp dụng **Event-Driven Architecture (EDA)** sử dụng **Redis Pub/Sub** làm message broker. Khi một đơn hàng được tạo, hệ thống phát ra event `order_created` và các service độc lập xử lý bất đồng bộ.

## 2. Kiến trúc

```
┌────────────┐     POST /orders      ┌─────────────────┐
│   Client   │ ──────────────────────▶│  Order Service  │
│ (cURL/UI)  │ ◀───── response ──────│    (FastAPI)     │
└────────────┘    (trả ngay lập tức)  └────────┬────────┘
                                               │
                                        PUBLISH │ order_created
                                               ▼
                                    ┌──────────────────┐
                                    │   Redis Pub/Sub  │
                                    │   (Message Broker)│
                                    └──┬───────┬───────┘
                                       │       │       │
                          SUBSCRIBE    │       │       │    SUBSCRIBE
                    ┌──────────────────┘       │       └──────────────────┐
                    ▼                          ▼                          ▼
          ┌─────────────────┐     ┌──────────────────────┐    ┌──────────────────┐
          │Inventory Service│     │Notification Service  │    │Analytics Service  │
          │   (Consumer)    │     │   (Consumer)         │    │   (Consumer)      │
          │                 │     │                      │    │                   │
          │ ✅ Trừ tồn kho  │     │ ⚠️ 50% lỗi giả lập   │    │ ⏳ Delay 5-8s     │
          └─────────────────┘     └──────────────────────┘    └──────────────────┘
```

### Các thành phần

| Service               | Vai trò                           | Hành vi đặc biệt                    |
| --------------------- | --------------------------------- | ------------------------------------ |
| **Order Service**     | Nhận đơn hàng, publish event      | Trả response ngay, không chờ consumer |
| **Inventory Service** | Trừ tồn kho                       | Hoạt động bình thường (~0.5s/item)   |
| **Notification Service** | Gửi email thông báo (giả lập)  | **50% xác suất lỗi** — demo fault isolation |
| **Analytics Service** | Ghi nhận phân tích                | **Delay 5-8 giây** — demo async      |
| **Redis**             | Message broker (Pub/Sub)          | Channel: `order_created`             |

## 3. Event Schema

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_type": "order_created",
  "timestamp": "2024-01-15T10:30:00.000000+00:00",
  "data": {
    "order_id": "a1b2c3d4-...",
    "customer_name": "Nguyen Van A",
    "items": [
      { "product": "Laptop", "quantity": 1, "price": 15000000 }
    ],
    "total": 15000000
  }
}
```

## 4. Quyết định kiến trúc

### Cách chia component
- **Order Service** là producer duy nhất — tách biệt logic tạo đơn hàng khỏi logic xử lý sau đó.
- Mỗi tác vụ phản ứng (inventory, notification, analytics) là một **consumer service độc lập**, chạy trong container riêng.

### Cơ chế truyền message
- Sử dụng **Redis Pub/Sub** — đơn giản, hiệu quả cho prototype.
- Một event publish lên channel sẽ được **tất cả subscriber nhận** (fan-out tự nhiên).

### Xử lý lỗi
- Mỗi consumer bọc logic xử lý trong `try/except` — lỗi chỉ ảnh hưởng consumer đó.
- Service không crash khi gặp lỗi — log lỗi rồi tiếp tục lắng nghe event tiếp theo.
- Order Service không biết và không quan tâm consumer có thành công hay không.

### Khả năng mở rộng
- Thêm consumer mới chỉ cần tạo service mới subscribe cùng channel `order_created`.
- Không cần sửa đổi Order Service hay bất kỳ consumer hiện có nào.

## 5. Hướng dẫn chạy

### Yêu cầu
- Docker Desktop đã cài và đang chạy

### Khởi động

```bash
cd lab6
docker-compose up --build
```

Chờ tất cả service start xong (khi thấy log "Waiting for events..." từ 3 consumer).

### Tạo đơn hàng mẫu

```bash
curl -X POST http://localhost:8000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Nguyen Van A",
    "items": [
      {"product": "Laptop", "quantity": 1, "price": 15000000},
      {"product": "Mouse", "quantity": 2, "price": 500000}
    ]
  }'
```

Trên Windows PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/orders" `
  -ContentType "application/json" `
  -Body '{"customer_name":"Nguyen Van A","items":[{"product":"Laptop","quantity":1,"price":15000000},{"product":"Mouse","quantity":2,"price":500000}]}'
```

### Dừng hệ thống

```bash
docker-compose down
```

## 6. Hướng dẫn demo

### Demo 1: Asynchronous Service Calling
1. Gửi request tạo đơn hàng bằng curl
2. **Quan sát**: Response trả về ngay lập tức (< 1 giây)
3. **Quan sát**: Trong Docker logs, Analytics Service vẫn đang xử lý (delay 5-8s) sau khi response đã trả

### Demo 2: Fan-out
1. Gửi 1 request tạo đơn hàng
2. **Quan sát** Docker logs: Cả 3 consumer (Inventory, Notification, Analytics) đều nhận và xử lý cùng event
3. Response trả về `"subscribers_notified": 3` xác nhận 3 subscriber đã nhận event

### Demo 3: Fault Isolation
1. Gửi nhiều request tạo đơn hàng (3-5 lần)
2. **Quan sát** Docker logs:
   - Notification Service có lần báo `❌ ERROR` (50% xác suất)
   - Nhưng Inventory Service và Analytics Service **vẫn xử lý bình thường**
   - Order Service vẫn trả response thành công
   - Notification Service **không crash** — log lỗi rồi tiếp tục lắng nghe event tiếp theo

### Demo 4: Khả năng mở rộng
- Giải thích: Để thêm chức năng mới (ví dụ: loyalty points), chỉ cần tạo service mới subscribe channel `order_created` — không cần sửa đổi code hiện có (Open/Closed Principle).

## 7. Log output kỳ vọng

```
eda-order-service         | [ORDER SERVICE] ✅ Order abc123 created successfully
eda-order-service         | [ORDER SERVICE] 📤 Event published to 'order_created' — 3 subscriber(s) received
eda-inventory-service     | [INVENTORY] 📦 Received order abc123
eda-inventory-service     | [INVENTORY] ✅ Updated stock: Laptop → deducted 1 unit(s)
eda-inventory-service     | [INVENTORY] ✅ Updated stock: Mouse → deducted 2 unit(s)
eda-inventory-service     | [INVENTORY] ✅ Inventory update completed for order abc123
eda-notification-service  | [NOTIFICATION] 📧 Received order abc123 for customer 'Nguyen Van A'
eda-notification-service  | [NOTIFICATION] ❌ ERROR: Failed to send email — SMTP server unavailable
eda-notification-service  | [NOTIFICATION] ⚡ Service still running — waiting for next event...
eda-analytics-service     | [ANALYTICS] 📊 Received order abc123
eda-analytics-service     | [ANALYTICS] ⏳ Processing analytics (simulated delay: 6.3s)...
eda-analytics-service     | [ANALYTICS] ✅ Analytics recorded:
eda-analytics-service     |     ├── Order ID    : abc123
eda-analytics-service     |     ├── Customer    : Nguyen Van A
eda-analytics-service     |     ├── Total       : 16,000,000
eda-analytics-service     |     └── Process time: 6.3s
```

## 8. Công nghệ sử dụng

- **Python 3.11** — ngôn ngữ lập trình
- **FastAPI** — web framework cho Order Service
- **Redis 7** — message broker (Pub/Sub)
- **Docker & Docker Compose** — container hóa và orchestration
