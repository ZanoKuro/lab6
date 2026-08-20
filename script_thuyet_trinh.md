# 📝 Script Thuyết Trình Demo — Lab6 Event-Driven Architecture (Bee Queue)

> **Thời lượng ước tính:** 12-18 phút
> **Số người trình bày:** 1-3 (chia theo phần)
> **Chuẩn bị trước:** Chạy `docker-compose up --build` và mở `http://localhost:8000`

---

## PHẦN 1 — MỞ ĐẦU (1 phút)

> 🎤 **Lời thoại:**

*"Xin chào thầy/cô và các bạn. Hôm nay nhóm em sẽ trình bày bài tập về **Event-Driven Architecture** — áp dụng vào bài toán xử lý sau khi đơn hàng được tạo trong hệ thống bán hàng, sử dụng **Redis Bee Queue** làm job queue.*

*Bài trình bày gồm 3 phần:*
- *Phần 1: Lý thuyết Event-Driven Architecture*
- *Phần 2: Kiến trúc đề xuất với Bee Queue*
- *Phần 3: Demo live trả lời 6 câu hỏi"*

---

## PHẦN 2 — LÝ THUYẾT EDA (3-4 phút)

### 2.1. EDA giải quyết vấn đề gì?

> 🎤 **Lời thoại:**

*"Đầu tiên, **Event-Driven Architecture giải quyết vấn đề gì?***

*Trong kiến trúc truyền thống, khi tạo đơn hàng, server phải lần lượt gọi: trừ kho, gửi email, ghi analytics... rồi mới trả response cho người dùng. Nếu 1 bước chậm hoặc lỗi → toàn bộ request thất bại.*

*EDA giải quyết bằng cách **tách rời** (decouple) các tác vụ phản ứng ra khỏi luồng chính. Thay vì gọi trực tiếp, service chính chỉ cần **đẩy job vào queue**, rồi trả response ngay. Các worker tự lắng nghe và xử lý job đó một cách độc lập."*

### 2.2. Tại sao chọn Bee Queue?

> 🎤 **Lời thoại:**

*"Nhóm chọn **Bee Queue** thay vì Redis Pub/Sub thuần vì những lý do sau:*

| Tiêu chí | Redis Pub/Sub | Bee Queue |
|---|---|---|
| **Lưu message** | ❌ Fire-and-forget | ✅ Lưu trong Redis |
| **Retry khi lỗi** | ❌ Không | ✅ Built-in retries |
| **Điều khiển worker** | ❌ Không | ✅ `isWorker` flag |
| **Theo dõi job** | ❌ Không | ✅ Job events + progress |
| **Job ID** | Phải tự tạo | ✅ Tự động gán |

*Bee Queue là lightweight job queue cho Node.js, backed by Redis. Nó vẫn dùng Redis làm backend nhưng thêm các tính năng production-ready."*

### 2.3. Các thành phần cơ bản

> 🎤 **Lời thoại:**

*"Hệ thống gồm:*

| Thành phần | Vai trò | Config |
|-----------|---------|--------|
| **Order Service** | Producer — tạo job | `isWorker: false` |
| **Inventory Worker** | Consumer — trừ kho | `isWorker: true` |
| **Notification Worker** | Consumer — gửi email | `isWorker: true`, 50% lỗi |
| **Analytics Worker** | Consumer — phân tích | `isWorker: true`, delay 5-8s |
| **Redis** | Job store | AOF persistence |

*Mỗi worker có queue riêng. Order Service fan-out: đẩy job vào 3 queue khác nhau."*

---

## PHẦN 3 — KIẾN TRÚC ĐỀ XUẤT (2 phút)

> 📺 **Thao tác:** Chiếu sơ đồ kiến trúc:

