const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const exported = require('../utils/zaloAutoReplyStore');
const { createStore } = exported;

const UID = 'test-tenant-a';
const PHONES = ['0900000000'];
const IMAGE = { filename: 'qr_test.png', mime: 'image/png', sha256: 'a'.repeat(64) };
const hash = uid => crypto.createHash('sha256').update(uid).digest('hex');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-auto-reply-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let clock = Date.parse('2026-01-01T00:00:00.000Z');
    const now = () => clock;
    return { root, now, store: createStore({ root, now }), advance: ms => { clock += ms; } };
}
function enable(store, uid = UID, extra = {}) {
    return store.saveSettings(uid, {
        enabled: true, target: { phone: '+84 900 000 000', name: 'Khách thử' },
        rules: { phone: { enabled: true, text: 'Số liên hệ riêng: 0900000000' } }, ...extra
    }, PHONES);
}
function incoming(store, id = 'source-1', extra = {}, uid = UID) {
    return store.ingest(uid, { sourceMessageId: id, conversationKey: 'private-1', text: 'Cho xin SỐ ĐIỆN THOẠI?', phone: '0900000000', name: 'Khách thử', ...extra }, PHONES);
}
function status(code) { return error => error.status === code; }

test('exports factory and default methods; fresh reads are disabled, independent, and do not write', t => {
    const { store, root } = fixture(t);
    for (const method of ['read', 'saveSettings', 'setImage', 'ingest', 'assertCurrent', 'hold', 'claim', 'finish', 'resolve', 'findEvent', 'pendingDispatch', 'markDispatch', 'recover']) assert.equal(typeof exported[method], 'function');
    assert.deepEqual(store.read(UID), { settings: { enabled: false, cooldownSeconds: 300, target: { phone: '', name: '' }, rules: {
        phone: { enabled: false, triggers: ['sdt', 'sđt', 'số điện thoại', 'hotline'], text: '' },
        qr: { enabled: false, triggers: ['qr', 'mã qr', 'qr code', 'quét mã'], caption: '', image: null },
        custom: []
    } }, messages: [] });
    store.read(UID).settings.enabled = true;
    assert.equal(store.read(UID).settings.enabled, false);
    assert.equal(incoming(store), null);
    assert.deepEqual(fs.readdirSync(root), []);
});

test('strict settings validation is atomic and normalizes an allowlisted VN target', t => {
    const { store } = fixture(t);
    const settings = enable(store);
    assert.equal(settings.target.phone, PHONES[0]);
    for (const patch of [
        { enabled: 'true' }, { cooldownSeconds: 29 }, { cooldownSeconds: 86401 }, { cooldownSeconds: '300' }, { cooldownSeconds: 30.5 },
        { target: { phone: '0911111111' } }, { target: { name: ' ' } }, { target: { group: true } },
        { rules: { phone: { enabled: false } } },
        { rules: { phone: { text: '' } } }, { rules: { phone: { triggers: [] } } },
                { rules: { phone: { triggers: ['\u0301'] } } },
        { rules: { phone: { triggers: ['x'.repeat(101)] } } }, { rules: { phone: { triggers: ['sdt', 'sdt'] } } },
        { rules: { qr: { enabled: true } } }, { rules: { qr: { image: IMAGE } } },
        { rules: { injected: {} } }, { messages: [] }, { settingsRevision: 999 }
    ]) {
        assert.throws(() => store.saveSettings(UID, patch, PHONES), status(400));
        assert.deepEqual(store.read(UID).settings, settings);
    }
    assert.throws(() => store.saveSettings(UID, {}, []), status(400));
    assert.throws(() => store.saveSettings(UID, {}, '0900000000'), status(400));
    assert.equal(store.saveSettings(UID, { cooldownSeconds: 30 }, ['+84900000000']).cooldownSeconds, 30);
    assert.equal(store.saveSettings(UID, { cooldownSeconds: 86400 }, PHONES).cooldownSeconds, 86400);
    assert.equal(store.saveSettings('disabled-tenant', { target: { phone: '0911111111' } }, []).enabled, false);
});

