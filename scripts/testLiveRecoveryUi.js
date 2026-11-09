'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

function harness() {
    const handlers = new Map(), sent = [], dialogs = [], storage = new Map();
    let confirmAnswer = false;
    const make = tag => ({ tag, children: [], style: {}, value: '', disabled: false,
        setAttribute(key, value) { this[key] = value; },
        appendChild(child) { this.children.push(child); if (tag === 'select' && !this.value && !child.disabled) this.value = child.value; },
        append(...children) { this.children.push(...children); },
        close() { this.closed = true; }, remove() { this.removed = true; }, showModal() { this.open = true; }
    });
    const context = vm.createContext({
        Object, JSON, console,
        document: { getElementById: id => dialogs.find(d => d.id === id && !d.removed), createElement: make, body: { appendChild(dialog) { dialogs.push(dialog); } } },
        socket: { on(event, handler) { handlers.set(event, handler); }, emit(event, payload) { sent.push({ event, payload }); }, timeout() { return { emit(event, payload, callback) { sent.push({ event, payload, callback }); } }; } },
        sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        clearLiveRequest() {}, beginLiveRequest() {}, formatVnTimestamp: value => value,
        tiktokIdInput: { value: 'shop' }, currentLiveSessionId: 'session', currentLiveSegmentStartedAt: 'segment-start',
        getScopedStorageKey: key => 'user-a:' + key, newOrderRequestId: () => 'request-one', alert() {},
        confirm: () => confirmAnswer
    });
    vm.runInContext(source.slice(source.indexOf("        socket.on('recovery-options'"), source.indexOf("        socket.on('ask-resume-session'")), context);
    const begin = source.indexOf('        function readPendingLiveMutations()');
    vm.runInContext(source.slice(begin, source.indexOf('        function refreshConfirmButtons()', begin)), context);
    return { context, handlers, sent, dialogs, storage, setConfirm: answer => { confirmAnswer = answer; } };
}

const candidates = { sessions: [{ id: 'old-one', liveName: 'Older live', broadcasterId: 'shop', stale: true, lastActivityAt: '2020-01-01T00:00:00Z' }, { id: 'old-two', liveName: 'Second live', broadcasterId: 'other', stale: false, startedAt: '2026-11-04T00:00:00Z' }] };
test('recovery dialog waits for explicit selection; cancel does not start or close a live', () => {
    const h = harness();
    h.handlers.get('recovery-options')(candidates);
    const dialog = h.dialogs[0];
    assert.equal(dialog.open, true);
    assert.equal(h.sent.length, 0);
    dialog.children.find(c => c.textContent === 'Để sau').onclick();
    assert.equal(dialog.removed, true);
    assert.equal(h.sent.length, 0);
    h.handlers.get('recovery-options')(candidates);
    const selected = h.dialogs[1];
    selected.children.find(c => c.tag === 'select').value = 'old-two';
    selected.children.find(c => c.textContent === 'Tiếp tục phiên đã chọn').onclick();
    assert.equal(h.sent[0].event, 'start-live');
    assert.equal(h.sent[0].payload.resumeSessionId, 'old-two');
    assert.equal(h.sent[0].payload.uniqueId, 'other');
    assert.equal(h.sent[0].payload.recoveryConfirmed, true);
});

test('close-and-create names all affected sessions and requires an explicit confirmation', () => {
    const h = harness(); h.handlers.get('recovery-options')(candidates);
    const button = h.dialogs[0].children.find(c => c.textContent === 'Đóng tất cả phiên trên, tạo phiên mới');
    button.onclick(); assert.equal(h.sent.length, 0);
    h.setConfirm(true); button.onclick();
    assert.equal(h.sent.length, 1);
    assert.deepEqual(Array.from(h.sent[0].payload.closeSessionIds), ['old-one', 'old-two']);
    assert.equal(h.sent[0].payload.resumeSessionId, null);
});

test('timeout retry preserves the original request ID, session and payload, including after reconnect', () => {
    const h = harness();
    h.context.sendLiveMutation('confirm-item', { requestId: 'original', price: 100 });
    const original = h.sent[0].payload;
    h.sent[0].callback(new Error('lost ACK'));
    h.context.currentLiveSessionId = 'different-session';
    h.context.sendLiveMutation('confirm-item', { requestId: 'original', price: 200 });
    assert.equal(h.sent[1].payload.price, 100);
    assert.equal(h.sent[1].payload.sessionId, 'session');
    assert.equal(h.sent[1].payload.requestId, original.requestId);
    h.setConfirm(true); h.handlers.get('connect')();
    assert.equal(h.sent[2].payload.price, 100);
    h.sent[2].callback(null, { ok: true, duplicate: true });
    assert.equal(Object.keys(h.context.readPendingLiveMutations()).length, 0);
});

test('close-selected sends only the chosen ID and visible broadcaster, and blocks double submit until ACK', () => {
    const h = harness(); h.handlers.get('recovery-options')({ ...candidates, offerId: 'offer-one' });
    const dialog = h.dialogs[0];
    const select = dialog.children.find(c => c.tag === 'select'); select.value = 'old-two'; select.onchange();
    const target = dialog.children.find(c => c.tag === 'input'); assert.equal(target.value, 'other'); target.value = 'explicit-new-host';
    const button = dialog.children.find(c => c.textContent === 'Đóng phiên đã chọn, tạo mới');
    button.onclick(); assert.equal(h.sent.length, 0);
    h.setConfirm(true); button.onclick(); button.onclick();
    assert.equal(h.sent.length, 1);
    assert.deepEqual(Array.from(h.sent[0].payload.closeSessionIds), ['old-two']);
    assert.equal(h.sent[0].payload.uniqueId, 'explicit-new-host');
    assert.equal(h.sent[0].payload.recoveryOfferId, 'offer-one');
    assert.ok(h.sent[0].payload.requestId);
    assert.equal(dialog.removed, undefined);
    h.sent[0].callback(null, { ok: true }); assert.equal(dialog.removed, true);
});

test('ambiguous session stays selectable for close but cannot resume; timeout retry preserves request', () => {
    const h = harness(); h.handlers.get('recovery-options')({ offerId: 'ambiguous-offer', sessions: [{ ...candidates.sessions[0], ambiguous: true }] });
    const dialog = h.dialogs[0], select = dialog.children.find(c => c.tag === 'select');
    assert.equal(select.children[0].disabled, false);
    assert.equal(dialog.children.find(c => c.textContent === 'Tiếp tục phiên đã chọn').disabled, true);
    h.setConfirm(true); dialog.children.find(c => c.textContent === 'Đóng phiên đã chọn, tạo mới').onclick();
    let prevented = false;
    dialog.oncancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(dialog.removed, undefined); assert.equal(h.sent.length, 1);
    const original = JSON.stringify(h.sent[0].payload);
    h.sent[0].callback(new Error('lost ACK'));
    dialog.children.find(c => c.textContent === 'Thử lại yêu cầu').onclick();
    assert.equal(JSON.stringify(h.sent[1].payload), original);
    h.sent[1].callback(null, { ok: false, error: 'stale', reloadRecovery: true });
    const reload = dialog.children.find(c => c.textContent === 'Tải lại lựa chọn'); assert.equal(reload.disabled, false); reload.onclick();
    assert.equal(h.sent.at(-1).event, 'get-recovery-options');
    assert.equal(dialog.removed, true);
});
