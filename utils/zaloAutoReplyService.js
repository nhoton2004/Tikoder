'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaultStore = require('./zaloAutoReplyStore');
const defaultAdapter = require('./zaloWebExperimental');
const { createRuntime, sanitize } = require('./zaloAutoReplyRuntime');
const { configuration, sign } = require('./n8nNotifications');
const MAX_AGE = 10 * 60 * 1000;
const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function isLocal(address) { return localAddresses.has(address); }
function createService({ store = defaultStore, adapter = defaultAdapter, env = process.env, fetcher = fetch, now = Date.now, imageRoot = path.join(__dirname, '..', 'data', 'zalo-auto-reply-images'), runtimeRoot = path.join(path.dirname(imageRoot), 'zalo-auto-reply-runtime') } = {}) {
    const jobs = new Set(), sessions = new Map(), snapshots = new Map();
    const runtime = createRuntime({ root: runtimeRoot, now });
    let draining = false, halted = false;
    let timer;
    const snapshot = uid => snapshots.get(uid) || runtime.read(uid);
    function record(uid, patch) {
        const safe = sanitize({ ...snapshot(uid), ...patch, updatedAt: now() });
        try { snapshots.set(uid, runtime.write(uid, safe)); }
        catch (_) {
            snapshots.set(uid, { ...safe, phase: 'needs_check', reasonCode: 'runtime_write_failed' });
            console.error('Không thể lưu trạng thái Zalo tự động; cần kiểm tra dữ liệu runtime.');
        }
    }
    function recordConnection(uid, patch) {
        const previous = snapshot(uid);
        if (['needs_check', 'dispatching'].includes(previous.phase) && ['connecting', 'waiting_zalo', 'monitoring'].includes(patch.phase)) {
            patch = { ...patch, phase: previous.phase, reasonCode: previous.reasonCode };
        }
        record(uid, patch);
    }
    function phones() { return String(env.ZALO_TEST_PHONES || '').split(',').map(x => x.trim()).filter(Boolean); }
    function experiment() { if (env.ZALO_WEB_EXPERIMENTAL !== 'true') fail('Chưa bật chế độ Zalo Web thử nghiệm trên máy này', 403); }
    function config() {
        const url = env.N8N_AUTO_REPLY_WEBHOOK_URL || new URL('/webhook/tikoder/zalo-auto-reply', env.N8N_WEBHOOK_URL || 'http://127.0.0.1:5678').toString();
        return configuration({ ...env, NOTIFY_ENABLED: 'true', N8N_WEBHOOK_URL: url });
    }
    function state(uid) {
        const data = store.read(uid);
        return { settings: data.settings, messages: data.messages.slice(-200).reverse(), connection: { ...adapter.getWatchStatus(uid), runtime: sanitize(snapshot(uid)) } };
    }
    // Integration consumers receive configuration only. Inbox records, target identity, and uid stay private to Tikoder.
    function integrationData(uid) {
        const { settings, settingsRevision } = store.readIntegration(uid);
        return {
            enabled: settings.enabled,
            revision: settingsRevision,
            phone: {
                enabled: settings.rules.phone.enabled,
                triggers: [...settings.rules.phone.triggers],
                text: settings.rules.phone.text,
            },
            qr: {
                enabled: settings.rules.qr.enabled,
                triggers: [...settings.rules.qr.triggers],
                caption: settings.rules.qr.caption,
                image: settings.rules.qr.image ? { ...settings.rules.qr.image } : null,
            },
            custom: Array.isArray(settings.rules.custom) ? settings.rules.custom.map(r => ({
                id: r.id,
                name: r.name,
                enabled: r.enabled,
                triggers: [...r.triggers],
                text: r.text
            })) : [],
        };
    }
    function current(session, generation) {
        return !halted && !session.stopped && session.generation === generation;
    }
    function active(uid, session, generation) {
        return current(session, generation) && env.ZALO_WEB_EXPERIMENTAL === 'true' && store.read(uid).settings.enabled;
    }
    function generation(uid, enabled, connected) {
        let session = sessions.get(uid);
        if (!session) {
            session = { generation: 0, pendingPromise: null, connected: false };
            sessions.set(uid, session);
        }
        session.generation++;
        session.stopped = !enabled || halted;
        session.connected = connected;
        session.attempts = 0;
        session.lastAttempt = null;
        session.nextRetryAt = null;
        // Keep pendingPromise: a new generation must wait for an old browser startup to settle.
        adapter.stopWatching(uid);
        const open = adapter.isOpen(uid);
        recordConnection(uid, { attempts: 0, lastAttemptAt: null, nextRetryAt: null,
            phase: session.stopped ? 'paused' : open ? 'connecting' : 'disconnected', reasonCode: session.stopped ? 'paused' : open ? 'connecting' : 'browser_closed', adapterState: adapter.getWatchStatus(uid).state });
        return session;
    }
    function observe(uid, session, status, reasonCode = 'watcher_stopped') {
        const open = adapter.isOpen(uid);
        if (open && status.watching === true) session.nextRetryAt = null;
        else if (!open) session.nextRetryAt = null;
        else if (session.nextRetryAt === null) session.nextRetryAt = now() + Math.min(30000, 5000 * 2 ** Math.min(3, Math.max(0, session.attempts - 1)));
        const previous = snapshot(uid);
        // A healthy reader does not establish that an uncertain send or failed dispatch succeeded.
        const reader = status.reader && typeof status.reader === 'object' ? status.reader : {};
        recordConnection(uid, { phase: !open ? 'disconnected' : status.watching === true ? 'monitoring' : 'waiting_zalo',
            reasonCode: !open ? 'browser_closed' : status.watching === true ? 'none' : reasonCode,
            attempts: session.attempts, lastAttemptAt: session.lastAttempt, nextRetryAt: session.nextRetryAt,
            adapterState: status.state,
            reader: { ...previous.reader, ...reader, acceptedCount: previous.reader.acceptedCount || 0, rejectedCount: previous.reader.rejectedCount || 0 },
            lastPollAt: reader.lastPollAt === undefined ? previous.lastPollAt : reader.lastPollAt });
    }
    function watch(uid, session, open = false) {
        const expected = session.generation, previous = session.pendingPromise;
        const pending = Promise.resolve().then(async () => {
            if (previous) await previous.catch(() => {});
            if (!current(session, expected)) return;
            if (open) {
                recordConnection(uid, { phase: 'connecting', reasonCode: 'connecting' });
                try { await adapter.open(uid); }
                catch (error) {
                    if (current(session, expected)) record(uid, { phase: 'disconnected', reasonCode: 'start_failed' });
                    throw error;
                }
            }
            if (!active(uid, session, expected)) {
                if (current(session, expected)) record(uid, { phase: 'paused', reasonCode: 'paused', nextRetryAt: null });
                return;
            }
            if (!adapter.isOpen(uid)) { observe(uid, session, adapter.getWatchStatus(uid)); return; }
            session.attempts++;
            session.lastAttempt = now();
            session.nextRetryAt = null;
            recordConnection(uid, { phase: 'connecting', reasonCode: 'connecting', attempts: session.attempts, lastAttemptAt: session.lastAttempt, nextRetryAt: null });
            const onStatus = status => {
                if (active(uid, session, expected)) observe(uid, session, status, 'waiting_zalo');
            };
            const onMessage = event => {
                const before = snapshot(uid);
                if (!active(uid, session, expected)) {
                    record(uid, { reader: { ...before.reader, rejectedCount: (before.reader.rejectedCount || 0) + 1 } });
                    return null;
                }
                try {
                    const accepted = store.ingest(uid, event, phones());
                    record(uid, { lastIncomingAt: accepted ? now() : before.lastIncomingAt,
                        ingested: before.ingested + (accepted ? 1 : 0),
                        reader: { ...before.reader, acceptedCount: (before.reader.acceptedCount || 0) + (accepted ? 1 : 0), rejectedCount: (before.reader.rejectedCount || 0) + (accepted ? 0 : 1) },
                        reasonCode: accepted ? before.reasonCode : 'ingest_rejected' });
                    return accepted;
                } catch (error) {
                    record(uid, { reader: { ...before.reader, rejectedCount: (before.reader.rejectedCount || 0) + 1 }, reasonCode: 'ingest_failed' });
                    throw error;
                }
            };
            try {
                await adapter.startWatching(uid, { phone: store.read(uid).settings.target.phone, name: store.read(uid).settings.target.name, onMessage, onStatus });
                if (active(uid, session, expected)) observe(uid, session, adapter.getWatchStatus(uid), 'waiting_zalo');
            } catch (_) {
                if (active(uid, session, expected)) {
                    adapter.stopWatching(uid);
                    observe(uid, session, adapter.getWatchStatus(uid), 'start_failed');
                }
            } finally {
                // No newer attempt can have started while this promise owns the slot.
                if (!current(session, expected)) adapter.stopWatching(uid);
            }
        }).finally(() => { if (session.pendingPromise === pending) session.pendingPromise = null; });
        session.pendingPromise = pending;
        return pending;
    }
    async function save(uid, input) {
        if (input.enabled) experiment();
        const settings = store.saveSettings(uid, input, phones());
        const session = generation(uid, settings.enabled, !!sessions.get(uid)?.connected || adapter.isOpen(uid));
        if (!session.stopped && session.connected) await watch(uid, session);
        return settings;
    }
    async function connect(uid) {
        experiment();
        if (halted) return state(uid);
        const session = generation(uid, true, true);
        await watch(uid, session, true);
        return state(uid);
    }
    function pause(uid) {
        store.saveSettings(uid, { enabled: false }, phones());
        generation(uid, false, !!sessions.get(uid)?.connected);
        return state(uid);
    }
    async function supervise() {
        if (halted || env.ZALO_WEB_EXPERIMENTAL !== 'true') return;
        const pending = [];
        for (const [uid, session] of sessions) {
            if (session.stopped || !session.connected || session.pendingPromise) continue;
            if (!store.read(uid).settings.enabled) { generation(uid, false, session.connected); continue; }
            const status = adapter.getWatchStatus(uid);
            if (!adapter.isOpen(uid)) {
                session.generation++;
                adapter.stopWatching(uid);
                observe(uid, session, status);
                continue;
            }
            observe(uid, session, status);
            if (status.watching === true || session.nextRetryAt > now()) continue;
            session.generation++;
            adapter.stopWatching(uid);
            pending.push(watch(uid, session));
        }
        await Promise.all(pending);
    }
    function verify(rawBody, headers, address) {
        if (!isLocal(address)) fail('Callback n8n chỉ dùng trên máy cục bộ', 403);
        experiment();
        const timestamp = String(headers['x-tikoder-timestamp'] || '');
        const signature = String(headers['x-tikoder-signature'] || '');
        if (!env.N8N_NOTIFY_SECRET || !Buffer.isBuffer(rawBody) || !/^\d{10}$/.test(timestamp) || Math.abs(now() / 1000 - Number(timestamp)) > 300 || !/^sha256=[a-f0-9]{64}$/.test(signature)) fail('Xác thực thất bại', 401);
        const expected = Buffer.from(sign(env.N8N_NOTIFY_SECRET, timestamp, rawBody).slice(7), 'hex');
        if (!crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) fail('Xác thực thất bại', 401);
        let event;
        try { event = JSON.parse(rawBody.toString('utf8')); } catch (_) { fail('Sự kiện không hợp lệ'); }
        if (!event || typeof event !== 'object' || event.eventId !== headers['x-tikoder-event-id']) fail('Sự kiện không hợp lệ');
        return event;
    }
    function verifyDataAccess(headers, address) {
        if (!isLocal(address)) fail('Data API chỉ dùng trên máy cục bộ', 403);
        const secret = String(env.N8N_DATA_API_SECRET || ''), tenant = String(headers['x-tikoder-data-tenant'] || '');
        const configuredTenant = String(env.N8N_DATA_API_TENANT || ''), uid = String(env.N8N_DATA_API_UID || '');
        const timestamp = String(headers['x-tikoder-data-timestamp'] || ''), signature = String(headers['x-tikoder-data-signature'] || '');
        if (!secret || !configuredTenant || !uid || tenant !== configuredTenant || !/^\d{10}$/.test(timestamp) || Math.abs(now() / 1000 - Number(timestamp)) > 300 || !/^sha256=[a-f0-9]{64}$/.test(signature)) fail('Xác thực data API thất bại', 401);
        const expected = Buffer.from(sign(secret, timestamp, tenant).slice(7), 'hex');
        if (!crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) fail('Xác thực data API thất bại', 401);
        return uid;
    }
    function lookup(event, type) {
        if (event.eventType !== type) fail('Loại sự kiện không hợp lệ');
        return store.findEvent(event.tenantId, event.eventId, event.messageId);
    }
    function fresh(message) { if (now() - Date.parse(message.receivedAt) > MAX_AGE || Date.parse(message.receivedAt) > now() + 300000) fail('Tin đã quá thời gian tự trả lời; hãy xử lý thủ công', 409); }
    function inspect(event) {
        const { uid, message } = lookup(event, 'zalo.auto_reply_requested');
        if (message.status !== 'queued') return { route: 'review', status: message.status };
        try { fresh(message); store.assertCurrent(uid, message.id, phones()); }
        catch (error) { store.hold(uid, message.id, error.message); return { route: 'review', status: 'pending', reason: error.message }; }
        const { settings } = store.read(uid);
        if (!settings.enabled || settings.target.phone !== message.target.phone || settings.target.name !== message.target.name) fail('Tự động trả lời đã dừng hoặc người nhận đã đổi', 409);
        if (!adapter.isOpen(uid)) fail('Hãy kết nối Zalo Web trong TikTokOrder trước', 409);
        const ruleKey = message.candidates.length === 1 ? message.candidates[0] : null;
        if (!['phone', 'qr'].includes(ruleKey)) return { route: 'review', status: 'pending' };
        if (ruleKey === 'qr' && adapter.getWatchStatus(uid).capabilities?.image !== true) {
            const reason = 'Chưa xác minh giao diện gửi ảnh Zalo. Không tự thao tác gửi QR.';
            store.hold(uid, message.id, reason);
            return { route: 'review', status: 'unsupported', reason };
        }
        const body = JSON.stringify({ eventId: message.eventId, eventType: 'zalo.auto_reply_command', tenantId: message.tenantId, messageId: message.id, ruleKey, settingsRevision: message.settingsRevision });
        const timestamp = String(Math.floor(now() / 1000));
        return { route: ruleKey, command: { body, timestamp, signature: sign(env.N8N_NOTIFY_SECRET, timestamp, body), eventId: message.eventId } };
    }
    function storedImage(uid, metadata) {
        if (!metadata || !/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg)$/.test(metadata.filename)) fail('Chưa có ảnh QR hợp lệ', 409);
        const directory = path.join(imageRoot, crypto.createHash('sha256').update(uid).digest('hex'));
        const filename = path.join(directory, metadata.filename);
        if (!fs.existsSync(filename)) fail('Không tìm thấy ảnh QR đã lưu', 409);
        const bytes = fs.readFileSync(filename);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) fail('Ảnh QR đã thay đổi; hãy tải lại ảnh', 409);
        return filename;
    }
    function enqueue(event) {
        const { uid, message } = lookup(event, 'zalo.auto_reply_command');
        if (message.status !== 'queued') return { status: message.status, eventId: message.eventId };
        fresh(message);
        if (event.settingsRevision !== message.settingsRevision) fail('Phiên bản cấu hình không khớp', 409);
        if (!adapter.isOpen(uid)) fail('Zalo Web chưa mở', 409);
        // Refuse known-unsupported actions before claiming an ambiguous browser operation.
        if (event.ruleKey === 'qr' && adapter.getWatchStatus(uid).capabilities?.image !== true) fail('Chưa xác minh được giao diện gửi ảnh Zalo', 409);
        const current = store.read(uid);
        const image = event.ruleKey === 'qr' ? storedImage(uid, current.settings.rules.qr.image) : null;
        const claimed = store.claim(uid, message.id, event.ruleKey, phones());
        const guard = () => {
            store.assertCurrent(uid, message.id, phones());
            const latest = store.read(uid), live = latest.messages.find(item => item.id === message.id);
            if (!latest.settings.enabled || !live || live.status !== 'sending' || latest.settings.target.phone !== claimed.target.phone || latest.settings.target.name !== claimed.target.name || JSON.stringify(latest.settings.rules[event.ruleKey]) !== JSON.stringify(claimed.rule)) fail('Đã dừng hoặc thay đổi cấu hình; không thao tác gửi', 409);
            if (image) storedImage(uid, claimed.rule.image);
        };
        // Respond to n8n immediately; the durable sending state owns duplicate protection.
        record(uid, { phase: 'dispatching', reasonCode: 'dispatching' });
        const job = Promise.resolve().then(async () => {
            let reason = '', outcome = 'needs_check';
            try {
                guard();
                const result = image
                    ? await adapter.sendImage(uid, claimed.target.phone, claimed.target.name, image, claimed.rule.caption, guard, message.conversationKey, claimed.rule.image.sha256)
                    : await adapter.sendReply(uid, claimed.target.phone, claimed.target.name, claimed.rule.text, message.conversationKey, guard);
                if (result?.outcome === 'sent') outcome = 'sent';
            } catch (error) {
                if (/existing.*(?:editor|attachment).*draft/i.test(error.message || '')) reason = 'Ô soạn tin đang có bản nháp hoặc tệp đính kèm. App không ghi đè; hãy kiểm tra Zalo trước.';
                else if (/photo click did not open/.test(error.message || '')) reason = 'Nút ảnh chưa mở được hộp chọn tệp theo cấu trúc đã hỗ trợ. Kiểm tra Zalo, không tự gửi lại.';
                else if (/preview SHA256 mismatch/.test(error.message || '')) reason = 'Ảnh xem trước không khớp nguyên bản QR đã lưu; app không bấm gửi. Kiểm tra Zalo trước khi xử lý tiếp.';
                else reason = 'Chưa xác nhận kết quả thao tác Zalo. Kiểm tra hội thoại trước khi xử lý tiếp.';
            }
            finally {
                store.finish(uid, message.id, reason, outcome);
                record(uid, { phase: outcome === 'sent' ? 'monitoring' : 'needs_check', reasonCode: outcome === 'sent' ? 'send_confirmed' : reason ? 'send_failed' : 'send_uncertain' });
            }
        }).catch(() => {
            record(uid, { phase: 'needs_check', reasonCode: 'send_failed' });
            console.error('Không thể lưu kết quả Zalo tự động; cần kiểm tra dữ liệu hàng đợi.');
        }).finally(() => jobs.delete(job));
        jobs.add(job);
        return { status: 'accepted', eventId: message.eventId };
    }
    async function drain() {
        if (draining || env.ZALO_WEB_EXPERIMENTAL !== 'true') return;
        draining = true;
        try {
            let transport;
            try { transport = config(); }
            catch (error) {
                for (const event of store.pendingDispatch().slice(0, 20)) {
                    const { uid } = store.findEvent(event.tenantId, event.eventId, event.messageId);
                    if (store.read(uid).settings.enabled) record(uid, { phase: 'needs_check', reasonCode: 'dispatch_config', lastDispatchStatus: 0 });
                }
                throw error;
            }
            for (const event of store.pendingDispatch().slice(0, 20)) {
                const { uid, message } = store.findEvent(event.tenantId, event.eventId, event.messageId);
                if (!store.read(uid).settings.enabled) continue;
                let error = '', status = 0;
                const beforeDispatch = snapshot(uid);
                record(uid, { dispatchAttempt: beforeDispatch.dispatchAttempt + 1,
                    phase: beforeDispatch.phase === 'needs_check' ? 'needs_check' : 'dispatching',
                    reasonCode: beforeDispatch.phase === 'needs_check' ? beforeDispatch.reasonCode : 'dispatching' });
                try {
                    fresh(message);
                    const body = JSON.stringify(event), timestamp = String(Math.floor(now() / 1000));
                    const response = await fetcher(transport.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-tikoder-token': transport.token, 'x-tikoder-timestamp': timestamp, 'x-tikoder-signature': sign(transport.secret, timestamp, body), 'x-tikoder-event-id': event.eventId }, body });
                    status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0;
                    if (!response.ok) error = 'n8n HTTP ' + status;
                } catch (_) { error = 'Không điều phối được qua n8n hoặc tin đã quá hạn'; }
                store.markDispatch(uid, message.id, { error });
                const previous = snapshot(uid);
                record(uid, { lastDispatchStatus: status,
                    phase: error || previous.phase === 'needs_check' ? 'needs_check' : !store.read(uid).settings.enabled ? 'paused' : !adapter.isOpen(uid) ? 'disconnected' : adapter.getWatchStatus(uid).watching === true ? 'monitoring' : 'waiting_zalo',
                    reasonCode: error ? 'dispatch_failed' : previous.phase === 'needs_check' ? previous.reasonCode : 'dispatch_accepted' });
            }
        } finally { draining = false; }
    }
    function start() {
        try { store.recover(); }
        catch (_) { console.error('Không thể phục hồi Zalo tự động; giữ nguyên dữ liệu, không tự gửi lại.'); return; }
        if (env.ZALO_WEB_EXPERIMENTAL !== 'true' || timer) return;
        halted = false;
        timer = setInterval(() => {
            // Independent lanes: invalid n8n configuration must never disable reader recovery.
            supervise().catch(() => console.error('Chưa phục hồi được bộ đọc Zalo tự động.'));
            drain().catch(() => console.error('Chưa điều phối được Zalo tự động; kiểm tra cấu hình n8n.'));
        }, 5000);
        timer.unref();
    }
    function stop() {
        halted = true;
        clearInterval(timer); timer = undefined;
        for (const [uid, session] of sessions) {
            session.generation++;
            session.stopped = true;
            session.nextRetryAt = null;
            adapter.stopWatching(uid);
            record(uid, { phase: 'paused', reasonCode: 'stopped', nextRetryAt: null });
        }
    }
    function upload(uid, input) {
        if (!input || !['image/png', 'image/jpeg'].includes(input.mime) || typeof input.data !== 'string' || input.data.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) fail('Chỉ nhận ảnh PNG/JPEG tối đa 5MB');
        const bytes = Buffer.from(input.data, 'base64');
        const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString() === 'IHDR';
        const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
        if (!bytes.length || bytes.length > 5 * 1024 * 1024 || (input.mime === 'image/png' ? !png : !jpeg) || bytes.toString('base64') !== input.data) fail('Dữ liệu ảnh không hợp lệ hoặc vượt 5MB');
        const directory = path.join(imageRoot, crypto.createHash('sha256').update(uid).digest('hex'));
        fs.mkdirSync(directory, { recursive: true });
        const metadata = { filename: crypto.randomUUID() + (png ? '.png' : '.jpg'), mime: input.mime, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
        const filename = path.join(directory, metadata.filename);
        fs.writeFileSync(filename, bytes, { mode: 0o600, flag: 'wx' });
        try { store.setImage(uid, metadata); } catch (error) { fs.unlinkSync(filename); throw error; }
        const session = sessions.get(uid);
        if (session) {
            generation(uid, store.read(uid).settings.enabled && !session.stopped, session.connected);
        } else adapter.stopWatching(uid);
        return metadata;
    }
    return { state, integrationData, save, connect, pause, verify, verifyDataAccess, inspect, enqueue, drain, supervise, start, stop, upload, async diagnostics(uid) { experiment(); const report = await adapter.diagnostics(uid); return { ...report, runtime: sanitize(snapshot(uid)) }; }, image(uid) { const metadata = store.read(uid).settings.rules.qr.image; return { filename: storedImage(uid, metadata), mime: metadata.mime }; }, resolve(uid, id, action) {
            const message = store.resolve(uid, id, action);
            const data = store.read(uid), connection = adapter.getWatchStatus(uid);
            if (!data.messages.some(item => ['sending', 'needs_check', 'dispatch_failed'].includes(item.status))) record(uid, {
                phase: !data.settings.enabled ? 'paused' : !adapter.isOpen(uid) ? 'disconnected' : connection.watching ? 'monitoring' : 'waiting_zalo',
                reasonCode: !data.settings.enabled ? 'paused' : !adapter.isOpen(uid) ? 'browser_closed' : connection.watching ? 'none' : 'waiting_zalo',
            });
            return message;
        }, waitForJobs: () => Promise.all([...jobs]) };
}
module.exports = { createService, isLocal };
