'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dashboard.js'), 'utf8');

function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing function ${name}`);
    const open = source.indexOf(') {', start) + 2;
    assert.ok(open > start, `Missing body for ${name}`);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unclosed function ${name}`);
}

function dashboardFunctionSource(name) {
    const functionIndex = dashboardSource.indexOf(`function ${name}(`);
    assert.ok(functionIndex >= 0, `Missing function ${name}`);
    const isAsync = dashboardSource.slice(Math.max(0, functionIndex - 6), functionIndex) === 'async ';
    const start = isAsync ? functionIndex - 6 : functionIndex;
    const open = dashboardSource.indexOf(') {', functionIndex) + 2;
    assert.ok(open > functionIndex, `Missing body for ${name}`);
    let depth = 0;
    for (let index = open; index < dashboardSource.length; index += 1) {
        if (dashboardSource[index] === '{') depth += 1;
        if (dashboardSource[index] === '}') depth -= 1;
        if (depth === 0) return dashboardSource.slice(start, index + 1);
    }
    throw new Error(`Unclosed function ${name}`);
}

function createFakeElement() {
    return {
        children: [],
        style: {},
        hidden: false,
        disabled: false,
        textContent: '',
        className: '',
        id: '',
        type: '',
        innerHTML: '',
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        appendChild(child) { this.children.push(child); return child; },
        insertBefore(child) { this.children.push(child); return child; },
        addEventListener() {},
        querySelector(selector) {
            const wanted = String(selector || '').replace(/^\./, '');
            return this.children.find(child => String(child.className || '').split(/\s+/).includes(wanted)) || null;
        }
    };
}

function dashboardHarness(options = {}) {
    const log = { fetchCalls: 0, renderCalls: 0, lastRender: null };
    const hostEl = createFakeElement();
    const topShopEl = createFakeElement();
    const documentMock = {
        body: { contains: () => true },
        getElementById: id => (id === 'overview-top-shop-list' ? topShopEl : null),
        querySelector: () => hostEl,
        createElement: () => createFakeElement()
    };
    const context = vm.createContext({
        URLSearchParams, AbortController, setTimeout, clearTimeout, Promise, console,
        Date, Intl, Map, Set, Object, Number, String, Math, JSON, Array,
        fetch: async (url, init) => {
            log.fetchCalls += 1;
            return options.fetch(url, init);
        },
        document: documentMock,
        parseDisplayDate: value => String(value || ''),
        renderOverview: (data, comparison) => {
            log.renderCalls += 1;
            log.lastRender = { data, comparison: JSON.parse(JSON.stringify(comparison || null)) };
        },
        currentLang: 'vi',
        overviewStartInput: { value: options.startDate || '2026-11-03' },
        overviewEndInput: { value: options.endDate || '2026-11-03' },
        OVERVIEW_REQUEST_TIMEOUT_MS: options.timeoutMs == null ? 1 : options.timeoutMs
    });
    vm.runInContext('var overviewData = null; var overviewComparison = null; var overviewStatusEl = null;', context);
    [
        'dateKeyOffset', 'dateKeyDayDifference', 'ensureOverviewStatusElement', 'setOverviewStatus',
        'fetchOverviewPayload', 'refreshOverviewData'
    ].forEach(name => vm.runInContext(dashboardFunctionSource(name), context));
    return {
        log,
        hostEl,
        refresh: () => {
            const promise = Promise.resolve(vm.runInContext('refreshOverviewData()', context));
            promise.catch(() => {});
            return promise;
        },
        state: () => JSON.parse(JSON.stringify({
            overviewData: vm.runInContext('overviewData', context),
            overviewComparison: vm.runInContext('overviewComparison', context),
            overviewStatusEl: vm.runInContext('overviewStatusEl', context)
        }))
    };
}

