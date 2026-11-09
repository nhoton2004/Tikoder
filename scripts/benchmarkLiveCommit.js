'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const persistence = require('../utils/livePersistence');
const { loadStore } = require('./helpers/liveRecoveryFixture');

const sizes = (process.argv[2] || '1000,10000,50000').split(',').map(Number);
if (sizes.some(n => !Number.isSafeInteger(n) || n <= 0 || n > 1000000)) throw new Error('Sizes must be positive integers <= 1000000');
function stats(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = q => Number((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] || 0).toFixed(2));
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}
async function benchmark(count) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-benchmark-'));
    const store = loadStore(directory);
    const originalWrite = persistence.atomicWrite;
    try {
        const session = await store.startLiveSession('benchmark', { broadcasterId: 'fixture', liveName: 'Synthetic fixture' });
        const orders = Array.from({ length: count }, (_, i) => ({ id: 'fixture-' + i, requestId: 'request-' + i, customerUsername: 'buyer-' + (i % 100), customerName: 'Synthetic buyer', productName: 'Synthetic product', price: 50000, total: 50000, createdAt: '2026-11-04T00:00:00Z' }));
        await store.updateLiveSession('benchmark', session.id, { orders });
        await store.migrateUserIndexes('benchmark');
        const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
        await delay(30);
        const queue = [], commit = [], ack = [], stringify = [], fileWrites = [];
        persistence.atomicWrite = async (target, value, ...args) => {
            const begin = performance.now();
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            stringify.push(performance.now() - begin);
            const ioBegin = performance.now();
            const result = await originalWrite(target, serialized, ...args);
            fileWrites.push(performance.now() - ioBegin);
            return result;
        };
        // Four concurrent requests per batch. Includes normal coalesced index work.
        for (let batch = 0; batch < 3; batch += 1) {
            await Promise.all(Array.from({ length: 4 }, (_, i) => {
                const submitted = performance.now();
                return store.serialize('benchmark', async () => {
                    const entered = performance.now(); queue.push(entered - submitted);
                    const current = store.getLiveSessionById('benchmark', session.id);
                    const id = `new-${batch}-${i}`;
                    const meta = store.operationMeta('confirm-item', { requestId: id, price: 50000 }, session.id);
                    await store.updateLiveSession('benchmark', session.id, { orders: [...current.orders, { ...orders[0], id, requestId: id }], meta });
                    commit.push(performance.now() - entered);
                    ack.push(performance.now() - submitted);
                });
            }));
        }
        await delay(30); loop.disable();
        return { orders: count, sessions: 1, sourceBytes: fs.statSync(path.join(store.DATA_DIR, 'benchmark.json')).size, concurrency: 4, mutations: 12, indexJob: 'enabled/coalesced', milliseconds: { queueWait: stats(queue), commit: stats(commit), commitResponse: stats(ack), stringifyPerFile: stats(stringify), fileWriteSyncRename: stats(fileWrites), eventLoop: { p95: +(loop.percentile(95) / 1e6).toFixed(2), p99: +(loop.percentile(99) / 1e6).toFixed(2), max: +(loop.max / 1e6).toFixed(2) } } };
    } finally {
        persistence.atomicWrite = originalWrite;
        await store.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
async function main() {
    const results = [];
    for (const size of sizes) results.push(await benchmark(size));
    const report = JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, platform: os.platform(), cpu: os.cpus()[0]?.model, filesystem: 'temporary directory on local host; storage cache/hardware not controlled', note: 'Synthetic store commit response; excludes network/TikTok/printing. No production SLO asserted. Source stores cumulative and segment orders.', results }, null, 2);
    if (process.argv[3]) fs.writeFileSync(process.argv[3], report + '\n', 'utf8');
    else console.log(report);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
