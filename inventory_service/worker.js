/**
 * Inventory Service — Bee Queue Worker
 * ======================================
 * Worker xử lý job từ queue 'inventory_queue'.
 * Giả lập trừ tồn kho cho từng sản phẩm trong đơn hàng.
 * 
 * Features:
 *   - isWorker: true (có thể toggle qua env)
 *   - Report progress theo từng item
 *   - Gửi log qua Redis Pub/Sub cho SSE
 *   - Heartbeat gửi về Order Service
 */

const Queue = require('bee-queue');
const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const SERVICE_NAME = 'inventory_service';
const IS_WORKER = process.env.IS_WORKER !== 'false'; // default true
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order_service:8000';
const CHANNEL_LOGS = 'service_logs';

const redisConfig = { host: REDIS_HOST, port: REDIS_PORT };
const redisPub = new Redis(redisConfig);

let jobsProcessed = 0;

// ── Helper: publish log to SSE stream ───────────────────────────────────────
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

// ── Helper: sleep ───────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Helper: heartbeat ───────────────────────────────────────────────────────
async function sendHeartbeat() {
    try {
        const resp = await fetch(`${ORDER_SERVICE_URL}/admin/services/${SERVICE_NAME}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: IS_WORKER, jobsProcessed }),
        });
    } catch (err) {
        // Silently ignore heartbeat errors
    }
}

// ── Bee Queue Worker ────────────────────────────────────────────────────────
const queue = new Queue('inventory_queue', {
    redis: redisConfig,
    isWorker: IS_WORKER,
    removeOnSuccess: false,
    removeOnFailure: false,
    stallInterval: 5000,
});

queue.on('ready', () => {
    console.log(`[INVENTORY] 🚀 Worker ready (isWorker: ${IS_WORKER})`);
    publishLog('info', `🚀 Inventory Service started (isWorker: ${IS_WORKER})`);
});

queue.on('error', (err) => {
    console.error(`[INVENTORY] ❌ Queue error:`, err.message);
    publishLog('error', `❌ Queue error: ${err.message}`);
});

queue.on('stalled', (jobId) => {
    console.log(`[INVENTORY] ⚠️ Job ${jobId} stalled — will be retried`);
    publishLog('warning', `⚠️ Job ${jobId} stalled — will be retried`, { job_id: jobId });
});

if (IS_WORKER) {
    queue.process(async (job) => {
        const event = job.data;
        const data = event.data;
        const orderId = data.order_id;
        const items = data.items;
        const totalItems = items.length;

        console.log(`[INVENTORY] 📦 Job ${job.id} — Processing order ${orderId}`);
        publishLog('info', `📦 [Job #${job.id}] Received order ${orderId.slice(0, 8)}...`, { order_id: orderId, job_id: job.id });

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // Giả lập xử lý
            await sleep(500);

            const progress = Math.round(((i + 1) / totalItems) * 100);
            job.reportProgress(progress);

            const msg = `✅ Stock updated: ${item.product} → deducted ${item.quantity} unit(s) [${progress}%]`;
            console.log(`[INVENTORY] ${msg}`);
            publishLog('success', `[Job #${job.id}] ${msg}`, { order_id: orderId, job_id: job.id });
        }

        const resultMsg = `🎉 Inventory update completed for order ${orderId.slice(0, 8)}... (${totalItems} items)`;
        console.log(`[INVENTORY] ${resultMsg}`);
        publishLog('success', `[Job #${job.id}] ${resultMsg}`, { order_id: orderId, job_id: job.id });
        console.log('-'.repeat(60));

        jobsProcessed++;
        sendHeartbeat();

        return { status: 'completed', items_processed: totalItems, order_id: orderId };
    });
} else {
    console.log('[INVENTORY] 📵 Running in NON-WORKER mode — will NOT process jobs');
    publishLog('warning', '📵 Running in NON-WORKER mode — will NOT process jobs');
}

// Heartbeat interval
setInterval(sendHeartbeat, 10000);

console.log(`[INVENTORY] 🔧 Config: Redis=${REDIS_HOST}:${REDIS_PORT}, isWorker=${IS_WORKER}`);
