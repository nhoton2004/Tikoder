// Offline contract tests in real Edge. No account, application server, profile,
// network access, or real sends. Fixture attributes are NOT live-verified Zalo DOM.
// Run: node scripts/testZaloInboxDom.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { chromium } = require('playwright-core');
const { snapshot } = require('../utils/zaloInboxDom');
const phone = '0901234567';
const name = 'Nguyễn Minh Anh';
const row = (id, direction = 'inbound', text = id) =>
    `<div class="chat-item" data-message-id="${id}" data-direction="${direction}"><span data-message-text>${text}</span></div>`;
const fixture = () => `<!doctype html><meta charset="utf-8">
<input id="contact-search-input">
<button id="friend-item-fixture"><span class="txt-highlight">${phone}</span><span class="conv-item-title__name">${name}</span></button>
<section id="chatView" data-chat-type="private" data-thread-id="thread-a" data-peer-phone="${phone}" data-peer-name="${name}" data-history-ready="true">
<div data-message-scroll style="height:200px;overflow:auto">${row('old')}${row('own-old', 'outbound')}</div>
<div class="chat-box-input-container"><div id="richInput" contenteditable="true" data-trailer="${name}"></div></div></section>
<script>window.enters=0; window.uploads=0;
document.querySelector('#richInput').addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();window.enters++;} });
document.addEventListener('change', e => {if(e.target.type==='file')window.uploads++;});</script>`;

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    const network = [];
    // Everything is fulfilled locally. Only the adapter's hardcoded Zalo URL is
    // permitted as a fixture navigation, never as an outbound HTTP request.
    await context.route('**/*', route => {
        const request = route.request();
        if (request.isNavigationRequest() && request.url() === 'https://chat.zalo.me/') {
            return route.fulfill({ contentType: 'text/html', body: fixture() });
        }
        network.push(request.url());
        return route.abort();
    });
    const page = await context.newPage();
    const timers = new Map();
    let timerId = 0;
    const delays = [];
    // Virtual scheduling only: DOM, navigation, selectors, and browser events
    // still execute in real Edge. Assert production uses exactly 2000ms.
    const filename = path.resolve(__dirname, '../utils/zaloWebExperimental.js');
    const adapterModule = new Module(filename, module);
    adapterModule.filename = filename;
    adapterModule.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalRequire = adapterModule.require.bind(adapterModule);
    adapterModule.require = id => {
        if (id === 'playwright-core') return { chromium: { launchPersistentContext: async () => context } };
        if (id === 'fs') return { ...fs, existsSync: value => String(value).endsWith('msedge.exe') || fs.existsSync(value) };
        return originalRequire(id);
    };
    // Compile the actual adapter with a controllable scheduler, not a second implementation.
    const previousTimers = global.__zaloFixtureTimers;
    global.__zaloFixtureTimers = {
        set(fn, delay) { delays.push(delay); const token = { id: ++timerId, unref() {} }; timers.set(token, fn); return token; },
        clear(token) { timers.delete(token); }
    };
    // Install the scheduler before loading the adapter.
    adapterModule._compile('const setTimeout = global.__zaloFixtureTimers.set; const clearTimeout = global.__zaloFixtureTimers.clear;\n' + fs.readFileSync(filename, 'utf8'), filename);
    const adapter = adapterModule.exports;
    const previousFlag = process.env.ZALO_WEB_EXPERIMENTAL;
    process.env.ZALO_WEB_EXPERIMENTAL = 'true';
    const uid = 'offline-fixture';
    const events = [];
    const statuses = [];
    const capabilities = { text: true, inbox: 'observed_web_dom', image: true };
    const options = { phone, name, onMessage: event => events.push(event), onStatus: status => statuses.push(status) };
    const poll = async () => {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
        assert.equal(timers.size, 1, 'Exactly one non-overlapping poll scheduled');
        const [token, fn] = timers.entries().next().value;
        timers.delete(token);
        await fn();
    };
    const append = async (id, direction = 'inbound', evidence = {}) => {
        await page.locator('[data-message-scroll]').evaluate(async (element, { html, evidence }) => {
            // Real browser time, strictly after the preceding baseline snapshot.
            await new Promise(resolve => setTimeout(resolve, 2));
            const template = document.createElement('template');
            template.innerHTML = html;
            const row = template.content.firstElementChild;
            if (evidence.live !== null) row.setAttribute('data-live-arrival', evidence.live === false ? 'false' : 'true');
            if (evidence.createdAt !== null) row.setAttribute('data-created-at', evidence.createdAt === 'iso' ? new Date().toISOString() : evidence.createdAt || String(Date.now()));
            element.append(row);
        }, { html: row(id, direction), evidence });
    };
    const reset = async () => {
        adapter.stopWatching(uid);
        await page.goto('https://chat.zalo.me/');
        events.length = 0;
        await adapter.startWatching(uid, options);
        assert.equal(adapter.getWatchStatus(uid).state, 'monitoring');
    };
    try {
        assert.deepEqual(adapter.getWatchStatus(uid).capabilities, capabilities, 'Capabilities available before browser open');
        await adapter.open(uid);
        const report = await adapter.diagnostics(uid);
        assert.equal(report.editorFound, true);
        const exported = JSON.stringify(report);
        assert.ok(!exported.includes(phone) && !exported.includes(name) && !exported.includes('thread-a'), 'Diagnostics must omit peer names, phones and thread values');
        assert.ok(exported.includes('data-peer-phone'), 'Attribute names are retained, not values');
        assert.ok(exported.includes('richInput'));
        await page.locator('#richInput').evaluate(element => element.remove());
        const noEditor = await adapter.diagnostics(uid);
        assert.equal(noEditor.editorFound, false);
        assert.ok(noEditor.pages[0].frames[0].report.structure.length > 0, 'Missing legacy editor still exports structural evidence');
        const secondPage = await context.newPage();
        await secondPage.goto('https://chat.zalo.me/');
        await secondPage.setContent('<main class="other-layout"><input type="password" value="DO_NOT_EXPORT_PASSWORD"><div class="new-composer" role="textbox" contenteditable="true">DO_NOT_EXPORT_MESSAGE</div></main>');
        const multiTab = await adapter.diagnostics(uid);
        assert.equal(multiTab.version, 3);
        assert.equal(multiTab.pages.length, 2, 'Diagnostics scans managed Zalo tabs, not only first tab');
        assert.equal(multiTab.editorFound, false);
        assert.equal(multiTab.pages[1].frames[0].report.candidates.length, 1, 'Changed editor selector is reported as a candidate, not used to send');
        assert.ok(!JSON.stringify(multiTab).includes('DO_NOT_EXPORT'), 'No text or password input value in report');
        const wrappers = '<div class="nested-layout">'.repeat(14);
        const sidebar = '<nav>' + '<div class="sidebar-contact">PRIVATE_CUSTOMER_NAME</div>'.repeat(400) + '</nav>';
        await secondPage.setContent(sidebar + wrappers + '<article id="chatView"><div class="message-view"><div class="message-row inbound" data-msg-id="PRIVATE_ID"><span class="actual-text-body">PRIVATE_MESSAGE</span></div></div><div class="chat-box-input-container">' + wrappers + '<input type="file" accept="image/png,image/jpeg"><input class="changed-composer" type="text" value="PRIVATE_DRAFT">' + '</div>'.repeat(14) + '</div></article>' + '</div>'.repeat(14));
        const deepReport = await adapter.diagnostics(uid);
        const deep = deepReport.pages[1].frames[0].report;
        assert.equal(deep.version, 3);
        assert.equal(deep.editorFound, false);
        const messageSection = deep.sections.find(section => section.selector === '.message-view');
        const composerSection = deep.sections.find(section => section.selector === '.chat-box-input-container');
        assert.ok(messageSection.structure.some(item => item.classes.includes('actual-text-body')), 'Message section independently sampled below old depth-8 cutoff');
        assert.ok(composerSection.structure.some(item => item.classes.includes('changed-composer')), 'Composer descendants below depth 8 remain visible in diagnostics');
        assert.ok(composerSection.structure.some(item => item.inputKind === 'file' && item.acceptKinds.includes('image/png')), 'File-input capability is diagnostic only');
        assert.ok(!JSON.stringify(deepReport).includes('PRIVATE_'), 'No message, draft, peer or ID attribute values exported');
        await secondPage.close();
        await page.goto('https://chat.zalo.me/');
        let stop = await adapter.startWatching(uid, options);
        assert.equal(adapter.getWatchStatus(uid).state, 'monitoring', JSON.stringify(adapter.getWatchStatus(uid)));
        assert.deepEqual(events, [], 'Old baseline ignored');
        await append('own-new', 'outbound');
        await append('incoming-new');
        await poll();
        assert.deepEqual(events, [{ sourceMessageId: 'incoming-new', conversationKey: 'private:thread-a', text: 'incoming-new', phone, name }]);
        await poll();
        assert.equal(events.length, 1, 'New inbound delivered exactly once');
        await page.locator('[data-message-id="incoming-new"]').evaluate(el => el.remove());
        await poll();
        await append('incoming-new'); await poll();
        assert.equal(events.length, 1, 'Remounted stable ID is not delivered again');
        stop();
        await append('paused');
        assert.equal(timers.size, 0);
        assert.equal(adapter.getWatchStatus(uid).state, 'paused');
        stop = await adapter.startWatching(uid, options);
        assert.equal(events.length, 1, 'Restart baselines all mounted rows');

        // Existing quote/text send and watcher use the same lock. A busy poll
        // skips without reading the DOM; concurrent sends reject rather than collide.
        let release;
        let entered;
        const ready = new Promise(resolve => { entered = resolve; });
        const quote = adapter.withSessionLock(uid, async () => {
            entered(); await new Promise(resolve => { release = resolve; });
        });
        await ready;
        const evaluate = page.evaluate.bind(page);
        let reads = 0;
        page.evaluate = (...args) => { reads++; return evaluate(...args); };
        const [busyToken, busyPoll] = timers.entries().next().value;
        timers.delete(busyToken);
        await busyPoll();
        assert.equal(reads, 0, 'Busy watcher does not read/navigation under quote lock');
        await assert.rejects(adapter.send(uid, phone, name, 'fixture'), /Đang xử lý/);
        await assert.rejects(adapter.sendReply(uid, phone, name, 'fixture', 'private:thread-a'), /Đang xử lý/);
        await assert.rejects(adapter.open(uid), /Đang xử lý/);
        page.evaluate = evaluate;
        release(); await quote;
        await append('after-lock'); await poll();
        assert.equal(events.at(-1).sourceMessageId, 'after-lock');

        // Preserve exact phone, display-name, and editor-trailer guards.
        adapter.stopWatching(uid);
        await assert.rejects(adapter.send(uid, phone, 'Wrong name', 'fixture'), /Tên Zalo/);
        await page.locator('.txt-highlight').evaluate(el => { el.textContent = '0' + el.textContent; });
        await assert.rejects(adapter.send(uid, phone, name, 'fixture'), /Số điện thoại/);
        await page.goto('https://chat.zalo.me/');
        await page.locator('#richInput').evaluate(el => el.setAttribute('data-trailer', 'Wrong'));
        await assert.rejects(adapter.send(uid, phone, name, 'fixture'), error => {
            assert.equal(error.name, 'TimeoutError');
            assert.equal(error.domDetail, 'Contact verification failed: editor-wait-identity');
            return true;
        });
        assert.equal(await page.evaluate(() => window.enters), 0, 'A mismatched trailer cannot reach Enter');
        assert.equal(await page.locator('#richInput').innerText(), '', 'Identity failure must not fill the editor');
        await page.goto('https://chat.zalo.me/');
        await assert.rejects(adapter.send(uid, phone, name, 'fixture', () => { throw new Error('cancel'); }), /cancel/);
        assert.equal(await page.evaluate(() => window.enters), 0);

        // Quote backwards compatibility: only the original live-verified selector
        // families remain. No root ID, private metadata, row IDs or directions.
        await page.evaluate(() => {
            const root = document.querySelector('#chatView');
            for (const attribute of [...root.attributes]) root.removeAttribute(attribute.name);
            for (const row of root.querySelectorAll('.chat-item')) {
                row.removeAttribute('data-message-id'); row.removeAttribute('data-direction');
            }
            root.querySelector('[data-message-scroll]').removeAttribute('data-message-scroll');
        });
        assert.equal((await page.evaluate(snapshot)).supported, false);
        await adapter.startWatching(uid, options);
        assert.equal(adapter.getWatchStatus(uid).state, 'unsupported');
        assert.deepEqual(adapter.getWatchStatus(uid).capabilities, capabilities);
        let quoteGuardCalls = 0;
        assert.deepEqual(await adapter.send(uid, phone, name, 'legacy quote', () => { quoteGuardCalls++; }), { outcome: 'needs_check' });
        assert.equal(quoteGuardCalls, 1);
        assert.equal(await page.locator('#richInput').innerText(), 'legacy quote');
        assert.equal(await page.evaluate(() => window.enters), 1, 'Quote sends without the new inbox contract');
        let replyGuardCalls = 0;
        await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', () => { replyGuardCalls++; }), /Unsupported Zalo DOM/);
        assert.equal(replyGuardCalls, 0);
        assert.equal(await page.evaluate(() => window.enters), 1, 'Reply without explicit DOM evidence never presses Enter');

        // Replies bind to the event's exact private thread, both before editing
        // and after an awaited beforeSend guard. Quote send has no such new gate.
        await page.goto('https://chat.zalo.me/');
        await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:wrong-thread', () => { replyGuardCalls++; }), /does not match reply conversationKey/);
        assert.equal(replyGuardCalls, 0);
        assert.equal(await page.locator('#richInput').innerText(), '');
        assert.equal(await page.evaluate(() => window.enters), 0);
        await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', async () => {
            await page.locator('#chatView').evaluate(el => el.setAttribute('data-thread-id', 'changed'));
        }), /changed before reply send/);
        assert.equal(await page.evaluate(() => window.enters), 0);
        await page.goto('https://chat.zalo.me/');
        await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', async () => {
            await page.locator('#chatView').evaluate(el => el.removeAttribute('data-chat-type'));
        }), /Unsupported Zalo DOM/);
        assert.equal(await page.evaluate(() => window.enters), 0);
        await page.goto('https://chat.zalo.me/');
        await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', async () => { throw new Error('cancel reply'); }), /cancel reply/);
        assert.equal(await page.evaluate(() => window.enters), 0);
        assert.equal(await page.locator('#richInput').innerText(), 'reply', 'Cancellation leaves the prepared draft untouched');
        await assert.rejects(adapter.sendReply(uid, phone, name, 'replacement', 'private:thread-a', () => { replyGuardCalls++; }), /unsent editor draft/);
        assert.equal(replyGuardCalls, 0, 'An existing cancelled draft must be rejected before any service guard');
        assert.equal(await page.locator('#richInput').innerText(), 'reply', 'A second attempt cannot overwrite the cancelled draft');
        assert.equal(await page.evaluate(() => window.enters), 0);
        await page.locator('#richInput').fill('');
        assert.deepEqual(await adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', () => { replyGuardCalls++; }), { outcome: 'needs_check' });
        assert.equal(replyGuardCalls, 2, 'Reply guard checked initially and synchronously at final send boundary');
        assert.equal(await page.evaluate(() => window.enters), 1, 'Only a verified reply thread sees Enter');

        for (const kind of ['image', 'attachment', 'selected-file', 'dialog']) {
            const addDraft = kind => {
                let node;
                if (kind === 'image') node = document.createElement('img');
                if (kind === 'attachment') { node = document.createElement('div'); node.className = 'attachment-preview'; node.textContent = 'Manual attachment'; }
                if (kind === 'selected-file') {
                    node = document.createElement('input'); node.type = 'file';
                    const transfer = new DataTransfer(); transfer.items.add(new File(['manual'], 'manual.txt')); node.files = transfer.files;
                }
                if (kind === 'dialog') { node = document.createElement('div'); node.setAttribute('role', 'dialog'); node.textContent = 'Manual upload'; }
                node.id = 'manual-attachment';
                document.querySelector('.chat-box-input-container').append(node);
            };
            await page.goto('https://chat.zalo.me/');
            await page.evaluate(addDraft, kind);
            let draftGuardCalls = 0;
            await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', () => { draftGuardCalls++; }), /attachment draft|dialog.*draft/);
            assert.equal(draftGuardCalls, 0, kind + ' is refused before the service guard');
            assert.equal(await page.locator('#richInput').innerText(), '', kind + ' prevents filling');
            assert.equal(await page.evaluate(() => window.enters), 0, kind + ' prevents Enter');
            assert.equal(await page.locator('#manual-attachment').count(), 1, kind + ' remains untouched');

            // Inject after arming the captured editor, before the final service
            // guard. Only the actual Enter-task draft recheck can stop submission.
            await page.goto('https://chat.zalo.me/');
            const evaluateHandle = page.evaluateHandle.bind(page);
            let injected = false;
            page.evaluateHandle = async (...args) => {
                const handle = await evaluateHandle(...args);
                const evaluateProof = handle.evaluate.bind(handle);
                handle.evaluate = async (fn, ...values) => {
                    const result = await evaluateProof(fn, ...values);
                    if (fn.toString().includes('value.armReply(text)')) {
                        await page.evaluate(addDraft, kind);
                        injected = true;
                    }
                    return result;
                };
                return handle;
            };
            try {
                assert.deepEqual(await adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', () => { draftGuardCalls++; }), { outcome: 'needs_check' });
            } finally { page.evaluateHandle = evaluateHandle; }
            assert.equal(injected, true, 'Late ' + kind + ' was injected after the final awaited proof');
            assert.equal(draftGuardCalls, 2, 'Both service guards passed before the Enter-task ' + kind + ' check');
            assert.equal(await page.evaluate(() => window.enters), 0, 'Late ' + kind + ' cannot reach the app Enter handler');
            assert.equal(await page.locator('#richInput').innerText(), 'reply', 'Late ' + kind + ' leaves the prepared text untouched');
            assert.equal(await page.locator('#manual-attachment').count(), 1, 'Late ' + kind + ' remains untouched');
        }

        // Delay delivery of the final, already-taken DOM snapshot to reproduce
        // pause/revision changes while Playwright is awaited. The final service
        // guard must run after that await and before any Enter command is issued.
        for (const change of ['pause', 'settings revision']) {
            await page.goto('https://chat.zalo.me/');
            let paused = false;
            let revision = 1;
            let guardCalls = 0;
            let snapshots = 0;
            let releaseSnapshot;
            let snapshotEntered;
            const snapshotReady = new Promise(resolve => { snapshotEntered = resolve; });
            const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
            page.evaluate = async (fn, ...args) => {
                const result = await evaluate(fn, ...args);
                if (fn === snapshot && ++snapshots === 2) {
                    snapshotEntered();
                    await snapshotGate;
                }
                return result;
            };
            try {
                const rejected = assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', () => {
                    guardCalls++;
                    if (paused || revision !== 1) throw new Error('Reply service guard cancelled');
                }), /service guard cancelled/);
                await snapshotReady;
                assert.equal(guardCalls, 1, 'Preliminary guard already passed');
                if (change === 'pause') paused = true;
                else revision++;
                releaseSnapshot();
                await rejected;
                assert.equal(guardCalls, 2, change);
                assert.equal(await evaluate(() => window.enters), 0, change + ' during final snapshot prevents Enter');
            } finally {
                releaseSnapshot();
                page.evaluate = evaluate;
            }
        }
        await page.goto('https://chat.zalo.me/');
        let finalPromiseCalls = 0;
        await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:thread-a', () => {
            if (++finalPromiseCalls === 2) return Promise.reject(new Error('SECRET async guard'));
        }), /beforeSend must be synchronous/);
        assert.equal(await page.evaluate(() => window.enters), 0, 'Promise-returning final guard cannot issue Enter');

        await reset();
        await page.locator('[data-message-scroll]').evaluate(el => el.dispatchEvent(new Event('scroll', { bubbles: true })));
        await append('history-after-scroll'); await poll();
        assert.equal(events.length, 0, 'Scroll resets baseline');
        await page.locator('[data-message-scroll]').evaluate((el, html) => el.insertAdjacentHTML('afterbegin', html), row('older-prepended'));
        await poll();
        assert.equal(events.length, 0, 'Prepended history ignored');
        await append('live-after-history'); await poll();
        assert.equal(events.length, 1);
        await page.locator('#chatView').evaluate(el => el.setAttribute('data-thread-id', 'thread-b'));
        await append('other-thread-baseline'); await poll();
        assert.equal(events.length, 1, 'SPA thread switch baselines');
        await append('thread-b-live'); await poll();
        assert.equal(events.at(-1).conversationKey, 'private:thread-b');
        await page.goto('https://chat.zalo.me/');
        await poll();
        assert.equal(events.length, 2, 'New document baselines');
        await append('reconnect-live'); await poll();
        assert.equal(events.at(-1).sourceMessageId, 'reconnect-live');

        // History-ready is an explicit contract, never inferred from mounted
        // rows or being at the bottom. It is not required by legacy quote send.
        adapter.stopWatching(uid);
        await page.goto('https://chat.zalo.me/');
        await page.locator('#chatView').evaluate(el => el.removeAttribute('data-history-ready'));
        await adapter.startWatching(uid, options);
        assert.equal(adapter.getWatchStatus(uid).state, 'unsupported');
        assert.match(adapter.getWatchStatus(uid).detail, /history-ready.*real DOM verification/);
        assert.equal(timers.size, 0);
        assert.deepEqual(await adapter.send(uid, phone, name, 'quote without history-ready'), { outcome: 'needs_check' });

        // Delayed initial history can be appended at the bottom with unseen IDs.
        // Neither mounting order nor DOM arrival time establishes live arrival.
        for (const [label, evidence] of [
            ['late unseen history without evidence', { live: null, createdAt: null }],
            ['late unseen history with old ISO timestamp', { createdAt: '2000-01-01T00:00:00.000Z' }],
            ['late unseen history with old epoch timestamp', { createdAt: '1600000000000' }],
            ['missing explicit live marker', { live: null }],
            ['explicitly not live', { live: false }],
            ['missing timestamp', { createdAt: null }],
            ['invalid timestamp', { createdAt: 'not-a-timestamp' }],
            ['relative timestamp', { createdAt: '2 minutes ago' }],
            ['timestamp without timezone', { createdAt: '2026-10-24T12:00:00' }],
            ['future timestamp', { createdAt: '2099-01-01T00:00:00Z' }]
        ]) {
            await reset();
            await append('unseen-history', 'inbound', evidence);
            await poll();
            assert.deepEqual(events, [], label + ' never emits');
            assert.equal(adapter.getWatchStatus(uid).state, 'unsupported', label);
            assert.equal(adapter.getWatchStatus(uid).watching, false, label);
            assert.match(adapter.getWatchStatus(uid).detail, /live-arrival.*timestamp.*real DOM verification/);
            assert.equal(timers.size, 0);
        }
        await reset();
        await append('fresh-iso', 'inbound', { createdAt: 'iso' });
        let liveView = await page.evaluate(snapshot);
        const isoMessage = liveView.messages.find(message => message.id === 'fresh-iso');
        assert.equal(isoMessage.liveArrival, true);
        assert.ok(Number.isFinite(isoMessage.createdAt));
        assert.equal(liveView.historyReady, true);
        await poll();
        assert.equal(events.at(-1).sourceMessageId, 'fresh-iso');
        await append('fresh-epoch');
        liveView = await page.evaluate(snapshot);
        assert.ok(Number.isFinite(liveView.messages.find(message => message.id === 'fresh-epoch').createdAt));
        await poll();
        assert.equal(events.at(-1).sourceMessageId, 'fresh-epoch');
        assert.equal(events.length, 2, 'Explicit fresh ISO and epoch evidence accepted');

        for (const [label, mutate, detail] of [
            ['group', () => document.querySelector('#chatView').setAttribute('data-chat-type', 'group'), /private-chat/],
            ['history no longer ready', () => document.querySelector('#chatView').removeAttribute('data-history-ready'), /history-ready/],
            ['unknown direction', () => document.querySelector('.chat-item').removeAttribute('data-direction'), /inbound\/outbound/],
            ['duplicate IDs', () => document.querySelector('[data-message-scroll]').append(document.querySelector('.chat-item').cloneNode(true)), /Duplicate/],
            ['missing thread', () => document.querySelector('#chatView').removeAttribute('data-thread-id'), /thread ID/],
            ['missing stable ID', () => document.querySelector('.chat-item').removeAttribute('data-message-id'), /stable ID/],
            ['two roots', () => { const root = document.querySelector('#chatView').cloneNode(true); root.id = 'chat-view'; document.body.append(root); }, /one visible/],
            ['wrong peer', () => document.querySelector('#chatView').setAttribute('data-peer-phone', '0999999999'), /evidence lost/],
            ['DOM loss', () => document.querySelector('#chatView').remove(), /visible/]
        ]) {
            await reset();
            await page.evaluate(mutate);
            await poll();
            const status = adapter.getWatchStatus(uid);
            assert.equal(status.watching, false, label);
            assert.equal(status.state, 'unsupported', label);
            assert.match(status.detail, detail, label);
            assert.equal(events.length, 0, label);
            assert.equal(timers.size, 0, label);
        }
        await reset();
        await page.locator('.chat-item').first().evaluate(el => el.classList.add('me'));
        const ambiguous = await page.evaluate(snapshot);
        assert.equal(ambiguous.supported, false, 'Contradictory own/inbound evidence fails closed');
        await poll();

        await reset();
        await page.locator('[data-message-scroll]').evaluate(el => {
            el.style.height = '20px';
            for (const row of el.children) row.style.height = '100px';
            el.scrollTop = 0;
        });
        await append('not-near-bottom'); await poll();
        assert.equal(events.length, 0, 'No emission away from bottom');

        // Slow callbacks do not overlap polls, and may acquire the send lock.
        await reset();
        let releaseCallback;
        let callbackEntered;
        const callbackReady = new Promise(resolve => { callbackEntered = resolve; });
        await adapter.startWatching(uid, { ...options, onMessage: async event => {
            assert.deepEqual(await adapter.sendReply(uid, phone, name, 'offline reply', event.conversationKey), { outcome: 'needs_check' });
            callbackEntered();
            await new Promise(resolve => { releaseCallback = resolve; });
        } });
        await append('slow-callback');
        const inFlight = poll();
        await callbackReady;
        assert.equal(timers.size, 0, 'No next poll until callback completes');
        adapter.stopWatching(uid);
        releaseCallback(); await inFlight;
        assert.equal(timers.size, 0, 'Paused in-flight poll cannot schedule another');

        // A rejected old callback must not stop a replacement watcher.
        await reset();
        let rejectOld;
        let oldEntered;
        const oldReady = new Promise(resolve => { oldEntered = resolve; });
        await adapter.startWatching(uid, { ...options, onMessage: async () => {
            oldEntered(); await new Promise((resolve, reject) => { rejectOld = reject; });
        } });
        await append('old-callback');
        const oldPoll = poll();
        await oldReady;
        await adapter.startWatching(uid, options);
        rejectOld(new Error('SECRET stale callback')); await oldPoll;
        assert.equal(adapter.getWatchStatus(uid).watching, true);
        assert.equal(timers.size, 1);

        await reset();
        await adapter.startWatching(uid, { ...options, onMessage: async () => { throw new Error('SECRET callback data'); } });
        await append('callback-failure'); await poll();
        assert.equal(adapter.getWatchStatus(uid).state, 'error');
        assert.doesNotMatch(JSON.stringify(adapter.getWatchStatus(uid)), /SECRET/);
        await reset();
        await adapter.startWatching(uid, { ...options, onStatus: async () => { throw new Error('SECRET status'); } });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(adapter.getWatchStatus(uid).watching, false);
        assert.doesNotMatch(JSON.stringify(adapter.getWatchStatus(uid)), /SECRET/);

        // Unsupported image UI fails before navigation, callback, upload or Enter,
        // even if a generic (potentially auto-sending) file input exists.
        await reset();
        await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<input type="file" accept="image/*">'));
        const before = await page.content();
        let imageGuard = 0;
        await assert.rejects(adapter.sendImage(uid, phone, name, '/not/a/real/image.png', 'caption', () => imageGuard++), /Unsupported Zalo image UI.*no action performed/);
        assert.equal(await page.content(), before);
        assert.equal(imageGuard, 0);
        assert.equal(await page.evaluate(() => window.uploads), 0);
        assert.equal(await page.evaluate(() => window.enters), 0);
        assert.ok(delays.length > 0 && delays.every(delay => delay === 2000));
        assert.deepEqual(network, [], 'No external resources requested');
        await context.close();
        const { reader, ...closedState } = adapter.getWatchStatus(uid);
        assert.deepEqual(closedState, { open: false, watching: false, state: 'closed', detail: 'Browser closed; watcher stopped', capabilities });
        assert.ok(Object.values(reader).every(value => Number.isInteger(value) && value >= 0), 'Closed legacy reader exposes numeric counters only');
        assert.ok(statuses.length > 0 && statuses.every(status => JSON.stringify(status.capabilities) === JSON.stringify(capabilities)), 'Status callbacks expose UI capabilities');
        assert.equal(timers.size, 0);
        console.log('PASS: offline Edge quote compatibility, final synchronous reply guards, explicit live/history evidence, capabilities, watcher, shared lock, pause/reconnect, and safe image rejection');
    } finally {
        adapter.stopWatching(uid);
        if (previousFlag === undefined) delete process.env.ZALO_WEB_EXPERIMENTAL;
        else process.env.ZALO_WEB_EXPERIMENTAL = previousFlag;
        if (previousTimers === undefined) delete global.__zaloFixtureTimers;
        else global.__zaloFixtureTimers = previousTimers;
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