test('failed atomic rename leaves persisted state unchanged and removes temporary files', t => {
    const { store, root } = fixture(t);
    enable(store);
    const message = incoming(store), before = store.read(UID);
    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('Simulated rename failure'); };
    try {
        assert.throws(() => store.claim(UID, message.id, 'phone', PHONES), /Simulated rename failure/);
    } finally { fs.renameSync = originalRename; }
    assert.deepEqual(store.read(UID), before);
    assert.equal(fs.readdirSync(root).filter(name => name.endsWith('.tmp')).length, 0);
    assert.equal(store.claim(UID, message.id, 'phone', PHONES).message.status, 'sending');
});

test('trusted image metadata is constrained, preserved, and revisioned', t => {
    const { store } = fixture(t);
    enable(store);
    for (const image of [
        null, { ...IMAGE, filename: '../qr.png' }, { ...IMAGE, filename: 'https://host/qr.png' },
        { ...IMAGE, filename: 'qr.svg' }, { ...IMAGE, mime: 'text/html' }, { ...IMAGE, sha256: 'bad' },
        { ...IMAGE, path: '/etc/passwd' }, { ...IMAGE, filename: 'qr.jpg' }
    ]) assert.throws(() => store.setImage(UID, image), status(400));
    const message = incoming(store);
    assert.deepEqual(store.setImage(UID, IMAGE), IMAGE);
    assert.throws(() => store.claim(UID, message.id, 'phone', PHONES), status(409));
    store.saveSettings(UID, { rules: { qr: { enabled: true, caption: 'Quét mã để thanh toán' } } }, PHONES);
    assert.deepEqual(store.read(UID).settings.rules.qr.image, IMAGE);
    const qr = incoming(store, 'qr-1', { text: 'MÃ QR?' });
    const claimed = store.claim(UID, qr.id, 'qr', PHONES);
    assert.deepEqual(claimed.rule.image, IMAGE);
    assert.equal(claimed.message.settingsRevision, message.settingsRevision + 2);
});

test('incoming identity must exactly match enabled target and current allowlist', t => {
    const { store } = fixture(t);
    enable(store);
    assert.equal(incoming(store, 'wrong-phone', { phone: '0911111111' }), null);
    assert.equal(incoming(store, 'wrong-name', { name: 'Khách khác' }), null);
    assert.equal(incoming(store, 'wrong-case', { name: 'khách thử' }), null);
    assert.equal(store.ingest(UID, { sourceMessageId: 'removed', conversationKey: 'private-1', text: 'sdt', phone: PHONES[0], name: 'Khách thử' }, []), null);
    store.saveSettings(UID, { enabled: false }, []);
    assert.equal(incoming(store), null);
    assert.deepEqual(store.read(UID).messages, []);
});

test('accent/case folding and phrase boundaries avoid substring and regex matches', t => {
    const { store } = fixture(t);
    enable(store);
    for (const [i, text] of ['SĐT?', 'Xin SO DIEN THOAI!', 'hotline', '(sdt)', 'số   điện\nthoại'].entries()) assert.equal(incoming(store, 'match-' + i, { text }).status, 'queued');
    for (const [i, text] of ['xsdt', 'hotlines', 'sdt2', '_sdt_', 'αsdt', 'sdt中', 'không có yêu cầu'].entries()) assert.equal(incoming(store, 'miss-' + i, { text }).status, 'pending');
    store.saveSettings(UID, { rules: { phone: { triggers: ['a+b'] } } }, PHONES);
    assert.equal(incoming(store, 'literal', { text: 'a+b?' }).status, 'queued');
    assert.equal(incoming(store, 'regex', { text: 'aaab' }).status, 'pending');
});

test('ambiguous or unmatched messages cannot be claimed or manually requeued', t => {
    const { store } = fixture(t);
    store.setImage(UID, IMAGE);
    enable(store, UID, { rules: { phone: { enabled: true, text: 'Liên hệ shop' }, qr: { enabled: true } } });
    const ambiguous = incoming(store, 'ambiguous', { text: 'Xin sđt và mã QR' });
    assert.equal(ambiguous.status, 'pending');
    assert.deepEqual(ambiguous.candidates, ['phone', 'qr']);
    assert.equal(ambiguous.reason, 'ambiguous_rules');
    const unmatched = incoming(store, 'unmatched', { text: 'Chào shop' });
    assert.deepEqual(unmatched.candidates, []);
    for (const message of [ambiguous, unmatched]) {
        assert.throws(() => store.claim(UID, message.id, 'phone', PHONES), status(409));
        assert.throws(() => store.resolve(UID, message.id, 'sent'), status(409));
        assert.equal(store.resolve(UID, message.id, 'skipped').status, 'skipped');
    }
    assert.deepEqual(store.pendingDispatch(), []);
});

