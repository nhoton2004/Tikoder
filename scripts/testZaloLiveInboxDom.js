'use strict';

// Offline synthetic fixtures of the observed version-3 classes, not real chat
// contents or proof of authenticated Zalo behavior. No profile/server/sends.
// Run: node scripts/testZaloLiveInboxDom.js (requires installed Microsoft Edge).
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { snapshotLive, trackLiveInbox, resetLiveInboxTracker } = require('../utils/zaloLiveInboxDom');

const NOW = Date.UTC(2026, 9, 25, 3, 12, 45); // 10:12:45 in the fixture browser.
const MINUTE = Math.floor(NOW / 60000) * 60000;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const row = (id, options = {}) => {
    const own = options.own ? ' me' : '';
    const qid = options.qid === null ? '' : ` data-qid="${escape(options.qid === undefined ? id : options.qid)}"`;
    const text = options.body === undefined ? `<span>${escape(options.text === undefined ? 'Fixture message' : options.text)}</span>` : options.body;
    const time = options.time === null ? '' : `<div class="card-send-time${own}">${escape(options.time || '10:12')}</div>`;
    return `<div class="chat-item${own}"><div class="chat-content"><div class="chat-message${own}" id="chat-${escape(id)}">
<div class="message-wrapper${options.own ? ' message-wrapper--me' : ''}"><div class="message-content-wrapper"><div class="message-content-render">
<div class="message-frame${own}" id="frame-${escape(id)}"${qid}><div data-id="fixture-payload"><div class="message-action">${text}</div>${time}<div class="message-reaction-container"></div></div></div>
<div class="floating-menu-wrapper floating-menu-wrapper--${options.own ? 'me' : 'other'}"><button>Fixture menu</button></div>
</div></div></div></div></div></div>`;
};
const date = label => `<div class="chat-date --time"><span class="content"><span>${escape(label)}</span></span></div>`;
const block = (rows, label = 'Hôm nay') => `<div class="block-date">${date(label)}${rows}</div>`;
const fixture = (rows = row('baseline'), label = 'Hôm nay') => `<!doctype html><html lang="vi"><meta charset="utf-8">
<style>.transform-gpu{height:180px;overflow-y:auto;overflow-anchor:none}.chat-item{min-height:28px}.card-send-time{font-size:10px}.floating-menu-wrapper{display:none}#richInput{min-height:24px}</style>
<article id="chatView"><div class="message-view"><div class="message-view__scroll"><div class="transform-gpu"><div class="message-view__scroll__inner">${block(rows, label)}</div></div></div></div>
<div class="chat-box-input"><div id="richInput" contenteditable="true" data-trailer="Fixture contact"></div></div></article></html>`;

