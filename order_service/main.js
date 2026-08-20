/**
 * Order Service — Producer + Web Dashboard
 * ==========================================
 * Express.js server + Bee Queue producer.
 * Tạo đơn hàng → đẩy job vào 3 queue riêng biệt (fan-out có kiểm soát).
 * Cung cấp:
 *   - POST /orders          — tạo đơn hàng, fan-out job
 *   - GET  /orders          — liệt kê đơn hàng
 *   - GET  /events          — SSE stream real-time logs
 *   - GET  /admin/redis-config  — xem Redis config
 *   - GET  /admin/services      — trạng thái các worker
 *   - GET  /jobs            — liệt kê jobs
 *   - GET  /jobs/:id        — chi tiết 1 job
 *   - GET  /                — Web Dashboard
 */

const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Queue = require('bee-queue');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// ── Redis Configuration ─────────────────────────────────────────────────────
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

const redisConfig = {
    host: REDIS_HOST,
    port: REDIS_PORT,
};

// Redis client for Pub/Sub logs (giữ lại Pub/Sub cho SSE streaming)
const redisPub = new Redis(redisConfig);
const redisSub = new Redis(redisConfig);

const CHANNEL_LOGS = 'service_logs';

// ── Bee Queue — tạo 3 queue cho fan-out ─────────────────────────────────────
const queueSettings = {
    redis: redisConfig,
    isWorker: false,          // Producer — KHÔNG xử lý job, chỉ tạo job
    removeOnSuccess: false,   // Giữ lại job sau khi xong để inspect
    removeOnFailure: false,   // Giữ lại job lỗi để debug
    stallInterval: 5000,      // Kiểm tra stalled job mỗi 5s
};

const inventoryQueue = new Queue('inventory_queue', queueSettings);
const notificationQueue = new Queue('notification_queue', queueSettings);
const analyticsQueue = new Queue('analytics_queue', queueSettings);

const queues = {
    inventory_queue: inventoryQueue,
    notification_queue: notificationQueue,
    analytics_queue: analyticsQueue,
};

// ── In-memory stores ────────────────────────────────────────────────────────
const ordersDb = {};
const jobsDb = {};      // Track all jobs: { jobId: { queue, status, payload, ... } }
const serviceStatus = {  // Track worker status
    inventory_service: { active: true, lastSeen: null, jobsProcessed: 0 },
    notification_service: { active: true, lastSeen: null, jobsProcessed: 0 },
    analytics_service: { active: true, lastSeen: null, jobsProcessed: 0 },
};

// ── Helper: publish log ─────────────────────────────────────────────────────
function publishLog(level, message, extra = {}) {
    const logData = JSON.stringify({
        service: 'order_service',
        level,
        message,
        timestamp: new Date().toISOString(),
        ...extra,
    });
    redisPub.publish(CHANNEL_LOGS, logData).catch(() => {});
}

// ── Listen for queue events (job-level) ─────────────────────────────────────
function setupQueueEvents(queue, queueName) {
    queue.on('ready', () => {
        console.log(`[ORDER SERVICE] ✅ Queue '${queueName}' ready`);
    });
    queue.on('error', (err) => {
        console.error(`[ORDER SERVICE] ❌ Queue '${queueName}' error:`, err.message);
    });
}

setupQueueEvents(inventoryQueue, 'inventory_queue');
setupQueueEvents(notificationQueue, 'notification_queue');
setupQueueEvents(analyticsQueue, 'analytics_queue');

// ── Endpoints ───────────────────────────────────────────────────────────────

// Serve Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// SSE — stream real-time logs from all services
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const sub = new Redis(redisConfig);
    sub.subscribe(CHANNEL_LOGS);

    sub.on('message', (channel, data) => {
        if (channel === CHANNEL_LOGS) {
            res.write(`data: ${data}\n\n`);
        }
    });

    req.on('close', () => {
        sub.unsubscribe(CHANNEL_LOGS);
        sub.disconnect();
    });
});

