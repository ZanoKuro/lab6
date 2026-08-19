# 📝 Script Thuyết Trình Demo — Lab6 Event-Driven Architecture

> **Thời lượng ước tính:** 10-15 phút
> **Số người trình bày:** 1-3 (chia theo phần)
> **Chuẩn bị trước:** Chạy `docker-compose up --build` và mở `http://localhost:8000`

---

## PHẦN 1 — MỞ ĐẦU (1 phút)

> 🎤 **Lời thoại:**

*"Xin chào thầy/cô và các bạn. Hôm nay nhóm em sẽ trình bày bài tập về **Event-Driven Architecture** — áp dụng vào bài toán xử lý sau khi đơn hàng được tạo trong hệ thống bán hàng.*

*Bài trình bày gồm 3 phần:*
- *Phần 1: Lý thuyết Event-Driven Architecture*
- *Phần 2: Kiến trúc nhóm đề xuất*
- *Phần 3: Demo live prototype chứng minh các yêu cầu"*

---

## PHẦN 2 — LÝ THUYẾT EDA (3-4 phút)

### 2.1. EDA giải quyết vấn đề gì?

> 🎤 **Lời thoại:**

*"Đầu tiên, **Event-Driven Architecture giải quyết vấn đề gì?***

*Trong kiến trúc truyền thống, khi tạo đơn hàng, server phải lần lượt gọi: trừ kho, gửi email, ghi analytics... rồi mới trả response cho người dùng. Nếu 1 bước chậm hoặc lỗi → toàn bộ request thất bại.*

*EDA giải quyết bằng cách **tách rời** (decouple) các tác vụ phản ứng ra khỏi luồng chính. Thay vì gọi trực tiếp, service chính chỉ cần **phát ra một sự kiện** (event), rồi trả response ngay. Các service khác tự lắng nghe và xử lý event đó một cách độc lập."*

### 2.2. Các thành phần cơ bản

> 🎤 **Lời thoại:**

*"Một hệ thống EDA gồm 3 thành phần chính:*

| Thành phần | Vai trò | Ví dụ trong bài |
|-----------|---------|-----------------|
| **Producer** | Tạo và phát ra event | Order Service |
| **Message Broker** | Trung gian truyền event | Redis Pub/Sub |
| **Consumer** | Lắng nghe và xử lý event | Inventory, Notification, Analytics |

*Producer **không biết** có bao nhiêu consumer, và consumer **không biết** ai đã tạo event. Chúng chỉ giao tiếp qua broker — đây gọi là **loose coupling**."*

### 2.3. Sync vs Async Communication

> 🎤 **Lời thoại:**

*"Sự khác nhau giữa synchronous và asynchronous:*

| | Synchronous | Asynchronous (EDA) |
|---|---|---|
| **Cách gọi** | A gọi B, chờ B trả về | A gửi event, không chờ |
| **Response** | Chậm (phải chờ tất cả) | Nhanh (trả ngay) |
| **Lỗi lan truyền?** | Có — B lỗi thì A cũng lỗi | Không — B lỗi, A vẫn OK |
| **Ví dụ** | REST API call trực tiếp | Redis Pub/Sub, RabbitMQ, Kafka |

*Nhóm em sẽ demo chứng minh điều này ngay sau đây."*

### 2.4. Một event được nhiều thành phần xử lý — Fan-out

> 🎤 **Lời thoại:**

*"Trong EDA, một event có thể được **nhiều consumer xử lý đồng thời** — gọi là **fan-out**. Ví dụ: 1 event `order_created` được cả Inventory, Notification, và Analytics nhận và xử lý song song.*

*Điều này giúp hệ thống dễ mở rộng — muốn thêm chức năng mới (ví dụ loyalty points), chỉ cần thêm 1 consumer mới subscribe cùng channel, **không cần sửa code producer hay consumer cũ**."*

### 2.5. Vấn đề khi event không xử lý được

> 🎤 **Lời thoại:**

*"Khi message không xử lý như mong đợi, có thể xảy ra:*
- ***Message bị mất** — nếu consumer chưa subscribe trước khi event được publish (Redis Pub/Sub không lưu trữ)*
- ***Consumer lỗi** — event đã nhận nhưng xử lý thất bại*
- ***Consumer chậm** — xử lý quá lâu, gây backlog*

