/**
 * Analytics Service — Bee Queue Worker
 * ======================================
 * Worker xử lý job từ queue 'analytics_queue'.
 * Giả lập phân tích dữ liệu nặng — delay 5-8 giây + progress reporting.
 * 
 * Features:
 *   - Heavy processing delay (5-8s) để demo async
 *   - Report progress theo % trong quá trình delay
 *   - isWorker: configurable
 */

const Queue = require('bee-queue');
const Redis = require('ioredis');

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const SERVICE_NAME = 'analytics_service';
const IS_WORKER = process.env.IS_WORKER !== 'false';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order_service:8000';
const CHANNEL_LOGS = 'service_logs';
const MIN_DELAY = 5; // giây
const MAX_DELAY = 8; // giây

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
const queue = new Queue('analytics_queue', {
    redis: redisConfig,
    isWorker: IS_WORKER,
    removeOnSuccess: false,
    removeOnFailure: false,
    stallInterval: 5000,
});

queue.on('ready', () => {
    console.log(`[ANALYTICS] 🚀 Worker ready (isWorker: ${IS_WORKER})`);
    console.log(`[ANALYTICS] ⏳ Processing delay: ${MIN_DELAY}-${MAX_DELAY}s per job`);
    publishLog('info', `🚀 Analytics Service started (isWorker: ${IS_WORKER}, delay: ${MIN_DELAY}-${MAX_DELAY}s)`);
});

queue.on('error', (err) => {
    console.error(`[ANALYTICS] ❌ Queue error:`, err.message);
});

queue.on('stalled', (jobId) => {
    console.log(`[ANALYTICS] ⚠️ Job ${jobId} stalled`);
    publishLog('warning', `⚠️ Job ${jobId} stalled — will be retried`, { job_id: jobId });
});

if (IS_WORKER) {
    queue.process(async (job) => {
        const event = job.data;
        const data = event.data;
        const orderId = data.order_id;
        const customerName = data.customer_name;
        const total = data.total;
        const numItems = data.items.length;

        const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
        const delayMs = delay * 1000;
        const steps = 10; // Report progress in 10 steps
        const stepDelay = delayMs / steps;

        console.log(`[ANALYTICS] 📊 Job ${job.id} — Processing order ${orderId}`);
        publishLog('info', `📊 [Job #${job.id}] Received order ${orderId.slice(0, 8)}...`, { order_id: orderId, job_id: job.id });
        publishLog('warning', `⏳ [Job #${job.id}] Heavy processing started (estimated: ${delay.toFixed(1)}s)...`, { order_id: orderId, job_id: job.id });

        console.log(`[ANALYTICS] ⏳ Processing analytics (delay: ${delay.toFixed(1)}s)...`);

        // Giả lập xử lý chậm — report progress theo %
        for (let i = 1; i <= steps; i++) {
            await sleep(stepDelay);
            const progress = Math.round((i / steps) * 100);
            job.reportProgress(progress);
        }

        const totalFormatted = new Intl.NumberFormat('vi-VN').format(total);
        const resultMsg = `✅ Analytics complete — Customer: ${customerName}, Total: ${totalFormatted}, Items: ${numItems}, Processed in ${delay.toFixed(1)}s`;

        console.log(`[ANALYTICS] ${resultMsg}`);
        publishLog('success', `[Job #${job.id}] ${resultMsg}`, { order_id: orderId, job_id: job.id });
        console.log('-'.repeat(60));

        jobsProcessed++;
        sendHeartbeat();

        return {
            status: 'completed',
            customer: customerName,
            total,
            items: numItems,
            processing_time: `${delay.toFixed(1)}s`,
            order_id: orderId,
        };
    });
} else {
    console.log('[ANALYTICS] 📵 Running in NON-WORKER mode');
    publishLog('warning', '📵 Running in NON-WORKER mode — will NOT process jobs');
}

setInterval(sendHeartbeat, 10000);

console.log(`[ANALYTICS] 🔧 Config: Redis=${REDIS_HOST}:${REDIS_PORT}, isWorker=${IS_WORKER}`);