function datasetHarness(options = {}) {
    const runtime = options.runtime || {};
    const liveRows = options.liveRows || [];
    const legacyRows = options.legacyRows || [];
    const indexedRows = options.indexedRows || [];
    const fallbackRows = options.fallbackRows || [];
    const context = vm.createContext({
        Date, Intl, Map, Set, Object, Number, String, Math, JSON, Array,
        getLiveRuntime: () => runtime,
        isAdminOrSuperAdmin: () => false,
        currentLiveRows: () => liveRows,
        legacyHistoryOverviewRows: () => legacyRows,
        liveSessionStore: { readIndexedRows: () => indexedRows },
        readAllLiveSessionRows: () => ({ rows: fallbackRows, files: fallbackRows.length ? 1 : 0 }),
        customerStore: {
            normalizeTikTokUsername: value => String(value || '').replace(/^@/, '').toLowerCase(),
            readUserCustomers: () => []
        },
        normalizeOrderCustomerName: (name, username) => String(name || username || ''),
        normalizeDisplayText: value => String(value || '')
    });
    [
        'pad2', 'formatDateKey', 'parseDateKey', 'dateKeyOffset', 'dateKeyDayDifference',
        'timestampFromParts', 'dateKeyFromTimestamp', 'parsedTimestamp', 'resolveOrderCapture',
        'buildLiveSessionDailySummary', 'normalizeOrdersStatus', 'dedupeWithReplay',
        'dateRangeContains', 'buildDailyOverview', 'liveSessionOverviewRows',
        'buildOverviewDataset', 'buildOrdersDataset'
    ].forEach(name => vm.runInContext(functionSource(name), context));
    return context;
}

function indexedRow(overrides = {}) {
    return {
        userId: 'user',
        createdAt: '2026-11-02T10:00:00.000Z',
        captureDate: '2026-11-02',
        total: 100,
        orderId: 'order-1',
        customerName: 'Buyer',
        customerUsername: 'buyer',
        productName: 'Product',
        quantity: 1,
        eventId: '',
        requestId: '',
        sourceMessageId: '',
        ...overrides
    };
}

function fallbackRow(overrides = {}) {
    return {
        source: 'live_session',
        userId: 'user',
        sessionType: 'live_session',
        orderCreatedAt: '2026-11-02T10:00:00.000Z',
        sessionStartedAt: '',
        sessionEndedAt: '',
        total: 100,
        orderId: 'order-1',
        customerName: 'Buyer',
        customerUsername: 'buyer',
        productName: 'Product',
        quantity: 1,
        eventId: '',
        requestId: '',
        sourceMessageId: '',
        ...overrides
    };
}

function overviewRow(overrides = {}) {
    return {
        source: 'live_session',
        userId: 'user',
        date: '2026-11-02',
        timestamp: Date.parse('2026-11-02T10:00:00.000Z'),
        shop: '',
        orderId: 'order-1',
        customer: 'Buyer',
        customerUsername: 'buyer',
        productName: 'Product',
        quantity: 1,
        value: 100,
        status: 'done',
        ...overrides
    };
}

function aggregationHarness(runtime) {
    const context = vm.createContext({
        Date, Intl, Map, Set, Object, Number, String, Math, JSON,
        getLiveRuntime: () => runtime,
        customerStore: { normalizeTikTokUsername: value => String(value || '').replace(/^@/, '').toLowerCase() },
        normalizeOrderCustomerName: (name, username) => String(name || username || ''),
        normalizeDisplayText: value => String(value || '')
    });
    [
        'pad2', 'formatDateKey', 'parseDateKey', 'dateKeyOffset', 'dateKeyDayDifference',
        'normalizeOverviewRange', 'timestampFromParts', 'dateKeyFromTimestamp', 'parsedTimestamp',
        'resolveOrderCapture', 'buildLiveSessionDailySummary', 'currentLiveRows', 'dedupeOverviewRows'
    ].forEach(name => vm.runInContext(functionSource(name), context));
    return context;
}

