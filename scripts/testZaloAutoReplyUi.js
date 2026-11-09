// Offline UI contract test: intercepted APIs/static files only. Never opens Zalo or starts the app.
// Run: node scripts/testZaloAutoReplyUi.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const publicRoot = path.resolve(__dirname, '../public');
const base = '/api/zalo-auto-reply';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64');
const fixture = () => ({
    settings: {
        enabled: false, cooldownSeconds: 60, target: { phone: '', name: '' },
        rules: { phone: { enabled: false, triggers: [], text: '' }, qr: { enabled: false, triggers: [], caption: '', image: null } }
    },
    messages: ['needs_check', 'queued', 'pending', 'dispatch_failed', 'sending', 'sent', 'skipped', 'cooldown'].map((status, index) => ({
        id: `message-${index}`, status, text: index === 0 ? '<img src=x onerror="window.unsafe=true"> kiểm thử' : 'Tin thử ' + status,
        receivedAt: new Date(Date.UTC(2026, 9, 24, 8, index)).toISOString(), reason: 'fixture_reason', candidates: ['phone', 'qr']
    })),
    connection: { open: false, watching: false, state: 'paused', detail: 'Chưa kết nối kiểm thử', runtime: {
            phase: 'paused', lastPollAt: '2026-10-25T10:00:00.000Z', ingested: 1, lastDispatchStatus: 202,
            reader: { readableMessages: 7, inboundMessages: 3, eligibleMessages: 1, skipped: { structure: 2, direction: 1, plaintext: 1, time: 0 } }
        } }
});

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        for (const theme of ['light', 'dark']) {
            for (const width of [390, 1440]) {
                const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
                await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
                let state = fixture();
                let failure = { path: base, message: 'Không tải được cấu hình ban đầu' };
                let hold = null;
                const calls = [];
                let imageGets = 0;
                const external = [];
                await context.route('**/*', async route => {
                    const request = route.request();
                    const url = new URL(request.url());
                    const pathname = url.pathname;
                    // No CDN, fonts, analytics, app server, or actual integration traffic is allowed.
                    if (url.hostname !== 'tikoder.test') {
                        external.push(url.hostname);
                        return route.fulfill({ contentType: url.hostname === 'cdn.tailwindcss.com' ? 'application/javascript' : 'text/css', body: '' });
                    }
                    if (pathname === '/socket.io/socket.io.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.io=()=>({on(){},emit(){},timeout(){return this;}});' });
                    if (pathname.startsWith(base)) {
                        const method = request.method();
                        const payload = method === 'GET' ? undefined : request.postDataJSON();
                        calls.push({ pathname, method, payload });
                        if (hold && pathname === hold.path) {
                            const pending = hold;
                            hold = null;
                            await new Promise(resolve => { pending.release = resolve; });
                        }
                        if (failure && pathname === failure.path) return route.fulfill({ status: 503, json: { error: failure.message } });
                        if (pathname === base && method === 'GET') return route.fulfill({ json: state });
                        if (pathname === base + '/diagnostics' && method === 'GET') return route.fulfill({ json: { version: 1, editorFound: true, structure: [] } });
                        if (pathname === base + '/settings' && method === 'PUT') state.settings = { ...payload, rules: { ...payload.rules, qr: { ...payload.rules.qr, image: state.settings.rules.qr.image } } };
                        else if (pathname === base + '/image' && method === 'POST') {
                            assert.deepEqual(payload, { data: png.toString('base64'), mime: 'image/png' });
                            state.settings.rules.qr.image = { filename: 'fixture.png', mime: 'image/png', sha256: 'fixture-sha' };
                        } else if (pathname === base + '/image' && method === 'GET') {
                            imageGets++;
                            return route.fulfill({ contentType: 'image/png', body: png });
                        } else if (pathname === base + '/connect') state.connection = { open: true, watching: true, state: 'monitoring', detail: 'Fixture monitor only' };
                        else if (pathname === base + '/pause') state.connection = { open: true, watching: false, state: 'paused', detail: 'Fixture paused' };
                        else if (pathname.endsWith('/resolve')) {
                            const id = decodeURIComponent(pathname.split('/').at(-2));
                            state.messages.find(message => message.id === id).status = payload.action;
                        } else throw new Error('Unexpected Zalo endpoint: ' + pathname);
                        return route.fulfill({ json: {} });
                    }
                    if (pathname.startsWith('/api/')) {
                        let body = {};
                        if (pathname === '/api/me') body = { loggedIn: true, user: { uid: 'fixture', name: 'Kiểm thử', email: 'fixture@example.test', role: 'user' } };
                        if (pathname === '/api/quotes') body = { quotes: [], deliveries: [], customers: [] };
                        if (pathname === '/api/customers') body = { customers: [] };
                        return route.fulfill({ json: body });
                    }
                    const file = pathname === '/app' ? path.join(publicRoot, 'app.html') : path.resolve(publicRoot, '.' + pathname);
                    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
                    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
                    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
                });
                const page = await context.newPage();
                const runtimeErrors = [];
                const dialogs = [];
                let acceptDialog = true;
                page.on('pageerror', error => runtimeErrors.push(error.message));
                page.on('dialog', async dialog => {
                    dialogs.push(dialog.message());
                    await (acceptDialog ? dialog.accept() : dialog.dismiss());
                });
                await page.goto('http://tikoder.test/app');
                // The new view uses standalone CSS; supply only the shell's visibility utility offline.
                await page.addStyleTag({ content: '.hidden { display: none; }' });
                await page.waitForFunction(() => typeof window.loadZaloAutoReply === 'function' && typeof window.switchView === 'function');
                assert.equal(calls.length, 0, 'No Zalo API access or sending on initial app load');
                // Merged UI adds both Đi Đơn (main) and Báo giá (security) to the bottom bar.
                assert.equal(await page.locator('.mobile-nav-item').count(), 7, 'Keep merged bottom buttons');
                assert.equal(await page.locator('.mobile-nav-item[data-view="zalo-inbox"]').count(), 0);
                // Merged responsive layout hides the desktop topbar on phones and uses the mobile header toggle.
                if (width === 390) await page.locator('#mobile-menu-toggle').click();

                await page.locator('.menu-item[data-view="zalo-inbox"]').click();
                await page.getByRole('alert').filter({ hasText: 'Không tải được cấu hình ban đầu' }).waitFor();
                assert.equal(await page.locator('#zar-target-phone').isDisabled(), true);
                assert.equal(await page.locator('#zar-enabled').isChecked(), false);
                failure = null;
                await page.locator('#zar-refresh').click();
                await page.waitForFunction(() => !document.getElementById('zar-config').disabled);
                assert.equal(await page.locator('#section-zalo-inbox').isVisible(), true);
                assert.equal(await page.locator('#section-quotes').isVisible(), false);
                if (width === 390) assert.equal(await page.locator('#sidebar-mobile-toggle').getAttribute('aria-expanded'), 'false');
                assert.equal(await page.locator('#zar-enabled').isChecked(), false);
                assert.equal(await page.locator('#zar-target-phone').inputValue(), '');
                assert.equal(await page.locator('#zar-image-preview').isVisible(), false);
                assert.ok((await page.locator('#zar-rules-warning').textContent()).includes('Chưa bật quy tắc nào'));
                const readerStatus = await page.locator('#zar-reader').textContent();
                assert.ok(readerStatus.includes('Tin đọc được: 7') && readerStatus.includes('tin khách: 3'));
                assert.ok(readerStatus.includes('đã đưa vào hàng đợi: 1') && readerStatus.includes('n8n HTTP: 202'));
                                assert.equal(readerStatus.includes('Bắt đầu quan sát'), false, 'Legacy reader does not invent observation diagnostics');
                                Object.assign(state.connection.runtime.reader, {
                                    observationStartedAt: '2026-10-25T09:58:12.345Z', trackerEpoch: 0, atBottom: false, candidateCount: 0,
                                    resetReason: 'outside-history-mutation', resetCounts: { 'outside-history-mutation': 28, 'baseline-mutation': 4 },
                                    implementation: 'observed-dom-mutation-trace-1',
                                    trace: [{ at: '2026-10-25T09:59:00.000Z', event: 'reset', reason: 'outside-history-mutation',
                                        candidatesBefore: 1, mutationCount: 3, mutations: [] }],
                                    skipped: { ...state.connection.runtime.reader.skipped, identity: 2, baseline: 4, untracked: 22, duplicate: 3, future: 1 }
                                });
                                await page.locator('#zar-refresh').click();
                                await page.waitForFunction(() => document.getElementById('zar-reader').textContent.includes('Phiên theo dõi: 0'));
                                const diagnostics = await page.locator('#zar-reader').textContent();
                                for (const text of [
                                    'Bắt đầu quan sát (ISO): 2026-10-25T09:58:12.345Z', 'Ở cuối hội thoại: không', 'Tin đang xác minh: 0',
                                    'Lý do đặt lại theo dõi: thay đổi ngoài vùng lịch sử tin nhắn',
                                    'Số lần đặt lại do thay đổi ngoài vùng lịch sử tin nhắn: 28', 'Số lần đặt lại do lịch sử đã ghi nhận thay đổi: 4',
                                    'Bỏ qua do không xác minh được định danh: 2', 'Bỏ qua do thuộc lịch sử ban đầu: 4',
                                    'Bỏ qua do chưa được theo dõi để xác minh là tin mới: 22', 'Bỏ qua do đã ghi nhận trước đó: 3',
                                    'Bỏ qua do thời điểm tin nằm trong tương lai: 1',
                                    'Bộ nhận có ghi vết mutation', 'Reset ghi vết lúc 2026-10-25T09:59:00.000Z',
                                    'ứng viên trước reset: 1; số mutation: 3'
                                ]) assert.ok(diagnostics.includes(text), text);
                                state.connection.runtime.reader.atBottom = true;
                                state.connection.runtime.reader.resetReason = '<img src=x onerror="window.unsafe=true">';
                                state.connection.runtime.reader.resetCounts['<img src=x>'] = 99;
                                await page.locator('#zar-refresh').click();
                                await page.waitForFunction(() => document.getElementById('zar-reader').textContent.includes('Ở cuối hội thoại: có'));
                                assert.equal((await page.locator('#zar-reader').textContent()).includes('<img'), false, 'Unknown reset reasons are not rendered');
                                assert.equal(await page.locator('#zar-reader img').count(), 0);
                assert.equal(calls.filter(call => call.method !== 'GET').length, 0, 'Loading never mutates');
                assert.equal(await page.locator('#zar-messages img').count(), 0, 'Inbox text cannot inject HTML');
                assert.equal(await page.evaluate(() => window.unsafe), undefined);
                const card = index => page.locator(`[data-message-id="message-${index}"]`);
                assert.equal(await card(0).getByRole('button', { name: 'Đã kiểm tra: đã gửi', exact: true }).count(), 1);
                for (const index of [1, 2, 3]) {
                    assert.equal(await card(index).getByRole('button', { name: 'Bỏ qua', exact: true }).count(), 1);
                    assert.equal(await card(index).locator('[data-zar-action="sent"]').count(), 0);
                }
                for (const index of [4, 5, 6, 7]) assert.equal(await card(index).getByRole('button').count(), 0);
                assert.equal(await page.locator('#zar-messages').getByRole('button', { name: /thử lại|gửi lại/i }).count(), 0);
                assert.ok((await card(0).textContent()).includes('Nội dung, Ảnh QR'));
                assert.ok((await card(0).textContent()).includes('fixture_reason'));
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Populated inbox has no overflow');

                // Poll only on the visible view. Never replace an unsaved form.
                await page.locator('#zar-target-name').fill('Tên nháp chưa lưu');
                assert.equal(await page.locator('#zar-connect').isHidden(), true, 'Legacy connection control is intentionally not exposed in the UI');
                const beforePoll = calls.filter(call => call.pathname === base).length;
                await page.waitForTimeout(5300);
                assert.ok(calls.filter(call => call.pathname === base).length > beforePoll, '5s visible refresh');
                assert.equal(await page.locator('#zar-target-name').inputValue(), 'Tên nháp chưa lưu');
                await page.evaluate(() => switchView('orders'));
                const hiddenCalls = calls.filter(call => call.pathname === base).length;
                await page.waitForTimeout(5300);
                assert.equal(calls.filter(call => call.pathname === base).length, hiddenCalls, 'No refresh while view hidden');
                await page.evaluate(() => switchView('zalo-inbox'));
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                assert.equal(await page.locator('#zar-target-name').inputValue(), 'Tên nháp chưa lưu');
                await page.locator('#zar-target-phone').fill('0901234567');
                await page.locator('#zar-target-name').fill('Liên hệ thử chính xác');
                await page.locator('#zar-cooldown').fill('45');
                if (!(await page.locator('#zar-enabled').isChecked())) await page.locator('label.zar-switch:has(#zar-enabled) .zar-slider').click();
                await page.locator('#zar-save').click();
                await page.getByRole('alert').filter({ hasText: 'Hãy bật ít nhất một quy tắc' }).waitFor();
                assert.equal(calls.filter(call => call.method === 'PUT').length, 0, 'Global switch alone cannot enable replies');
                await page.locator('label.zar-switch:has(#zar-phone-enabled) .zar-slider').click();
                await page.locator('#zar-phone-triggers').fill(' số điện thoại, liên hệ , ');
                await page.locator('#zar-phone-text').fill('Nội dung kiểm thử');
                await page.locator('#zar-qr-triggers').fill('qr, thanh toán');
                await page.locator('#zar-qr-caption').fill('Ảnh kiểm thử');
                if (!(await page.locator('#zar-enabled').isChecked())) await page.locator('label.zar-switch:has(#zar-enabled) .zar-slider').click();
                acceptDialog = false;
                await page.locator('#zar-save').click();
                assert.equal(calls.filter(call => call.method === 'PUT').length, 0, 'Enable cancellation never saves');
                acceptDialog = true;
                const heldSave = { path: base + '/settings' };
                hold = heldSave;
                await page.locator('#zar-save').click();
                await page.waitForFunction(() => document.getElementById('zar-refresh').disabled);
                assert.equal(await page.locator('#zar-pause').isHidden(), true, 'Legacy pause control is intentionally not exposed in the UI');
                assert.equal(await card(0).getByRole('button').first().isDisabled(), true);
                await assertEventually(() => !!heldSave.release);
                heldSave.release();
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                assert.deepEqual(calls.find(call => call.method === 'PUT').payload, {
                    enabled: true, cooldownSeconds: 45, target: { phone: '0901234567', name: 'Liên hệ thử chính xác' },
                    rules: { phone: { enabled: true, triggers: ['số điện thoại', 'liên hệ'], text: 'Nội dung kiểm thử' }, qr: { enabled: false, triggers: ['qr', 'thanh toán'], caption: 'Ảnh kiểm thử' }, custom: [] }
                });
                assert.ok(dialogs.some(text => text.includes('Liên hệ thử chính xác (0901234567)')));
                await page.locator('#zar-cooldown').fill('29');
                const saves = calls.filter(call => call.method === 'PUT').length;
                await page.locator('#zar-save').click();
                assert.equal(calls.filter(call => call.method === 'PUT').length, saves, 'Reject cooldown below 30');
                await page.locator('#zar-cooldown').fill('45');
                failure = { path: base + '/settings', message: 'Không thể lưu cấu hình thử' };
                await page.locator('#zar-save').click();
                await page.getByRole('alert').filter({ hasText: failure.message }).waitFor();
                assert.equal(await page.locator('#zar-target-name').inputValue(), 'Liên hệ thử chính xác');
                failure = null;
                await page.locator('#zar-save').click();
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);

                await page.locator('#zar-image').setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: png });
                await page.locator('#zar-upload').click();
                await page.getByRole('alert').filter({ hasText: 'Chỉ chấp nhận ảnh PNG hoặc JPEG.' }).waitFor();
                await page.locator('#zar-image').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
                await page.locator('#zar-upload').click();
                await page.getByRole('alert').filter({ hasText: 'không vượt quá 5 MB' }).waitFor();
                await page.locator('#zar-phone-text').fill('Nháp giữ lại qua tải ảnh');
                await page.locator('#zar-image').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
                await page.locator('#zar-upload').click();
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                await page.waitForFunction(() => document.getElementById('zar-image-preview').naturalWidth > 0);
                assert.ok(imageGets > 0, 'Authenticated same-origin GET image preview');
                assert.equal(await page.locator('#zar-phone-text').inputValue(), 'Nháp giữ lại qua tải ảnh');
                assert.ok((await page.locator('#zar-image-preview').getAttribute('src')).startsWith(base + '/image'));
                await page.locator('#zar-save').click();
                assert.equal(await page.locator('#zar-connect').isHidden(), true);
                assert.equal(await page.locator('#zar-pause').isHidden(), true);
                assert.equal(await page.locator('#zar-diagnostics').isHidden(), true);
                assert.equal(calls.some(call => call.pathname.endsWith('/connect') || call.pathname.endsWith('/pause')), false, 'UI does not expose legacy connection controls');
                failure = { path: base + '/messages/message-0/resolve', message: 'Không lưu được kết quả kiểm tra' };
                await card(0).getByRole('button', { name: 'Đã kiểm tra: đã gửi', exact: true }).click();
                await page.getByRole('alert').filter({ hasText: failure.message }).waitFor();
                assert.equal(state.messages[0].status, 'needs_check', 'Failed resolution remains unverified');
                failure = null;
                await card(0).getByRole('button', { name: 'Đã kiểm tra: đã gửi', exact: true }).click();
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                assert.equal(state.messages[0].status, 'sent');
                assert.equal(await card(0).getByRole('button').count(), 0);
                for (const index of [1, 2, 3]) {
                    await card(index).getByRole('button', { name: 'Bỏ qua', exact: true }).click();
                    await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                    assert.equal(state.messages[index].status, 'skipped');
                }
                state.messages[0].status = 'needs_check';
                await page.locator('#zar-refresh').click();
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                await card(0).getByRole('button', { name: 'Bỏ qua', exact: true }).click();
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                assert.equal(state.messages[0].status, 'skipped');
                const resolutions = calls.filter(call => call.pathname.endsWith('/resolve'));
                assert.equal(resolutions[0].payload.action, 'sent');
                assert.equal(resolutions[1].payload.action, 'sent');
                assert.ok(resolutions.slice(2).every(call => call.payload.action === 'skipped'));

                failure = { path: base, message: 'Không tải được trạng thái thử' };
                await page.locator('#zar-refresh').click();
                await page.getByRole('alert').filter({ hasText: failure.message }).waitFor();
                failure = null;
                state.messages = [];
                await page.locator('#zar-refresh').click();
                await page.locator('#zar-messages').filter({ hasText: 'Chưa có tin nhắn.' }).waitFor();
                await page.waitForFunction(() => !document.getElementById('zar-refresh').disabled);
                const metrics = await page.evaluate(() => ({
                    width: innerWidth, scroll: document.documentElement.scrollWidth,
                    sectionWidth: document.getElementById('section-zalo-inbox').getBoundingClientRect().width,
                    theme: document.documentElement.dataset.theme,
                    colors: ['color', 'backgroundColor'].map(key => getComputedStyle(document.querySelector('.zar-card'))[key])
                }));
                assert.ok(metrics.scroll <= width + 1, `No overflow: ${JSON.stringify(metrics)}`);
                assert.ok(metrics.sectionWidth > width * .5, 'View not squeezed');
                assert.equal(metrics.theme, theme);
                assert.deepEqual(runtimeErrors, [], 'No browser runtime errors');
                console.log(`PASS ${theme} ${width}px: drawer/navigation, defaults, save/confirmation/payload/errors, busy controls, 5s visible-only polling, draft preservation, PNG upload/preview, hidden legacy controls, resolve-only actions, empty inbox, no overflow/runtime errors. Colors ${metrics.colors.join(' / ')}`);
                await context.close();
            }
        }
        console.log('PASS: 4 offline Edge UI scenarios. All APIs intercepted; no live Zalo tested. External CDN/font scripts blocked (existing Tailwind CDN not executed).');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function assertEventually(check) {
    for (let count = 0; count < 100; count++) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected intercepted request did not start');
}
