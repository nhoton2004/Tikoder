const test = require('node:test');
const assert = require('node:assert/strict');
const { isResumableSession, shouldClearActiveSession } = require('../utils/liveSessionLifecycle');
const { endLiveSession } = require('../sockets/liveHandler');

test('only unfinished sessions can be resumed', () => {
    for (const status of ['draft', 'live', 'reconnecting', 'interrupted']) {
        assert.equal(isResumableSession(status), true);
    }
    for (const status of ['ending', 'ended', 'discarded', 'error', '']) {
        assert.equal(isResumableSession(status), false);
    }
});

test('a completed or discarded session clears the client reference', () => {
    assert.equal(shouldClearActiveSession('ended'), true);
    assert.equal(shouldClearActiveSession('discarded'), true);
    assert.equal(shouldClearActiveSession('live'), false);
    assert.equal(shouldClearActiveSession('reconnecting'), false);
});

test('simultaneous end signals share one final flush', async () => {
    let flushCount = 0;
    const events = [];
    const runtime = {
        sessionId: 'live_1', currentDbSessionId: 'live_1', currentBroadcasterId: 'shop',
        sessionState: 'live', sessionRevision: 2, confirmedOrders: { buyer: { items: [{}] } },
        manualConfirmedOrders: {}, activeLoadedSessionId: null, historyLoadedSessionId: null,
        saveDebouncedTimer: null, saveQueue: Promise.resolve(), endPromise: null
    };
    const ctx = {
        saveSessionDataForUser() {},
        flushSessionToDb() { flushCount += 1; return { status: 'ended', orderCount: 1 }; },
        emitToUser(_userId, event, payload) { events.push({ event, payload }); }
    };

    await Promise.all([
        endLiveSession('u1', runtime, ctx, 'host_ended'),
        endLiveSession('u1', runtime, ctx, 'manual_disconnect')
    ]);

    assert.equal(flushCount, 1);
    assert.equal(events.filter(({ event }) => event === 'live-ended').length, 1);
    assert.equal(events.find(({ event }) => event === 'live-ended').payload.status, 'ended');
});