test('dedup is persisted by conversation plus source ID, never creates a replay event', t => {
    const f = fixture(t), { store } = f;
    enable(store);
    const first = incoming(store);
    const restarted = createStore({ root: f.root, now: f.now });
    assert.deepEqual(incoming(restarted, 'source-1', { text: 'changed replay' }), first);
    store.saveSettings(UID, { enabled: false }, PHONES);
    const paused = store.read(UID).messages[0];
    assert.equal(paused.status, 'pending');
    assert.equal(paused.reason, 'configuration_changed');
    assert.deepEqual(incoming(restarted), paused);
    enable(store);
    const other = incoming(store, 'source-1', { conversationKey: 'private-2' });
    assert.notEqual(other.id, first.id);
    assert.equal(store.read(UID).messages.length, 2);
    assert.equal(store.pendingDispatch().length, 1);
});

test('assertCurrent guards queued inspection and sending even after pause and identical re-enable', t => {
    const f = fixture(t), { store } = f;
    const original = enable(store);
    const sending = incoming(store), queued = incoming(store, 'queued');
    assert.equal(store.assertCurrent(UID, queued.id, PHONES), true);
    assert.throws(() => store.assertCurrent(UID, queued.id, []), status(409));
    store.claim(UID, sending.id, 'phone', PHONES);
    assert.equal(store.assertCurrent(UID, sending.id, PHONES), true);
    const beforePause = store.read(UID);
    store.saveSettings(UID, { enabled: false }, []);
    assert.throws(() => store.assertCurrent(UID, queued.id, PHONES), status(409));
    assert.throws(() => store.assertCurrent(UID, sending.id, PHONES), status(409));
    const paused = store.read(UID);
    assert.deepEqual(paused.messages.find(m => m.id === sending.id), beforePause.messages.find(m => m.id === sending.id));
    assert.equal(paused.messages.find(m => m.id === queued.id).status, 'pending');
    assert.equal(paused.messages.find(m => m.id === queued.id).reason, 'configuration_changed');
    store.saveSettings(UID, { enabled: true }, PHONES);
    assert.deepEqual(store.read(UID).settings, original);
    const restarted = createStore({ root: f.root, now: f.now });
    assert.throws(() => restarted.assertCurrent(UID, sending.id, PHONES), status(409));
    assert.throws(() => restarted.assertCurrent(UID, queued.id, PHONES), status(409));
    assert.deepEqual(restarted.pendingDispatch(), []);
    const current = incoming(restarted, 'new-current', { conversationKey: 'private-2' });
    assert.equal(restarted.assertCurrent(UID, current.id, PHONES), true);
    restarted.finish(UID, sending.id);
    assert.throws(() => restarted.assertCurrent(UID, sending.id, PHONES), status(409));
    restarted.resolve(UID, sending.id, 'sent');
    assert.throws(() => restarted.assertCurrent(UID, sending.id, PHONES), status(409));
});