*Trong prototype, nhóm giải quyết bằng: mỗi consumer bọc logic trong `try/except` — lỗi chỉ ảnh hưởng consumer đó, service không crash, log lỗi rồi tiếp tục lắng nghe. Trong production thực tế, sẽ cần thêm dead letter queue, retry mechanism, v.v."*

---

## PHẦN 3 — KIẾN TRÚC ĐỀ XUẤT (2 phút)

> 🎤 **Lời thoại:**

*"Giờ nhóm trình bày kiến trúc đề xuất cho bài toán."*

> 📺 **Thao tác:** Mở file [README.md](file:///c:/Code/lab6/README.md) hoặc chiếu sơ đồ kiến trúc:

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
                                    │  (Message Broker) │
                                    └──┬───────┬───────┘
                                       │       │       │
                          SUBSCRIBE    │       │       │    SUBSCRIBE
                    ┌──────────────────┘       │       └──────────────────┐
                    ▼                          ▼                          ▼
          ┌─────────────────┐     ┌──────────────────────┐    ┌──────────────────┐
          │Inventory Service│     │Notification Service  │    │Analytics Service  │
          │   (Consumer)    │     │   (Consumer)         │    │   (Consumer)      │
          │ ✅ Trừ tồn kho  │     │ ⚠️ 50% lỗi giả lập   │    │ ⏳ Delay 5-8s     │
          └─────────────────┘     └──────────────────────┘    └──────────────────┘
```

> 🎤 **Lời thoại:**

*"Nhóm chia thành 5 component chạy trong Docker container độc lập:*

1. ***Redis** — message broker, dùng Pub/Sub truyền event qua channel `order_created`*
2. ***Order Service** (FastAPI) — producer duy nhất. Nhận request tạo đơn, publish event, trả response ngay*
3. ***Inventory Service** — consumer, trừ tồn kho, hoạt động bình thường*
4. ***Notification Service** — consumer, gửi email. **Giả lập lỗi 50%** để chứng minh fault isolation*
5. ***Analytics Service** — consumer, ghi phân tích. **Giả lập delay 5-8 giây** để chứng minh async*

*Nhóm chọn Redis Pub/Sub vì đơn giản, phù hợp prototype, và có fan-out tự nhiên — 1 publish sẽ được tất cả subscriber nhận.*

*Tất cả được đóng gói bằng Docker Compose, chỉ cần 1 lệnh `docker-compose up` là chạy."*

---

## PHẦN 4 — DEMO LIVE (5-7 phút)

### 📺 Chuẩn bị màn hình

> **Thao tác:** Mở browser `http://localhost:8000` — web dashboard hiển thị form tạo đơn hàng bên trái và Live Event Stream bên phải.

> 🎤 **Lời thoại:**

*"Giờ nhóm sẽ demo live. Đây là web dashboard của hệ thống. Bên trái là form tạo đơn hàng, bên phải là **Live Event Stream** hiển thị real-time các event từ tất cả service."*

---

### Demo 4.1 — Tạo đơn hàng + Asynchronous Service Calling

> **Đề bài:** *"Chứng minh thao tác tạo đơn hàng trả kết quả trước khi các xử lý sau đó hoàn tất."*

> 📺 **Thao tác:**
> 1. Nhấn nút **"⚡ Fill Sample Data"** để điền dữ liệu mẫu
> 2. Nhấn nút **"🛒 Create Order"**
> 3. **Chỉ ngay vào response** hiện ra — trả về rất nhanh
> 4. **Chỉ vào Live Event Stream** — Analytics vẫn đang ⏳ processing

> 🎤 **Lời thoại:**

*"Em nhấn tạo đơn hàng... Mời thầy/cô quan sát:*

*→ **Response đã trả về ngay lập tức** — trong vài trăm millisecond.*

*→ Nhưng nhìn vào Live Event Stream, **Analytics Service vẫn đang xử lý** — nó hiện dòng '⏳ Heavy processing started, estimated 6-7 giây'.*

*Điều này chứng minh: **thao tác tạo đơn hàng KHÔNG phải chờ** các consumer xử lý xong. Order Service chỉ publish event rồi trả response ngay — đây chính là **asynchronous service calling**.*

*...(chờ vài giây)... Giờ Analytics đã xong — hiện dòng '✅ Analytics complete' sau ~7 giây. Nhưng người dùng đã nhận response từ lâu rồi."*

> [!TIP]
> **Điểm nhấn cho giảng viên:** Response trả trong ~200ms, Analytics mất 5-8s → client không bị block.

---

### Demo 4.2 — Fan-out

> **Đề bài:** *"Chứng minh một lần tạo đơn hàng có thể kích hoạt nhiều xử lý độc lập."*

> 📺 **Thao tác:**
> 1. Vẫn nhìn vào kết quả vừa rồi trên Live Event Stream
> 2. Chỉ vào **từng nhóm event** theo service

> 🎤 **Lời thoại:**

*"Tiếp theo, mời thầy/cô quan sát Live Event Stream. Từ **1 đơn hàng duy nhất**, có **3 service độc lập** đã nhận và xử lý:*

1. *🟢 **order_service** — tạo order, publish event → '3 subscribers received'*
2. *🔵 **inventory_service** — trừ tồn kho: Laptop -1, Mouse -2, Hub -1*
3. *🟡 **notification_service** — gửi email cho khách hàng*
4. *🟣 **analytics_service** — ghi phân tích, xử lý nặng*

*Mỗi service xử lý **độc lập, song song**, không biết nhau. Đây chính là **fan-out** — 1 event publish, nhiều subscriber nhận.*

*Đặc biệt, nếu muốn thêm chức năng mới — ví dụ loyalty points — chỉ cần tạo service mới subscribe channel `order_created`, **không cần sửa code** Order Service hay bất kỳ consumer nào. Đây tuân thủ **Open/Closed Principle**."*

---

### Demo 4.3 — Fault Isolation

> **Đề bài:** *"Chứng minh khi một xử lý bị chậm hoặc lỗi, các phần còn lại vẫn có thể tiếp tục."*

> 📺 **Thao tác:**
> 1. Tạo thêm **3-4 đơn hàng liên tiếp** (nhấn Fill Sample Data → Create Order, lặp lại)
> 2. Quan sát Live Event Stream — sẽ thấy Notification ❌ lỗi ở một số đơn

> 🎤 **Lời thoại:**

*"Giờ em sẽ tạo thêm vài đơn hàng để chứng minh fault isolation. Notification Service được thiết kế với **50% xác suất lỗi** — giả lập tình huống SMTP server down.*

*(tạo 3-4 đơn hàng...)*

*Mời thầy/cô quan sát Live Event Stream:*

*→ Có đơn hàng Notification báo **❌ Failed to send email — SMTP server unavailable***

*→ Nhưng nhìn ngay bên dưới:*
- ***Inventory Service vẫn ✅** — trừ kho bình thường*
- ***Analytics Service vẫn ✅** — ghi phân tích bình thường*
- ***Order Service vẫn trả response thành công** — người dùng không biết notification bị lỗi*

*Và quan trọng nhất: Notification Service **không crash**. Nó báo lỗi xong, hiện dòng '⚡ Service still running — waiting for next event...' rồi tiếp tục lắng nghe đơn hàng tiếp theo.*

*Đây chính là **fault isolation** — lỗi được **cô lập** trong service gặp lỗi, không lan ra toàn hệ thống."*

> [!TIP]
> **Nếu không thấy lỗi:** Tạo thêm đơn hàng (xác suất 50%, nên 3-5 đơn là chắc chắn thấy lỗi).

> 📺 **Thao tác bổ sung (nếu cần):** Mở terminal, chạy lệnh xem log Notification:
> ```powershell
> docker logs eda-notification-service
> ```
> Chỉ ra dòng ❌ lỗi xen kẽ ✅ thành công, service vẫn chạy liên tục.

---

## PHẦN 5 — GIẢI THÍCH CODE CHÍNH (2 phút, tuỳ chọn)

> 🎤 **Lời thoại (nếu giảng viên hỏi):**

### Producer — Order Service

*"Order Service dùng FastAPI. Khi nhận request, nó tạo event rồi gọi `redis_client.publish()` để phát lên channel `order_created`. Hàm publish trả về số subscriber đã nhận event, rồi service trả response ngay — **không có bất kỳ lệnh chờ nào**."*

```python
# order_service/main.py — dòng 141-156
event_json = json.dumps(event)
num_subscribers = redis_client.publish(CHANNEL_ORDER, event_json)  # Publish rồi đi tiếp

# Trả response ngay — KHÔNG chờ consumer xử lý
return {
    "message": "Order created successfully. Processing in background.",
    "subscribers_notified": num_subscribers,
}
```

### Consumer — Cấu trúc chung

*"Mỗi consumer subscribe channel bằng `pubsub.subscribe()`, rồi lặp vô hạn lắng nghe event. Logic xử lý bọc trong `try/except` — nếu lỗi thì log rồi tiếp tục lặp, **không bao giờ crash**."*

```python
# Cấu trúc chung của mỗi consumer
pubsub.subscribe("order_created")
for message in pubsub.listen():        # Vòng lặp vô hạn
    try:
        event = json.loads(message["data"])
        handle_order_created(event)     # Xử lý event
    except Exception as e:
        print(f"❌ Error: {e}")         # Log lỗi
        # ← Tiếp tục vòng lặp, KHÔNG crash
```

### Lỗi giả lập — Notification

```python
# notification_service/main.py — dòng 18, 50
FAILURE_RATE = 0.5  # 50% xác suất lỗi
if random.random() < FAILURE_RATE:
    print("❌ Failed to send email — SMTP server unavailable")
    return  # Chỉ return, không raise exception, service tiếp tục
```

---

## PHẦN 6 — TỔNG KẾT (1 phút)

> 🎤 **Lời thoại:**

*"Tổng kết, nhóm đã chứng minh được cả **5 yêu cầu** của đề bài:*

| # | Yêu cầu | Đã chứng minh bằng |
|---|---------|---------------------|
| 1 | Đề xuất kiến trúc EDA | Sơ đồ kiến trúc 5 component + Redis Pub/Sub |
| 2 | Implement prototype | Docker Compose chạy 5 container |
| 3 | **Async service calling** | Response ~200ms, Analytics mất 5-8s sau đó |
| 4 | **Fan-out** | 1 event → 3 consumer nhận song song |
| 5 | **Fault isolation** | Notification lỗi 50%, nhưng hệ thống vẫn OK |

*Công nghệ sử dụng: Python 3.11, FastAPI, Redis 7 Pub/Sub, Docker Compose.*

*Cảm ơn thầy/cô đã lắng nghe. Nhóm xin nhận câu hỏi."*

---

## 📌 CÂU HỎI CÓ THỂ GẶP + GỢI Ý TRẢ LỜI

### ❓ "Tại sao chọn Redis Pub/Sub mà không phải RabbitMQ/Kafka?"

> *"Redis Pub/Sub đơn giản, phù hợp prototype. Không cần cài thêm tool. Fan-out tự nhiên — publish 1 lần, tất cả subscriber nhận. Trong production thực tế, nếu cần đảm bảo message không mất, sẽ dùng RabbitMQ hoặc Kafka có message persistence."*

### ❓ "Redis Pub/Sub có nhược điểm gì?"

> *"Không lưu trữ message — nếu consumer chưa subscribe khi event publish thì sẽ mất event. Không có acknowledge mechanism — không biết consumer đã xử lý thành công chưa. Trong production sẽ cần Redis Streams hoặc RabbitMQ để khắc phục."*

### ❓ "Nếu Notification luôn lỗi thì sao?"

> *"Trong prototype, nó chỉ log lỗi rồi bỏ qua. Trong production, sẽ cần thêm: retry mechanism (thử lại 3 lần), dead letter queue (lưu message lỗi để xử lý sau), và alerting (thông báo cho admin)."*

### ❓ "Consumer xử lý chậm có ảnh hưởng event khác không?"

> *"Có — vì mỗi consumer là single-threaded. Ví dụ Analytics mất 7s xử lý event 1, thì event 2 phải chờ. Để giải quyết, có thể scale horizontally — chạy nhiều instance của cùng 1 consumer."*

### ❓ "Thêm consumer mới như thế nào?"

> *"Tạo file Python mới, subscribe channel `order_created`, thêm service vào `docker-compose.yml`. Không cần sửa Order Service hay consumer cũ. Em có thể demo tạo consumer mới ngay nếu thầy/cô muốn."*