test('capture date remains stable when a live render happens after midnight', () => {
    const runtime = {
        currentSessionStartedAt: '2026-11-02T15:00:00.000Z',
        currentBroadcasterId: 'shop',
        confirmedOrders: {
            buyer: {
                username: 'buyer', nickname: 'Buyer', items: [
                    { id: 'before-midnight', text: 'A', price: 100, createdAt: '2026-11-02T16:30:00.000Z' },
                    { id: 'after-midnight', text: 'B', price: 200, createdAt: '2026-11-02T17:10:00.000Z' }
                ]
            }
        }
    };
    const context = aggregationHarness(runtime);
    const current = JSON.parse(JSON.stringify(context.currentLiveRows({ uid: 'user' })));

    assert.deepEqual(current.map(row => ({ id: row.orderId, date: row.date })), [
        { id: 'before-midnight', date: '2026-11-02' },
        { id: 'after-midnight', date: '2026-11-03' }
    ]);

    const saved = current.map(row => ({ ...row, source: 'live_session' }));
    const deduped = JSON.parse(JSON.stringify(context.dedupeOverviewRows([...current, ...saved])));
    assert.equal(deduped.length, 2, 'the current and persisted projections must not create a third day or duplicate rows');
});

test('capture resolver uses stable fallbacks and clamps only against a closed session', () => {
    const context = aggregationHarness({ confirmedOrders: {} });
    const fallback = JSON.parse(JSON.stringify(context.resolveOrderCapture({
        createdAt: '', sessionStartedAt: '2026-11-02T17:15:00.000Z'
    })));
    assert.deepEqual(fallback, { date: '2026-11-03', timestamp: Date.parse('2026-11-02T17:15:00.000Z'), dateKnown: true });

    const closed = JSON.parse(JSON.stringify(context.resolveOrderCapture({
        createdAt: '2026-11-04T17:00:00.000Z',
        sessionStartedAt: '2026-11-02T17:00:00.000Z',
        sessionEndedAt: '2026-11-03T16:00:00.000Z'
    })));
    assert.equal(closed.date, '2026-11-03');
    assert.equal(closed.timestamp, Date.parse('2026-11-03T16:00:00.000Z'));

    const active = JSON.parse(JSON.stringify(context.resolveOrderCapture({
        createdAt: '2026-11-04T17:00:00.000Z', sessionStartedAt: '2026-11-02T17:00:00.000Z'
    })));
    assert.equal(active.date, '2026-11-05', 'an active session has no arbitrary upper clamp');

    const unknown = JSON.parse(JSON.stringify(context.resolveOrderCapture({ createdAt: '' })));
    assert.equal(unknown.dateKnown, false);
    assert.equal(unknown.date, '');
});

test('a multi-day session exposes an authoritative per-day summary', () => {
    const context = aggregationHarness({ confirmedOrders: {} });
    const summary = JSON.parse(JSON.stringify(context.buildLiveSessionDailySummary({
        startedAt: '2026-11-02T15:00:00.000Z',
        endedAt: '2026-11-03T18:00:00.000Z',
        orders: [
            { id: 'one', price: 100, createdAt: '2026-11-02T16:30:00.000Z' },
            { id: 'two', total: 200, createdAt: '2026-11-02T17:10:00.000Z' },
            { id: 'three', price: 300, createdAt: '2026-11-03T17:30:00.000Z' }
        ]
    })));
    assert.deepEqual(summary, [
        { date: '2026-11-02', orders: 1, revenue: 100 },
        { date: '2026-11-03', orders: 1, revenue: 200 },
        { date: '2026-11-04', orders: 1, revenue: 300 }
    ]);

    const merged = JSON.parse(JSON.stringify(context.buildLiveSessionDailySummary({
        type: 'merged_session',
        startedAt: '2026-11-04T17:00:00.000Z', endedAt: '2026-11-04T17:00:00.000Z',
        orders: [{ id: 'historical', total: 500, createdAt: '2026-11-02T16:30:00.000Z' }]
    })));
    assert.deepEqual(merged, [{ date: '2026-11-02', orders: 1, revenue: 500 }]);
});