test('settings updates atomically hold old queued messages but preserve sending and existing holds', t => {
    const { store } = fixture(t);
    enable(store);
    const sending = incoming(store), queued = incoming(store, 'queued'), held = incoming(store, 'held');
    store.claim(UID, sending.id, 'phone', PHONES);
    store.markDispatch(UID, queued.id, { error: 'Transport failure' });
    store.hold(UID, held.id, 'unsupported');
    const before = store.read(UID);
    assert.throws(() => store.saveSettings(UID, { cooldownSeconds: 1 }, PHONES), status(400));
    assert.deepEqual(store.read(UID), before);
    store.saveSettings(UID, { rules: { phone: { text: 'Nội dung mới' } } }, PHONES);
    const after = store.read(UID);
    assert.deepEqual(Object.keys(after).sort(), ['messages', 'settings']);
    for (const id of [sending.id, held.id]) assert.deepEqual(after.messages.find(m => m.id === id), before.messages.find(m => m.id === id));
    const changed = after.messages.find(m => m.id === queued.id);
    assert.equal(changed.status, 'pending');
    assert.equal(changed.reason, 'configuration_changed');
    assert.equal(changed.nextDispatchAt, null);
    assert.equal(changed.settingsRevision, queued.settingsRevision);
    assert.equal(changed.dispatchAttempts, 1);
    assert.deepEqual(store.pendingDispatch(), []);
    assert.deepEqual(incoming(store, 'queued'), changed);
    assert.throws(() => store.assertCurrent(UID, sending.id, PHONES), status(409));
    assert.throws(() => store.claim(UID, queued.id, 'phone', PHONES), status(409));
});

test('hold persists unsupported QR as pending with no dispatch, claim, or replay retry', t => {
    const f = fixture(t), { store } = f;
    store.setImage(UID, IMAGE);
    enable(store, UID, { rules: { qr: { enabled: true } } });
    const qr = incoming(store, 'qr', { text: 'Mã QR' });
    store.markDispatch(UID, qr.id);
    const before = store.read(UID);
    for (const reason of ['', ' ', 'x'.repeat(501), {}, null, undefined]) {
        assert.throws(() => store.hold(UID, qr.id, reason), status(400));
        assert.deepEqual(store.read(UID), before);
    }
    const held = store.hold(UID, qr.id, '  qr_upload_unsupported  ');
    assert.equal(held.status, 'pending');
    assert.equal(held.reason, 'qr_upload_unsupported');
    assert.equal(held.nextDispatchAt, null);
    assert.equal(held.dispatchAttempts, 1);
    assert.deepEqual(held.candidates, ['qr']);
    assert.equal(held.settingsRevision, qr.settingsRevision);
    f.advance(86400000);
    const restarted = createStore({ root: f.root, now: f.now });
    assert.equal(restarted.recover(), 0);
    assert.deepEqual(restarted.pendingDispatch(), []);
    assert.deepEqual(incoming(restarted, 'qr', { text: 'QR replay' }), held);
    assert.deepEqual(restarted.markDispatch(UID, qr.id), held);
    assert.throws(() => restarted.assertCurrent(UID, qr.id, PHONES), status(409));
    assert.throws(() => restarted.claim(UID, qr.id, 'qr', PHONES), status(409));
    assert.throws(() => restarted.hold(UID, qr.id, 'again'), status(409));
    assert.throws(() => restarted.resolve(UID, qr.id, 'queued'), status(409));
    assert.equal(restarted.resolve(UID, qr.id, 'skipped').status, 'skipped');
    const fresh = incoming(restarted, 'fresh', { text: 'QR' });
    restarted.claim(UID, fresh.id, 'qr', PHONES);
    assert.throws(() => restarted.hold(UID, fresh.id, 'unsupported'), status(409));
});

test('settings changes, pause/resume, and allowlist removal invalidate claims', t => {
    const { store } = fixture(t);
    enable(store);
    const beforeEdit = incoming(store);
    store.saveSettings(UID, { rules: { phone: { text: 'Nội dung mới' } } }, PHONES);
    assert.throws(() => store.claim(UID, beforeEdit.id, 'phone', PHONES), status(409));
    const beforePause = incoming(store, 'before-pause');
    store.saveSettings(UID, { enabled: false }, PHONES);
    assert.throws(() => store.claim(UID, beforePause.id, 'phone', PHONES), status(409));
    store.saveSettings(UID, { enabled: true }, PHONES);
    assert.throws(() => store.claim(UID, beforePause.id, 'phone', PHONES), status(409));
    const current = incoming(store, 'current');
    assert.throws(() => store.claim(UID, current.id, 'phone', []), status(409));
    assert.throws(() => store.claim(UID, current.id, 'qr', PHONES), status(409));
    assert.equal(store.claim(UID, current.id, 'phone', PHONES).rule.text, 'Nội dung mới');
});