```
┌────────────┐     POST /orders      ┌─────────────────┐
│   Client   │ ──────────────────────▶│  Order Service  │
│ (Web UI)   │ ◀── response ngay ────│  (Express.js)   │
└────────────┘                        └────────┬────────┘
                                               │
                                    createJob()│→ 3 queues
                                               ▼
                                    ┌──────────────────┐
                                    │    Redis 7        │
                                    │  (AOF Persistence)│
                                    │  ┌──────────────┐ │
                                    │  │inventory_queue│ │
                                    │  │notif_queue    │ │
                                    │  │analytics_queue│ │
                                    │  └──────────────┘ │
                                    └──┬───────┬───────┘
                                       │       │       │
                         process()     │       │       │    process()
                    ┌──────────────────┘       │       └──────────────────┐
                    ▼                          ▼                          ▼
          ┌─────────────────┐     ┌──────────────────────┐    ┌──────────────────┐
          │Inventory Worker │     │Notification Worker   │    │Analytics Worker   │
          │ isWorker: true  │     │ isWorker: true       │    │ isWorker: true    │
          │ ✅ Trừ tồn kho  │     │ ⚠️ 50% lỗi + retry   │    │ ⏳ Delay 5-8s     │
          └─────────────────┘     └──────────────────────┘    └──────────────────┘
```

> 🎤 **Lời thoại:**

*"Khác với Pub/Sub broadcast, ở đây Order Service chủ động đẩy job vào 3 queue riêng. Mỗi worker chỉ process queue của mình — đây là **fan-out có kiểm soát**.*

*Redis cấu hình AOF persistence — tất cả job được ghi vào disk. Nếu Redis restart, data được khôi phục từ AOF file."*

---

## PHẦN 4 — DEMO LIVE (7-10 phút)

### 📺 Chuẩn bị màn hình

> **Thao tác:** Mở browser `http://localhost:8000`

> 🎤 **Lời thoại:**

*"Đây là web dashboard. Có 3 tab: Dashboard để tạo đơn hàng, Admin Panel để xem config Redis và trạng thái service, và Job Inspector để xem chi tiết từng job."*

---

### Demo 4.1 — Câu hỏi 6: Mỗi event có ID không?

> 📺 **Thao tác:**
> 1. Fill Sample Data → Create Order
> 2. Quan sát Live Event Stream → chỉ vào `[Job #1]`, `[Job #2]`, `[Job #3]`
> 3. Mở tab **Job Inspector** → chỉ vào cột Job ID

> 🎤 **Lời thoại:**

*"Mời thầy/cô quan sát: mỗi event đều có ID. Trong Live Event Stream, mỗi dòng log hiển thị `[Job #1]`, `[Job #2]`, `[Job #3]` — đây là ID do Bee Queue tự động gán (auto-increment).*

*Mở tab Job Inspector — mỗi job hiển thị ID, queue, status, progress. Nhấn View để xem payload — bên trong còn có `event_id` là UUID do Order Service tạo."*

---

### Demo 4.2 — Câu hỏi 5: Xem service chạy như thế nào (payload)?

> 📺 **Thao tác:**
> 1. Vẫn ở tab Job Inspector
> 2. Nhấn **View** trên 1 job → modal hiện ra
> 3. Chỉ vào payload JSON

> 🎤 **Lời thoại:**

*"Đây là Job Inspector — mỗi job hiển thị đầy đủ thông tin:
- **Job ID**: #1, #2, #3...
- **Queue**: job đang ở queue nào
- **Status**: created, succeeded, failed, retrying
- **Progress**: phần trăm xử lý
- **Payload**: toàn bộ dữ liệu JSON — event_id, event_type, data gồm order_id, customer, items, total*

*Nhấn View → thấy payload chi tiết và result sau khi xử lý xong."*

---

### Demo 4.3 — Câu hỏi 1: Redis cấu hình gì?

> 📺 **Thao tác:**
> 1. Chuyển sang tab **Admin Panel**
> 2. Chỉ vào phần **Redis Configuration**

> 🎤 **Lời thoại:**

