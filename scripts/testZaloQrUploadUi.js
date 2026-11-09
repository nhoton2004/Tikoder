// Offline Edge regression for QR upload and authenticated image preview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const publicRoot = path.resolve(__dirname, '../public');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64');
const base = '/api/zalo-auto-reply';

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
        let image = null;
        let posts = 0;
        let gets = 0;
        await context.route('**/*', route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.hostname !== 'tikoder.test') return route.fulfill({ body: '', contentType: 'application/javascript' });
            if (url.pathname === '/socket.io/socket.io.js') return route.fulfill({ body: 'window.io=()=>({on(){},emit(){},timeout(){return this;}});', contentType: 'application/javascript' });
            if (url.pathname === base && request.method() === 'GET') return route.fulfill({ json: {
                settings: { enabled: false, cooldownSeconds: 60, target: { phone: '', name: '' }, rules: {
                    phone: { enabled: false, triggers: [], text: '' }, qr: { enabled: false, triggers: [], caption: '', image }
                } }, messages: [], connection: { open: false, watching: false, state: 'paused' }
            } });
            if (url.pathname === base + '/image' && request.method() === 'POST') {
                assert.deepEqual(request.postDataJSON(), { data: png.toString('base64'), mime: 'image/png' });
                posts++;
                image = { filename: 'fixture.png', mime: 'image/png', sha256: 'fixture-sha' };
                return route.fulfill({ json: image });
            }
            if (url.pathname === base + '/image' && request.method() === 'GET') {
                gets++;
                return route.fulfill({ contentType: 'image/png', body: png });
            }
            if (url.pathname === '/api/me') return route.fulfill({ json: { loggedIn: true, user: { uid: 'fixture', name: 'Kiểm thử', email: 'fixture@example.test', role: 'user' } } });
            if (url.pathname === '/api/quotes') return route.fulfill({ json: { quotes: [], deliveries: [], customers: [] } });
            if (url.pathname === '/api/customers') return route.fulfill({ json: { customers: [] } });
            if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
            const file = url.pathname === '/app' ? path.join(publicRoot, 'app.html') : path.resolve(publicRoot, '.' + url.pathname);
            if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
            return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://tikoder.test/app');
        // The offline route blocks Tailwind CDN; restore its visibility utility.
        await page.addStyleTag({ content: '.hidden { display: none; }' });
        await page.waitForFunction(() => typeof window.switchView === 'function' && typeof window.loadZaloAutoReply === 'function');
        await page.evaluate(() => switchView('zalo-inbox'));
        await page.waitForFunction(() => !document.getElementById('zar-config').disabled);
        assert.equal(await page.locator('#zar-image-preview').isVisible(), false);
        assert.equal(await page.locator('#zar-upload').isDisabled(), true);
        const picker = page.waitForEvent('filechooser');
        await page.locator('#zar-select-image').click();
        await (await picker).setFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
        assert.equal(await page.locator('#zar-upload').isEnabled(), true);
        await page.locator('#zar-upload').click();
        await page.waitForFunction(() => {
            const preview = document.getElementById('zar-image-preview');
            return !preview.hidden && preview.naturalWidth > 0;
        });
        assert.equal(posts, 1);
        assert.ok(gets >= 1);
        assert.equal(await page.locator('#zar-image-preview').isVisible(), true);
        assert.match(await page.locator('#zar-image-info').textContent(), /Ảnh đã lưu: fixture.png/);
        assert.deepEqual(errors, []);
        console.log('PASS: mobile Edge chooses QR, uploads once, then visibly renders the stored image.');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