test('claim persists sending before action; uncertain finish requires manual verification', t => {
    const f = fixture(t), { store } = f;
    enable(store);
    const message = incoming(store);
    const result = store.claim(UID, message.id, 'phone', PHONES);
    assert.deepEqual(Object.keys(result).sort(), ['message', 'rule', 'target']);
    assert.equal(createStore({ root: f.root }).read(UID).messages[0].status, 'sending');
    result.target.name = 'Mutated'; result.rule.text = 'Mutated';
    assert.equal(store.read(UID).settings.target.name, 'Khách thử');
    assert.throws(() => store.claim(UID, message.id, 'phone', PHONES), status(409));
    assert.throws(() => store.resolve(UID, message.id, 'sent'), status(409));
    assert.throws(() => store.resolve(UID, message.id, 'skipped'), status(409));
    assert.equal(store.finish(UID, message.id, 'Browser result uncertain').status, 'needs_check');
    assert.throws(() => store.finish(UID, message.id), status(409));
    assert.throws(() => store.resolve(UID, message.id, 'queued'), status(409));
    assert.throws(() => store.claim(UID, message.id, 'phone', PHONES), status(409));
    assert.equal(store.resolve(UID, message.id, 'sent').status, 'sent');
    assert.throws(() => store.resolve(UID, message.id, 'skipped'), status(409));
    assert.deepEqual(store.pendingDispatch(), []);
});

test('confirmed finish persists sent, needs no manual resolution and keeps duplicate protection', t => {
    const f = fixture(t), { store, advance } = f;
    enable(store);
    const first = incoming(store, 'confirmed');
    store.claim(UID, first.id, 'phone', PHONES);
    assert.throws(() => store.finish(UID, first.id, '', 'accepted'));
    assert.equal(store.read(UID).messages[0].status, 'sending');
    const finished = store.finish(UID, first.id, '', 'sent');
    assert.equal(finished.status, 'sent');
    assert.equal(finished.confirmedAt, finished.updatedAt);
    assert.equal(createStore({ root: f.root }).read(UID).messages[0].status, 'sent');
    assert.throws(() => store.claim(UID, first.id, 'phone', PHONES), status(409));
    assert.throws(() => store.resolve(UID, first.id, 'sent'), status(409));
    advance(300000);
    const next = incoming(store, 'confirmed-next');
    assert.equal(store.claim(UID, next.id, 'phone', PHONES).message.status, 'sending');
});

test('cooldown starts on claim, spans conversations, persists 409 and expires at boundary', t => {
    const { store, advance } = fixture(t);
    enable(store);
    const first = incoming(store), pending = incoming(store, 'pending', { text: 'Chào' });
    assert.equal(pending.status, 'pending');
    store.claim(UID, first.id, 'phone', PHONES);
    const second = incoming(store, 'second', { conversationKey: 'private-2' });
    assert.throws(() => store.claim(UID, second.id, 'phone', PHONES), status(409));
    assert.equal(store.read(UID).messages.find(m => m.id === second.id).status, 'cooldown');
    store.finish(UID, first.id);
    const third = incoming(store, 'third', { conversationKey: 'private-3' });
    assert.throws(() => store.claim(UID, third.id, 'phone', PHONES), status(409));
    store.resolve(UID, first.id, 'sent');
    advance(299999);
    const fourth = incoming(store, 'fourth');
    assert.throws(() => store.claim(UID, fourth.id, 'phone', PHONES), status(409));
    advance(1);
    const fifth = incoming(store, 'fifth');
    assert.equal(store.claim(UID, fifth.id, 'phone', PHONES).message.status, 'sending');
    assert.throws(() => store.claim(UID, second.id, 'phone', PHONES), status(409));
});

test('pending and skipped do not consume cooldown; rules have independent cooldowns', t => {
    const { store } = fixture(t);
    store.setImage(UID, IMAGE);
    enable(store, UID, { rules: { phone: { enabled: true, text: 'Liên hệ' }, qr: { enabled: true } } });
    incoming(store, 'pending', { text: 'Hello' });
    const first = incoming(store);
    store.claim(UID, first.id, 'phone', PHONES);
    store.finish(UID, first.id);
    store.resolve(UID, first.id, 'skipped');
    const second = incoming(store, 'second');
    store.claim(UID, second.id, 'phone', PHONES);
    const qr = incoming(store, 'qr', { text: 'qr', conversationKey: 'private-2' });
    assert.equal(store.claim(UID, qr.id, 'qr', PHONES).message.ruleKey, 'qr');
});