*"Mời thầy/cô xem tab Admin Panel — phần Redis Configuration:*

- ***Connection:** host=redis, port=6379*
- ***Queue Settings:** isWorker=false (Order Service chỉ là producer), stallInterval=5000ms (kiểm tra job bị stuck mỗi 5s)*
- ***Persistence:** appendonly=yes (bật AOF), appendfsync=everysec (flush mỗi giây), maxmemory-policy=noeviction (không tự xoá key)*

*Cấu hình này đảm bảo mọi job được lưu vào disk — không bị mất khi service restart."*

---

### Demo 4.4 — Câu hỏi 2: Có điều khiển được các subscriber không?

> 📺 **Thao tác:**
> 1. Vẫn ở Admin Panel → chỉ phần Worker Services Status
> 2. Chạy lệnh: `docker stop eda-notification-service`
> 3. Tạo 1 đơn hàng mới
> 4. Quan sát: inventory và analytics xử lý, notification nằm chờ
> 5. Chạy: `docker start eda-notification-service`
> 6. Quan sát: notification bắt đầu xử lý job chờ

> 🎤 **Lời thoại:**

*"Bee Queue cho phép điều khiển subscriber bằng `isWorker` flag:*

- *`isWorker: true` → worker lắng nghe và xử lý job*
- *`isWorker: false` → worker KHÔNG xử lý, chỉ tạo job*

*Em sẽ demo: stop notification service → tạo đơn hàng → chỉ inventory và analytics xử lý, notification job nằm chờ trong queue.*

*(stop, tạo order, quan sát)*

*Bây giờ start lại notification → nó tự nhận job đang chờ và xử lý. Đây chứng minh ta có thể **điều khiển** service nào nhận job, service nào không."*

---

### Demo 4.5 — Câu hỏi 3: Thêm service không sub vào channel?

> 🎤 **Lời thoại:**

*"Hoàn toàn được. Trong docker-compose, chỉ cần set `IS_WORKER=false`:*

```yaml
environment:
  - IS_WORKER=false
```

*Service sẽ kết nối Redis bình thường nhưng **không gọi `queue.process()`** — nên không nhận job nào. Trong code:*

```javascript
if (IS_WORKER) {
    queue.process(async (job) => { ... }); // Xử lý job
} else {
    console.log('NON-WORKER mode — will NOT process jobs');
}
```

*Service này có thể dùng để monitor queue, tạo job, nhưng không consume."*

---

### Demo 4.6 — Câu hỏi 4: Service sập thì sao? Có lưu message không?

> 📺 **Thao tác:**
> 1. Chạy lệnh: `docker stop eda-inventory-service`
> 2. Tạo 1-2 đơn hàng
> 3. Mở Admin Panel → Queue Health → thấy `inventory_queue: waiting: 1-2`
> 4. Chạy: `docker start eda-inventory-service`
> 5. Quan sát Live Event Stream → inventory bắt đầu xử lý job cũ

> 🎤 **Lời thoại:**

*"Đây là điểm mạnh nhất của Bee Queue so với Pub/Sub. Em sẽ stop inventory service, rồi tạo đơn hàng.*

*(stop container, tạo order)*

*Mời thầy/cô xem Admin Panel → Queue Health: `inventory_queue` có `waiting: 1` — job đang nằm chờ trong Redis, **không bị mất**.*

*Giờ em start lại inventory...*

*(start container)*

*Quan sát Live Event Stream: inventory worker khởi động → tự nhận job đang chờ → xử lý bình thường!*

*Điều này xảy ra được vì:*
1. *Redis bật **AOF persistence** — ghi mọi write vào disk*
2. *Bee Queue lưu job trong Redis **list/hash** — không phải fire-and-forget như Pub/Sub*
3. *Worker dùng `queue.process()` — tự pull job từ queue khi start*

*Nếu dùng Redis Pub/Sub thuần, message sẽ bị **mất hoàn toàn** vì không có ai subscribe lúc publish."*