(async () => {
    assert.deepEqual(Object.keys(require('../utils/zaloLiveInboxDom')).sort(),
        ['resetLiveInboxTracker', 'snapshotLive', 'trackLiveInbox']);
    assert.equal(snapshotLive(null).supported, false);
    assert.equal(trackLiveInbox(null).supported, false);
    assert.equal(resetLiveInboxTracker(null), false);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ timezoneId: 'Asia/Ho_Chi_Minh', viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const requests = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    let passed = 0;
    const test = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`); };
    const read = () => page.evaluate(snapshotLive);
    const start = () => page.evaluate(trackLiveInbox);
    const poll = async () => { await start(); return read(); };
    const load = async (rows, label) => {
        await page.evaluate(resetLiveInboxTracker);
        await page.clock.setFixedTime(new Date(NOW));
        await page.setContent(fixture(rows, label));
    };
    const append = html => page.evaluate(html => document.querySelector('.block-date').insertAdjacentHTML('beforeend', html), html);
    const advance = minutes => page.clock.setFixedTime(new Date(NOW + minutes * 60000));
    const groupedRow = (id, options) => row(id, options).replace('class="chat-message"', 'class="chat-message chat-message-v2 -send-time"');
    const groupAppend = (html, mode = 'remove', mutate = null) => page.evaluate(({ html, mode, mutate }) => {
        const tail = document.querySelector('.chat-item:last-child');
        const chat = tail.querySelector('.chat-message');
        const time = tail.querySelector('.card-send-time');
        if (mutate) new Function('tail', 'time', `return (${mutate})(tail, time)`)(tail, time);
        chat.classList.remove('-send-time');
        if (mode === 'remove') time.remove();
        if (mode === 'class') time.classList.remove('card-send-time');
        if (mode === 'display') time.style.display = 'none';
        if (mode === 'visibility') time.style.visibility = 'hidden';
        document.querySelector('.block-date').insertAdjacentHTML('beforeend', html);
    }, { html, mode, mutate: mutate && mutate.toString() });
    // A separate browser task and a native scroll event, not a mocked scrollTop
    // or synthetic scroll event, for all overflowing viewport follow tests.
    const followBottom = (offset = 0) => page.evaluate(offset => new Promise((resolve, reject) => {
        setTimeout(() => {
            const scroll = document.querySelector('.transform-gpu');
            const target = Math.max(0, scroll.scrollHeight - scroll.clientHeight - offset);
            if (Math.abs(scroll.scrollTop - target) <= 1) { resolve(); return; }
            const timeout = setTimeout(() => { scroll.removeEventListener('scroll', done); reject(new Error('Native fixture scroll timed out')); }, 2000);
            function done() { clearTimeout(timeout); resolve(); }
            scroll.addEventListener('scroll', done, { once: true });
            scroll.scrollTop = target;
        }, 0);
    }), offset);
    const geometry = () => page.locator('.transform-gpu').evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight,
        client: node.clientHeight, gap: node.scrollHeight - node.clientHeight - node.scrollTop }));
    const assertSkipped = (result, reason) => {
        assert.equal(result.supported, true, result.detail);
        assert.deepEqual(result.messages, []);
        assert.ok(result.skipped[reason] > 0, JSON.stringify(result.skipped));
        assert.deepEqual(result.tracking && result.tracking.eligible || [], []);
    };
    try {
        await test('Observed shape needs no artificial identity/direction/live attributes', async () => {
            await load(row('incoming') + row('own', { own: true }));
            const result = await read();
            assert.equal(result.supported, true, result.detail);
            assert.equal(result.rootKey, 'chatView');
            assert.equal(result.editorName, 'Fixture contact');
            assert.equal(result.requiresIdentityGuard, true);
            for (const key of ['phone', 'name', 'conversationKey', 'historyReady']) assert.equal(key in result, false);
            assert.equal(result.tracking, null);
            assert.deepEqual(result.messages.map(message => [message.id, message.direction, message.createdMinute]),
                [['incoming', 'inbound', MINUTE], ['own', 'outbound', MINUTE]]);
            assert.equal(result.messages[0].frameId, 'frame-incoming');
            assert.equal(result.messages[0].chatMessageId, 'chat-incoming');
            assert.equal(await page.locator('.chat-item[id]').count(), 0);
            assert.equal(await page.locator('[data-chat-type], [data-thread-id], [data-peer-phone], [data-message-text], [data-message-id], [data-direction], [data-live-arrival], [data-created-at], [data-message-scroll]').count(), 0);
            assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
        });

        for (const [name, mutate] of [
            ['duplicate visible roots', () => document.body.append(document.querySelector('#chatView').cloneNode(true))],
            ['non-article root', () => { const old = document.querySelector('#chatView'); const node = document.createElement('section'); node.id = old.id; node.innerHTML = old.innerHTML; old.replaceWith(node); }],
            ['duplicate visible editors', () => document.querySelector('#chatView').append(document.querySelector('#richInput').cloneNode(true))],
            ['editor outside root', () => document.body.append(document.querySelector('#richInput'))],
            ['hidden editor', () => { document.querySelector('#richInput').style.display = 'none'; }],
            ['missing trailer', () => document.querySelector('#richInput').removeAttribute('data-trailer')],
            ['duplicate history', () => document.querySelector('.transform-gpu').append(document.querySelector('.message-view__scroll__inner').cloneNode(true))],
            ['unobserved scroll class', () => { document.querySelector('.transform-gpu').className = 'unknown-scroll'; }],
            ['non-scrollable history', () => { document.querySelector('.transform-gpu').style.overflowY = 'visible'; }],
        ]) await test(`Fail closed: ${name}`, async () => {
            await load(); await page.evaluate(mutate);
            assert.equal((await read()).supported, false);
        });

        await test('Hidden duplicate root does not override the visible root', async () => {
            await load();
            await page.evaluate(() => { const clone = document.querySelector('#chatView').cloneNode(true); clone.style.display = 'none'; document.body.append(clone); });
            assert.equal((await read()).supported, true);
        });
        await test('Observed outer scroll fallback is supported', async () => {
            await load();
            await page.evaluate(() => {
                document.querySelector('.transform-gpu').style.overflowY = 'visible';
                const outer = document.querySelector('.message-view__scroll'); outer.style.height = '180px'; outer.style.overflowY = 'auto';
            });
            assert.equal((await read()).supported, true);
            assert.equal((await start()).supported, true);
        });

        for (const [name, mutate] of [
            ['bare not-me', () => document.querySelector('.floating-menu-wrapper').remove()],
            ['both menus', () => document.querySelector('.floating-menu-wrapper').classList.add('floating-menu-wrapper--me')],
            ['duplicate menus', () => { const menu = document.querySelector('.floating-menu-wrapper'); menu.after(menu.cloneNode(true)); }],
            ['row me only', () => document.querySelector('.chat-item').classList.add('me')],
            ['chat me only', () => document.querySelector('.chat-message').classList.add('me')],
            ['frame me only', () => document.querySelector('.message-frame').classList.add('me')],
            ['wrapper me only', () => document.querySelector('.message-wrapper').classList.add('message-wrapper--me')],
            ['own menu without me', () => { document.querySelector('.floating-menu-wrapper').className = 'floating-menu-wrapper floating-menu-wrapper--me'; }],
        ]) await test(`Reject ambiguous direction: ${name}`, async () => {
            await load(); await page.evaluate(mutate); assertSkipped(await read(), 'direction');
        });
        await test('Incomplete own markers cannot become incoming', async () => {
            await load(row('own', { own: true }));
            await page.locator('.chat-message').evaluate(node => node.classList.remove('me'));
            assertSkipped(await read(), 'direction');
        });

        for (const qid of [null, '', ' ', 'bad id', 'bad\nvalue', 'x'.repeat(201)]) {
            await test('Missing/invalid bounded qid is skipped without ID fallback', async () => {
                await load(row('invalid', { qid })); assertSkipped(await read(), 'identity');
            });
        }
        await test('Bounded independent IDs and opaque qids are not timestamps', async () => {
            await load(row('bounded', { qid: 'x'.repeat(200) }) + row('numeric', { qid: '1792897920000', time: null }));
            const result = await read();
            assert.equal(result.messages[0].id.length, 200);
            assert.equal(result.messages[1].createdMinute, null);
            await page.locator('.chat-message').first().evaluate(node => node.removeAttribute('id'));
            assert.equal((await read()).skipped.identity, 1);
        });
        await test('Duplicate qids fail the snapshot even with distinct wrapper IDs', async () => {
            await load(row('a', { qid: 'same' }) + row('b', { qid: 'same' }));
            assert.equal((await read()).supported, false);
        });
        await test('Missing original frame ID is skipped without qid-only fallback', async () => {
            await load(); await page.locator('.message-frame').evaluate(node => node.removeAttribute('id'));
            assertSkipped(await read(), 'identity');
        });
        await test('Duplicate original chat IDs fail the snapshot', async () => {
            await load(row('a') + row('b'));
            await page.locator('.chat-message').last().evaluate(node => { node.id = 'chat-a'; });
            assert.equal((await read()).supported, false);
        });
        await test('Duplicate frame IDs fail the snapshot', async () => {
            await load(row('a') + row('b'));
            await page.locator('.message-frame').last().evaluate(node => { node.id = 'frame-a'; });
            assert.equal((await read()).supported, false);
        });

        await test('Plaintext uses rendered action only, without status/menu/hidden text', async () => {
            await load(row('text', { body: '<div>Fixture <strong>plaintext</strong></div><span style="display:none">Hidden fixture</span>', time: 'Đã xem 10:12' }));
            const result = await read();
            assert.equal(result.messages[0].text, 'Fixture plaintext');
            assert.equal(result.messages[0].createdMinute, MINUTE);
        });
        await test('Observed numbered Zalo text span reads inbound keyword and becomes eligible', async () => {
            await load(); await start(); await advance(1);
            await append(row('keyword', { time: '10:13', body: '<div class="text-message__container"><div><div class="overflow-hidden"><span-15><span class="text">cho em xin sdt nha</span></span-15></div></div></div>' }));
            const result = await poll();
            assert.equal(result.messages.find(message => message.id === 'keyword').text, 'cho em xin sdt nha');
            assert.deepEqual(result.tracking.eligible, ['keyword']);
        });
        for (const [name, body] of [
            ['numbered span outside text renderer', '<span-15>sdt</span-15>'],
            ['numbered span attachment', '<div class="text-message__container"><span-15><img alt="attachment">sdt</span-15></div>'],
            ['numbered span widget', '<div class="text-message__container"><span-15 role="tree">sdt</span-15></div>'],
            ['empty', ''], ['whitespace', '   '], ['oversize', 'x'.repeat(4001)],
            ['image-only', '<img alt="Fixture image">'], ['attachment with caption', '<span>Fixture caption</span><div class="file-card">Fixture file</div>'],
            ['quote', '<div class="message-quote">Fixture quote</div><span>Fixture reply</span>'],
            ['reply', '<div class="reply-preview">Fixture quote</div>'], ['preview', '<div class="link-preview">Fixture preview</div>'],
            ['action button', '<button>Fixture action</button>'], ['unknown widget', '<div role="tree">Fixture widget</div>'],
            ['unknown element', '<custom-fixture>Fixture widget</custom-fixture>'],
            ['download link', '<a download>Fixture file</a>'], ['control character', 'Fixture&#1;text'],
        ]) await test(`Skip unsafe/non-plaintext action: ${name}`, async () => {
            await load(row('text', { body })); assertSkipped(await read(), 'plaintext');
        });
        await test('Multiple actions and sibling previews are skipped', async () => {
            await load();
            await page.locator('.message-action').evaluate(node => node.after(node.cloneNode(true)));
            assertSkipped(await read(), 'plaintext');
            await load();
            await page.locator('.message-action').evaluate(node => node.insertAdjacentHTML('afterend', '<div class="quote-preview">Fixture quote</div>'));
            assertSkipped(await read(), 'plaintext');
        });

        for (const [label, time, expected] of [
            ['Hôm nay', '10:11', MINUTE - 60000], ['Hôm nay', '10:12 Đã nhận', MINUTE],
            ['Hôm qua', '10:12', MINUTE - 86400000], ['25/10/2026', '10:12', MINUTE],
            ['02:00 Hôm nay', '10:12', MINUTE], ['02:00 Hôm qua', '10:12', MINUTE - 86400000],
            ['00:00 Hôm nay', '10:11', MINUTE - 60000], ['23:59 Hôm nay', '10:12', MINUTE],
            ['02:00 Hôm nay', '09:11', MINUTE - 61 * 60000], ['02:00 Hôm nay', null, null],
            ['02:00 Hôm qua', null, null], ['02:00 Hôm nay', 'Unknown time', null],
            ['02:00 Hôm nay', '10:13', null],
            ['T2 19/10/2026', '10:12', MINUTE - 6 * 86400000],
            ['T3 20/10/2026', '10:12', MINUTE - 5 * 86400000],
            ['T4 21/10/2026', '10:12', MINUTE - 4 * 86400000],
            ['T5 22/10/2026', '10:12', MINUTE - 3 * 86400000],
            ['T6 23/10/2026', '10:12', MINUTE - 2 * 86400000],
            ['T7 24/10/2026', '10:12', MINUTE - 86400000], ['CN 25/10/2026', '10:12', MINUTE],
            ['24:00 Hôm nay', '10:12', null], ['29:00 Hôm qua', '10:12', null],
            ['99:00 Hôm nay', '10:12', null], ['02:60 Hôm nay', '10:12', null],
            ['2:00 Hôm nay', '10:12', null], ['02:0 Hôm nay', '10:12', null],
            ['02:00:00 Hôm nay', '10:12', null], ['02:00 03:00 Hôm nay', '10:12', null],
            ['02:00Hôm nay', '10:12', null], ['02:00 Hôm nay extra', '10:12', null],
            ['extra 02:00 Hôm qua', '10:12', null], ['Hôm nay 02:00', '10:12', null],
            ['02:00 T4 21/10/2026', '10:12', null],
            ['T1 21/10/2026', '10:12', null], ['T8 21/10/2026', '10:12', null],
            ['T04 21/10/2026', '10:12', null], ['T4 21/10/2026 extra', '10:12', null],
            ['extra T4 21/10/2026', '10:12', null], ['T421/10/2026', '10:12', null],
            ['CN25/10/2026', '10:12', null], ['CN 31/02/2026', '10:12', null],
            ['Chủ nhật, 25/10/2026', '10:12', MINUTE], ['Thứ Hai, 26/10/2026', '10:12', null],
            ['Hôm nay', '10:13', null], ['Hôm nay', '24:00', null], ['Hôm nay', '9:12', null],
            ['Hôm nay', '10:12:00', null], ['Hôm nay', '10:12 10:11', null], ['Hôm nay', '99:99 10:12', null],
            ['Hôm nay', 'prefix10:12', null], ['Hôm nay', null, null], ['Hôm nay', 'Unknown time', null],
            ['31/02/2026', '10:12', null], ['25/13/2026', '10:12', null], ['25/10/26', '10:12', null],
            ['Ngày 25/10/2026 somewhere', '10:12', null], ['Unknown day', '10:12', null],
        ]) await test(`Local calendar parsing: ${label} / ${time}`, async () => {
            await load(row('time', { time }), label);
            const result = await read();
            assert.equal(result.messages.length, 1);
            assert.equal(result.messages[0].createdMinute, expected);
        });
        await test('Nearest preceding separator wins within a block', async () => {
            await load(row('yesterday') + date('Hôm nay') + row('today'), 'Hôm qua');
            assert.deepEqual((await read()).messages.map(message => message.createdMinute), [MINUTE - 86400000, MINUTE]);
            await page.locator('.chat-date').last().evaluate(node => node.querySelector('.content').textContent = 'Unknown day');
            assert.equal((await read()).messages[1].createdMinute, null);
        });
        await test('No preceding date or duplicate time yields null, not a guess', async () => {
            await load(); await page.locator('.chat-date').evaluate(node => node.remove());
            assert.equal((await read()).messages[0].createdMinute, null);
            await load(); await page.locator('.card-send-time').evaluate(node => node.after(node.cloneNode(true)));
            assert.equal((await read()).messages[0].createdMinute, null);
        });
        await test('Relative dates cross local midnight and month boundaries', async () => {
            await load(row('time', { time: '23:59' }), 'Hôm qua');
            const midnight = Date.UTC(2026, 9, 31, 17, 0, 20); // Nov 1, 00:00 local.
            await page.clock.setFixedTime(new Date(midnight));
            assert.equal((await read()).messages[0].createdMinute, Date.UTC(2026, 9, 31, 16, 59));
        });

        await test('Initial and repeated tracker setup baseline existing rows', async () => {
            await load(); const first = await start(); const second = await start();
            assert.equal(first.supported, true);
            assert.equal(first.token, second.token);
            assert.equal(first.baselineMinute, MINUTE);
            const result = await read();
            assert.deepEqual(result.tracking.eligible, []);
            assert.equal(result.tracking.epoch, 0);
            assert.equal(await page.evaluate(() => '__tikoderInboxTracker' in window), false);
        });
        await test('Reproduce overflow tail-follow and non-overflow bottom scroll without losing incoming candidates', async () => {
            const evidence = [];
            for (const overflow of [true, false]) {
                await load(overflow ? Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('') : row('baseline'));
                if (overflow) await followBottom(12);
                const initialGeometry = await geometry();
                assert.ok(initialGeometry.gap <= 32);
                if (overflow) assert.ok(initialGeometry.height > initialGeometry.client);
                const baseline = await start(); await advance(1);
                await append(row('live-follow', { time: '10:13', body: overflow ? '<div style="min-height:140px">Fixture tall inbound</div>' : '<span>Fixture inbound</span>' }));
                const grownGeometry = await geometry();
                if (overflow) {
                    assert.ok(grownGeometry.height - initialGeometry.height >= 100);
                    assert.ok(grownGeometry.gap > 32);
                } else assert.equal(grownGeometry.height, grownGeometry.client);
                const beforeFollow = await poll();
                if (overflow) await followBottom();
                else await page.locator('.transform-gpu').evaluate(node => node.dispatchEvent(new Event('scroll')));
                const afterFollow = await poll();
                assert.equal(beforeFollow.tracking.pendingTailFollow, overflow);
                assert.equal(afterFollow.tracking.pendingTailFollow, false);
                assert.equal(afterFollow.tracking.resetReason, 'initial-baseline');
                assert.deepEqual(afterFollow.tracking.resetCounts, {});
                evidence.push({ path: overflow ? 'overflow-next-task-native-follow' : 'non-overflow-bottom-event',
                    initialBaseline: baseline.baselineMinute, baseline: afterFollow.tracking.baselineMinute,
                    beforeEpoch: beforeFollow.tracking.epoch, afterEpoch: afterFollow.tracking.epoch,
                    eligible: afterFollow.tracking.eligible });
            }
            console.log('Scroll reproduction evidence:', JSON.stringify(evidence));
            assert.deepEqual(evidence.map(item => ({ path: item.path, baseline: item.baseline, epoch: item.afterEpoch, eligible: item.eligible })), [
                { path: 'overflow-next-task-native-follow', baseline: MINUTE, epoch: 0, eligible: ['live-follow'] },
                { path: 'non-overflow-bottom-event', baseline: MINUTE, epoch: 0, eligible: ['live-follow'] },
            ]);
        });
        await test('Same-task overflow append and native bottom-follow preserve the cutoff', async () => {
            await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom();
            await start(); await advance(1);
            await page.locator('.block-date').evaluate((block, html) => {
                block.insertAdjacentHTML('beforeend', html);
                const scroll = document.querySelector('.transform-gpu'); scroll.scrollTop = scroll.scrollHeight;
            }, row('same-task', { time: '10:13', body: '<div style="min-height:160px">Fixture inbound</div>' }));
            await followBottom();
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, ['same-task']);
            assert.equal(result.tracking.baselineMinute, MINUTE);
            assert.equal(result.tracking.epoch, 0);
        });
        await test('Staged candidate hydration may grow overflow before a later native bottom-follow', async () => {
            await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom(12);
            await start(); await advance(1); await append('<div class="chat-item"></div>');
            assert.deepEqual((await poll()).tracking.eligible, []);
            await page.locator('.chat-item').last().evaluate((node, html) => {
                const template = document.createElement('template'); template.innerHTML = html;
                node.innerHTML = template.content.firstElementChild.innerHTML;
            }, row('hydrated-follow', { qid: null, time: null, body: '<div style="min-height:180px"></div>' }));
            const grown = await poll(); assert.equal(grown.tracking.pendingTailFollow, true);
            assert.deepEqual(grown.tracking.eligible, []);
            await page.locator('.message-frame').last().evaluate(node => node.setAttribute('data-qid', 'hydrated-follow'));
            await page.locator('.message-action > div').last().evaluate(node => { node.textContent = 'Hydrated fixture inbound'; });
            await page.locator('.message-action').last().evaluate(node => node.insertAdjacentHTML('afterend', '<div class="card-send-time">10:13</div>'));
            assert.deepEqual((await poll()).tracking.eligible, []);
            await followBottom();
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, ['hydrated-follow']);
            assert.equal(result.tracking.baselineMinute, MINUTE); assert.equal(result.tracking.epoch, 0);
        });
        await test('Native scroll away invalidates candidates and returning bottom baselines history', async () => {
            await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom();
            await start(); await advance(1);
            await append(row('before-away', { time: '10:13', body: '<div style="min-height:150px">Fixture inbound</div>' }));
            await followBottom(); assert.deepEqual((await poll()).tracking.eligible, ['before-away']);
            await followBottom(100);
            const away = await poll();
            assert.equal(away.atBottom, false); assert.deepEqual(away.tracking.eligible, []);
            assert.ok(away.tracking.resetCounts['scroll-away'] >= 1);
            await followBottom();
            const returned = await poll();
            assert.equal(returned.atBottom, true); assert.deepEqual(returned.tracking.eligible, []);
            assert.ok(returned.tracking.resetCounts['return-to-bottom'] >= 1);
            await advance(2);
            await append(row('after-return', { time: '10:14', body: '<div style="min-height:150px">Fixture fresh inbound</div>' }));
            await followBottom();
            assert.deepEqual((await poll()).tracking.eligible, ['after-return']);
        });
        await test('Native wheel intent during pending follow cannot be mistaken for automatic following', async () => {
            await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom();
            await start(); await advance(1);
            await append(row('wheel-pending', { time: '10:13', body: '<div style="min-height:160px">Fixture inbound</div>' }));
            assert.equal((await poll()).tracking.pendingTailFollow, true);
            const bounds = await page.locator('.transform-gpu').boundingBox();
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            await page.mouse.wheel(0, -100);
            await page.waitForFunction(() => window.__tikoderLiveInboxTracker.resetCounts['user-scroll'] > 0);
            await followBottom();
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, []);
            assert.equal(result.tracking.pendingTailFollow, false);
            assert.ok(result.tracking.resetCounts['user-scroll'] >= 1);
            assert.equal(result.tracking.baselineMinute, MINUTE + 60000);
        });
        await test('User intent before observer delivery cannot be rescued by bottom-follow', async () => {
            await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom();
            await start(); await advance(1);
            await page.locator('.block-date').evaluate((block, html) => {
                document.querySelector('.transform-gpu').dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
                block.insertAdjacentHTML('beforeend', html);
            }, row('intent-first', { time: '10:13', body: '<div style="min-height:160px">Fixture inbound</div>' }));
            await followBottom();
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, []);
            assert.ok(result.tracking.resetCounts['user-scroll'] >= 1);
        });
        await test('Bottom-follow never substitutes for timestamp, source ID or direction proof', async () => {
            for (const options of [{ time: '10:11' }, { time: '10:14' }, { time: null },
                { time: '10:13', qid: null }, { time: '10:13', own: true }, { time: '10:13', noDirection: true }]) {
                await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom();
                await start(); await advance(1);
                let html = row('not-live-proof', { ...options, body: '<div style="min-height:150px">Fixture candidate</div>' });
                if (options.noDirection) html = html.replace('floating-menu-wrapper--other', 'fixture-no-direction');
                await append(html); await followBottom();
                const result = await poll();
                assert.deepEqual(result.tracking.eligible, [], JSON.stringify(options));
                assert.equal(result.tracking.baselineMinute, MINUTE);
                assert.equal(result.tracking.epoch, 0);
            }
        });
        await test('Prepend, replacement and old-row edits during follow still fail closed', async () => {
            for (const [reason, mutate] of [
                ['history-reorder', html => document.querySelector('.chat-date').insertAdjacentHTML('afterend', html)],
                ['history-reorder', () => { const row = document.querySelector('.chat-item:last-child'); row.replaceWith(row.cloneNode(true)); }],
                ['baseline-mutation', () => { document.querySelector('.message-action').textContent = 'Edited baseline fixture'; }],
                ['message-identity-change', () => { const frames = document.querySelectorAll('.message-frame'); frames[frames.length - 1].setAttribute('data-qid', 'changed-fixture'); }],
            ]) {
                await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom();
                await start(); await advance(1);
                await append(row('pending-safety', { time: '10:13', body: '<div style="min-height:150px">Fixture inbound</div>' }));
                assert.equal((await poll()).tracking.pendingTailFollow, true);
                await page.evaluate(mutate, row('history-prepend', { time: '10:11' }));
                await followBottom();
                const result = await poll();
                assert.deepEqual(result.tracking.eligible, []);
                assert.ok(result.tracking.resetCounts[reason] >= 1, JSON.stringify(result.tracking));
            }
        });
        await test('Mutation trace captures append before reset without exporting IDs, values or payloads', async () => {
            await load(); await start();
            await append(row('private-source-id', { text: 'private-message-content' }));
            assert.ok((await poll()).tracking.eligible.includes('private-source-id'));
            await page.locator('#chatView').evaluate(node => node.setAttribute('data-private-token', 'private-attribute-value'));
            const result = await poll();
            const events = result.tracking.trace;
            assert.equal(events[events.length - 2].event, 'append');
            const last = events[events.length - 1];
            assert.equal(last.event, 'reset');
            assert.equal(last.reason, 'outside-history-mutation');
            assert.equal(last.candidatesBefore, 1);
            assert.equal(last.rowsBefore, 2);
            assert.equal(last.rowsAfter, 2);
            assert.ok(last.mutations.some(item => item.region === 'root' && item.attribute === 'other'));
            const serialized = JSON.stringify(events);
            for (const secret of ['private-source-id', 'private-message-content', 'data-private-token', 'private-attribute-value', 'Fixture contact']) {
                assert.equal(serialized.includes(secret), false);
            }
            events[0].reason = 'changed-copy';
            assert.notEqual((await read()).tracking.trace[0].reason, 'changed-copy');
        });
        await test('Mutation trace stores at most 24 events and 8 summaries per batch', async () => {
            await load(); await start();
            for (let i = 0; i < 30; i++) {
                await page.locator('#chatView').evaluate((node, index) => {
                    for (let j = 0; j < 12; j++) node.setAttribute('data-fixture-counter', String(index * 12 + j));
                }, i);
                await poll();
            }
            const events = (await read()).tracking.trace;
            assert.equal(events.length, 24);
            assert.ok(events.every(event => event.mutationCount === 12 && event.mutations.length === 8));
        });
        await test('Reset diagnostics are serializable counters and fixed non-PII reason codes', async () => {
            await load(row('secret-fixture-source', { text: 'Private fixture payload' })); await start(); await advance(1);
            await page.locator('.message-action').evaluate(node => { node.textContent = 'Changed private fixture payload'; });
            const result = await poll();
            assert.equal(result.tracking.resetReason, 'baseline-mutation');
            assert.deepEqual(result.tracking.resetCounts, { 'baseline-mutation': 1 });
            assert.equal(Object.values(result.tracking.resetCounts).reduce((sum, count) => sum + count, 0), result.tracking.epoch);
            const diagnostics = JSON.stringify({ resetReason: result.tracking.resetReason, resetCounts: result.tracking.resetCounts });
            for (const secret of ['secret-fixture-source', 'Private fixture payload', 'Fixture contact']) assert.ok(!diagnostics.includes(secret));
            result.tracking.resetCounts['baseline-mutation'] = 999;
            assert.equal((await read()).tracking.resetCounts['baseline-mutation'], 1);
        });
        for (const sameBatch of [true, false]) for (const [name, mutate] of [
            ['root focus attributes', () => {
                const root = document.querySelector('#chatView');
                root.classList.add('composer-focused'); root.style.outline = 'none'; root.setAttribute('aria-label', 'Fixture chat');
            }],
            ['history focus classes', () => {
                for (const selector of ['.message-view', '.message-view__scroll', '.transform-gpu', '.message-view__scroll__inner', '.block-date', '.chat-item', '.chat-message', '.message-frame', '.message-action']) {
                    for (const node of document.querySelectorAll(selector)) node.classList.toggle('highlight-v3');
                }
                document.querySelector('.chat-item').classList.toggle('hovered');
            }],
            ['editor focus attributes', () => {
                const editor = document.querySelector('#richInput');
                editor.focus(); editor.classList.add('focused'); editor.style.outline = 'none'; editor.setAttribute('aria-label', 'Fixture composer');
            }],
            ['composer ancestor focus attributes', () => {
                const composer = document.querySelector('.chat-box-input');
                composer.classList.toggle('highlight-v3'); composer.style.outline = 'none'; composer.setAttribute('aria-label', 'Fixture composer');
            }],
            ['editor editable toggle and ancestor highlight', () => {
                const editor = document.querySelector('#richInput'), composer = document.querySelector('.chat-box-input');
                editor.setAttribute('contenteditable', 'false'); composer.classList.add('highlight-v3');
                editor.setAttribute('contenteditable', 'true'); composer.classList.remove('highlight-v3');
            }],
            ['composer child replacement', () => { document.querySelector('#richInput').innerHTML = '<p><span>Fixture draft</span><br></p>'; }],
            ['composer character data', () => {
                const editor = document.querySelector('#richInput');
                editor.textContent = 'Fixture draft'; editor.firstChild.data = 'Updated fixture draft';
            }],
            ['root child text', () => {
                const text = document.createTextNode(' '); document.querySelector('#chatView').append(text); text.data = '\n';
            }],
        ]) await test(`Cosmetic ${name} preserves append ${sameBatch ? 'in the same batch' : 'before snapshot'}`, async () => {
            await load(); const baseline = await start(); await advance(1);
            if (sameBatch) {
                // Queue the append with the cosmetic mutation before observer delivery.
                await page.evaluate(({ html, source }) => {
                    document.querySelector('.block-date').insertAdjacentHTML('beforeend', html);
                    new Function(`return (${source})`)()();
                    window.__tikoderLiveInboxTracker.flush();
                }, { html: row('cosmetic-live', { time: '10:13' }), source: mutate.toString() });
            } else {
                await append(row('cosmetic-live', { time: '10:13' }));
                await page.evaluate(mutate);
            }
            for (let repeat = 0; repeat < 3; repeat++) {
                await page.evaluate(mutate);
                const result = await poll();
                assert.equal(result.tracking.token, baseline.token);
                assert.equal(result.tracking.epoch, baseline.epoch);
                assert.equal(result.tracking.baselineMinute, MINUTE);
                assert.deepEqual(result.tracking.resetCounts, {});
                assert.deepEqual(result.tracking.eligible, ['cosmetic-live']);
                assert.equal(result.requiresIdentityGuard, true);
            }
        });
        await test('Noneditable editor snapshot fails closed and restoring the same editor preserves candidates', async () => {
            await load(); const baseline = await start(); await advance(1);
            await append(row('editable-live', { time: '10:13' }));
            await page.locator('#richInput').evaluate(editor => editor.setAttribute('contenteditable', 'false'));
            assert.equal((await read()).supported, false);
            await page.locator('#richInput').evaluate(editor => editor.setAttribute('contenteditable', 'true'));
            const restored = await poll();
            assert.equal(restored.supported, true);
            assert.equal(restored.tracking.token, baseline.token);
            assert.equal(restored.tracking.epoch, baseline.epoch);
            assert.equal(restored.tracking.baselineMinute, MINUTE);
            assert.deepEqual(restored.tracking.resetCounts, {});
            assert.deepEqual(restored.tracking.eligible, ['editable-live']);
        });
        for (const selector of ['#richInput', '.chat-box-input']) await test(`Unknown outside attribute still resets: ${selector}`, async () => {
            await load(); await start(); await advance(1); await append(row('unknown-attr-live', { time: '10:13' }));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, ['unknown-attr-live']);
            await page.locator(selector).evaluate(node => {
                node.classList.add('highlight-v3'); node.setAttribute('data-unknown-fixture', 'changed');
            });
            const after = await poll();
            assert.equal(after.tracking.resetReason, 'outside-history-mutation');
            assert.ok(after.tracking.epoch > before.tracking.epoch);
            assert.equal(after.tracking.baselineMinute, MINUTE + 60000);
            assert.deepEqual(after.tracking.eligible, []);
        });
        for (const [name, mutate] of [
            ['unknown root child', () => document.querySelector('#chatView').append(document.createElement('header'))],
            ['root identity attribute', () => document.querySelector('#chatView').setAttribute('data-peer', 'changed-fixture')],
            ['unknown non-composer outside class', () => document.querySelector('.message-view').classList.add('unknown-fixture')],
            ['composer ancestor editable attribute', () => document.querySelector('.chat-box-input').setAttribute('contenteditable', 'false')],
            ['structural composer child', () => { document.querySelector('#richInput').innerHTML = '<div class="message-frame"></div>'; }],
            ['baseline direction class', () => document.querySelector('.chat-item').classList.add('me')],
            ['baseline structural class', () => document.querySelector('.message-frame').classList.remove('message-frame')],
            ['baseline unknown class', () => document.querySelector('.chat-item').classList.add('unknown-fixture')],
            ['baseline text', () => { document.querySelector('.message-action').textContent = 'Changed baseline fixture'; }],
            ['candidate ID', () => {
                const frames = document.querySelectorAll('.message-frame'); frames[frames.length - 1].setAttribute('data-qid', 'changed-fixture');
            }],
        ]) await test(`Cosmetics do not mask ${name}`, async () => {
            await load(); await start(); await advance(1); await append(row('guarded-live', { time: '10:13' }));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, ['guarded-live']);
            await page.evaluate(source => {
                document.querySelector('#chatView').classList.add('composer-focused');
                document.querySelector('#richInput').textContent = 'Fixture draft';
                new Function(`return (${source})`)()();
            }, mutate.toString());
            const after = await poll();
            assert.deepEqual(after.tracking.eligible, []);
            assert.ok(after.tracking.epoch > before.tracking.epoch);
            assert.equal(after.tracking.baselineMinute, MINUTE + 60000);
        });
        await test('Only proven appended incoming rows at or after baseline minute can qualify', async () => {
            await load(); await start(); await advance(1);
            await append(row('old', { time: '10:11' }) + row('start-minute', { time: '10:12' }) + row('live', { time: '10:13' }));
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, ['start-minute', 'live'], JSON.stringify(result));
            assert.ok(result.messages.find(message => message.id === 'live').createdMinute > MINUTE);
            assert.ok(result.messages.find(message => message.id === 'live').createdMinute <= result.capturedAt);
            assert.deepEqual((await poll()).tracking.eligible, ['start-minute', 'live']); // Parent must deduplicate.
        });
        await test('Clock-prefixed day labels allow proven start-minute appends', async () => {
            await load(row('baseline'), '02:00 Hôm nay'); await start(); await advance(1);
            await append(row('start-minute', { time: '10:12' }) + row('live', { time: '10:13' }));
            const result = await poll();
            assert.equal(result.tracking.baselineMinute, MINUTE);
            assert.equal(result.messages.find(message => message.id === 'start-minute').createdMinute, MINUTE);
            assert.deepEqual(result.tracking.eligible, ['start-minute', 'live']);
        });
        await test('Same-minute appends survive focus changes without admitting baseline, own, history or future rows', async () => {
            await load(row('baseline') + row('baseline-own', { own: true }));
            const baseline = await start();
            await append(row('same-minute') + row('same-own', { own: true }) + row('history', { time: '10:11' }) + row('future', { time: '10:13' }));
            await page.locator('.chat-item').first().evaluate(node => node.classList.add('focused'));
            const result = await poll();
            assert.equal(result.tracking.token, baseline.token);
            assert.equal(result.tracking.epoch, baseline.epoch);
            assert.equal(result.tracking.baselineMinute, MINUTE);
            assert.deepEqual(result.tracking.eligible, ['same-minute']);
            assert.deepEqual((await poll()).tracking.eligible, ['same-minute']);
        });
        await test('Same-minute overflow append requires completed bottom-follow', async () => {
            await load(Array.from({ length: 8 }, (_, i) => row(`baseline-${i}`)).join('')); await followBottom();
            const baseline = await start();
            await append(row('same-minute-follow', { body: '<div style="min-height:150px">Fixture incoming</div>' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
            await followBottom();
            const result = await poll();
            assert.equal(result.tracking.epoch, baseline.epoch);
            assert.equal(result.tracking.baselineMinute, MINUTE);
            assert.deepEqual(result.tracking.eligible, ['same-minute-follow']);
        });
        await test('Same-minute baseline skeleton hydration is never an append', async () => {
            await load('<div class="chat-item"></div>'); await start();
            await page.locator('.chat-item').evaluate((node, html) => {
                const template = document.createElement('template'); template.innerHTML = html;
                node.innerHTML = template.content.firstElementChild.innerHTML;
            }, row('baseline-hydrated'));
            assert.deepEqual((await poll()).tracking.eligible, []);
            await append(row('fresh-after-reset'));
            assert.deepEqual((await poll()).tracking.eligible, ['fresh-after-reset']);
        });
        await test('Same-minute appended skeleton can hydrate with fresh IDs', async () => {
            await load(); const baseline = await start();
            await append('<div class="chat-item"></div>'); await poll();
            await page.locator('.chat-item').last().evaluate((node, html) => {
                const template = document.createElement('template'); template.innerHTML = html;
                node.innerHTML = template.content.firstElementChild.innerHTML;
            }, row('fresh-hydrated'));
            const result = await poll();
            assert.equal(result.tracking.epoch, baseline.epoch);
            assert.deepEqual(result.tracking.eligible, ['fresh-hydrated']);
        });
        await test('Delayed history appended after startup remains ineligible', async () => {
            await load(); await start(); await advance(3);
            await append(row('delayed-history', { time: '10:11' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
        });
        await test('Own, undated and future rows never qualify', async () => {
            await load(); await start(); await advance(1);
            await append(row('own', { own: true, time: '10:13' }) + row('undated', { time: null }) + row('future', { time: '10:14' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
        });
        await test('Append of a new dated block is tracked', async () => {
            await load(); await start(); await advance(1);
            await page.locator('.message-view__scroll__inner').evaluate((inner, html) => inner.insertAdjacentHTML('beforeend', html), block(row('new-block', { time: '10:13' })));
            assert.deepEqual((await poll()).tracking.eligible, ['new-block']);
        });
        await test('A new preceding date separator may accompany an appended row', async () => {
            await load(); await start(); await advance(1);
            await append(date('Hôm nay') + row('new-date', { time: '10:13' }));
            assert.deepEqual((await poll()).tracking.eligible, ['new-date']);
        });

        for (const [name, mutation] of [
            ['history prepend', (html) => document.querySelector('.chat-date').insertAdjacentHTML('afterend', html)],
            ['row removal', () => document.querySelector('.chat-item').remove()],
            ['row replacement', () => { const row = document.querySelector('.chat-item'); row.replaceWith(row.cloneNode(true)); }],
            ['same-node removal/reinsertion', () => { const row = document.querySelector('.chat-item'); const parent = row.parentElement; const next = row.nextSibling; row.remove(); parent.insertBefore(row, next); }],
            ['date change', () => { document.querySelector('.chat-date .content').textContent = 'Hôm qua'; }],
            ['qid mutation', () => document.querySelector('.message-frame').setAttribute('data-qid', 'changed')],
            ['original chat ID mutation', () => { document.querySelector('.chat-message').id = 'changed-chat'; }],

        ]) await test(`Rebaseline after ${name}`, async () => {
            await load(); await start(); await advance(1); await append(row('live', { time: '10:13' }));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, ['live']);
            await page.evaluate(mutation, row('prepended', { time: '10:13' }));
            const after = await poll();
            assert.deepEqual(after.tracking.eligible, []);
            assert.ok(after.tracking.epoch > before.tracking.epoch);
            assert.equal(after.tracking.baselineMinute, MINUTE + 60000);
        });
        await test('History viewport must be at bottom before and after append', async () => {
            await load(Array.from({ length: 15 }, (_, i) => row(`history-${i}`)).join(''));
            await start(); assert.equal((await read()).atBottom, false);
            await advance(1); await append(row('away-from-bottom', { time: '10:13' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
            await page.locator('.transform-gpu').evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
            const bottom = await poll(); assert.equal(bottom.atBottom, true); assert.deepEqual(bottom.tracking.eligible, []);
        });
        await test('Unfollowed tail growth stays ineligible and times out to a safe new baseline', async () => {
            await load(); await start(); await advance(1);
            await append(Array.from({ length: 12 }, (_, i) => row(`large-${i}`, { time: '10:13' })).join(''));
            const pending = await poll();
            assert.equal(pending.atBottom, false); assert.deepEqual(pending.tracking.eligible, []);
            assert.equal(pending.tracking.pendingTailFollow, true); assert.equal(pending.tracking.epoch, 0);
            await page.waitForTimeout(1650);
            const expired = await poll();
            assert.equal(expired.tracking.pendingTailFollow, false); assert.deepEqual(expired.tracking.eligible, []);
            assert.equal(expired.tracking.resetReason, 'tail-follow-timeout');
            assert.equal(expired.tracking.resetCounts['tail-follow-timeout'], 1);
            assert.equal(expired.tracking.baselineMinute, MINUTE + 60000);
            await followBottom(); assert.deepEqual((await poll()).tracking.eligible, []);
        });
        for (const [name, mutation] of [
            ['inner replacement', () => { const node = document.querySelector('.message-view__scroll__inner'); node.replaceWith(node.cloneNode(true)); }],
            ['root replacement', () => { const node = document.querySelector('#chatView'); node.replaceWith(node.cloneNode(true)); }],
            ['root detach/reinsert', () => { const node = document.querySelector('#chatView'); node.remove(); document.body.append(node); }],
            ['composer ancestor replacement', () => { const node = document.querySelector('.chat-box-input'); node.replaceWith(node.cloneNode(true)); }],
            ['editor replacement', () => { const node = document.querySelector('#richInput'); node.replaceWith(node.cloneNode(true)); }],
            ['editor detach/reinsert', () => { const node = document.querySelector('#richInput'); node.remove(); document.querySelector('#chatView').append(node); }],
            ['editor trailer change', () => document.querySelector('#richInput').setAttribute('data-trailer', 'Another fixture contact')],
        ]) await test(`New tracking token after ${name}`, async () => {
            await load(); const before = await start(); await advance(1); await append(row('live', { time: '10:13' }));
            await poll();
            await page.evaluate(source => {
                document.querySelector('#chatView').classList.add('composer-focused');
                document.querySelector('.chat-box-input').classList.toggle('highlight-v3');
                const editor = document.querySelector('#richInput');
                editor.setAttribute('contenteditable', 'false'); editor.setAttribute('contenteditable', 'true');
                editor.textContent = 'Fixture draft';
                new Function(`return (${source})`)()();
            }, mutation.toString());
            const after = await poll();
            assert.notEqual(after.tracking.token, before.token);
            assert.deepEqual(after.tracking.eligible, []);
            assert.equal(after.rootKey, 'chatView'); // Same root key cannot prove same contact.
        });
        await test('Staged candidate children, identifiers, text and time complete without rebaselining', async () => {
            await load(); await start(); await advance(1);
            await append('<div class="chat-item"></div>');
            const pending = await poll();
            assert.deepEqual(pending.tracking.eligible, []);
            const complete = async () => {
                const result = await poll();
                assert.equal(result.tracking.epoch, pending.tracking.epoch);
                assert.equal(result.tracking.baselineMinute, MINUTE);
                return result;
            };
            await page.locator('.chat-item').last().evaluate((node, html) => {
                const template = document.createElement('template'); template.innerHTML = html;
                const content = template.content.firstElementChild;
                content.querySelector('.message-frame').removeAttribute('id');
                content.querySelector('.chat-message').removeAttribute('id');
                node.innerHTML = content.innerHTML;
            }, row('staged', { qid: null, body: '', time: null }));
            assert.deepEqual((await complete()).tracking.eligible, []);
            await page.locator('.chat-message').last().evaluate(node => { node.id = 'chat-staged'; });
            assert.deepEqual((await complete()).tracking.eligible, []);
            await page.locator('.message-frame').last().evaluate(node => { node.id = 'frame-staged'; });
            assert.deepEqual((await complete()).tracking.eligible, []);
            await page.locator('.message-frame').last().evaluate(node => node.setAttribute('data-qid', 'staged'));
            assert.deepEqual((await complete()).tracking.eligible, []);
            await page.locator('.message-action').last().evaluate(node => { node.textContent = 'Staged fixture message'; });
            assert.deepEqual((await complete()).tracking.eligible, []);
            await page.locator('.message-action').last().evaluate(node => node.insertAdjacentHTML('afterend', '<div class="card-send-time">10:13</div>'));
            const ready = await complete();
            assert.deepEqual(ready.tracking.eligible, ['staged']);
            assert.equal(ready.messages.find(message => message.id === 'staged').createdMinute, MINUTE + 60000);
            await page.locator('.message-action').last().evaluate(node => { node.firstChild.data = 'Updated candidate fixture'; });
            const edited = await complete();
            assert.deepEqual(edited.tracking.eligible, ['staged']);
            assert.equal(edited.messages.find(message => message.id === 'staged').text, 'Updated candidate fixture');
            const parentSeen = new Set();
            const delivered = [];
            for (const result of [pending, ready, edited, await complete()]) for (const id of result.tracking.eligible) {
                if (!parentSeen.has(id)) { parentSeen.add(id); delivered.push(id); }
            }
            assert.deepEqual(delivered, ['staged']); // Parent source-ID deduplication remains required.
        });
        await test('Late qid hydration qualifies only an appended candidate', async () => {
            await load(); await start(); await advance(1);
            await append(row('late-id', { qid: null, time: '10:13' }));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, []);
            await page.locator('.message-frame').last().evaluate(node => node.setAttribute('data-qid', 'late-id'));
            const after = await poll();
            assert.deepEqual(after.tracking.eligible, ['late-id']);
            assert.equal(after.tracking.epoch, before.tracking.epoch);
        });
        await test('Staged candidate still requires positive incoming direction', async () => {
            await load(); await start(); await advance(1);
            await append(row('direction', { time: '10:13' }).replace('floating-menu-wrapper--other', 'fixture-no-direction'));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, []);
            await page.locator('.floating-menu-wrapper').last().evaluate(node => node.classList.add('floating-menu-wrapper--other'));
            const after = await poll();
            assert.deepEqual(after.tracking.eligible, ['direction']);
            assert.equal(after.tracking.epoch, before.tracking.epoch);
        });
        await test('True baseline text/time edits never create candidates', async () => {
            await load(row('old', { time: '10:11' })); await start(); await advance(1);
            await page.locator('.message-action').evaluate(node => { node.textContent = 'Edited baseline fixture'; });
            const textEdit = await poll();
            assert.deepEqual(textEdit.tracking.eligible, []);
            assert.equal(textEdit.tracking.baselineMinute, MINUTE + 60000);
            await advance(2);
            await page.locator('.card-send-time').evaluate(node => { node.firstChild.data = '10:14'; });
            const timeEdit = await poll();
            assert.deepEqual(timeEdit.tracking.eligible, []);
            assert.ok(timeEdit.tracking.epoch > textEdit.tracking.epoch);
            await advance(3);
            assert.deepEqual((await poll()).tracking.eligible, []);
        });
        await test('A skeleton present at baseline cannot hydrate into an eligible message', async () => {
            await load('<div class="chat-item"></div>'); await start(); await advance(1);
            await page.locator('.chat-item').evaluate((node, html) => {
                const template = document.createElement('template'); template.innerHTML = html;
                node.innerHTML = template.content.firstElementChild.innerHTML;
            }, row('old-skeleton', { time: '10:13' }));
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, []);
            assert.ok(result.tracking.epoch > 0);
        });
        await test('Historical timestamp stays ineligible through candidate completion and text edits', async () => {
            await load(); await start(); await advance(1);
            await append(row('old-candidate', { qid: null, body: '', time: '10:11' }));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, []);
            await page.locator('.message-frame').last().evaluate(node => node.setAttribute('data-qid', 'old-candidate'));
            await page.locator('.message-action').last().evaluate(node => { node.textContent = 'Completed historical fixture'; });
            const after = await poll();
            assert.equal(after.tracking.epoch, before.tracking.epoch);
            assert.equal(after.messages.find(message => message.id === 'old-candidate').createdMinute, MINUTE - 60000);
            assert.deepEqual(after.tracking.eligible, []);
            await page.locator('.card-send-time').last().evaluate(node => { node.textContent = '10:13'; });
            const changedClock = await poll();
            assert.deepEqual(changedClock.tracking.eligible, []);
            assert.ok(changedClock.tracking.epoch > before.tracking.epoch);
        });
        for (const selector of ['.chat-item', '.chat-message', '.message-frame']) {
            await test(`Candidate replacement with identical IDs rebaselines: ${selector}`, async () => {
                await load(); await start(); await advance(1); await append(row('replaced', { time: '10:13' }));
                const before = await poll(); assert.deepEqual(before.tracking.eligible, ['replaced']);
                await page.locator(selector).last().evaluate(node => node.replaceWith(node.cloneNode(true)));
                const after = await poll();
                assert.deepEqual(after.tracking.eligible, []);
                assert.ok(after.tracking.epoch > before.tracking.epoch);
            });
        }
        for (const [selector, attribute] of [['.message-frame', 'data-qid'], ['.message-frame', 'id'], ['.chat-message', 'id']]) {
            await test(`Candidate valid identity cannot change: ${selector} ${attribute}`, async () => {
                await load(); await start(); await advance(1); await append(row('identity', { time: '10:13' }));
                const before = await poll(); assert.deepEqual(before.tracking.eligible, ['identity']);
                await page.locator(selector).last().evaluate((node, attribute) => node.setAttribute(attribute, 'changed-fixture'), attribute);
                const after = await poll();
                assert.deepEqual(after.tracking.eligible, []);
                assert.ok(after.tracking.epoch > before.tracking.epoch);
            });
        }
        await test('Changing and restoring candidate ID in the same React commit still resets', async () => {
            await load(); await start(); await advance(1); await append(row('identity', { time: '10:13' }));
            const before = await poll();
            await page.locator('.message-frame').last().evaluate(node => {
                const original = node.getAttribute('data-qid');
                node.setAttribute('data-qid', 'temporary-fixture'); node.setAttribute('data-qid', original);
            });
            const after = await poll(); assert.deepEqual(after.tracking.eligible, []);
            assert.ok(after.tracking.epoch > before.tracking.epoch);
        });
        await test('An appended candidate cannot claim a baseline identifier', async () => {
            await load(); await start(); await advance(1);
            await append(row('duplicate', { qid: null, time: '10:13' }));
            const before = await start();
            await page.locator('.message-frame').last().evaluate(node => node.setAttribute('data-qid', 'baseline'));
            const after = await start(); assert.ok(after.epoch > before.epoch);
            assert.equal((await read()).supported, false); // Duplicate IDs still fail the snapshot.
        });
        for (const characterData of [false, true]) for (const sameBatch of [false, true]) {
            await test(`Old outbound receipt preserves same-minute arrival (${characterData ? 'characterData' : 'textContent'}, ${sameBatch ? 'same batch' : 'later batch'})`, async () => {
                await load(row('old-own', { own: true, time: '10:11' }));
                const baseline = await start();
                if (!sameBatch) {
                    await append(row('receipt-live'));
                    assert.deepEqual((await poll()).tracking.eligible, ['receipt-live']);
                }
                await page.evaluate(({ html, sameBatch, characterData }) => {
                    if (sameBatch) document.querySelector('.block-date').insertAdjacentHTML('beforeend', html);
                    const time = document.querySelector('.card-send-time');
                    if (characterData) time.firstChild.data = '10:11 Đã nhận';
                    else time.textContent = '10:11 Đã nhận';
                    document.querySelector('.chat-item').classList.add('focused');
                }, { html: row('receipt-live'), sameBatch, characterData });
                for (const status of ['Đã xem', 'Đã gửi']) {
                    const result = await poll();
                    assert.equal(result.tracking.token, baseline.token);
                    assert.equal(result.tracking.epoch, baseline.epoch);
                    assert.equal(result.tracking.baselineMinute, MINUTE);
                    assert.deepEqual(result.tracking.resetCounts, {});
                    assert.deepEqual(result.tracking.eligible, ['receipt-live']);
                    await page.locator('.card-send-time').first().evaluate((node, status) => {
                        node.firstChild.data = status + ' 10:11';
                    }, status);
                }
                assert.deepEqual((await poll()).tracking.eligible, ['receipt-live']);
            });
        }
        for (const [name, mutate] of [
            ['actual clock', () => { document.querySelector('.card-send-time').textContent = '10:12 Đã nhận'; }],
            ['unknown receipt text', () => { document.querySelector('.card-send-time').textContent = '10:11 Unknown fixture'; }],
            ['payload text', () => { document.querySelector('.message-action').textContent = 'Changed outbound payload'; }],
            ['frame ID', () => { document.querySelector('.message-frame').id = 'changed-old-frame'; }],
            ['qid', () => document.querySelector('.message-frame').setAttribute('data-qid', 'changed-old-qid')],
            ['direction', () => document.querySelector('.chat-item').classList.remove('me')],
            ['receipt attribute', () => document.querySelector('.card-send-time').setAttribute('data-unknown', 'fixture')],
            ['receipt markup', () => { document.querySelector('.card-send-time').innerHTML = '<span>10:11 Đã xem</span>'; }],
            ['time node replacement', () => { const node = document.querySelector('.card-send-time'); node.replaceWith(node.cloneNode(true)); }],
            ['frame replacement', () => { const node = document.querySelector('.message-frame'); node.replaceWith(node.cloneNode(true)); }],
            ['clock changed and restored', () => {
                const node = document.querySelector('.card-send-time');
                node.firstChild.data = '10:12 Đã nhận'; node.firstChild.data = '10:11 Đã nhận';
            }],
        ]) await test(`Old outbound receipt cannot mask changed ${name}`, async () => {
            await load(row('old-own', { own: true, time: '10:11' })); await start();
            await append(row('receipt-live'));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, ['receipt-live']);
            await page.evaluate(source => {
                document.querySelector('.card-send-time').textContent = '10:11 Đã nhận';
                document.querySelector('.chat-item').classList.add('focused');
                new Function(`return (${source})`)()();
            }, mutate.toString());
            const after = await poll();
            assert.ok(after.tracking.epoch > before.tracking.epoch);
            assert.deepEqual(after.tracking.eligible, []);
        });
        await test('Old inbound time labels do not receive the outbound receipt exception', async () => {
            await load(row('old-inbound', { time: '10:11' })); await start();
            await append(row('receipt-live'));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, ['receipt-live']);
            await page.locator('.card-send-time').first().evaluate(node => { node.textContent = '10:11 Đã nhận'; });
            const after = await poll();
            assert.equal(after.tracking.resetReason, 'baseline-mutation');
            assert.ok(after.tracking.epoch > before.tracking.epoch);
            assert.deepEqual(after.tracking.eligible, []);
        });
        await test('Candidate send-status updates preserve the pinned clock', async () => {
            await load(); await start(); await advance(1); await append(row('status', { time: '10:13' }));
            const before = await poll();
            await page.locator('.card-send-time').last().evaluate(node => { node.textContent = '10:13 Đã xem'; });
            const after = await poll();
            assert.equal(after.tracking.epoch, before.tracking.epoch);
            assert.deepEqual(after.tracking.eligible, ['status']);
        });
        for (const mode of ['remove', 'class', 'display', 'visibility']) {
            await test(`Repeated last-time-only grouping preserves baseline and candidate proofs: ${mode}`, async () => {
                await load(groupedRow('group-baseline', { time: '10:11' }));
                const baseline = await start();
                for (let i = 0; i < 8; i++) {
                    await groupAppend(groupedRow(`group-${i}`), mode);
                    const pending = await poll();
                    if (pending.tracking.pendingTailFollow) await followBottom();
                    const result = await poll();
                    assert.equal(result.tracking.token, baseline.token);
                    assert.equal(result.tracking.epoch, baseline.epoch);
                    assert.equal(result.tracking.baselineMinute, MINUTE);
                    assert.deepEqual(result.tracking.resetCounts, {});
                    assert.equal(result.tracking.candidateCount, i + 1);
                    assert.deepEqual(result.tracking.eligible, Array.from({ length: i + 1 }, (_, j) => `group-${j}`));
                    assert.ok(result.messages.filter(message => message.id !== 'group-baseline').every(message => message.createdMinute === MINUTE));
                    assert.ok(!result.tracking.eligible.includes('group-baseline'));
                    assert.equal(await page.locator('.card-send-time:visible').count(), 1);
                }
                await advance(2);
                const later = await poll();
                assert.equal(later.tracking.epoch, baseline.epoch);
                assert.ok(later.messages.filter(message => message.id !== 'group-baseline').every(message => message.createdMinute === MINUTE));
            });
        }
        await test('Removing only send-time class can suppress the prior tail via existing CSS', async () => {
            await load(groupedRow('class-baseline'));
            await page.evaluate(() => document.styleSheets[0].insertRule('.chat-message:not(.-send-time) .card-send-time { display:none }', 0));
            await start();
            for (let i = 0; i < 2; i++) {
                await page.evaluate(html => {
                    document.querySelector('.chat-item:last-child .chat-message').classList.remove('-send-time');
                    document.querySelector('.block-date').insertAdjacentHTML('beforeend', html);
                }, groupedRow(`class-live-${i}`));
                const result = await poll();
                assert.equal(result.tracking.epoch, 0);
                assert.deepEqual(result.tracking.eligible, Array.from({ length: i + 1 }, (_, j) => `class-live-${j}`));
                assert.equal(await page.locator('.card-send-time:visible').count(), 1);
            }
        });
        await test('Grouped candidate minutes remain distinct across a minute boundary and focus changes', async () => {
            await load(''); await start(); await append(groupedRow('earlier')); await poll();
            await advance(1);
            await groupAppend(groupedRow('later', { time: '10:13' }), 'remove', tail => {
                tail.classList.add('focused');
                tail.querySelector('.chat-message').classList.add('hovered');
            });
            const result = await poll();
            assert.equal(result.tracking.epoch, 0);
            assert.deepEqual(result.tracking.eligible, ['earlier', 'later']);
            assert.deepEqual(result.messages.map(message => message.createdMinute), [MINUTE, MINUTE + 60000]);
        });
        await test('Historical candidate retains its original minute through proven grouping', async () => {
            await load(''); await start();
            await append(groupedRow('group-history', { time: '10:11' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
            await groupAppend(groupedRow('group-live'));
            const result = await poll();
            assert.equal(result.tracking.epoch, 0);
            assert.deepEqual(result.tracking.eligible, ['group-live']);
            assert.equal(result.messages.find(message => message.id === 'group-history').createdMinute, MINUTE - 60000);
        });
        await test('Grouping cannot supply a minute before the candidate own time was read', async () => {
            await load(); await start();
            await append(groupedRow('unread'));
            await start(); // Observer clock proof exists, but no timestamp snapshot yet.
            await groupAppend(groupedRow('readable'));
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, ['readable']);
            assert.equal(result.messages.find(message => message.id === 'unread').createdMinute, null);
        });
        for (const time of [null, '24:00', 'Unknown time', '10:12 10:11']) {
            await test(`Version classes cannot manufacture a message clock: ${time}`, async () => {
                await load(''); await start();
                await append(groupedRow('no-time-proof', { time }));
                const result = await poll();
                assert.deepEqual(result.tracking.eligible, []);
                assert.equal(result.messages[0].createdMinute, null);
                await advance(2);
                assert.equal((await poll()).messages[0].createdMinute, null);
            });
        }
        await test('Duplicate own clocks remain unknown despite version classes and time separator', async () => {
            await load(''); await start();
            await append(date('10:12') + groupedRow('duplicate-time').replace('<div class="card-send-time">10:12</div>',
                '<div class="card-send-time">10:12</div><div class="card-send-time">10:11</div>'));
            const result = await poll();
            assert.equal(result.messages[0].createdMinute, null);
            assert.deepEqual(result.tracking.eligible, []);
        });
        await test('Invalid own clock is not rescued by a time-only separator', async () => {
            await load(date('10:12') + groupedRow('invalid-time', { time: '24:00' }));
            assert.equal((await read()).messages[0].createdMinute, null);
        });
        await test('Unrelated inbound or outbound neighbors cannot supply a missing clock', async () => {
            for (const own of [false, true]) {
                await load(row('neighbor', { own })); await start();
                await append(groupedRow('clockless', { time: null }));
                const result = await poll();
                assert.equal(result.messages.find(message => message.id === 'clockless').createdMinute, null);
                assert.deepEqual(result.tracking.eligible, []);
            }
        });
        await test('Stylesheet-only hiding cannot promote historical candidate time', async () => {
            await load(''); await start();
            await append(groupedRow('css-history', { time: '10:11' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
            await page.evaluate(() => document.styleSheets[0].insertRule('#chat-css-history .card-send-time { display:none }', 0));
            const result = await poll();
            assert.deepEqual(result.tracking.eligible, []);
            assert.equal(result.messages[0].createdMinute, null);
        });
        for (const baselineTail of [false, true]) for (const mode of ['remove', 'class', 'display', 'visibility']) {
            await test(`Suppression without append fails closed (${baselineTail ? 'baseline' : 'candidate'}, ${mode})`, async () => {
                await load(baselineTail ? groupedRow('alone') : ''); await start();
                if (!baselineTail) { await append(groupedRow('alone')); assert.deepEqual((await poll()).tracking.eligible, ['alone']); }
                await groupAppend('', mode);
                const result = await poll();
                assert.ok(result.tracking.epoch > 0);
                assert.deepEqual(result.tracking.eligible, []);
            });
        }
        for (const [name, mutate] of [
            ['payload', tail => { tail.querySelector('.message-action').textContent = 'Changed fixture'; }],
            ['payload restored', tail => { const node = tail.querySelector('.message-action span').firstChild; const old = node.data; node.data = 'Transient'; node.data = old; }],
            ['payload replacement', tail => { const node = tail.querySelector('.message-action'); node.replaceWith(node.cloneNode(true)); }],
            ['direction', tail => tail.classList.add('me')],
            ['qid', tail => tail.querySelector('.message-frame').setAttribute('data-qid', 'changed-group-id')],
            ['frame ID', tail => { tail.querySelector('.message-frame').id = 'changed-group-frame'; }],
            ['chat ID', tail => { tail.querySelector('.chat-message').id = 'changed-group-chat'; }],
            ['clock', (tail, time) => { time.firstChild.data = '10:13'; }],
            ['clock restored', (tail, time) => { time.firstChild.data = '10:13'; time.firstChild.data = '10:12'; }],
            ['time attribute', (tail, time) => time.setAttribute('data-unknown', 'fixture')],
            ['unknown class', tail => tail.querySelector('.chat-message').classList.add('unknown-group-class')],
            ['unknown style', (tail, time) => { time.style.color = 'red'; }],
            ['frame replacement', tail => { const node = tail.querySelector('.message-frame'); node.replaceWith(node.cloneNode(true)); }],
        ]) for (const baselineTail of [false, true]) {
            await test(`Grouping cannot hide ${name} (${baselineTail ? 'baseline' : 'candidate'})`, async () => {
                await load(baselineTail ? groupedRow('tamper-tail') : ''); await start();
                if (!baselineTail) { await append(groupedRow('tamper-tail')); await poll(); }
                await groupAppend(groupedRow('tamper-next'), 'remove', mutate);
                const result = await poll();
                assert.ok(result.tracking.epoch > 0);
                assert.deepEqual(result.tracking.eligible, []);
            });
        }
        for (const options of [{ qid: null }, { own: true }, { time: null }, { time: '24:00' }, { time: '10:11' }]) {
            await test(`Grouping requires a fully proven incoming append: ${JSON.stringify(options)}`, async () => {
                await load(groupedRow('guarded-tail')); await start();
                await groupAppend(groupedRow('unproven-next', options));
                const result = await poll();
                assert.ok(result.tracking.epoch > 0);
                assert.deepEqual(result.tracking.eligible, []);
            });
        }
        await test('Suppressed candidate proof rejects later time or payload tampering', async () => {
            for (const tamper of ['time', 'payload']) {
                await load(''); await start(); await append(groupedRow('suppressed')); await poll();
                await groupAppend(groupedRow('following'), 'display');
                assert.deepEqual((await poll()).tracking.eligible, ['suppressed', 'following']);
                await page.locator('#chat-suppressed').evaluate((chat, tamper) => {
                    if (tamper === 'time') chat.querySelector('.card-send-time').textContent = '10:13';
                    else chat.querySelector('.message-action').textContent = 'Changed suppressed payload';
                }, tamper);
                const result = await poll();
                assert.ok(result.tracking.epoch > 0);
                assert.deepEqual(result.tracking.eligible, []);
            }
        });
        await test('Grouping overflow remains pending until native bottom-follow', async () => {
            await load(Array.from({ length: 8 }, (_, i) => groupedRow(`group-old-${i}`)).join(''));
            await followBottom(); const baseline = await start();
            await groupAppend(groupedRow('group-overflow', { body: '<div style="min-height:180px">Fixture incoming</div>' }));
            const pending = await poll();
            assert.equal(pending.tracking.epoch, baseline.epoch);
            assert.equal(pending.tracking.pendingTailFollow, true);
            assert.deepEqual(pending.tracking.eligible, []);
            await followBottom();
            assert.deepEqual((await poll()).tracking.eligible, ['group-overflow']);
        });
        await test('Grouping cannot hide a history prepend', async () => {
            await load(groupedRow('prepend-tail')); await start();
            await groupAppend(groupedRow('prepend-next'), 'remove', tail => {
                const historical = tail.cloneNode(true);
                historical.querySelector('.message-frame').setAttribute('data-qid', 'prepended');
                historical.querySelector('.message-frame').id = 'frame-prepended';
                historical.querySelector('.chat-message').id = 'chat-prepended';
                tail.parentElement.insertBefore(historical, tail);
            });
            const result = await poll();
            assert.equal(result.tracking.resetReason, 'history-reorder');
            assert.deepEqual(result.tracking.eligible, []);
        });
        await test('Grouping away from bottom does not rescue history', async () => {
            await load(Array.from({ length: 8 }, (_, i) => groupedRow(`away-${i}`)).join(''));
            await start();
            await groupAppend(groupedRow('away-next'));
            assert.deepEqual((await poll()).tracking.eligible, []);
        });
        await test('Candidate capacity overflow rebaselines instead of accumulating history', async () => {
            await load();
            await page.locator('.transform-gpu').evaluate(node => { node.style.height = '10000px'; });
            await start(); await advance(1);
            await append('<div class="chat-item"></div>'.repeat(64));
            const before = await poll();
            assert.equal(await page.evaluate(() => window.__tikoderLiveInboxTracker.candidates.size), 64);
            assert.equal(before.tracking.epoch, 0);
            await append('<div class="chat-item"></div>');
            const after = await poll();
            assert.ok(after.tracking.epoch > before.tracking.epoch);
            assert.deepEqual(after.tracking.eligible, []);
            assert.equal(await page.evaluate(() => window.__tikoderLiveInboxTracker.candidates.size), 0);
            await advance(2);
            await page.locator('.chat-item').last().evaluate((node, html) => {
                const template = document.createElement('template'); template.innerHTML = html;
                node.innerHTML = template.content.firstElementChild.innerHTML;
            }, row('overflow-baseline', { time: '10:14' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
        });
        await test('Relative labels cannot roll historical candidates into another local day', async () => {
            await load(); await start(); await advance(1); await append(row('old-day', { time: '10:11' }));
            const before = await poll(); assert.deepEqual(before.tracking.eligible, []);
            await advance(24 * 60 + 2);
            const after = await poll(); assert.deepEqual(after.tracking.eligible, []);
            assert.ok(after.tracking.epoch > before.tracking.epoch);
        });
        await test('Tracker is disposed when required structure disappears', async () => {
            await load(); await start();
            await page.locator('#richInput').evaluate(node => node.remove());
            assert.equal((await start()).supported, false);
            assert.equal((await read()).supported, false);
            assert.equal(await page.evaluate(() => '__tikoderLiveInboxTracker' in window), false);
        });
        await test('Transient rows and recycled IDs cannot survive removal', async () => {
            await load(); await start(); await advance(1);
            await page.evaluate(html => { const block = document.querySelector('.block-date'); block.insertAdjacentHTML('beforeend', html); block.lastElementChild.remove(); }, row('transient', { time: '10:13' }));
            assert.deepEqual((await poll()).tracking.eligible, []);
            await append(row('transient', { time: '10:13' }));
            assert.deepEqual((await poll()).tracking.eligible, []); // Removed source IDs are quarantined, not fresh append proof.
        });
        await test('Reset disposes only the independent live tracker', async () => {
            await load(); const before = await start();
            await page.evaluate(() => { window.__tikoderInboxTracker = { fixture: true }; });
            assert.equal(await page.evaluate(resetLiveInboxTracker), true);
            assert.equal(await page.evaluate(resetLiveInboxTracker), false);
            assert.equal((await read()).tracking, null);
            assert.equal(await page.evaluate(() => window.__tikoderInboxTracker.fixture), true);
            assert.notEqual((await start()).token, before.token);
        });
        assert.deepEqual(requests, [], 'Fixtures must not make network requests');
        assert.deepEqual(failures, [], 'No uncaught browser errors');
        console.log(`Passed ${passed} offline Edge fixture tests. No Zalo account, profile or sends used.`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