test('sending blocks overlap but needs_check isolates the old event without blocking new requests', t => {
    const { store, advance } = fixture(t);
    store.setImage(UID, IMAGE);
    enable(store, UID, { rules: { phone: { enabled: true, text: 'Liên hệ' }, qr: { enabled: true } } });
    const first = incoming(store), qr = incoming(store, 'qr', { text: 'qr' });
    store.claim(UID, first.id, 'phone', PHONES);
    assert.throws(() => store.claim(UID, qr.id, 'qr', PHONES), status(409));
    store.finish(UID, first.id);
    assert.throws(() => store.claim(UID, first.id, 'phone', PHONES), status(409));
    assert.equal(store.claim(UID, qr.id, 'qr', PHONES).message.status, 'sending');
    store.finish(UID, qr.id, '', 'sent');
    const cooling = incoming(store, 'cooling');
    assert.throws(() => store.claim(UID, cooling.id, 'phone', PHONES), status(409));
    assert.equal(store.read(UID).messages.find(m => m.id === cooling.id).status, 'cooldown');
    advance(300000);
    const fresh = incoming(store, 'fresh');
    assert.equal(store.claim(UID, fresh.id, 'phone', PHONES).message.status, 'sending');
    assert.equal(store.read(UID).messages.find(m => m.id === first.id).status, 'needs_check');
    assert.throws(() => store.claim(UID, first.id, 'phone', PHONES), status(409));
});

test('event lookup and dispatch isolate tenants and exclude PII', t => {
    const { store } = fixture(t);
    enable(store); enable(store, 'test-tenant-b');
    const a = incoming(store), b = incoming(store, 'source-1', {}, 'test-tenant-b');
    assert.notEqual(a.id, b.id);
    assert.deepEqual(store.findEvent(a.tenantId, a.eventId, a.id), { uid: UID, message: a });
    assert.throws(() => store.findEvent(b.tenantId, a.eventId, a.id), status(404));
    assert.throws(() => store.findEvent(a.tenantId, b.eventId, a.id), status(404));
    assert.throws(() => store.claim('test-tenant-b', a.id, 'phone', PHONES), status(404));
    const events = store.pendingDispatch();
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { eventId: a.eventId, eventType: 'zalo.auto_reply_requested', occurredAt: a.receivedAt, tenantId: a.tenantId, messageId: a.id });
    assert.doesNotMatch(JSON.stringify(events), /0900000000|Khách|ĐIỆN|private-1|source-1|test-tenant/);
    store.claim(UID, a.id, 'phone', PHONES);
    assert.equal(store.claim('test-tenant-b', b.id, 'phone', PHONES).message.status, 'sending');
});

test('dispatch records only explicit attempts, backoff, maximum five, and stale callback no-op', t => {
    const { store, advance } = fixture(t);
    enable(store);
    const message = incoming(store);
    for (const metadata of [{ status: 'sent' }, { dispatchAttempts: 0 }, { nextDispatchAt: '2099' }, { error: 42 }]) assert.throws(() => store.markDispatch(UID, message.id, metadata), status(400));
    for (let i = 1; i <= 5; i++) {
        const updated = store.markDispatch(UID, message.id, { error: 'Transport failed' });
        assert.equal(updated.dispatchAttempts, i);
        assert.equal(updated.status, i === 5 ? 'dispatch_failed' : 'queued');
        assert.deepEqual(store.pendingDispatch(), []);
        if (i < 5) { advance(30000 * i); assert.equal(store.pendingDispatch().length, 1); }
    }
    assert.equal(store.markDispatch(UID, message.id).dispatchAttempts, 5);
    assert.throws(() => store.claim(UID, message.id, 'phone', PHONES), status(409));
    assert.equal(store.resolve(UID, message.id, 'skipped').status, 'skipped');
    const claimed = incoming(store, 'claimed');
    store.claim(UID, claimed.id, 'phone', PHONES);
    assert.equal(store.markDispatch(UID, claimed.id, { error: 'Late callback' }).dispatchAttempts, 0);
    assert.equal(store.read(UID).messages.find(m => m.id === claimed.id).status, 'sending');
});