test('overview handles an empty source without throwing and reports zero rows', () => {
    const context = datasetHarness();
    const result = JSON.parse(JSON.stringify(context.buildOverviewDataset(
        { uid: 'user' },
        { start: '2026-11-01', end: '2026-11-03' }
    )));
    assert.equal(result.summary.orders, 0);
    assert.equal(result.summary.revenue, 0);
    assert.equal(result.meta.rows, 0);
});

test('overview counts an in-range order once in summary and meta', () => {
    const context = datasetHarness({ liveRows: [overviewRow()] });
    const result = JSON.parse(JSON.stringify(context.buildOverviewDataset(
        { uid: 'user' },
        { start: '2026-11-01', end: '2026-11-03' }
    )));
    assert.equal(result.summary.orders, 1);
    assert.equal(result.summary.revenue, 100);
    assert.equal(result.meta.rows, 1);
});

test('overview excludes an out-of-range order', () => {
    const context = datasetHarness({
        liveRows: [overviewRow({ date: '2026-10-01', timestamp: Date.parse('2026-10-01T10:00:00.000Z') })]
    });
    const result = JSON.parse(JSON.stringify(context.buildOverviewDataset(
        { uid: 'user' },
        { start: '2026-11-01', end: '2026-11-03' }
    )));
    assert.equal(result.summary.orders, 0);
    assert.equal(result.summary.revenue, 0);
    assert.equal(result.meta.rows, 0);
});

test('overview keeps meta rows equal to summary orders for replay fixtures', () => {
    const base = {
        source: 'live_session', userId: 'user', date: '2026-11-02',
        shop: '', orderId: 'order-1', customer: 'Buyer', customerUsername: 'buyer',
        productName: 'Product', quantity: 1, value: 100, status: 'done'
    };
    const replayTimestamp = Date.parse('2026-11-02T10:00:00.000Z');
    const context = datasetHarness({
        liveRows: [
            overviewRow({ ...base, timestamp: replayTimestamp }),
            overviewRow({ ...base, timestamp: replayTimestamp }),
            overviewRow({ ...base, timestamp: replayTimestamp })
        ]
    });
    const result = JSON.parse(JSON.stringify(context.buildOverviewDataset(
        { uid: 'user' },
        { start: '2026-11-01', end: '2026-11-03' }
    )));
    assert.equal(result.summary.orders, 1);
    assert.equal(result.meta.rows, result.summary.orders);
    assert.equal(result.summary.dups, 2);
});

test('indexed live-session rows retain all three identity fields', () => {
    const context = datasetHarness({
        indexedRows: [indexedRow({ eventId: 'event-1', requestId: 'request-1', sourceMessageId: 'message-1' })]
    });
    const rows = JSON.parse(JSON.stringify(context.liveSessionOverviewRows({ uid: 'user' })));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eventId, 'event-1');
    assert.equal(rows[0].requestId, 'request-1');
    assert.equal(rows[0].sourceMessageId, 'message-1');
});

test('canonical projection supplied after index fallback retains all three identity fields', () => {
    const context = datasetHarness({
        indexedRows: [indexedRow({ eventId: 'event-1', requestId: 'request-1', sourceMessageId: 'message-1' })]
    });
    const rows = JSON.parse(JSON.stringify(context.liveSessionOverviewRows({ uid: 'user' })));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eventId, 'event-1');
    assert.equal(rows[0].requestId, 'request-1');
    assert.equal(rows[0].sourceMessageId, 'message-1');
});

test('different stable ids for one user stay as two rows without a false conflict', () => {
    const context = datasetHarness({
        indexedRows: [
            indexedRow({ eventId: 'event-1', orderId: 'order-1' }),
            indexedRow({ eventId: 'event-2', orderId: 'order-2' })
        ]
    });
    const result = JSON.parse(JSON.stringify(context.buildOrdersDataset({ uid: 'user' }, {})));
    assert.equal(result.rows.length, 2);
    assert.equal(result.dedupe.discord, 0);
});

