const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'data', 'zalo-auto-reply');
const RULES = ['phone', 'qr'];
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const MESSAGE_ID = new RegExp('^zar_' + UUID + '$');
const EVENT_ID = new RegExp('^' + UUID + '$');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Expected an object');
    if (Object.keys(value).some(key => !keys.includes(key))) fail('Unknown field');
}
function string(value, max, empty = false) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('Invalid text');
    const result = value.trim().normalize('NFC');
    if (!empty && !result) fail('Text is required');
    return result;
}
function uidValue(uid) {
    if (typeof uid !== 'string' || !uid || uid.length > 128 || /[\s\u0000-\u001f\u007f]/.test(uid)) fail('Invalid uid');
    return uid;
}
function sourceId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value)) fail('Invalid source or conversation identifier');
    return value;
}
function messageId(value) { if (typeof value !== 'string' || !MESSAGE_ID.test(value)) fail('Invalid message identifier'); return value; }
function phoneValue(value, empty = false) {
    if (typeof value !== 'string' || value.length > 40) fail('Invalid phone');
    let phone = value.replace(/[\s().-]/g, '');
    if (!phone && empty) return '';
    phone = phone.replace(/^(?:\+84|0084|84)/, '0');
    if (!/^0[35789]\d{8}$/.test(phone)) fail('Invalid Vietnamese phone');
    return phone;
}
function allowed(value) {
    if (!Array.isArray(value)) fail('allowedPhones must be an array');
    return value.map(phone => phoneValue(phone));
}
function folded(value) { return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim(); }
function matches(text, trigger) {
    const escaped = folded(trigger).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])', 'u').test(folded(text));
}
function candidates(settings, text) { return RULES.filter(key => settings.rules[key].enabled && settings.rules[key].triggers.some(trigger => matches(text, trigger))); }
function defaults() {
    return { enabled: false, cooldownSeconds: 300, target: { phone: '', name: '' }, rules: {
        phone: { enabled: false, triggers: ['sdt', 'sđt', 'số điện thoại', 'hotline'], text: '' },
        qr: { enabled: false, triggers: ['qr', 'mã qr', 'qr code', 'quét mã'], caption: '', image: null },
        custom: []
    } };
}
function imageValue(input) {
    object(input, ['filename', 'mime', 'sha256']);
    if (typeof input.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(?:png|jpg|jpeg|webp)$/.test(input.filename)) fail('Invalid stored image filename');
    const extension = input.filename.split('.').pop();
    if (input.mime !== ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[extension]) fail('Invalid image MIME type');
    if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) fail('Invalid image SHA-256');
    return { filename: input.filename, mime: input.mime, sha256: input.sha256 };
}
function validateSettings(settings, phones) {
    if (typeof settings.enabled !== 'boolean' || !Number.isInteger(settings.cooldownSeconds) || settings.cooldownSeconds < 30 || settings.cooldownSeconds > 86400) fail('Invalid enabled flag or cooldown');
    settings.target.phone = phoneValue(settings.target.phone, true);
    settings.target.name = string(settings.target.name, 100, true);
    if (settings.enabled && (!settings.target.name || !phones.includes(settings.target.phone))) fail('Enabled target requires a name and an allowlisted phone');
    const hasActiveCustom = Array.isArray(settings.rules.custom) && settings.rules.custom.some(r => r.enabled === true);
    if (settings.enabled && !hasActiveCustom && !RULES.some(key => settings.rules[key].enabled === true)) fail('Hãy bật ít nhất một quy tắc (SĐT, QR hoặc tùy chỉnh) trước khi bật trả lời tự động');
    for (const key of RULES) {
        const rule = settings.rules[key];
        if (typeof rule.enabled !== 'boolean' || !Array.isArray(rule.triggers) || rule.triggers.length > 30 || (rule.enabled && !rule.triggers.length)) fail('Invalid rule');
        rule.triggers = rule.triggers.map(trigger => { const text = string(trigger, 100); if (!folded(text)) fail('Empty normalized trigger'); return text; });
        if (new Set(rule.triggers).size !== rule.triggers.length) fail('Duplicate triggers');
        if (key === 'phone') rule.text = string(rule.text, 4000, !rule.enabled);
        else {
            rule.caption = string(rule.caption, 1000, true);
            if (rule.image !== null) rule.image = imageValue(rule.image);
            if (rule.enabled && !rule.image) fail('QR rule requires a stored image');
        }
    }
    if (settings.rules.custom !== undefined) {
        if (!Array.isArray(settings.rules.custom) || settings.rules.custom.length > 50) fail('Invalid custom rules');
        settings.rules.custom = settings.rules.custom.map(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Invalid custom rule item');
            const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) ? item.id : 'c_' + crypto.randomUUID().slice(0, 8);
            const name = string(item.name || 'Mẫu tùy chỉnh', 100, true);
            const enabled = typeof item.enabled === 'boolean' ? item.enabled : false;
            if (!Array.isArray(item.triggers) || item.triggers.length > 30 || (enabled && !item.triggers.length)) fail('Invalid custom triggers');
            const triggers = item.triggers.map(t => { const s = string(t, 100); if (!folded(s)) fail('Empty normalized trigger'); return s; });
            const text = string(item.text || '', 4000, !enabled);
            return { id, name, enabled, triggers, text };
        });
    } else {
        settings.rules.custom = [];
    }
}