test('explicit restart recovery persists needs_check, is idempotent, and never retries', t => {
    const f = fixture(t), { store } = f;
    enable(store);
    const message = incoming(store);
    store.claim(UID, message.id, 'phone', PHONES);
    const restarted = createStore({ root: f.root, now: f.now });
    assert.equal(restarted.read(UID).messages[0].status, 'sending');
    assert.equal(restarted.recover(), 1);
    assert.equal(restarted.recover(), 0);
    assert.equal(store.read(UID).messages[0].status, 'needs_check');
    assert.deepEqual(restarted.pendingDispatch(), []);
    assert.throws(() => restarted.claim(UID, message.id, 'phone', PHONES), status(409));
    assert.equal(incoming(restarted).id, message.id);
    assert.equal(restarted.resolve(UID, message.id, 'skipped').status, 'skipped');
    assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')).length, 0);
});

test('IDs, incoming text bounds, event traversal, corrupt ownership and JSON fail closed', t => {
    const f = fixture(t), { root } = f;
    const store = createStore({ root, now: f.now, onError: () => {} });
    enable(store);
    for (const field of ['sourceMessageId', 'conversationKey']) for (const value of ['', '../x', 'a/b', 'a\\b', 'x'.repeat(201), 123, 'id\n']) assert.throws(() => incoming(store, 'invalid', { [field]: value }), status(400));
    assert.throws(() => incoming(store, 'long', { text: 'a'.repeat(4001) }), status(400));
    assert.throws(() => incoming(store, 'type', { text: {} }), status(400));
    assert.throws(() => incoming(store, 'extra', { outgoing: true }), status(400));
    assert.equal(incoming(store, 'limit', { text: 'a'.repeat(4000) }).text.length, 4000);
    const message = incoming(store);
    for (const tenant of ['../outside', 'A'.repeat(64), '', null]) assert.throws(() => store.findEvent(tenant, message.eventId, message.id), status(400));
    assert.throws(() => store.findEvent(message.tenantId, '../x', message.id), status(400));
    assert.throws(() => store.findEvent(message.tenantId, message.eventId, '../x'), status(400));
    assert.throws(() => store.read({}), status(400));
    const filename = path.join(root, hash(UID) + '.json');
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    data.createdBy = 'wrong-owner'; fs.writeFileSync(filename, JSON.stringify(data));
    assert.throws(() => store.findEvent(message.tenantId, message.eventId, message.id), status(404));
    assert.throws(() => store.read(UID), status(500));
    assert.deepEqual(store.pendingDispatch(), []);
    fs.writeFileSync(filename, '{broken');
    assert.throws(() => store.read(UID), SyntaxError);
    assert.equal(store.recover(), 0);
    assert.throws(() => store.findEvent(message.tenantId, message.eventId, message.id), SyntaxError);
    assert.equal(fs.readFileSync(filename, 'utf8'), '{broken');
});