test('rows without any stable id remain independent without a false conflict', () => {
    const context = datasetHarness({
        indexedRows: [
            indexedRow({ orderId: 'order-1' }),
            indexedRow({ orderId: 'order-2' })
        ]
    });
    const result = JSON.parse(JSON.stringify(context.buildOrdersDataset({ uid: 'user' }, {})));
    assert.equal(result.rows.length, 2);
    assert.equal(result.dedupe.discord, 0);
});

test('a populated stable id keeps existing bucket behavior', () => {
    const context = datasetHarness({
        indexedRows: [
            indexedRow({ eventId: 'event-1', orderId: 'order-1' }),
            indexedRow({ eventId: 'event-1', orderId: 'order-2' })
        ]
    });
    const result = JSON.parse(JSON.stringify(context.buildOrdersDataset({ uid: 'user' }, {})));
    assert.equal(result.rows.length, 2);
    assert.equal(result.dedupe.discord, 1);
});

test('whitespace event id falls through to a valid request id', () => {
    const context = datasetHarness({
        indexedRows: [
            indexedRow({ eventId: '   ', requestId: 'request-1', orderId: 'order-1' }),
            indexedRow({ eventId: '', requestId: 'request-1', orderId: 'order-2' })
        ]
    });
    const result = JSON.parse(JSON.stringify(context.buildOrdersDataset({ uid: 'user' }, {})));
    assert.equal(result.rows.length, 2);
    assert.equal(result.dedupe.discord, 1);
});

test('overview UI shows the retry button when the current request fails without prior data', async () => {
    const harness = dashboardHarness({
        fetch: async () => ({ ok: false, json: async () => ({ error: 'boom' }) })
    });
    await harness.refresh();
    const statusEl = harness.state().overviewStatusEl;
    assert.ok(statusEl, 'the status element must exist');
    const retry = statusEl.children.find(c => String(c.className || '').split(/\s+/).includes('overview-status-retry'));
    const message = statusEl.children.find(c => String(c.className || '').split(/\s+/).includes('overview-status-message'));
    assert.equal(retry.hidden, false, 'the retry button must be visible');
    assert.equal(retry.disabled, false);
    assert.equal(message.textContent, 'Không thể tải dữ liệu tổng quan.');
});

test('overview UI renders the current period without waiting for the comparison request', async () => {
    const harness = dashboardHarness({
        fetch: url => {
            if (String(url).includes('2026-11-02')) return new Promise(() => {});
            return Promise.resolve({ ok: true, json: async () => ({ summary: { orders: 3, revenue: 300 }, meta: {} }) });
        }
    });
    harness.refresh();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(harness.log.fetchCalls, 2);
    assert.equal(harness.log.renderCalls, 1, 'the current period must be rendered while the comparison is pending');
    const state = harness.state();
    assert.equal(state.overviewData.summary.orders, 3);
    assert.equal(state.overviewComparison.unavailable, true);
});

test('overview UI applies the comparison after the previous period resolves late', async () => {
    const harness = dashboardHarness({
        fetch: url => {
            if (String(url).includes('2026-11-02')) {
                return new Promise(resolve => setTimeout(() => resolve({
                    ok: true, json: async () => ({ summary: { orders: 1, revenue: 100 } })
                }), 30));
            }
            return Promise.resolve({ ok: true, json: async () => ({ summary: { orders: 3, revenue: 300 }, meta: {} }) });
        }
    });
    await harness.refresh();
    assert.equal(harness.log.renderCalls, 2);
    const comparison = harness.state().overviewComparison;
    assert.equal(comparison.ordersDiff, 2);
    assert.equal(comparison.revenueDiff, 200);
    assert.equal(comparison.hasPreviousData, true);
    assert.equal(comparison.unavailable, undefined);
});
