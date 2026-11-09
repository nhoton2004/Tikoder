// Run with Playwright installed: node scripts/testDashboardResponsive.js [playwright-module-path]
// Uses intercepted fixture APIs. No server, credentials, or real customer writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright-core');
const root = path.join(__dirname, '..');
const widths = [360, 390, 430, 768, 980, 1024, 1180, 1440];
const customers = [{
    id: 'fixture', tiktokUsername: 'khach_hang_ten_dai_1234567890',
    displayName: 'Khách kiểm thử với tên người nhận dài', phone: '0901234567',
    addressDetail: 'Địa chỉ kiểm thử rất dài để kiểm tra xuống dòng trên điện thoại',
    ward: 'Phường kiểm thử', district: 'Quận kiểm thử', province: 'Thành phố kiểm thử'
}];

(async () => {
    const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
    try {
        const request = await browser.newContext();
        const tailwind = await request.request.get('https://cdn.tailwindcss.com', { timeout: 30000 });
        assert.equal(tailwind.ok(), true, 'Tailwind CDN must load for representative layout checks');
        const tailwindScript = await tailwind.body();
        await request.close();
        let checks = 0;
        for (const theme of ['light', 'dark']) {
            for (const collapsed of [false, true]) {
                const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
                await context.addInitScript(({ theme, collapsed }) => {
                    localStorage.setItem('theme', theme);
                    localStorage.setItem('sidebarCollapsed', String(collapsed));
                }, { theme, collapsed });
                let list = structuredClone(customers);
                const quotes = [];
                let quoteCreates = 0;
                const approvals = [];
                const historyEdits = [];
                const quoteSources = [];
                const histories = new Map();
                let promptAnswers = [];
                let failSave = false;
                let failList = false;
                let holdSave = false;
                let releaseSave;
                let markSaveStarted;
                await context.route('**/*', async route => {
                    const url = new URL(route.request().url());
                    const pathname = url.pathname;
                    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'application/javascript', body: tailwindScript });
                    if (url.hostname !== 'tikoder.test') return route.abort();
                    if (pathname === '/socket.io/socket.io.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.__socketHandlers = {}; window.__socketEmits = []; window.io = () => ({on(name, handler){ window.__socketHandlers[name] = handler; }, emit(...args){window.__socketEmits.push(args);}, timeout(){return this;}});' });
                    if (pathname.startsWith('/api/')) {
                        let body = {};
                        if (pathname === '/api/me') body = { loggedIn: true, user: { uid: 'fixture', name: 'Kiểm thử', email: 'fixture@example.test', role: 'user' } };
                        if (pathname === '/api/customers/import-from-history') body = { success: true, imported: [], skipped: list, totalSessions: 3, totalCandidates: list.length };
                        else if (pathname.startsWith('/api/customers')) {
                            const method = route.request().method();
                            if (method === 'GET') {
                                if (failList) return route.fulfill({ status: 500, json: { error: 'Lỗi kiểm thử tải khách' } });
                                const query = (url.searchParams.get('q') || '').toLowerCase();
                                body = { customers: list.filter(c => `${c.displayName} ${c.tiktokUsername}`.toLowerCase().includes(query)) };
                            } else if (method === 'POST' || method === 'PATCH') {
                                if (failSave) return route.fulfill({ status: 500, json: { error: 'Lỗi kiểm thử lưu khách' } });
                                if (holdSave) await new Promise(resolve => { releaseSave = resolve; markSaveStarted(); });
                                const customer = { id: method === 'PATCH' ? 'fixture' : 'new', ...route.request().postDataJSON() };
                                list = [...list.filter(c => c.id !== customer.id), customer];
                                body = { customer, warnings: [] };
                            } else if (method === 'DELETE') list = list.filter(c => c.id !== pathname.split('/').pop());
                        }
                        if (pathname === '/api/quotes') {
                            if (route.request().method() === 'POST') {
                                const payload = route.request().postDataJSON();
                                if (payload.source) quoteSources.push(payload.source);
                                quoteCreates++;
                                const items = payload.items || (payload.source ? histories.get(payload.source.sessionId).orders.filter(o => o.customerUsername === payload.username).map(o => ({ label: o.productName, amount: o.price, sourceItemId: o.id })) : [{ label: 'Món kiểm thử', amount: 120000, sourceItemId: 'one' }]);
                                quotes.push({ id: 'quote-fixture', customerId: payload.customerId || 'fixture', version: 1, status: 'draft', items, total: items.reduce((sum, i) => sum + Number(i.amount), 0), shippingNote: payload.shippingNote || 'Chưa gồm phí vận chuyển' });
                                body = { quote: quotes[0] };
                            } else body = { quotes, deliveries: [], customers: list };
                        }
                        if (pathname === '/api/quotes/quote-fixture') {
                            const payload = route.request().postDataJSON();
                            assert.equal(payload.version, quotes[0].version);
                            if (route.request().method() === 'DELETE') quotes.splice(0);
                            else { Object.assign(quotes[0], payload, { version: quotes[0].version + 1, status: 'draft', total: payload.items.reduce((sum, i) => sum + Number(i.amount), 0) }); body = { quote: quotes[0] }; }
                        }
                        if (pathname === '/api/quotes/quote-fixture/approve') {
                            const payload = route.request().postDataJSON();
                            approvals.push(payload);
                            if (!['zalo', 'tiktok'].includes(payload.channel)) return route.fulfill({ status: 400, json: { error: 'Kênh không hợp lệ' } });
                            body = { delivery: { status: payload.autoName ? 'queued' : 'ready' } };
                        }
                        if (pathname.startsWith('/api/live-sessions/')) {
                            const editing = pathname.endsWith('/orders');
                            const id = decodeURIComponent(pathname.slice('/api/live-sessions/'.length, editing ? -7 : undefined));
                            if (id === 'denied') return route.fulfill({ status: 404, json: { error: 'Không tìm thấy phiên live' } });
                            if (!histories.has(id)) histories.set(id, { session: { id, liveName: 'History ' + id, tiktokUsername: 'fixture_shop' }, revision: 'r1', orders: [
                                { id: 'history-item', customerUsername: customers[0].tiktokUsername, customerName: 'Khách lịch sử', productName: 'Món lịch sử ' + id, price: 45000 }
                            ] });
                            const history = histories.get(id);
                            if (editing) {
                                const payload = route.request().postDataJSON();
                                historyEdits.push({ id, ...payload });
                                if (payload.revision !== history.revision) return route.fulfill({ status: 409, json: { error: 'Lịch sử đã thay đổi' } });
                                if (payload.action === 'edit') Object.assign(history.orders.find(o => o.id === payload.itemId), { productName: payload.text, price: payload.price });
                                if (payload.action === 'add') history.orders.push({ id: 'added', customerUsername: payload.username, customerName: 'Khách mới', productName: payload.text, price: payload.price });
                                if (payload.action === 'delete') history.orders = history.orders.filter(o => o.id !== payload.itemId);
                                if (payload.action === 'delete-customer') history.orders = history.orders.filter(o => o.customerUsername !== payload.username);
                                history.revision = 'r' + (Number(history.revision.slice(1)) + 1);
                            }
                            body = history;
                        }
                                                if (pathname === '/api/live-sessions') body = { sessions: [{ id: 'fixture', liveName: 'sess_2026-09-07_39f1rb_shop_ten_dai_de_kiem_thu', createdAt: '2026-09-07', summary: { totalOrders: 97, totalQuantity: 97, totalRevenue: 4877001 } }] };
                        return route.fulfill({ json: body });
                    }
                    const file = pathname === '/app' ? path.join(root, 'public', 'app.html')
                        : path.join(root, 'public', pathname);
                    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
                    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.woff2') ? 'font/woff2' : 'image/svg+xml';
                    return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
                });
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? (promptAnswers.shift() ?? 'Tên Zalo kiểm thử') : undefined));
                await page.goto('http://tikoder.test/app');
                await page.waitForFunction(() => typeof window.switchView === 'function');
                for (const width of widths) {
                    await page.setViewportSize({ width, height: width < 768 ? 844 : 1100 });
                    for (const view of ['overview', 'live', 'orders', 'customers', 'quotes', 'settings']) {
                        await page.evaluate(view => switchView(view), view);
                        if (view === 'customers') await page.locator('[data-customer-row]').first().waitFor();
                        const metrics = await page.evaluate(() => {
                            const main = document.querySelector('.main-wrap').getBoundingClientRect();
                            const sidebar = document.querySelector('.sidebar');
                            return { scroll: document.documentElement.scrollWidth, width: innerWidth,
                                mainWidth: main.width, sidebarRight: sidebar.getBoundingClientRect().right,
                                sidebarInert: sidebar.inert, bottomNav: getComputedStyle(document.querySelector('.mobile-bottom-nav')).display };
                        });
                        if (metrics.scroll > width + 1) {

                            console.log('Overflow elements:', await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
                                .filter(el => el.getBoundingClientRect().right > innerWidth + 1 && el.getClientRects().length)
                                .slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, cls: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width, cssWidth: getComputedStyle(el).width, flex: getComputedStyle(el).flex, parent: el.parentElement.className, parentWidth: el.parentElement.getBoundingClientRect().width }))));
                        }
                        assert.ok(metrics.scroll <= width + 1, `${theme}/${collapsed}/${width}/${view}: page overflow ${JSON.stringify(metrics)}`);
                        if (width <= 980) {
                            assert.ok(metrics.mainWidth >= width - 24, `Main content squeezed: ${JSON.stringify(metrics)}`);
                            assert.ok(metrics.sidebarRight <= 0 && metrics.sidebarInert, `Drawer not hidden: ${JSON.stringify(metrics)}`);
                            assert.notEqual(metrics.bottomNav, 'none');
                        } else assert.equal(metrics.bottomNav, 'none');
                        if (view === 'live') {
                            const live = await page.evaluate(() => {
                                const rect = selector => {
                                    const r = document.querySelector(selector).getBoundingClientRect();
                                    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
                                };
                                const row = document.querySelector('.live-connect-row');
                                return { input: rect('#tiktok-id'), start: rect('#btn-connect'), end: rect('#btn-end-live'),
                                    stray: [...row.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).map(n => n.textContent),
                                    endCount: document.querySelectorAll('#btn-end-live').length,
                                    topbarCount: document.querySelectorAll('#topbar-save-session-btn').length,
                                    nowrap: ['#btn-connect', '#btn-end-live'].every(s => getComputedStyle(document.querySelector(s)).whiteSpace === 'nowrap') };
                            });
                            const label = `${theme}/${collapsed}/${width}/live`;
                            assert.deepEqual(live.stray, [], `${label}: stray text`);
                            assert.equal(live.endCount, 1);
                            assert.equal(live.topbarCount, 0);
                            assert.ok(live.nowrap);
                            assert.ok(Math.abs(live.start.y - live.end.y) < 1, `${label}: actions must share a row`);
                            assert.ok(live.start.height <= 48 && live.end.height <= 48, `${label}: oversized action`);
                            assert.ok(live.start.width >= 100 && live.end.width >= 100, `${label}: squeezed action`);
                            if (width >= 768) assert.ok(Math.abs(live.input.y - live.start.y) < 1, `${label}: input/actions must share a row`);
                            else assert.ok(live.start.y >= live.input.bottom, `${label}: mobile input must precede actions`);
                            assert.ok(live.end.right <= width, `${label}: action overflow`);
                            for (const state of [
                                { sessionId: 'layout-run', connecting: true },
                                { sessionId: 'layout-run', connected: true },
                                { sessionId: 'layout-run', connected: false },
                                { sessionId: null, connected: false }
                            ]) {
                                await page.evaluate(state => window.__socketHandlers['live-state'](state), state);
                                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: status overflow ${JSON.stringify(state)}`);
                            }
                        }
                        checks++;
                    }
                }
                await page.evaluate(() => switchView('live'));
                const liveState = async (event, data) => page.evaluate(({ event, data }) => window.__socketHandlers[event](data), { event, data });
                const assertLive = async (phase, startDisabled, endDisabled, inputDisabled) => {
                    assert.equal(await page.locator('#status-msg').getAttribute('data-live-phase'), phase);
                    assert.equal(await page.locator('#btn-connect').isDisabled(), startDisabled);
                    assert.equal(await page.locator('#btn-end-live').isDisabled(), endDisabled);
                    assert.equal(await page.locator('#tiktok-id').isDisabled(), inputDisabled);
                    assert.equal(await page.locator('#kpi-status').textContent(), await page.locator('#status-msg').textContent());
                };
                await liveState('live-state', { sessionId: null, connected: false });
                await assertLive('idle', false, true, false);
                await page.locator('#tiktok-id').fill('fixture_shop');
                await page.locator('#btn-connect').click();
                await assertLive('connecting', true, true, true);
                await page.evaluate(() => document.querySelector('#btn-connect').dispatchEvent(new Event('click')));
                assert.equal(await page.evaluate(() => window.__socketEmits.filter(e => e[0] === 'start-live').length), 1);
                await liveState('live-state', { sessionId: 'run', broadcasterId: 'fixture_shop', connecting: true });
                await assertLive('connecting', true, true, true);
                await liveState('status', { connected: true, broadcasterId: 'fixture_shop', roomId: 'room' });
                await assertLive('connected', true, false, true);
                await liveState('status', { connected: false });
                await assertLive('open', false, false, true);
                assert.ok(!(await page.locator('#status-msg').textContent()).includes('kết thúc'));
                await page.locator('#btn-end-live').click();
                await assertLive('ending', true, true, true);
                await page.evaluate(() => window.saveCurrentSession());
                assert.equal(await page.evaluate(() => window.__socketEmits.filter(e => e[0] === 'end-live').length), 1);
                await liveState('session-ended', { saved: false, error: 'Fixture write failed' });
                assert.equal(await page.locator('#btn-end-live').isDisabled(), false);
                await liveState('live-state', { sessionId: 'run', broadcasterId: 'fixture_shop', connected: false });
                await assertLive('open', false, false, true);
                await page.locator('#btn-end-live').click();
                await liveState('session-ended', { saved: true });
                await assertLive('idle', false, true, false);
                await page.clock.install();
                await page.locator('#btn-connect').click();
                await page.clock.fastForward(30001);
                assert.equal(await page.locator('#btn-connect').isDisabled(), false);
                assert.match(await page.locator('#status-msg').textContent(), /Chưa nhận phản hồi/);
                await page.locator('#btn-connect').click();
                await liveState('status', { connected: false, error: 'Fixture connection failed' });
                assert.equal(await page.locator('#btn-connect').isDisabled(), false);
                await liveState('live-state', { sessionId: 'run', broadcasterId: 'fixture_shop', connected: true });
                await liveState('disconnect');
                await assertLive('open', false, false, true);
                await liveState('live-state', { sessionId: null, connected: false });
                await assertLive('idle', false, true, false);
                await page.evaluate(() => setLang('en'));
                assert.equal(await page.locator('#status-msg').textContent(), 'No active Live session');
                await page.evaluate(() => setLang('vi'));
                await page.clock.resume();
                await page.setViewportSize({ width: 1440, height: 900 });
                // History CRUD works offline without replacing unrelated Live orders, even for the same shop.
                                await page.evaluate(() => { window.__printCalls = 0; window.print = () => window.__printCalls++; });
                                for (const [sessionId, broadcasterId] of [[null, ''], ['run', 'fixture_shop'], ['run', 'other_shop']]) {
                                    await liveState('live-state', { sessionId, broadcasterId, connected: Boolean(sessionId) });
                                    for (const id of ['fixture', 'merged', 'legacy:user:old.json']) {
                                        await liveState('live-state', { sessionId, broadcasterId, connected: Boolean(sessionId) });
                                        await page.evaluate(id => loadSessionOrdersToCurrentView(id), id);
                                        const ordersPanel = page.locator('#section-orders');
                                        assert.equal(await ordersPanel.isVisible(), true);
                                        assert.match(await ordersPanel.textContent(), new RegExp('Món lịch sử ' + id));
                                        assert.equal(await ordersPanel.getByRole('button', { name: 'Tạo báo giá', exact: true }).isDisabled(), false);
                                        await ordersPanel.getByRole('button', { name: 'In lại tổng', exact: true }).click();
                                        assert.match(await page.locator('#print-section').textContent(), new RegExp('Món lịch sử ' + id));
                                        const downloadEvent = page.waitForEvent('download');
                                        await ordersPanel.getByRole('button', { name: 'Xuất JSON', exact: true }).click();
                                        const download = await downloadEvent;
                                        const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
                                        assert.equal(exported[customers[0].tiktokUsername].items[0].price, 45000);
                                        await liveState('all-confirmed-orders', { livebuyer: { username: 'livebuyer', items: [{ id: 'live-item', text: 'Đơn live riêng', price: 99000 }], total: 99000 } });
                                        await liveState('order-confirmed', { username: 'livebuyer', items: [{ id: 'live-item', text: 'Đơn live mới', price: 99000 }], total: 99000 });
                                        assert.match(await ordersPanel.textContent(), new RegExp('Món lịch sử ' + id));
                                        await page.evaluate(() => loadSessionOrdersToCurrentView('denied'));
                                        assert.match(await ordersPanel.textContent(), new RegExp('Món lịch sử ' + id), 'Failed load retains snapshot');
                                        promptAnswers = ['Món đã sửa', '55000'];
                                        await ordersPanel.getByTitle('Sửa bình luận', { exact: true }).click();
                                        await ordersPanel.getByText('Món đã sửa', { exact: true }).waitFor();
                                        assert.equal(historyEdits.at(-1).id, id);
                                        await ordersPanel.getByRole('button', { name: 'Tạo báo giá', exact: true }).click();
                                        await page.locator('[data-quote="quote-fixture"]').waitFor();
                                        assert.equal(quoteSources.at(-1).sessionId, id);
                                        assert.match(await page.locator('[data-quote] textarea').inputValue(), /Món đã sửa/);
                                        await page.locator('[data-action="delete"]').click();
                                        await page.getByText('Chưa có báo giá. Tạo báo giá tại đây hoặc từ Đơn hàng.', { exact: true }).waitFor();
                                        await page.evaluate(() => switchView('orders'));
                                        // Reload restores the selected history and its persisted edit, not Live.
                                        await page.reload();
                                        await page.locator('#section-orders').getByText('Món đã sửa', { exact: true }).waitFor();
                                        await ordersPanel.getByTitle('Xóa bình luận', { exact: true }).click();
                                        await page.waitForFunction(() => !document.querySelector('#current-orders-grid').textContent.includes('Món đã sửa'));
                                        promptAnswers = ['newhistorybuyer', 'Khách thêm', '12000'];
                                        await ordersPanel.getByRole('button', { name: 'Thêm đơn khách', exact: true }).click();
                                        await ordersPanel.getByText('Khách thêm', { exact: true }).waitFor();
                                        await ordersPanel.getByTitle('Xóa khách', { exact: true }).click();
                                        await page.waitForFunction(() => !document.querySelector('#current-orders-grid').textContent.includes('Khách thêm'));
                                        assert.equal(await page.evaluate(() => window.__socketEmits.some(args => ['edit-item', 'delete-item', 'delete-customer', 'confirm-item', 'start-live'].includes(args[0]))), false, 'History editing never sends live mutations');
                                        await liveState('all-confirmed-orders', { livebuyer: { username: 'livebuyer', items: [{ id: 'live-item', text: 'Đơn live mới', price: 99000 }], total: 99000 } });
                                        histories.delete(id);
                                        await ordersPanel.getByRole('button', { name: 'Quay lại đơn hiện tại', exact: true }).click();
                                        assert.match(await ordersPanel.textContent(), /Đơn live mới/);
                                        assert.equal(await ordersPanel.getByRole('button', { name: 'Tạo báo giá', exact: true }).isDisabled(), false);
                                    }
                                }
                                await liveState('history-data', { fileName: '2026-11-01_shop.json', data: {} });
                                await page.locator('#section-orders').getByText('Món lịch sử legacy:user:2026-11-01_shop.json', { exact: true }).waitFor();
                                await page.evaluate(() => returnToCurrentOrders());
                                await page.locator('.menu-item[data-view="quotes"]').click();
                await page.getByText('Chưa có báo giá. Tạo báo giá tại đây hoặc từ Đơn hàng.', { exact: true }).waitFor();
                await page.locator('#quote-create-editor summary').click();
                await page.locator('#quote-create-customer').selectOption('fixture');
                await page.locator('#quote-create-items [data-label]').fill('Báo giá độc lập');
                await page.locator('#quote-create-items [data-amount]').fill('15000');
                await page.locator('#quote-create-add-item').click();
                await page.locator('#quote-create-items [data-item]').last().getByRole('button', { name: 'Xóa món' }).click();
                await page.locator('#quote-create-form [type="submit"]').click();
                await page.locator('[data-quote="quote-fixture"]').waitFor();
                assert.equal(quotes[0].items[0].label, 'Báo giá độc lập');
                // Cancelled quotes retain the same full edit controls as drafts.
                quotes[0].status = 'cancelled';
                await page.evaluate(() => loadQuotes());
                await page.locator('[data-quote] summary').click();
                await page.locator('[data-quote] [data-action="add-item"]').click();
                await page.locator('[data-quote] [data-item]').first().getByRole('button', { name: 'Xóa món' }).click();
                await page.locator('[data-quote] [data-label]').fill('Món thay thế');
                await page.locator('[data-quote] [data-amount]').fill('20000');
                await page.locator('[data-quote] [data-action="save-items"]').click();
                await page.waitForFunction(() => document.querySelector('[data-quote]')?.dataset.version === '2');
                assert.equal(quotes[0].status, 'draft');
                assert.equal(quotes[0].items.length, 1);
                assert.equal(quotes[0].items[0].label, 'Món thay thế');
                await page.locator('[data-quote] [data-action="delete"]').click();
                await page.getByText('Chưa có báo giá. Tạo báo giá tại đây hoặc từ Đơn hàng.', { exact: true }).waitFor();
                quoteCreates = 0;
                assert.equal(await page.locator('#section-quotes').isVisible(), true);
                assert.equal(await page.locator('#zalo-experimental-open').isVisible(), true);
                await page.evaluate(username => {
                    window.__socketHandlers['all-confirmed-orders']({ [username]: { username, nickname: 'Khách kiểm thử', items: [{ id: 'one', text: 'Món kiểm thử', price: 120000 }], total: 120000 } });
                    switchView('orders');
                }, customers[0].tiktokUsername);
                await page.locator('#section-orders').getByRole('button', { name: 'Tạo báo giá', exact: true }).click();
                await page.locator('[data-quote="quote-fixture"]').waitFor();
                assert.equal(quoteCreates, 1, 'Create quote button submits exactly once');
                assert.equal(await page.locator('#section-quotes').isVisible(), true);
                await page.reload();
                await page.waitForFunction(() => typeof window.switchView === 'function' && typeof window.loadQuotes === 'function');
                await page.setViewportSize({ width: 390, height: 844 });
                await page.locator('.mobile-nav-item[data-view="quotes"]').click();
                await page.locator('[data-quote="quote-fixture"]').waitFor();
                assert.equal(quoteCreates, 1, 'Reload must not recreate quotes');
                assert.equal(await page.locator('#section-quotes').isVisible(), true);
                const quoteCard = page.locator('[data-quote="quote-fixture"]');
                // Consent is the first select in the card; it must never become the channel.
                for (const [channel, consent, action] of [['tiktok', 'unknown', 'approve'], ['zalo', 'granted', 'approve'], ['zalo', 'granted', 'approve-auto']]) {
                    await quoteCard.locator('[data-consent]').selectOption(consent);
                    await quoteCard.getByRole('combobox', { name: 'Kênh gửi', exact: true }).selectOption(channel);
                    const reloaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/quotes' && r.request().method() === 'GET');
                    await quoteCard.locator(`[data-action="${action}"]`).click();
                    await reloaded;
                    assert.equal(approvals.at(-1).channel, channel, 'Approval must use channel, not consent select');
                    assert.equal(approvals.at(-1).autoName, action === 'approve-auto' ? 'Tên Zalo kiểm thử' : undefined);
                }
                assert.equal(approvals.length, 3);
                await page.evaluate(() => switchView('customers'));
                await page.locator('[data-customer-row]').first().waitFor();
                await page.locator('#sidebar-mobile-toggle').click();
                assert.equal(await page.locator('#app-sidebar').getAttribute('aria-modal'), 'true');
                await page.keyboard.press('Escape');
                assert.equal(await page.locator('#sidebar-mobile-toggle').getAttribute('aria-expanded'), 'false');
                assert.equal(await page.locator('#sidebar-mobile-toggle').evaluate(el => el === document.activeElement), true);
                await page.locator('#customer-add-btn').click();
                await page.locator('#customer-display-name').fill('Khách kiểm thử mới');
                await page.locator('#customer-form button[type="submit"]').click();
                await page.waitForFunction(() => !document.querySelector('#customer-editor').classList.contains('is-open'));
                await page.waitForFunction(() => document.querySelectorAll('[data-customer-row]').length === 2);
                await page.locator('[data-customer-row]').first().getByRole('button', { name: 'Sửa', exact: true }).click();
                failSave = true;
                await page.locator('#customer-form button[type="submit"]').click();
                await page.locator('#customer-form-status').filter({ hasText: 'Lỗi kiểm thử lưu khách' }).waitFor();
                assert.equal(await page.locator('#customer-editor').getAttribute('aria-modal'), 'true');
                failSave = false;
                await page.locator('#customer-display-name').fill('Khách đã sửa');
                await page.locator('#customer-form button[type="submit"]').click();
                await page.waitForFunction(() => !document.querySelector('#customer-editor').classList.contains('is-open'));
                await page.getByText('Khách đã sửa', { exact: true }).waitFor();
                assert.equal(await page.locator('[data-customer-id="fixture"] button.customer-action-btn').first().evaluate(el => el === document.activeElement), true, 'Edit focus should survive table refresh');
                if (process.argv[3] && theme === 'light' && !collapsed) {
                    await page.screenshot({ path: `${process.argv[3]}-list.png` });
                }
                await page.locator('#customer-add-btn').click();
                await page.setViewportSize({ width: 390, height: 400 });
                await page.locator('#customer-address-note').fill('Kiểm thử khi bàn phím chiếm màn hình');
                const saveBounds = await page.locator('#customer-form button[type="submit"]').boundingBox();
                assert.ok(saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 400, 'Save button obscured in short viewport');
                await page.setViewportSize({ width: 390, height: 844 });
                if (process.argv[3] && theme === 'light' && !collapsed) {
                    await page.screenshot({ path: `${process.argv[3]}-editor.png` });
                }
                await page.keyboard.press('Shift+Tab');
                await page.keyboard.press('Tab');
                assert.equal(await page.locator('#customer-form').evaluate(el => el.contains(document.activeElement)), true);
                await page.setViewportSize({ width: 1440, height: 900 });
                await page.waitForFunction(() => !document.body.classList.contains('customer-editor-open'));
                assert.equal(await page.locator('#customer-editor').getAttribute('aria-modal'), null);
                await page.setViewportSize({ width: 390, height: 844 });
                holdSave = true;
                const saveStarted = new Promise(resolve => { markSaveStarted = resolve; });
                await page.locator('#customer-add-btn').click();
                await page.locator('#customer-display-name').fill('Lần lưu đang chờ');
                await page.locator('#customer-form button[type="submit"]').click();
                await saveStarted;
                await page.locator('.customer-form-close').click();
                await page.locator('#customer-add-btn').click();
                await page.locator('#customer-display-name').fill('Bản nháp mới không được mất');
                releaseSave();
                holdSave = false;
                await page.waitForFunction(() => !document.querySelector('#customer-form button[type="submit"]').disabled);
                assert.equal(await page.locator('#customer-display-name').inputValue(), 'Bản nháp mới không được mất');
                assert.equal(await page.locator('#customer-editor').getAttribute('aria-modal'), 'true');
                await page.keyboard.press('Escape');
                await page.locator('#customer-search').fill('khong_co_khach');
                await page.getByText('Chưa có khách hàng', { exact: true }).waitFor();
                failList = true;
                await page.locator('#customer-search').fill('error');
                await page.getByText('Lỗi kiểm thử tải khách', { exact: true }).waitFor();
                failList = false;
                await page.locator('.topbar-session-btn').click();
                await page.locator('#live-sessions-list input').first().waitFor();
                assert.ok(await page.locator('#live-sessions-modal > div').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'History modal overflow');
                assert.deepEqual(errors, [], 'Browser runtime errors');
                console.log(`PASS ${theme}, desktop collapsed=${collapsed}: viewport matrix + Live controls/states/timeouts + customer create/error/search + quote CRUD + history CRUD/source/refresh + focus/drawer/resize`);
                // Exercise the non-reduced-motion drawer after page-entry animation settles.
                await page.evaluate(() => closeLiveSessions());
                await page.emulateMedia({ reducedMotion: 'no-preference' });
                await page.waitForTimeout(650);
                assert.ok(await page.locator('#app-sidebar').evaluate(el => el.getBoundingClientRect().right <= 0));
                await context.close();
            }
        }
        console.log(`PASS ${checks} layout checks, real Edge rendering with mocked APIs (no production data modified)`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
