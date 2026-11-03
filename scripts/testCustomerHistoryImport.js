const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const routeStart = source.indexOf("app.post('/api/customers/import-from-history'");
const routeEnd = source.indexOf("\napp.get('/api/customers/by-tiktok", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart);

function createHarness(files = {}, storedSessions = []) {
    const customers = [];
    let handler;
    const context = vm.createContext({
        console,
        path: path.posix,
        HISTORY_ROOT_DIR: '/history',
        fs: {
            existsSync: filePath => filePath === '/history/current' || Object.hasOwn(files, filePath),
            readdirSync: dir => Object.keys(files)
                .filter(filePath => path.posix.dirname(filePath) === dir)
                .map(filePath => path.posix.basename(filePath)),
            readFileSync: filePath => JSON.stringify(files[filePath]),
            statSync: () => ({ mtime: new Date('2026-10-22T00:00:00Z') })
        },
        getUserHistoryDir: uid => `/history/${uid}`,
        cleanDisplayText: value => String(value || '').trim(),
        normalizeDisplayText: value => String(value || '').trim(),
        normalizeOrderCustomerName: (name, username) => String(name || username || '').trim(),
        customerStore: {
            normalizeTikTokUsername: value => String(value || '').replace(/^@+/, '').trim().toLowerCase(),
            readUserCustomers: () => customers,
            createCustomer: (uid, data) => {
                assert.equal(uid, 'current');
                const customer = { id: `customer_${customers.length}`, ...data };
                customers.push(customer);
                return customer;
            }
        },
        liveSessionStore: {
            readUserSessions: uid => {
                assert.equal(uid, 'current');
                return storedSessions;
            },
            calculateSessionSummary: orders => ({ totalOrders: orders.length })
        },
        requireApiAuth: () => {},
        app: { post: (url, auth, callback) => { handler = callback; } }
    });

    for (const name of [
        'safeLegacyHistoryFileName', 'historyMetaFromFile', 'formatDateKey', 'pad2',
        'timestampFromParts', 'buildLegacySessionId', 'legacyHistoryFileToOrders',
        'readLegacyHistorySession', 'readLegacyHistorySessions'
    ]) {
        const start = source.indexOf(`function ${name}(`);
        assert.ok(start >= 0, `Missing function ${name}`);
        const end = source.indexOf('\n}', start) + 2;
        vm.runInContext(source.slice(start, end), context);
    }
    vm.runInContext(source.slice(routeStart, routeEnd), context);

    return () => {
        let response;
        handler({ session: { user: { uid: 'current' } } }, {
            json: data => { response = data; },
            status: code => { throw new Error(`Unexpected HTTP status ${code}`); }
        });
        return response;
    };
}

function legacyCustomer(username, nickname) {
    return { [username]: { username, nickname, items: [{ id: 1, text: 'Item', price: 50000, time: '20:00:00' }] } };
}

test('imports all legacy formats and stored sessions without crossing user boundaries', () => {
    const run = createHarness({
        '/history/current/2026-10-22_shop.json': legacyCustomer('@Buyer.One', 'Buyer One'),
        '/history/current/session_1787674145221_i3edrh_shop.json': legacyCustomer('buyer_two', 'Buyer Two'),
        '/history/current/sess_2026-09-07_39f1rb_shop.json': legacyCustomer('buyer_three', 'Buyer Three'),
        '/history/current/sess_2026-09-08_repeat_shop.json': legacyCustomer('buyer.one', 'Buyer One'),
        '/history/current/unsupported.json': legacyCustomer('unsupported', 'Unsupported'),
        '/history/other/2026-10-22_shop.json': legacyCustomer('other_user', 'Other User'),
        '/history/2026-10-22_shop.json': legacyCustomer('shared_user', 'Shared User')
    }, [{ id: 'saved', orders: [{ customerUsername: 'saved_buyer', customerName: 'Saved Buyer' }] }]);

    const first = run();
    assert.equal(first.success, true);
    assert.equal(first.totalSessions, 5);
    assert.equal(first.totalCandidates, 4);
    assert.deepEqual(Array.from(first.imported, customer => customer.tiktokUsername).sort(),
        ['buyer.one', 'buyer_three', 'buyer_two', 'saved_buyer']);
    assert.equal(first.skipped.length, 0);

    const second = run();
    assert.equal(second.imported.length, 0);
    assert.equal(second.skipped.length, 4);
});

test('reports empty history without creating customers', () => {
    const result = createHarness()();
    assert.equal(result.totalSessions, 0);
    assert.equal(result.totalCandidates, 0);
    assert.equal(result.imported.length, 0);
});