test('corrupt tenant files cannot block valid recovery or dispatch and remain untouched', t => {
    const f = fixture(t), errors = [];
    const store = createStore({ root: f.root, now: f.now, onError: (...args) => errors.push(args) });
    enable(store);
    enable(store, 'valid-dispatch-tenant');
    const sending = incoming(store), queued = incoming(store, 'queued', {}, 'valid-dispatch-tenant');
    store.claim(UID, sending.id, 'phone', PHONES);
    const corrupt = [];
    const mutations = [
        () => '{"private":"SECRET_PRIVATE_CONTENT",broken',
        () => 'null',
        data => { delete data.createdBy; return JSON.stringify(data); },
        data => { data.createdBy = { uid: 'SECRET_PRIVATE_CONTENT' }; return JSON.stringify(data); },
        data => { data.createdBy = 'another-private-owner'; return JSON.stringify(data); },
        data => { data.messages = {}; return JSON.stringify(data); },
        data => { data.messages = null; return JSON.stringify(data); },
        data => { data.messages.push(null); return JSON.stringify(data); },
        data => { data.messages.push('SECRET_PRIVATE_CONTENT'); return JSON.stringify(data); },
        data => { data.messages[0].tenantId = hash('another-private-owner'); return JSON.stringify(data); },
        data => { data.messages[0].eventId = 'SECRET_PRIVATE_CONTENT'; return JSON.stringify(data); }
    ];
    for (const [index, mutate] of mutations.entries()) {
        const uid = 'corrupt-private-tenant-' + index;
        enable(store, uid);
        const message = incoming(store, 'source-1', {}, uid);
        store.claim(uid, message.id, 'phone', PHONES);
        const filename = path.join(f.root, hash(uid) + '.json');
        const content = mutate(JSON.parse(fs.readFileSync(filename, 'utf8')));
        fs.writeFileSync(filename, content);
        corrupt.push({ uid, message, filename, content, mtime: fs.statSync(filename).mtimeMs });
    }
    const expected = [{ eventId: queued.eventId, eventType: 'zalo.auto_reply_requested', occurredAt: queued.receivedAt, tenantId: queued.tenantId, messageId: queued.id }];
    assert.deepEqual(store.pendingDispatch(), expected);
    assert.equal(store.recover(), 1);
    assert.equal(store.read(UID).messages[0].status, 'needs_check');
    assert.equal(store.recover(), 0);
    assert.deepEqual(store.pendingDispatch(), expected);
    assert.equal(errors.length, corrupt.length * 4);
    for (const args of errors) assert.deepEqual(args, ['Zalo auto-reply store: unable to process tenant data.']);
    for (const entry of corrupt) {
        assert.equal(fs.readFileSync(entry.filename, 'utf8'), entry.content);
        assert.equal(fs.statSync(entry.filename).mtimeMs, entry.mtime);
        assert.throws(() => store.read(entry.uid));
        assert.throws(() => store.findEvent(entry.message.tenantId, entry.message.eventId, entry.message.id));
    }
    assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')).length, 0);
});

test('throwing or rejecting onError callbacks cannot interrupt tenant scans', async t => {
    const f = fixture(t);
    enable(f.store);
    const sending = incoming(f.store), queued = incoming(f.store, 'queued');
    f.store.claim(UID, sending.id, 'phone', PHONES);
    const filename = path.join(f.root, hash('corrupt-private-owner') + '.json');
    const content = '{SECRET_PRIVATE_CONTENT';
    fs.writeFileSync(filename, content);
    let calls = 0;
    for (const onError of [
        () => { calls++; throw new Error('Reporter failed'); },
        async () => { calls++; throw new Error('Async reporter failed'); }
    ]) {
        const store = createStore({ root: f.root, now: f.now, onError });
        const expectedRecoveries = calls === 0 ? 1 : 0;
        assert.equal(store.recover(), expectedRecoveries);
        assert.deepEqual(store.pendingDispatch().map(event => event.messageId), [queued.id]);
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(calls, 4);
    assert.equal(f.store.read(UID).messages[0].status, 'needs_check');
    assert.equal(fs.readFileSync(filename, 'utf8'), content);
    assert.throws(() => createStore({ root: f.root, onError: null }), status(400));
});

test('default error reporting emits only a generic message without paths, uid, or JSON', t => {
    const { root, now } = fixture(t), calls = [];
    const filename = path.join(root, hash('secret-owner') + '.json');
    fs.writeFileSync(filename, '{SECRET_PRIVATE_CONTENT');
    const originalError = console.error;
    console.error = (...args) => calls.push(args);
    try {
        const store = createStore({ root, now });
        assert.equal(store.recover(), 0);
        assert.deepEqual(store.pendingDispatch(), []);
    } finally { console.error = originalError; }
    assert.deepEqual(calls, [
        ['Zalo auto-reply store: unable to process tenant data.'],
        ['Zalo auto-reply store: unable to process tenant data.']
    ]);
    assert.equal(fs.readFileSync(filename, 'utf8'), '{SECRET_PRIVATE_CONTENT');
});
