'use strict';

// Offline observed-shape adapter integration. Edge only renders local fixtures;
// no real profile, authenticated Zalo, outbound network, or real sends.
// Run: node scripts/testZaloLiveAdapter.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright-core');
const { snapshotLive, trackLiveInbox } = require('../utils/zaloLiveInboxDom');
const hash = value => createHash('sha256').update(value).digest('hex');
const phone = '0901234567';
const name = 'Nguyễn Minh Anh';
const contactKey = 'private:' + hash(phone + '\0friend-item-fixture');
const NOW = Date.UTC(2026, 9, 25, 3, 12, 45); // Browser: 10:12:45.
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function row(id, { own = false, time = '10:12', text = id, status = own ? 'Đã gửi' : '' } = {}) {
    const me = own ? ' me' : '';
    return `<div class="chat-item${me}"><div class="chat-content"><div class="chat-message${me}" id="chat-${escape(id)}">
<div class="message-wrapper${own ? ' message-wrapper--me' : ''}"><div class="message-content-wrapper"><div class="message-content-render">
<div class="message-frame${me}" id="frame-${escape(id)}" data-qid="${escape(id)}"><div data-id="payload"><div class="message-action"><span>${escape(text)}</span></div><div class="card-send-time">${escape([time, status].filter(Boolean).join(' '))}</div><div class="message-reaction-container"></div></div></div>
<div class="floating-menu-wrapper floating-menu-wrapper--${own ? 'me' : 'other'}"><button>Menu</button></div>
</div></div></div></div></div></div>`;
}
function fixture() {
    return `<!doctype html><html lang="vi"><meta charset="utf-8">
<style>.transform-gpu{height:500px;overflow-y:auto;overflow-anchor:none}.chat-item{min-height:28px}.card-send-time{font-size:10px}.floating-menu-wrapper{display:none}#richInput{min-height:28px}</style>
<input id="contact-search-input"><button id="friend-item-fixture"><span class="txt-highlight">${phone}</span><span class="conv-item-title__name">${name}</span></button>
<article id="chatView"><div class="message-view"><div class="message-view__scroll"><div class="transform-gpu"><div class="message-view__scroll__inner"><div class="block-date"><div class="chat-date --time"><span class="content">Hôm nay</span></div>${row('baseline')}${row('own-baseline', { own: true })}${row('incomplete-baseline', { text: '', time: '' })}</div></div></div></div></div><div class="chat-box-input-container"><div id="richInput" contenteditable="true" data-trailer="${name}"></div></div></article>
<script>window.enters=0;window.selections=0;
document.querySelector('[id^="friend-item-"]').onclick=()=>{window.selections++;};
document.querySelector('#richInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.enters++;}});</script></html>`;
}

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ timezoneId: 'Asia/Ho_Chi_Minh', serviceWorkers: 'block' });
    const network = [], failures = [];
    await context.route('**/*', route => {
        if (route.request().isNavigationRequest() && route.request().url() === 'https://chat.zalo.me/') {
            return route.fulfill({ contentType: 'text/html', body: fixture() });
        }
        network.push(route.request().url());
        return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.clock.setFixedTime(new Date(NOW));
    const timers = new Map();
    const scheduler = {
        set(fn, delay) { assert.equal(delay, 2000); const token = { unref() {} }; timers.set(token, fn); return token; },
        clear(token) { timers.delete(token); }
    };
    const filename = path.resolve(__dirname, '../utils/zaloWebExperimental.js');
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalRequire = loaded.require.bind(loaded);
    let imageMock = null;
    loaded.require = id => {
        if (id === 'playwright-core') return { chromium: { launchPersistentContext: async () => context } };
        if (id === 'fs') return { ...fs, existsSync: value => String(value).endsWith('msedge.exe') || fs.existsSync(value) };
        if (id === './zaloImageSend') return { sendImageOnPage: args => {
            assert.ok(imageMock, 'Only explicit image-wrapper tests may enter helper');
            return imageMock(args);
        } };
        return originalRequire(id);
    };
    const previousTimers = global.__zaloLiveAdapterTimers;
    global.__zaloLiveAdapterTimers = scheduler;
    loaded._compile('const setTimeout = global.__zaloLiveAdapterTimers.set; const clearTimeout = global.__zaloLiveAdapterTimers.clear;\n' + fs.readFileSync(filename, 'utf8'), filename);
    const adapter = loaded.exports;
    const previousFlag = process.env.ZALO_WEB_EXPERIMENTAL;
    process.env.ZALO_WEB_EXPERIMENTAL = 'true';
    const uid = 'offline-live-adapter';
    const events = [], statuses = [];
    const options = { phone, name, onMessage: event => events.push(event), onStatus: status => statuses.push(status) };
    const poll = async () => {
        assert.equal(timers.size, 1);
        const [token, fn] = timers.entries().next().value;
        timers.delete(token);
        await fn();
    };
    const append = html => page.evaluate(html => document.querySelector('.block-date').insertAdjacentHTML('beforeend', html), html);
    const advance = minutes => page.clock.setFixedTime(new Date(NOW + minutes * 60000));
    const load = async () => {
        adapter.stopWatching(uid);
        await page.goto('https://chat.zalo.me/');
        await advance(0);
        events.length = 0;
    };
    const reset = async () => { await load(); await adapter.startWatching(uid, options); };
    let passed = 0;
    const test = async (label, fn) => { await fn(); passed++; console.log('PASS ' + label); };
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-live-adapter-'));
    const imagePath = path.join(temp, 'fixture.png');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(imagePath, bytes);
    try {
        await adapter.open(uid);
        await test('Observed shape, hashed contact identity and read-only pinned polling', async () => {
            await reset();
            assert.deepEqual(adapter.getWatchStatus(uid).capabilities, { text: true, inbox: 'observed_web_dom', image: true });
            assert.equal(adapter.getWatchStatus(uid).state, 'monitoring');
            assert.equal(adapter.getWatchStatus(uid).readyAt, new Date(NOW).toISOString());
            assert.match(adapter.getWatchStatus(uid).detail, /Chỉ xử lý tin mới.*kể cả cùng phút/);
            assert.equal(await page.locator('[data-chat-type],[data-thread-id],[data-peer-phone],[data-direction],[data-live-arrival],[data-created-at]').count(), 0);
            assert.deepEqual(events, []);
            await append(row('start-minute'));
            await poll();
            assert.deepEqual(events.map(event => event.sourceMessageId), [hash('zalo:start-minute')]);
            await poll();
            assert.equal(events.length, 1);
            events.length = 0;
            await advance(1);
            await append(row('old-late', { time: '10:11' }) + row('own-new', { own: true, time: '10:13' }) + row('incoming:/opaque', { time: '10:13', text: 'Hello fixture' }));
            const selections = await page.evaluate(() => window.selections);
            await poll();
            assert.equal(await page.evaluate(() => window.selections), selections, 'Poll must not search or reselect');
            assert.deepEqual(events, [{ sourceMessageId: hash('zalo:incoming:/opaque'), conversationKey: contactKey, text: 'Hello fixture', phone, name }]);
            assert.match(events[0].sourceMessageId, /^[a-f0-9]{64}$/);
            assert.ok(!contactKey.includes(phone) && !contactKey.includes(name));
            await poll();
            assert.equal(events.length, 1);
            const beforeBusy = await page.evaluate(() => window.selections);
            await adapter.withSessionLock(uid, poll);
            assert.equal(await page.evaluate(() => window.selections), beforeBusy, 'Busy lock skips selection and DOM reads');
        });
        await test('Reselecting a contact restores the search-disabled composer without sending', async () => {
            await load();
            await page.evaluate(() => {
                const editor = document.querySelector('#richInput');
                document.querySelector('[id^="friend-item-"]').onclick = () => {
                    window.selections++;
                    editor.setAttribute('contenteditable', 'false');
                };
                editor.onclick = () => editor.setAttribute('contenteditable', 'true');
            });
            await adapter.startWatching(uid, options);
            assert.equal(adapter.getWatchStatus(uid).state, 'monitoring');
            await poll();
            assert.equal(adapter.getWatchStatus(uid).state, 'monitoring');
            assert.equal(await page.locator('#richInput').getAttribute('contenteditable'), 'true');
            assert.equal(await page.evaluate(() => window.enters), 0);
            assert.deepEqual(events, []);
        });
        await test('Contact-click focus mutations preserve matching pending arrivals exactly once', async () => {
            await load();
            await page.evaluate(() => {
                document.querySelector('[id^="friend-item-"]').onclick = () => {
                    window.selections++;
                    document.querySelector('#richInput').classList.toggle('composer-focused');
                };
            });
            await adapter.startWatching(uid, options);
            const readyAt = adapter.getWatchStatus(uid).readyAt;
            for (const minute of [0, 1, 2]) {
                await advance(minute);
                const id = 'focus-incoming-' + minute;
                await append(row(id, { time: '10:' + (12 + minute) }));
                assert.ok((await page.evaluate(snapshotLive)).tracking.eligible.includes(id));
                const selections = await page.evaluate(() => window.selections);
                await poll();
                assert.equal(await page.evaluate(() => window.selections), selections, 'No contact-click focus side effects while observing');
                assert.ok((await page.evaluate(snapshotLive)).tracking.eligible.includes(id), 'Read-only observation preserves tracker eligibility');
                assert.deepEqual(events.map(event => event.sourceMessageId), Array.from({ length: minute + 1 }, (_, i) => hash('zalo:focus-incoming-' + i)));
                assert.ok(events.every(event => event.conversationKey === contactKey));
                await poll();
                assert.equal(events.length, minute + 1, 'Repeated polls do not duplicate pending arrivals');
                assert.equal(adapter.getWatchStatus(uid).readyAt, readyAt, 'Initial cutoff is not moved on every poll');
            }
            assert.equal(await page.evaluate(() => window.enters), 0, 'Polling is read-only navigation, never sending');
        });
        await test('Same-name other-contact navigation invalidates pinned proof before any event emits', async () => {
            await reset();
            await page.evaluate(otherBaseline => {
                const history = document.querySelector('.message-view__scroll__inner');
                const targetHistory = history.innerHTML;
                // Simulate manual navigation to another contact with the same
                // display name, reusing the root/editor and unchanged trailer.
                history.innerHTML = '<div class="block-date"><div class="chat-date --time"><span class="content">Hôm nay</span></div>' + otherBaseline + '</div>';
                document.querySelector('[id^="friend-item-"]').onclick = () => {
                    window.selections++;
                    history.innerHTML = targetHistory;
                    document.querySelector('#richInput').classList.toggle('composer-focused');
                };
            }, row('other-contact-baseline'));
            await page.evaluate(trackLiveInbox);
            await advance(1);
            await append(row('other-contact-pending', { time: '10:13' }));
            assert.ok((await page.evaluate(snapshotLive)).tracking.eligible.includes('other-contact-pending'), 'The pre-navigation candidate is genuinely eligible');
            await poll();
            assert.equal(adapter.getWatchStatus(uid).state, 'unsupported');
            assert.equal(timers.size, 0, 'No callbacks until exact contact is verified afresh');
            assert.equal(events.length, 0, 'Same display name cannot scope another peer to the target');
            await adapter.startWatching(uid, options);
            assert.equal(adapter.getWatchStatus(uid).state, 'monitoring');
            assert.equal(await page.locator('#frame-other-contact-pending').count(), 0);
            assert.equal(await page.locator('#frame-baseline').count(), 1, 'Recovery reselects and baselines the configured target');
            await poll();
            assert.equal(events.length, 0);
            assert.equal(await page.evaluate(() => window.enters), 0);
        });
        for (const [label, mutate] of [
            ['wrong search name', () => { document.querySelector('.conv-item-title__name').textContent = 'Other contact'; }],
            ['changed stable card ID', () => { document.querySelector('[id^="friend-item-"]').id = 'friend-item-different'; }],
            ['wrong editor trailer', () => { document.querySelector('#richInput').setAttribute('data-trailer', 'Other contact'); }]
        ]) await test('Stop on ' + label, async () => {
            await reset(); await advance(1);
            await append(row('blocked', { time: '10:13' }));
            await page.evaluate(mutate); await poll();
            assert.equal(adapter.getWatchStatus(uid).state, 'unsupported');
            assert.equal(adapter.getWatchStatus(uid).watching, false);
            assert.equal(events.length, 0);
            assert.equal(timers.size, 0);
        });
        await test('Regression: search/reselection churn cannot baseline customer arrivals during polling', async () => {
            await reset();
            await page.evaluate(() => {
                const search = document.querySelector('#contact-search-input');
                search.addEventListener('input', () => {
                    const root = document.querySelector('#chatView');
                    root.setAttribute('data-search-render', String(Date.now()));
                    document.querySelector('#frame-baseline .message-reaction-container').textContent = 'search changed history';
                });
                document.querySelector('[id^="friend-item-"]').onclick = () => {
                    window.selections++;
                    const history = document.querySelector('.message-view__scroll__inner');
                    history.innerHTML = history.innerHTML;
                };
            });
            const selected = await page.evaluate(() => window.selections);
            for (let i = 0; i < 3; i++) {
                await append(row('churn-safe-' + i, { text: 'cho em xin sdt' }));
                await poll();
                assert.equal(events.length, i + 1);
                assert.equal(await page.evaluate(() => window.selections), selected);
                assert.equal(adapter.getWatchStatus(uid).reader.trackerEpoch, 0);
                assert.equal(adapter.getWatchStatus(uid).reader.resetReason, 'initial-baseline');
            }
            const reader = adapter.getWatchStatus(uid).reader;
            assert.equal(reader.observationStartedAt, new Date(NOW).toISOString());
            assert.equal(reader.atBottom, true);
            assert.equal(reader.candidateCount, 3);
            assert.ok(reader.skipped.baseline > 0);
            assert.ok(reader.skipped.duplicate > 0);
            assert.equal(await page.evaluate(() => window.enters), 0);
        });
        await test('Navigation while awaiting the snapshot invalidates the batch before callbacks', async () => {
            await reset();
            await append(row('racing-peer', { text: 'sdt' }));
            const evaluate = page.evaluate.bind(page);
            page.evaluate = async (fn, ...args) => {
                const result = await evaluate(fn, ...args);
                if (fn === snapshotLive) await evaluate(() => {
                    const history = document.querySelector('.message-view__scroll__inner');
                    history.innerHTML = history.innerHTML;
                });
                return result;
            };
            try { await poll(); } finally { page.evaluate = evaluate; }
            assert.equal(events.length, 0);
            assert.equal(adapter.getWatchStatus(uid).state, 'unsupported');
            assert.equal(timers.size, 0);
        });
        await test('Empty initial history does not weaken same-name navigation detection after arrivals', async () => {
            await load();
            await page.locator('.chat-item').evaluateAll(nodes => nodes.forEach(node => node.remove()));
            await adapter.startWatching(uid, options);
            await append(row('first-in-empty', { text: 'sdt' }));
            await poll();
            assert.equal(events.length, 1);
            await page.evaluate(html => {
                document.querySelector('.block-date').innerHTML = '<div class="chat-date --time"><span class="content">Hôm nay</span></div>' + html;
            }, row('same-name-peer-baseline'));
            await append(row('same-name-peer-arrival', { text: 'sdt' }));
            await poll();
            assert.equal(events.length, 1, 'Replacement of post-connect rows invalidates the empty-start proof');
            assert.equal(adapter.getWatchStatus(uid).state, 'unsupported');
            assert.equal(timers.size, 0);
        });
        await test('Pause while acquiring inbox proof disposes the late handle and never starts polling', async () => {
            await load();
            const evaluateHandle = page.evaluateHandle.bind(page);
            let disposed = 0;
            page.evaluateHandle = async (...args) => {
                const handle = await evaluateHandle(...args);
                const dispose = handle.dispose.bind(handle);
                handle.dispose = async () => { disposed++; return dispose(); };
                adapter.stopWatching(uid);
                return handle;
            };
            try { await adapter.startWatching(uid, options); } finally { page.evaluateHandle = evaluateHandle; }
            assert.equal(disposed, 1);
            assert.equal(timers.size, 0);
            assert.equal(adapter.getWatchStatus(uid).watching, false);
            assert.equal(events.length, 0);
        });
        await test('Initial incomplete rows and later incomplete rendering never become unsafe events', async () => {
            await reset(); await advance(1);
            await append(row('late-incomplete', { time: '', text: '' })); await poll();
            await page.locator('#frame-incomplete-baseline .message-action').evaluate(node => { node.textContent = 'Completed initial text'; });
            await page.locator('#frame-incomplete-baseline .card-send-time').evaluate(node => { node.textContent = '10:13'; });
            await page.locator('#frame-late-incomplete .message-action').evaluate(node => { node.textContent = 'Completed new text'; });
            await page.locator('#frame-late-incomplete .card-send-time').evaluate(node => { node.textContent = '10:13'; });
            await poll();
            assert.equal(events.length, 0, 'Conservative tracker reset is allowed, not a fabricated live arrival');
            await advance(2); await append(row('after-reset', { time: '10:14' })); await poll();
            assert.equal(events.length, 1);
        });
        await test('Unread/unready future-minute rows are not consumed before their timestamp becomes valid', async () => {
            await reset(); await advance(1);
            await append(row('future-unready', { time: '10:14' })); await poll();
            assert.equal(events.length, 0);
            await advance(2); await poll();
            assert.deepEqual(events.map(event => event.sourceMessageId), [hash('zalo:future-unready')]);
            await poll();
            assert.equal(events.length, 1);
        });
        await test('Pause from the first callback suppresses the rest of the batch', async () => {
            await load();
            await adapter.startWatching(uid, { ...options, onMessage: event => {
                events.push(event);
                adapter.stopWatching(uid);
            } });
            await advance(1);
            await append(row('batch-first', { time: '10:13' }) + row('batch-second', { time: '10:13' }));
            await poll();
            assert.equal(events.length, 1);
            assert.equal(timers.size, 0);
        });
        await test('Pause during an awaited poll prevents every queued callback', async () => {
            await reset(); await advance(1); await append(row('pause-new', { time: '10:13' }));
            const evaluate = page.evaluate.bind(page);
            page.evaluate = async (fn, ...args) => {
                const result = await evaluate(fn, ...args);
                if (fn === snapshotLive) adapter.stopWatching(uid);
                return result;
            };
            try { await poll(); } finally { page.evaluate = evaluate; }
            assert.equal(events.length, 0);
            assert.equal(timers.size, 0);
        });
        await test('Real reply key guard, existing draft rejection and one conditional Enter', async () => {
            await load();
            await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', 'private:wrong'), /conversationKey/);
            assert.equal(await page.locator('#richInput').innerText(), '');
            await page.locator('#richInput').fill('Manual unsent draft');
            await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', contactKey), /unsent editor draft/);
            assert.equal(await page.locator('#richInput').innerText(), 'Manual unsent draft');
            assert.equal(await page.evaluate(() => window.enters), 0);
            await page.locator('#richInput').fill('');
            let guards = 0;
            assert.deepEqual(await adapter.sendReply(uid, phone, name, 'reply', contactKey, () => { guards++; }), { outcome: 'needs_check' });
            assert.equal(guards, 2);
            assert.equal(await page.evaluate(() => window.enters), 1);
        });
        for (const mode of ['matching', 'nonmatching', 'missing', 'duplicate', 'wrong-peer', 'draft', 'whitespace', 'baseline', 'transient', 'direction', 'quoted', 'id-change', 'received', 'viewed', 'pending', 'failed', 'no-status', 'unknown-status', 'mixed-status', 'hidden-status', 'payload-status', 'missing-status']) {
            await test('Reply outgoing confirmation: ' + mode, async () => {
                await load();
                await append(row('old-reply', { own:true, text:'reply' }));
                await page.evaluate(({ mode, html }) => {
                    document.querySelector('#richInput').addEventListener('keydown', event => {
                        if (event.key !== 'Enter') return;
                        const history = document.querySelector('.block-date');
                        if (!['missing', 'baseline'].includes(mode)) history.insertAdjacentHTML('beforeend', html);
                        if (mode === 'duplicate') history.insertAdjacentHTML('beforeend', html);
                        if (mode === 'transient') { const frame = document.querySelector('#frame-reply-echo'); frame.closest('.chat-item').remove(); }
                        if (mode === 'direction') document.querySelector('#frame-reply-echo').classList.remove('me');
                        if (mode === 'quoted') document.querySelector('#frame-reply-echo .message-action span').classList.add('quoted-message');
                        if (mode === 'id-change') document.querySelector('#frame-reply-echo').setAttribute('data-qid', 'changed-id');
                        document.querySelector('#richInput').textContent = mode === 'draft' ? 'Unsent manual draft' : mode === 'whitespace' ? ' ' : '';
                        if (mode === 'wrong-peer') document.querySelector('#richInput').setAttribute('data-trailer', 'Other contact');
                        if (mode === 'hidden-status') document.querySelector('#frame-reply-echo .card-send-time').style.display = 'none';
                        if (mode === 'missing-status') document.querySelector('#frame-reply-echo .card-send-time').remove();
                        if (mode === 'payload-status') document.querySelector('#frame-reply-echo .message-action').append(document.querySelector('#frame-reply-echo .card-send-time'));
                    });
                }, { mode, html:row('reply-echo', { own:true, text:mode === 'nonmatching' ? 'Other reply' : 'reply',
                    status: ({ received:'Đã nhận', viewed:'Đã xem', pending:'Đang gửi', failed:'Gửi thất bại',
                        'no-status':'', 'unknown-status':'Không rõ', 'mixed-status':'Đã gửi Gửi thất bại' })[mode] ?? 'Đã gửi' }) });
                assert.deepEqual(await adapter.sendReply(uid, phone, name, 'reply', contactKey), { outcome:['matching', 'received', 'viewed'].includes(mode) ? 'sent' : 'needs_check' });
                assert.equal(await page.evaluate(() => window.enters), 1);
            });
        }
        await test('Pending reply waits for positive receipt without sending again', async () => {
            await load();
            await page.evaluate(html => {
                document.querySelector('#richInput').addEventListener('keydown', event => {
                    if (event.key !== 'Enter') return;
                    document.querySelector('.block-date').insertAdjacentHTML('beforeend', html);
                    document.querySelector('#richInput').textContent = '';
                    setTimeout(() => { document.querySelector('#frame-reply-echo .card-send-time').textContent = 'Đã nhận 10:12'; }, 100);
                });
            }, row('reply-echo', { own:true, text:'reply', status:'Đang gửi' }));
            assert.deepEqual(await adapter.sendReply(uid, phone, name, 'reply', contactKey), { outcome:'sent' });
            assert.equal(await page.evaluate(() => window.enters), 1);
        });
        await test('Reply acceptance is rechecked after final awaited snapshot', async () => {
            await load();
            await page.evaluate(html => {
                document.querySelector('#richInput').addEventListener('keydown', event => {
                    if (event.key !== 'Enter') return;
                    document.querySelector('.block-date').insertAdjacentHTML('beforeend', html);
                    document.querySelector('#richInput').textContent = '';
                });
            }, row('reply-echo', { own:true, text:'reply' }));
            const evaluate = page.evaluate.bind(page);
            page.evaluate = async (fn, ...args) => {
                const result = await evaluate(fn, ...args);
                if (fn === snapshotLive && result.messages.some(message => message.id === 'reply-echo')) {
                    await evaluate(() => { document.querySelector('#frame-reply-echo .card-send-time').textContent = 'Gửi thất bại'; });
                }
                return result;
            };
            try { assert.deepEqual(await adapter.sendReply(uid, phone, name, 'reply', contactKey), { outcome:'needs_check' }); }
            finally { page.evaluate = evaluate; }
            assert.equal(await page.evaluate(() => window.enters), 1);
        });
        await test('Legacy reply path also refuses an attachment draft before fill', async () => {
            await load();
            await page.evaluate(({ phone, name }) => {
                const root = document.querySelector('#chatView');
                root.setAttribute('data-chat-type', 'private'); root.setAttribute('data-thread-id', 'legacy-fixture');
                root.setAttribute('data-peer-phone', phone); root.setAttribute('data-peer-name', name);
                root.querySelector('.message-view__scroll__inner').setAttribute('data-message-scroll', '');
                root.querySelectorAll('.chat-item').forEach((row, index) => {
                    row.setAttribute('data-message-id', 'legacy-' + index);
                    row.setAttribute('data-direction', row.classList.contains('me') ? 'outbound' : 'inbound');
                    row.querySelector('.message-action').setAttribute('data-message-text', '');
                });
                document.querySelector('.chat-box-input-container').append(document.createElement('img'));
            }, { phone, name });
            const legacy = await page.evaluate(require('../utils/zaloInboxDom').snapshot);
            assert.equal(legacy.supported, true);
            await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', legacy.conversationKey), /attachment draft/);
            assert.equal(await page.locator('#richInput').innerText(), '');
            assert.equal(await page.evaluate(() => window.enters), 0);
        });
        for (const kind of ['image', 'attachment', 'selected-file', 'dialog']) {
            for (const boundary of ['before-fill', 'enter-task']) {
                await test('Reply attachment draft guard: ' + kind + ' at ' + boundary, async () => {
                    await load();
                    const installDraft = kind => {
                        const composer = document.querySelector('.chat-box-input-container');
                        let node;
                        if (kind === 'image') node = document.createElement('img');
                        if (kind === 'attachment') { node = document.createElement('div'); node.className = 'attachment-preview'; node.textContent = 'Manual attachment'; }
                        if (kind === 'selected-file') {
                            node = document.createElement('input'); node.type = 'file';
                            const transfer = new DataTransfer(); transfer.items.add(new File(['manual'], 'manual.txt')); node.files = transfer.files;
                        }
                        if (kind === 'dialog') { node = document.createElement('div'); node.setAttribute('role', 'dialog'); node.textContent = 'Manual upload'; }
                        node.id = 'manual-attachment';
                        composer.append(node);
                    };
                    if (boundary === 'before-fill') {
                        await page.evaluate(installDraft, kind);
                        await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', contactKey), /attachment draft|dialog.*draft/);
                        assert.equal(await page.locator('#richInput').innerText(), '');
                    } else {
                        // Install after the final awaited proof so only the Enter-task guard can catch it.
                        let calls = 0;
                        const evaluateHandle = page.evaluateHandle.bind(page);
                        page.evaluateHandle = async (...args) => {
                            const handle = await evaluateHandle(...args);
                            const evaluate = handle.evaluate.bind(handle);
                            handle.evaluate = async (fn, ...values) => {
                                const result = await evaluate(fn, ...values);
                                if (fn.toString().includes('value.verify()')) await page.evaluate(installDraft, kind);
                                return result;
                            };
                            return handle;
                        };
                        try {
                            assert.deepEqual(await adapter.sendReply(uid, phone, name, 'reply', contactKey, () => { calls++; }), { outcome:'needs_check' });
                        } finally { page.evaluateHandle = evaluateHandle; }
                        assert.equal(calls, 2);
                        assert.equal(await page.locator('#richInput').innerText(), 'reply');
                    }
                    assert.equal(await page.evaluate(() => window.enters), 0, 'No app Enter handler may submit the draft');
                    assert.equal(await page.locator('#manual-attachment').count(), 1, 'Manual draft stays untouched');
                });
            }
        }
        for (const [label, mutate] of [
            ['history rows replaced with identical names/IDs', () => { const history = document.querySelector('.message-view__scroll__inner'); history.innerHTML = history.innerHTML; }],
            ['history node replaced', () => { const node = document.querySelector('.message-view__scroll__inner'); node.replaceWith(node.cloneNode(true)); }],
            ['editor replaced with same trailer', () => { const node = document.querySelector('#richInput'); node.replaceWith(node.cloneNode(true)); }],
            ['root removed and reinserted', () => { const node = document.querySelector('#chatView'); node.remove(); document.body.append(node); }]
        ]) await test('Node proof rejects ' + label, async () => {
            await load(); let calls = 0;
            await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', contactKey, async () => {
                if (++calls === 1) await page.evaluate(mutate);
            }), /target nodes changed/);
            assert.equal(await page.evaluate(() => window.enters), 0);
        });
        for (const change of ['pause', 'settings revision']) await test('Final synchronous guard catches ' + change + ' during final awaited proof', async () => {
            await load();
            let inactive = false, guards = 0;
            const evaluateHandle = page.evaluateHandle.bind(page);
            page.evaluateHandle = async (...args) => {
                const handle = await evaluateHandle(...args);
                const evaluate = handle.evaluate.bind(handle);
                handle.evaluate = async (fn, ...values) => {
                    const result = await evaluate(fn, ...values);
                    if (fn.toString().includes('value.verify()')) inactive = true;
                    return result;
                };
                return handle;
            };
            try {
                await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', contactKey, () => {
                    guards++;
                    if (inactive) throw new Error('Service guard cancelled');
                }), /Service guard cancelled/);
            } finally { page.evaluateHandle = evaluateHandle; }
            assert.equal(guards, 2);
            assert.equal(await page.evaluate(() => window.enters), 0);
        });
        await test('Async final reply guard is rejected without Enter', async () => {
            await load(); let calls = 0;
            await assert.rejects(adapter.sendReply(uid, phone, name, 'reply', contactKey, () => {
                if (++calls === 2) return Promise.reject(new Error('Private guard data'));
            }), /must be synchronous/);
            assert.equal(await page.evaluate(() => window.enters), 0);
        });
        await test('Invalid image fails before selection/guard/helper; persisted digest checked before navigation', async () => {
            await load(); let guards = 0;
            const before = await page.content();
            await assert.rejects(adapter.sendImage(uid, phone, name, '/not/a/real/image.png', '', () => { guards++; }), /Unsupported Zalo image UI.*no action performed/);
            await assert.rejects(adapter.sendImage(uid, phone, name, imagePath, '', () => { guards++; }, contactKey, '0'.repeat(64)), /Unsupported Zalo image UI.*no action performed/);
            assert.equal(guards, 0);
            assert.equal(await page.content(), before);
            assert.equal(await page.evaluate(() => window.selections), 0);
        });
        await test('Conditional image wrapper forwards signature, async node proof, sync guard, digest and shared lock', async () => {
            await load(); let helperCalls = 0, guards = 0;
            const guard = () => { guards++; };
            imageMock = async args => {
                helperCalls++;
                assert.equal(args.page, page);
                assert.equal(args.imagePath, imagePath);
                assert.equal(args.caption, 'Image caption');
                assert.equal(args.expectedSha256, hash(bytes));
                assert.equal(args.beforeSend, guard);
                assert.equal(await args.verifyTarget(), true);
                await assert.rejects(adapter.send(uid, phone, name, 'blocked'), /Đang xử lý/);
                args.beforeSend();
                await page.evaluate(() => { const history = document.querySelector('.message-view__scroll__inner'); history.innerHTML = history.innerHTML; });
                await assert.rejects(args.verifyTarget(), /target nodes changed/);
                return { outcome: 'needs_check' };
            };
            assert.deepEqual(await adapter.sendImage(uid, phone, name, imagePath, 'Image caption', guard, contactKey, hash(bytes)), { outcome: 'needs_check' });
            assert.equal(helperCalls, 1);
            assert.equal(guards, 1);
            await load();
            await assert.rejects(adapter.sendImage(uid, phone, name, imagePath, '', guard, 'private:wrong'), /conversationKey/);
            assert.equal(helperCalls, 1);
            imageMock = async args => { assert.equal(args.caption, ''); assert.equal(args.expectedSha256, hash(bytes)); return { outcome: 'needs_check' }; };
            assert.deepEqual(await adapter.sendImage(uid, phone, name, imagePath), { outcome: 'needs_check' });
        });
        await test('Dedup capacity stops instead of evicting IDs', async () => {
            // Mock only snapshot payload size; normal target selection and browser
            // tracker still run. No need to mount 10,001 expensive browser rows.
            await reset(); await advance(1);
            const evaluate = page.evaluate.bind(page);
            page.evaluate = async (fn, ...args) => {
                const result = await evaluate(fn, ...args);
                if (fn === snapshotLive) result.messages = Array.from({ length: 10001 }, (_, i) => ({ id: 'old-capacity-' + i, direction: 'inbound', createdMinute: NOW - 60000 }));
                return result;
            };
            try { await poll(); } finally { page.evaluate = evaluate; }
            assert.equal(adapter.getWatchStatus(uid).state, 'capacity');
            assert.equal(adapter.getWatchStatus(uid).watching, false);
            assert.equal(events.length, 0);
            assert.equal(timers.size, 0);
        });
        await test('Customer DOM -> queue -> signed n8n command -> saved reply echo, twice without approval', async () => {
            await load();
            const { createStore } = require('../utils/zaloAutoReplyStore');
            const { createService } = require('../utils/zaloAutoReplyService');
            const { sign } = require('../utils/n8nNotifications');
            let clock = NOW, requests = 0, echo = 0, service;
            const store = createStore({ root: path.join(temp, 'flow-queue'), now: () => clock });
            const env = { ZALO_WEB_EXPERIMENTAL: 'true', ZALO_TEST_PHONES: phone,
                N8N_NOTIFY_SECRET: 'offline-only-secret', N8N_HEADER_TOKEN: 'offline-only-token' };
            const verify = (body, timestamp, signature, eventId) => service.verify(Buffer.from(body), {
                'x-tikoder-timestamp': timestamp, 'x-tikoder-signature': signature, 'x-tikoder-event-id': eventId,
            }, '127.0.0.1');
            service = createService({ store, adapter, env, now: () => clock,
                runtimeRoot: path.join(temp, 'flow-runtime'), imageRoot: path.join(temp, 'flow-images'),
                fetcher: async (url, request) => {
                    requests++;
                    assert.ok(url.endsWith('/webhook/tikoder/zalo-auto-reply'));
                    assert.doesNotMatch(request.body, /0901234567|cho em xin|Mẫu trả lời/);
                    const timestamp = request.headers['x-tikoder-timestamp'];
                    assert.equal(request.headers['x-tikoder-signature'], sign(env.N8N_NOTIFY_SECRET, timestamp, request.body));
                    const inspected = service.inspect(verify(request.body, timestamp, request.headers['x-tikoder-signature'], request.headers['x-tikoder-event-id']));
                    assert.equal(inspected.route, 'phone');
                    const command = inspected.command;
                    assert.equal(service.enqueue(verify(command.body, command.timestamp, command.signature, command.eventId)).status, 'accepted');
                    return { ok: true, status: 202 };
                } });
            store.saveSettings(uid, { enabled: true, cooldownSeconds: 30, target: { phone, name },
                rules: { phone: { enabled: true, text: 'Mẫu trả lời đã lưu', triggers: ['sdt'] } } }, [phone]);
            await page.exposeFunction('fixtureReplyEcho', () => row('full-flow-echo-' + (++echo), { own: true, text: 'Mẫu trả lời đã lưu' }));
            await page.evaluate(() => {
                document.querySelector('#richInput').addEventListener('keydown', async event => {
                    if (event.key !== 'Enter') return;
                    const html = await window.fixtureReplyEcho();
                    document.querySelector('.block-date').insertAdjacentHTML('beforeend', html);
                    document.querySelector('#richInput').textContent = '';
                });
            });
            try {
                await service.connect(uid);
                for (let i = 0; i < 2; i++) {
                    clock = NOW + i * 60000;
                    await advance(i);
                    await append(row('full-flow-incoming-' + i, { text: 'cho em xin sdt', time: i ? '10:13' : '10:12' }));
                    await poll();
                    await service.drain();
                    await service.waitForJobs();
                    assert.equal(store.read(uid).messages.length, i + 1);
                    assert.equal(store.read(uid).messages.at(-1).status, 'sent');
                    assert.equal(requests, i + 1);
                    assert.equal(await page.evaluate(() => window.enters), i + 1);
                    await poll();
                    await service.drain();
                    assert.equal(requests, i + 1, 'Source IDs cannot replay a send');
                }
                assert.equal(service.state(uid).connection.runtime.ingested, 2);
            } finally { service.stop(); }
        });
        await test('Quote path still accepts the original search/editor contract alone', async () => {
            await load();
            await page.locator('.message-view').evaluate(node => node.remove());
            assert.deepEqual(await adapter.send(uid, phone, name, 'quote'), { outcome: 'needs_check' });
            assert.equal(await page.evaluate(() => window.enters), 1);
        });
        assert.deepEqual(network, [], 'No outbound requests');
        assert.deepEqual(failures, [], 'No browser exceptions');
        assert.ok(statuses.length > 0);
        console.log(`PASS: ${passed} offline observed-DOM adapter checks. No real Zalo was run.`);
    } finally {
        adapter.stopWatching(uid);
        global.__zaloLiveAdapterTimers = previousTimers;
        if (previousFlag === undefined) delete process.env.ZALO_WEB_EXPERIMENTAL;
        else process.env.ZALO_WEB_EXPERIMENTAL = previousFlag;
        fs.rmSync(temp, { recursive: true, force: true });
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