// Create Order — fan-out to 3 queues
app.post('/orders', async (req, res) => {
    try {
        const { customer_name, items } = req.body;

        if (!customer_name || !items || items.length === 0) {
            return res.status(400).json({ error: 'customer_name and items are required' });
        }

        const orderId = uuidv4();
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

        const orderData = {
            order_id: orderId,
            customer_name,
            items,
            total,
            status: 'created',
            created_at: new Date().toISOString(),
        };
        ordersDb[orderId] = orderData;

        // Event payload chung cho tất cả queue
        const eventPayload = {
            event_id: uuidv4(),
            event_type: 'order_created',
            timestamp: new Date().toISOString(),
            data: orderData,
        };

        const itemsStr = items.map(i => `${i.product} x${i.quantity}`).join(', ');
        publishLog('info', `📦 Creating order for '${customer_name}': ${itemsStr}`, { order_id: orderId });

        // Fan-out: tạo job cho mỗi queue
        const jobResults = {};
        const queueEntries = [
            ['inventory_queue', inventoryQueue],
            ['notification_queue', notificationQueue],
            ['analytics_queue', analyticsQueue],
        ];

        let activeWorkers = 0;

        for (const [qName, queue] of queueEntries) {
            try {
                const job = queue.createJob(eventPayload);
                job.retries(3);
                job.backoff('fixed', 2000);
                job.timeout(30000);

                const savedJob = await job.save();

                jobResults[qName] = {
                    job_id: savedJob.id,
                    status: 'created',
                };

                // Track job
                jobsDb[savedJob.id] = {
                    id: savedJob.id,
                    queue: qName,
                    status: 'created',
                    payload: eventPayload,
                    created_at: new Date().toISOString(),
                    result: null,
                    error: null,
                    progress: 0,
                };

                activeWorkers++;

                // Listen for job events
                savedJob.on('succeeded', (result) => {
                    if (jobsDb[savedJob.id]) {
                        jobsDb[savedJob.id].status = 'succeeded';
                        jobsDb[savedJob.id].result = result;
                    }
                });

                savedJob.on('failed', (err) => {
                    if (jobsDb[savedJob.id]) {
                        jobsDb[savedJob.id].status = 'failed';
                        jobsDb[savedJob.id].error = err.message;
                    }
                });

                savedJob.on('progress', (progress) => {
                    if (jobsDb[savedJob.id]) {
                        jobsDb[savedJob.id].progress = progress;
                    }
                });

                savedJob.on('retrying', (err) => {
                    if (jobsDb[savedJob.id]) {
                        jobsDb[savedJob.id].status = 'retrying';
                        jobsDb[savedJob.id].error = err.message;
                    }
                    publishLog('warning', `🔄 Job ${savedJob.id} retrying in ${qName}: ${err.message}`, { order_id: orderId, job_id: savedJob.id });
                });

            } catch (err) {
                console.error(`[ORDER SERVICE] ❌ Failed to create job in ${qName}:`, err.message);
                jobResults[qName] = { error: err.message };
            }
        }

        publishLog('success',
            `✅ Order ${orderId.slice(0, 8)}... created — jobs dispatched to ${activeWorkers} queue(s)`,
            { order_id: orderId, jobs: jobResults }
        );

        console.log(`[ORDER SERVICE] ✅ Order ${orderId} created`);
        console.log(`[ORDER SERVICE] 📤 Jobs dispatched to ${activeWorkers} queue(s)`);

        res.json({
            message: 'Order created successfully. Processing in background.',
            order_id: orderId,
            total,
            subscribers_notified: activeWorkers,
            jobs: jobResults,
        });

    } catch (err) {
        console.error('[ORDER SERVICE] ❌ Error creating order:', err);
        res.status(500).json({ error: err.message });
    }
});

// List orders
app.get('/orders', (req, res) => {
    res.json({ orders: Object.values(ordersDb) });
});

// Get order by ID
app.get('/orders/:id', (req, res) => {
    const order = ordersDb[req.params.id];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
});

// ── Admin APIs ──────────────────────────────────────────────────────────────

// Get Redis configuration
app.get('/admin/redis-config', (req, res) => {
    res.json({
        connection: {
            host: REDIS_HOST,
            port: REDIS_PORT,
        },
        queue_settings: {
            isWorker: false,
            removeOnSuccess: false,
            removeOnFailure: false,
            stallInterval: '5000ms',
        },
        persistence: {
            appendonly: 'yes',
            appendfsync: 'everysec',
            maxmemory_policy: 'noeviction',
        },
        queues: Object.keys(queues),
    });
});

// Get service status
app.get('/admin/services', (req, res) => {
    res.json({ services: serviceStatus });
});

// Update service status (từ worker heartbeat)
app.post('/admin/services/:name/heartbeat', (req, res) => {
    const { name } = req.params;
    const { active, jobsProcessed } = req.body;

    if (serviceStatus[name]) {
        serviceStatus[name].active = active !== undefined ? active : serviceStatus[name].active;
        serviceStatus[name].lastSeen = new Date().toISOString();
        if (jobsProcessed !== undefined) {
            serviceStatus[name].jobsProcessed = jobsProcessed;
        }
    }
    res.json({ ok: true });
});

// ── Job Inspector APIs ──────────────────────────────────────────────────────

// List all tracked jobs
app.get('/jobs', (req, res) => {
    const jobs = Object.values(jobsDb).sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    );
    res.json({ jobs });
});

// Get single job detail
app.get('/jobs/:id', (req, res) => {
    const job = jobsDb[req.params.id];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

// Get queue health
app.get('/admin/queues', async (req, res) => {
    const result = {};
    for (const [name, queue] of Object.entries(queues)) {
        try {
            const health = await queue.checkHealth();
            result[name] = health;
        } catch (err) {
            result[name] = { error: err.message };
        }
    }
    res.json({ queues: result });
});

// ── Start Server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ORDER SERVICE] 🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`[ORDER SERVICE] 📊 Redis: ${REDIS_HOST}:${REDIS_PORT}`);
    console.log(`[ORDER SERVICE] 📦 Queues: inventory_queue, notification_queue, analytics_queue`);
    console.log(`[ORDER SERVICE] 🔧 Mode: PRODUCER (isWorker: false)`);
});