// All operations are synchronous: one process owns each root. No browser or network actions occur here.
function createStore({ root = ROOT, now = Date.now, onError = message => console.error(message) } = {}) {
    if (typeof root !== 'string' || !root || typeof now !== 'function' || typeof onError !== 'function') fail('Invalid store options');
    function reportError() {
        // Never forward filesystem/parser errors: they can contain paths or private JSON content.
        try { Promise.resolve(onError('Zalo auto-reply store: unable to process tenant data.')).catch(() => {}); }
        catch (_) { /* Diagnostics must not interrupt other tenants. */ }
    }
    function validateData(data, uid) {
        if (!data || data.createdBy !== uid || !Number.isSafeInteger(data.settingsRevision) || data.settingsRevision < 0 || !data.settings || !Array.isArray(data.messages)) fail('Invalid tenant data', 500);
        const statuses = ['queued', 'pending', 'cooldown', 'sending', 'needs_check', 'sent', 'skipped', 'dispatch_failed'];
        for (const message of data.messages) {
            if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.id !== 'string' || !MESSAGE_ID.test(message.id) || typeof message.eventId !== 'string' || !EVENT_ID.test(message.eventId) || message.tenantId !== hash(uid) || !statuses.includes(message.status)) fail('Invalid tenant message data', 500);
        }
        return data;
    }
    function time() { const value = new Date(now()); if (!Number.isFinite(value.getTime())) fail('Invalid clock'); return value.toISOString(); }
    function file(uid) { return path.join(root, hash(uidValue(uid)) + '.json'); }
    function load(uid) {
        const target = file(uid);
        if (!fs.existsSync(target)) return { createdBy: uid, settingsRevision: 0, settings: defaults(), messages: [] };
        return validateData(JSON.parse(fs.readFileSync(target, 'utf8')), uid);
    }
    function write(uid, data) {
        const target = file(uid);
        fs.mkdirSync(root, { recursive: true });
        const tmp = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
        try {
            fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            fs.renameSync(tmp, target);
        } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    }
    function get(data, id) { messageId(id); const message = data.messages.find(item => item.id === id); if (!message) fail('Message not found', 404); return message; }
    function bump(data) { if (data.settingsRevision >= Number.MAX_SAFE_INTEGER) fail('Revision exhausted', 409); data.settingsRevision++; }
    function forEachTenant(visit) {
        if (!fs.existsSync(root)) return;
        let names;
        try { names = fs.readdirSync(root).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
        catch (_) { reportError(); return; }
        for (const name of names) {
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
                const uid = uidValue(raw && raw.createdBy);
                if (hash(uid) + '.json' !== name) fail('Tenant hash mismatch', 500);
                visit(uid, validateData(raw, uid));
            } catch (_) { reportError(); }
        }
    }
    function read(uid) { const data = load(uid); return { settings: data.settings, messages: data.messages }; }
    function readIntegration(uid) { const data = load(uid); return { settings: clone(data.settings), settingsRevision: data.settingsRevision }; }
    // Partial settings updates are supported, but images and arbitrary patches are not.
    function saveSettings(uid, input, allowedPhones) {
        object(input, ['enabled', 'cooldownSeconds', 'target', 'rules']);
        const data = load(uid), settings = clone(data.settings);
        for (const key of ['enabled', 'cooldownSeconds']) if (Object.hasOwn(input, key)) settings[key] = input[key];
        if (Object.hasOwn(input, 'target')) { object(input.target, ['phone', 'name']); Object.assign(settings.target, input.target); }
        if (Object.hasOwn(input, 'rules')) {
            object(input.rules, [...RULES, 'custom']);
            for (const key of RULES) if (Object.hasOwn(input.rules, key)) {
                object(input.rules[key], key === 'phone' ? ['enabled', 'triggers', 'text'] : ['enabled', 'triggers', 'caption']);
                Object.assign(settings.rules[key], input.rules[key]);
            }
            if (Object.hasOwn(input.rules, 'custom')) {
                settings.rules.custom = input.rules.custom;
            }
        }
        validateSettings(settings, allowed(allowedPhones));
        data.settings = settings; bump(data);
        const updatedAt = time();
        for (const message of data.messages) if (message.status === 'queued' && message.settingsRevision !== data.settingsRevision) {
            message.status = 'pending'; message.reason = 'configuration_changed'; message.updatedAt = updatedAt; message.nextDispatchAt = null;
        }
        write(uid, data); return clone(settings);
    }
    function setImage(uid, metadata) {
        const image = imageValue(metadata), data = load(uid);
        data.settings.rules.qr.image = image; bump(data); write(uid, data); return clone(image);
    }
    function targetValid(settings, phones, target) {
        return settings.enabled && phones.includes(settings.target.phone) && !!settings.target.name && target.phone === settings.target.phone && target.name === settings.target.name;
    }
    function validateCurrent(data, message, allowedPhones) {
        if (!['queued', 'sending'].includes(message.status)) fail('Message is not queued or sending', 409);
        if (message.settingsRevision !== data.settingsRevision || !targetValid(data.settings, allowed(allowedPhones), message.target)) fail('Configuration changed or target disabled', 409);
    }
    // Re-read persisted configuration for inspect and immediately before a browser send.
    function assertCurrent(uid, id, allowedPhones) {
        const data = load(uid);
        validateCurrent(data, get(data, id), allowedPhones);
        return true;
    }
    function hold(uid, id, reason) {
        const data = load(uid), message = get(data, id);
        if (message.status !== 'queued') fail('Message is not queued', 409);
        message.reason = string(reason, 500); message.status = 'pending'; message.updatedAt = time(); message.nextDispatchAt = null;
        write(uid, data); return clone(message);
    }
    // The trusted adapter must supply incoming private messages only, never group messages or outgoing echoes.
    function ingest(uid, input, allowedPhones) {
        object(input, ['sourceMessageId', 'conversationKey', 'text', 'phone', 'name']);
        const sourceMessageId = sourceId(input.sourceMessageId), conversationKey = sourceId(input.conversationKey);
        const text = string(input.text, 4000, true), target = { phone: phoneValue(input.phone), name: string(input.name, 100) };
        const phones = allowed(allowedPhones), data = load(uid);
        const duplicate = data.messages.find(item => item.sourceMessageId === sourceMessageId && item.conversationKey === conversationKey);
        if (duplicate) return clone(duplicate);
        if (!targetValid(data.settings, phones, target)) return null;
        const keys = candidates(data.settings, text), receivedAt = time();
        const message = {
            id: 'zar_' + crypto.randomUUID(), eventId: crypto.randomUUID(), tenantId: hash(uid),
            sourceMessageId, conversationKey, text, receivedAt, status: keys.length === 1 ? 'queued' : 'pending',
            reason: keys.length === 1 ? '' : keys.length ? 'ambiguous_rules' : 'no_matching_rule',
            candidates: keys, settingsRevision: data.settingsRevision, target,
            dispatchAttempts: 0, lastDispatchAt: null, nextDispatchAt: null, dispatchError: ''
        };
        data.messages.push(message); write(uid, data); return clone(message);
    }
    function claim(uid, id, ruleKey, allowedPhones) {
        const data = load(uid), message = get(data, id), settings = data.settings;
        if (!RULES.includes(ruleKey)) fail('Invalid rule key');
        if (message.status !== 'queued') fail('Message is not queued', 409);
        validateCurrent(data, message, allowedPhones);
        validateSettings(settings, allowed(allowedPhones));
        const keys = candidates(settings, message.text);
        if (keys.length !== 1 || keys[0] !== ruleKey || message.candidates.length !== 1 || message.candidates[0] !== ruleKey) fail('An exact single rule match is required', 409);
        if (data.messages.some(item => item.id !== id && item.conversationKey === message.conversationKey && item.status === 'sending')) fail('Conversation already has a send in progress', 409);
        const startedAt = time(), timestamp = Date.parse(startedAt);
        const previous = data.messages.filter(item => item.id !== id && item.target.phone === message.target.phone && item.ruleKey === ruleKey && ['sending', 'needs_check', 'sent'].includes(item.status));
        if (previous.some(item => timestamp - Date.parse(item.startedAt) < settings.cooldownSeconds * 1000)) {
            message.status = 'cooldown'; message.reason = 'cooldown'; message.updatedAt = startedAt;
            write(uid, data); fail('Target rule is in cooldown', 409);
        }
        message.status = 'sending'; message.reason = ''; message.ruleKey = ruleKey; message.startedAt = startedAt; message.updatedAt = startedAt;
        write(uid, data);
        return { message: clone(message), rule: clone(settings.rules[ruleKey]), target: clone(settings.target) };
    }
    function finish(uid, id, reason = '', outcome = 'needs_check') {
        if (!['sent', 'needs_check'].includes(outcome)) fail('Invalid send outcome');
        const data = load(uid), message = get(data, id);
        if (message.status !== 'sending') fail('Message is not sending', 409);
        message.reason = string(reason, 500, true); message.status = outcome; message.updatedAt = time();
        if (outcome === 'sent') message.confirmedAt = message.updatedAt;
        write(uid, data); return clone(message);
    }
    function resolve(uid, id, action) {
        const data = load(uid), message = get(data, id);
        if (!(message.status === 'needs_check' && ['sent', 'skipped'].includes(action)) && !(action === 'skipped' && ['pending', 'queued', 'dispatch_failed'].includes(message.status))) fail('Invalid resolution', 409);
        message.status = action; message.updatedAt = time(); message.resolvedAt = message.updatedAt;
        write(uid, data); return clone(message);
    }
    function findEvent(tenantId, eventId, id) {
        if (typeof tenantId !== 'string' || !/^[a-f0-9]{64}$/.test(tenantId) || typeof eventId !== 'string' || !EVENT_ID.test(eventId)) fail('Invalid event identifiers');
        messageId(id);
        const target = path.join(root, tenantId + '.json');
        if (!fs.existsSync(target)) fail('Event not found', 404);
        const raw = JSON.parse(fs.readFileSync(target, 'utf8')), uid = uidValue(raw.createdBy);
        if (hash(uid) !== tenantId) fail('Event not found', 404);
        const data = load(uid), message = data.messages.find(item => item.id === id && item.eventId === eventId && item.tenantId === tenantId);
        if (!message) fail('Event not found', 404);
        return { uid, message: clone(message) };
    }
    // These envelopes are safe for n8n: no uid, target, conversation ID, or message content.
    function pendingDispatch() {
        const result = [], timestamp = Date.parse(time());
        forEachTenant((uid, data) => {
            for (const message of data.messages) {
                if (message.status !== 'queued' || (message.nextDispatchAt && Date.parse(message.nextDispatchAt) > timestamp)) continue;
                result.push({ eventId: message.eventId, eventType: 'zalo.auto_reply_requested', occurredAt: message.receivedAt, tenantId: hash(uid), messageId: message.id });
            }
        });
        return result;
    }
    // One call records one transport attempt; success never means a browser send succeeded.
    function markDispatch(uid, id, metadata = {}) {
        object(metadata, ['error']);
        const error = Object.hasOwn(metadata, 'error') ? string(metadata.error, 500, true) : '';
        const data = load(uid), message = get(data, id);
        if (message.status !== 'queued') return clone(message);
        message.dispatchAttempts++; message.lastDispatchAt = time(); message.dispatchError = error;
        if (message.dispatchAttempts >= 5) { message.status = 'dispatch_failed'; message.reason = 'dispatch_attempts_exhausted'; message.nextDispatchAt = null; }
        else message.nextDispatchAt = new Date(Date.parse(message.lastDispatchAt) + 30000 * message.dispatchAttempts).toISOString();
        write(uid, data); return clone(message);
    }
    function recover() {
        let count = 0;
        forEachTenant((uid, data) => {
            let recovered = 0;
            for (const message of data.messages) if (message.status === 'sending') {
                message.status = 'needs_check'; message.reason = 'recovered_after_restart'; message.updatedAt = time(); recovered++;
            }
            if (recovered) { write(uid, data); count += recovered; }
        });
        return count;
    }
    return { read, readIntegration, saveSettings, setImage, ingest, assertCurrent, hold, claim, finish, resolve, findEvent, pendingDispatch, markDispatch, recover };
}

module.exports = { createStore, ...createStore() };
