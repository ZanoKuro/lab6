/**
 * Notification Service — Bee Queue Worker
 * =========================================
 * Worker xử lý job từ queue 'notification_queue'.
 * Giả lập gửi email — 50% xác suất lỗi để demo fault isolation + retry.
 * 
 * Features:
 *   - 50% failure rate → Bee Queue tự retry (max 2 lần)
 *   - isWorker: true (có thể toggle qua env)
 *   - Report progress
 *   - Gửi log qua Redis Pub/Sub cho SSE
 */

const Queue = require('bee-queue');
const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const SERVICE_NAME = 'notification_service';
const IS_WORKER = process.env.IS_WORKER !== 'false';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order_service:8000';
const CHANNEL_LOGS = 'service_logs';
const FAILURE_RATE = 0.5; // 50% xác suất lỗi

const redisConfig = { host: REDIS_HOST, port: REDIS_PORT };
const redisPub = new Redis(redisConfig);

let jobsProcessed = 0;

function publishLog(level, message, extra = {}) {
    const logData = JSON.stringify({
        service: SERVICE_NAME,
        level,
        message,
        timestamp: new Date().toISOString(),
        ...extra,
    });
    redisPub.publish(CHANNEL_LOGS, logData).catch(() => {});
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendHeartbeat() {
    try {
        await fetch(`${ORDER_SERVICE_URL}/admin/services/${SERVICE_NAME}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: IS_WORKER, jobsProcessed }),
        });
    } catch (err) { /* ignore */ }
}

// ── Bee Queue Worker ────────────────────────────────────────────────────────
const queue = new Queue('notification_queue', {
    redis: redisConfig,
    isWorker: IS_WORKER,
    removeOnSuccess: false,
    removeOnFailure: false,
    stallInterval: 5000,
});

queue.on('ready', () => {
    console.log(`[NOTIFICATION] 🚀 Worker ready (isWorker: ${IS_WORKER})`);
    console.log(`[NOTIFICATION] ⚠️  Simulated failure rate: ${FAILURE_RATE * 100}%`);
    publishLog('info', `🚀 Notification Service started (isWorker: ${IS_WORKER}, failureRate: ${FAILURE_RATE * 100}%)`);
});

queue.on('error', (err) => {
    console.error(`[NOTIFICATION] ❌ Queue error:`, err.message);
});

queue.on('stalled', (jobId) => {
    console.log(`[NOTIFICATION] ⚠️ Job ${jobId} stalled`);
    publishLog('warning', `⚠️ Job ${jobId} stalled — will be retried`, { job_id: jobId });
});

if (IS_WORKER) {
    queue.process(async (job) => {
        const event = job.data;
        const data = event.data;
        const orderId = data.order_id;
        const customerName = data.customer_name;
        const total = data.total;

        console.log(`[NOTIFICATION] 📧 Job ${job.id} — Sending email for order ${orderId}`);
        publishLog('info', `📧 [Job #${job.id}] Preparing email for '${customerName}'...`, { order_id: orderId, job_id: job.id });

        job.reportProgress(30);

        // Giả lập xử lý
        await sleep(1000);
        job.reportProgress(60);

        // Giả lập lỗi ngẫu nhiên — throw error để Bee Queue retry
        if (Math.random() < FAILURE_RATE) {
            const errorMsg = `SMTP server unavailable — failed to send email to '${customerName}'`;
            console.log(`[NOTIFICATION] ❌ ${errorMsg}`);
            publishLog('error', `❌ [Job #${job.id}] Failed: ${errorMsg}`, { order_id: orderId, job_id: job.id });
            publishLog('warning', `⚡ [Job #${job.id}] Service still running — Bee Queue will retry automatically`, { order_id: orderId, job_id: job.id });
            console.log(`[NOTIFICATION] ⚡ Service still running — waiting for next job...`);
            console.log('-'.repeat(60));

            // Throw error → Bee Queue sẽ retry theo cấu hình
            throw new Error(errorMsg);
        }

        job.reportProgress(100);

        const totalFormatted = new Intl.NumberFormat('vi-VN').format(total);
        const msg = `✅ Email sent to '${customerName}': 'Your order ${orderId.slice(0, 8)}... (total: ${totalFormatted}) confirmed!'`;
        console.log(`[NOTIFICATION] ${msg}`);
        publishLog('success', `[Job #${job.id}] ${msg}`, { order_id: orderId, job_id: job.id });
        console.log('-'.repeat(60));

        jobsProcessed++;
        sendHeartbeat();

        return { status: 'sent', customer: customerName, order_id: orderId };
    });
} else {
    console.log('[NOTIFICATION] 📵 Running in NON-WORKER mode');
    publishLog('warning', '📵 Running in NON-WORKER mode — will NOT process jobs');
}

setInterval(sendHeartbeat, 10000);

console.log(`[NOTIFICATION] 🔧 Config: Redis=${REDIS_HOST}:${REDIS_PORT}, isWorker=${IS_WORKER}`);