> [!TIP]
> **Điểm nhấn:** So sánh trực tiếp Pub/Sub (mất message) vs Bee Queue (lưu + khôi phục).

---

### Demo 4.7 — Async + Fan-out + Fault Isolation (bonus)

> 📺 **Thao tác:**
> 1. Tạo 3-5 đơn hàng liên tiếp
> 2. Quan sát Live Event Stream

> 🎤 **Lời thoại:**

*"Cuối cùng, em demo nhanh 3 tính năng cốt lõi:*

1. ***Async:** Response trả trong ~200ms, Analytics mất 5-8s → client không bị block*
2. ***Fan-out:** 1 order → 3 job vào 3 queue → 3 worker xử lý song song*
3. ***Fault Isolation:** Notification lỗi 50%, nhưng:*
   - *Inventory vẫn ✅*
   - *Analytics vẫn ✅*
   - *Order vẫn trả response thành công*
   - *Bee Queue **tự retry** notification job (hiện dòng 'retrying')*

*Notification không crash — nó throw error, Bee Queue bắt lỗi, retry tối đa 3 lần với backoff 2 giây."*

---

## PHẦN 5 — TỔNG KẾT (1 phút)

> 🎤 **Lời thoại:**

*"Tổng kết, nhóm đã trả lời được cả **6 câu hỏi**:*

| # | Câu hỏi | Trả lời |
|---|---------|---------|
| 1 | Redis cấu hình gì? | AOF persistence, isWorker, stallInterval — xem trên Admin Panel |
| 2 | Điều khiển subscriber? | ✅ Bằng `isWorker` flag — demo stop/start container |
| 3 | Service không sub? | ✅ Set `IS_WORKER=false` → không gọi `queue.process()` |
| 4 | Service sập, lưu message? | ✅ Bee Queue lưu job trong Redis, AOF ghi disk — demo stop/start |
| 5 | Xem payload? | ✅ Job Inspector — ID, payload JSON, status, progress, result |
| 6 | Event có ID? | ✅ `job.id` (auto) + `event_id` (UUID) |

*Công nghệ: Node.js 20, Express.js, Bee Queue, Redis 7 (AOF), Docker Compose.*

*Cảm ơn thầy/cô đã lắng nghe. Nhóm xin nhận câu hỏi."*

---

## 📌 CÂU HỎI CÓ THỂ GẶP + GỢI Ý TRẢ LỜI

### ❓ "Tại sao không dùng BullMQ thay vì Bee Queue?"

> *"Bee Queue nhẹ hơn (~1000 dòng code), phù hợp prototype. BullMQ mạnh hơn nhưng phức tạp hơn (priority queues, rate limiting, job flows). Cho bài lab này, Bee Queue đủ để demo tất cả concept."*

### ❓ "Bee Queue khác gì Redis Streams?"

> *"Redis Streams là native Redis feature (XADD/XREAD), cần tự implement retry/progress. Bee Queue là abstraction layer — cung cấp API level cao hơn: `createJob()`, `process()`, `retries()`, `reportProgress()`. Trade-off: thêm dependency nhưng đơn giản hơn nhiều."*

### ❓ "Job retry hoạt động thế nào?"

> *"Khi worker throw error, Bee Queue tự move job về waiting list. Cấu hình: `job.retries(3).backoff('fixed', 2000)` — retry tối đa 3 lần, mỗi lần chờ 2 giây. Nếu hết retry → job chuyển sang trạng thái 'failed'. Demo: Notification service lỗi 50%, thấy dòng 'retrying' trên event stream."*

### ❓ "Stalled job là gì?"

> *"Stalled job = job bị 'kẹt' — worker nhận job nhưng không heartbeat (vì crash hoặc event loop bị block). Bee Queue kiểm tra mỗi `stallInterval` (5s), nếu phát hiện stalled job → re-enqueue để worker khác xử lý. Đảm bảo at-least-once delivery."*
