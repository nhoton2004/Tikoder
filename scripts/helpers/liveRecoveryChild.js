'use strict';
const { loadStore } = require('./liveRecoveryFixture');
const store = loadStore(process.argv[2]);
const mode = process.argv[3];
async function main() {
    await store.initialize();
    if (mode === 'commit') {
        const session = await store.startLiveSession('a', { broadcasterId: 'shop', liveName: 'Crash test' });
        const meta = store.operationMeta('confirm-item', { requestId: 'durable-request', price: 100 }, session.id);
        await store.updateLiveSession('a', session.id, { orders: [{ id: 'one', requestId: meta.requestId, price: 100, createdAt: new Date().toISOString() }], meta });
        process.send({ committed: true, sessionId: session.id, meta });
        // Parent SIGKILLs this process: no signal/shutdown/exit flush is used.
        setInterval(() => {}, 1000);
    } else if (mode === 'inspect') {
        const session = store.readUserSessions('a')[0];
        const meta = store.operationMeta('confirm-item', { requestId: 'durable-request', price: 100 }, session.id);
        const retry = await store.updateLiveSession('a', session.id, { orders: [{ id: 'bad-duplicate', price: 999 }], meta });
        await store.migrateUserIndexes('a');
        process.send({ retry, session: store.getLiveSessionById('a', session.id), audit: store.migrationAudit('a') });
        await store.drain();
    } else if (mode === 'lock') {
        process.send({ acquired: true });
        setInterval(() => {}, 1000);
    }
}
main().catch(error => { process.send?.({ error: error.message }); process.exitCode = 1; });
