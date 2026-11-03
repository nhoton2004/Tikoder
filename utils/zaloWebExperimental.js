// Experimental local-only adapter. Every profile belongs to one Tikoder user.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('playwright-core');
const contexts = new Map();
const locks = new Set();
const { snapshot, trackInbox } = require('./zaloInboxDom');
const { snapshotLive, trackLiveInbox, resetLiveInboxTracker } = require('./zaloLiveInboxDom');
const { sendImageOnPage } = require('./zaloImageSend');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_SEEN = 10000;
const watchers = new Map();
const statuses = new Map();

async function withSessionLock(uid, action) {
    if (locks.has(uid)) throw new Error('Đang xử lý một tin nhắn khác');
    locks.add(uid);
    try { return await action(); }
    finally { locks.delete(uid); }
}

function getPage(uid) {
    const context = contexts.get(uid);
    if (!context) throw new Error('Hãy mở Zalo và đăng nhập trước');
    const page = context.pages().find(p => /^https:\/\/chat\.zalo\.me\//.test(p.url()));
    if (!page) throw new Error('Không tìm thấy cửa sổ Zalo Web');
    return page;
}
const normalizeName = value => String(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
async function assertPrivate(page, phone, name, result = null) {
    result = result || await page.evaluate(snapshot);
    if (!result.supported) {
        const error = new Error('Unsupported Zalo DOM: ' + result.detail);
        error.domDetail = result.detail;
        throw error;
    }
    if (result.phone !== phone || normalizeName(result.name) !== normalizeName(name)) {
        throw new Error('Private thread does not match verified phone/name');
    }
    return result;
}

async function selectContact(page, phone, expectedName, withIdentity = false) {
    let stage = 'contact-search';
    try {
    const search = page.locator('#contact-search-input');
    await search.waitFor({ state: 'visible', timeout: 5000 });
    await search.click(); await search.fill(phone);
    stage = 'contact-card';
    const card = page.locator('[id^="friend-item-"]').filter({ has: page.locator('.txt-highlight', { hasText: phone }) });
    await card.first().waitFor({ state: 'visible', timeout: 15000 });
    if (await card.count() !== 1) throw new Error('Không xác định duy nhất người nhận');
    if ((await card.locator('.txt-highlight').innerText()).replace(/\s/g, '') !== phone) throw new Error('Số điện thoại không khớp');
    const name = (await card.locator('.conv-item-title__name').innerText()).replace(/\s+/g, ' ').trim();
    if (normalizeName(name) !== normalizeName(expectedName)) throw new Error('Tên Zalo không khớp tên được xác nhận');
    let contactKey, cardId;
    if (withIdentity) {
        const id = await card.getAttribute('id');
        if (!/^friend-item-[^\s\x00-\x1f\x7f]{1,200}$/u.test(id || '')) throw new Error('Missing stable contact card identity');
        contactKey = 'private:' + sha256(phone + '\0' + id);
                cardId = id;
    }
    stage = 'contact-selection';
    await card.click();
    stage = 'editor-identity';
    const editor = page.locator('#richInput');
    await editor.waitFor({ state: 'visible', timeout: 5000 });
    // Zalo disables the composer while the contact-search field owns focus.
    // Reselecting the already-open chat does not automatically restore it.
    if (await editor.getAttribute('contenteditable') !== 'true') await editor.click();
    // Visibility can belong to the previous render during contact reselection.
    // Wait for the confirmed identity, never accept a stale trailer.
    stage = 'editor-wait-identity';
    await page.waitForFunction(expected => {
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
        const editors = [...document.querySelectorAll('#richInput[contenteditable="true"]')]
            .filter(node => node.getClientRects().length && getComputedStyle(node).visibility === 'visible');
        return editors.length === 1 && normalize(editors[0].getAttribute('data-trailer')) === normalize(expected);
    }, name, { timeout: 5000 });
    stage = 'editor-read-identity';
    const trailer = (await editor.getAttribute('data-trailer') || '').replace(/\s+/g, ' ').trim();
    stage = 'editor-name-mismatch';
    if (await editor.getAttribute('contenteditable') !== 'true') throw new Error('Composer is not editable');
    if (normalizeName(trailer) !== normalizeName(name)) throw new Error('Cuộc hội thoại không khớp người nhận');
    return withIdentity ? { editor, contactKey, cardId } : editor;
    } catch (error) {
        // Fixed stage codes only: Playwright errors may include private DOM text.
        if (!error.domDetail) error.domDetail = 'Contact verification failed: ' + stage;
        throw error;
    }
}

async function assertLive(page, name) {
    const view = await page.evaluate(snapshotLive);
    if (!view.supported) {
        const error = new Error('Unsupported Zalo DOM: ' + view.detail);
        error.domDetail = view.detail;
        throw error;
    }
    if (normalizeName(view.editorName) !== normalizeName(name)) throw unsupportedInbox('Observed editor does not match verified contact');
    return view;
}

// Keep actual nodes across awaited checks. A reused root/display name is not
// identity evidence, and replacing/removing even the same nodes invalidates proof.
async function captureTargetProof(page, name, fixture = false, contact = null) {
    return page.evaluateHandle(({ expectedName, fixture, contact }) => {
        const rootSelector = fixture ? '#chatView, #chat-view' : 'article#chatView';
        const historySelector = fixture ? '[data-message-scroll]' : '.message-view__scroll__inner';
        const root = document.querySelector(rootSelector);
        const editor = document.querySelector('#richInput[contenteditable="true"]');
        const history = root && root.querySelector(historySelector);
        const composer = editor && editor.closest('.chat-box-input-container');
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
        const trailer = editor && editor.getAttribute('data-trailer');
        const card = contact && document.getElementById(contact.cardId);
        const verifyCard = () => {
            if (!contact) return;
            if (!card || card.id !== contact.cardId ||
                (card.querySelector('.txt-highlight')?.textContent || '').replace(/\s/g, '') !== contact.phone ||
                normalize(card.querySelector('.conv-item-title__name')?.textContent) !== normalize(expectedName)) {
                throw new Error('Verified contact card identity changed');
            }
        };
        verifyCard();
        if (!root || !editor || !history || !root.contains(editor) || normalize(trailer) !== normalize(expectedName)) {
            throw new Error('Cannot capture verified target nodes');
        }
        const baseline = [...history.querySelectorAll('.chat-message')].map(node => ({ node, id: node.id,
            frames: [...node.querySelectorAll('.message-frame')].map(frame => ({ node: frame, id: frame.id, qid: frame.getAttribute('data-qid') })) }));
        const protectedNodes = [root, editor, history, ...(composer ? [composer] : []), ...baseline.map(entry => entry.node)];
        let invalidated = false;
        let replyBaseline = null;
        let replyFrames = null;
        let replyKeydown = null;
        const consume = records => {
            for (const record of records) {
                // Inbox identity must cover rows arriving after connection too,
                // including an initially empty thread. A peer switch can reuse
                // root/editor nodes, but cannot replace message nodes/IDs unnoticed.
                if (contact && history.contains(record.target)) {
                    const structural = '.chat-item, .chat-message, .message-frame';
                    if ([...record.removedNodes].some(node => node.nodeType === 1 &&
                        (node.matches(structural) || node.querySelector(structural)))) invalidated = true;
                    if (record.type === 'attributes' && ['id', 'data-qid'].includes(record.attributeName) &&
                        record.target.matches(structural) && record.oldValue &&
                        record.oldValue !== record.target.getAttribute(record.attributeName)) invalidated = true;
                }
                if (replyFrames && ([...record.removedNodes].some(node => node.nodeType === 1 &&
                    (node.matches('.message-frame') || node.querySelector('.message-frame'))) ||
                    (record.type === 'attributes' && record.target.matches('.message-frame') &&
                        ['id', 'data-qid', 'class'].includes(record.attributeName)))) invalidated = true;
                if ([...record.removedNodes].some(node => protectedNodes.some(target => node === target || node.contains(target))) ||
                    (record.type === 'attributes' && record.target === editor && record.attributeName === 'data-trailer')) invalidated = true;
            }
        };
        const observer = new MutationObserver(consume);
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-trailer', 'id', 'data-qid', 'class'] });
        return { editor,
            verify(empty = false) {
                consume(observer.takeRecords());
                verifyCard();
                if (invalidated || !root.isConnected || !editor.isConnected || !history.isConnected ||
                    document.querySelectorAll('#chatView, #chat-view').length !== 1 || document.querySelector(rootSelector) !== root ||
                    document.querySelectorAll('#richInput').length !== 1 || document.querySelector('#richInput') !== editor ||
                    root.querySelectorAll(historySelector).length !== 1 ||
                    root.querySelector(historySelector) !== history || !root.contains(editor) ||
                    editor.getAttribute('data-trailer') !== trailer || normalize(trailer) !== normalize(expectedName) ||
                    baseline.some(entry => !entry.node.isConnected || !history.contains(entry.node) || entry.node.id !== entry.id ||
                        entry.frames.some(frame => !entry.node.contains(frame.node) || frame.node.id !== frame.id || frame.node.getAttribute('data-qid') !== frame.qid))) {
                    throw new Error('Verified target nodes changed before send');
                }
                if (empty && editor.textContent) throw new Error('Existing unsent editor draft; no action performed');
                return true;
            },
            verifyReply(empty = false) {
                this.verify(empty);
                if (!composer || !composer.isConnected || !root.contains(composer) ||
                    editor.closest('.chat-box-input-container') !== composer || history.contains(composer) || composer.contains(history)) {
                    throw new Error('Missing or changed reply composer; no action performed');
                }
                const visible = node => node.isConnected && node.getClientRects().length &&
                    getComputedStyle(node).visibility === 'visible';
                if ([...document.querySelectorAll('dialog, [role="dialog"]')].some(visible) ||
                    [...document.querySelectorAll('input[type="file"]')].some(node => node.files.length)) {
                    throw new Error('Existing dialog or selected file attachment draft; no action performed');
                }
                // Conservative draft heuristics, not asserted Zalo attachment selectors.
                const blocked = /(?:^|[-_])(attachment|preview|upload|file|image|photo|sticker|quote|reply)(?:$|[-_])/i;
                for (const node of composer.querySelectorAll('*')) {
                    if (node.closest('.chat-box-toolbar')) continue;
                    if (/^(IMG|VIDEO|AUDIO|CANVAS|OBJECT|EMBED|IFRAME)$/.test(node.tagName) ||
                        node.matches('a[download], [data-attachment], [data-file]') ||
                        (node.matches('input:not([type="file"]):not([type="hidden"]), textarea') && node.value) ||
                        [...node.classList].some(value => blocked.test(value))) {
                        throw new Error('Existing or unknown attachment draft; no action performed');
                    }
                }
                return true;
            },
            armReply(text) {
                this.verifyReply();
                if (editor.innerText !== text) throw new Error('Reply draft changed before send');
                // Capture the baseline in the actual Enter task, before app handlers.
                replyKeydown = event => {
                    if (event.key !== 'Enter') return;
                    try {
                        this.verifyReply();
                        if (editor.innerText !== text) throw new Error('Reply draft changed');
                        replyFrames = new Map([...history.querySelectorAll('.message-frame')].map(frame => [frame, frame.getAttribute('data-qid')]));
                        replyBaseline = new Set([...replyFrames.values()]);
                    } catch (_) { invalidated = true; event.preventDefault(); event.stopImmediatePropagation(); }
                };
                editor.addEventListener('keydown', replyKeydown, { capture: true, once: true });
            },
            replyEcho(text) {
                try {
                    this.verifyReply(true);
                    const frames = [...history.querySelectorAll('.message-frame')];
                    if (!replyFrames || [...replyFrames].some(([frame, id]) => !history.contains(frame) || frame.getAttribute('data-qid') !== id)) return { error: true };
                    const ids = frames.map(frame => frame.getAttribute('data-qid'));
                    if (ids.some(id => !id) || new Set(ids).size !== ids.length) return { error: true };
                    const fresh = frames.filter(frame => !replyFrames.has(frame) && frame.closest('.chat-item.me'));
                    if (fresh.length !== 1) return false;
                    const frame = fresh[0];
                    if (replyBaseline.has(frame.getAttribute('data-qid'))) return { error: true };
                    const actions = frame.querySelectorAll('.message-action');
                    if (actions.length !== 1 || !frame.getClientRects().length ||
                        frame.querySelector('img, video, audio, [contenteditable], .quote, .reply, .attachment')) return false;
                    const receipts = frame.querySelectorAll('.card-send-time');
                    if (receipts.length !== 1 || actions[0].contains(receipts[0]) || !receipts[0].getClientRects().length ||
                        getComputedStyle(receipts[0]).visibility !== 'visible') return false;
                    const receipt = receipts[0].innerText.normalize('NFC').replace(/\s+/g, ' ').trim();
                    // Only observed positive receipt text, optionally alongside HH:mm, proves acceptance.
                    const accepted = /^(?:Đã (?:gửi|nhận|xem)(?: (?:[01]\d|2[0-3]):[0-5]\d)?|(?:[01]\d|2[0-3]):[0-5]\d Đã (?:gửi|nhận|xem))$/iu;
                    if (!accepted.test(receipt)) return false;
                    const blocked = /(?:^|[-_])(quote|quoted|reply|replied|preview|attachment|file|image|photo|video|audio|sticker|button)(?:$|[-_])/i;
                    if ([actions[0], ...actions[0].querySelectorAll('*')].some(node =>
                        !/^(DIV|SPAN(?:-\d+)?|P|BR|B|STRONG|I|EM|U|S|DEL|SMALL|A|CODE|PRE)$/.test(node.tagName) ||
                        [...node.classList].some(value => blocked.test(value)) || node.hasAttribute('onclick') ||
                        node.hasAttribute('download') || node.hasAttribute('data-attachment'))) return false;
                    return actions[0].innerText.replace(/\r\n?/g, '\n').trim() === text.replace(/\r\n?/g, '\n').trim()
                        ? { sent: true, id: frame.getAttribute('data-qid') } : false;
                } catch (_) { return false; }
            },
            disconnect() { observer.disconnect(); if (replyKeydown) editor.removeEventListener('keydown', replyKeydown, true); }
        };
    }, { expectedName: name, fixture, contact });
}
async function disposeProof(proof) {
    if (!proof) return;
    await proof.evaluate(value => value.disconnect()).catch(() => {});
    await proof.dispose().catch(() => {});
}
function finalReplyGuard(beforeSend) {
    const result = beforeSend();
    if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new Error('Reply beforeSend must be synchronous at the final send boundary');
    }
    if (result === false) throw new Error('Reply beforeSend refused the action');
}

async function open(uid) {
    return withSessionLock(uid, async () => {
        if (process.env.ZALO_WEB_EXPERIMENTAL !== 'true') throw new Error('Chế độ thử Zalo chưa được bật');
        if (contexts.has(uid)) return contexts.get(uid);
        const browserPath = process.env.ZALO_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        if (!fs.existsSync(browserPath)) throw new Error('Không tìm thấy trình duyệt; cấu hình ZALO_BROWSER_PATH');
        const profile = path.join(__dirname, '..', 'data', 'zalo-profiles', crypto.createHash('sha256').update(uid).digest('hex'));
        const context = await chromium.launchPersistentContext(profile, { executablePath: browserPath, headless: false });
        contexts.set(uid, context);
        context.on('close', () => {
            contexts.delete(uid);
            const watcher = watchers.get(uid);
            stopWatching(uid);
            setStatus(uid, 'closed', 'Browser closed; watcher stopped', watcher);
        });
        const page = context.pages()[0] || await context.newPage();
        await page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded' });
        return context;
    });
}

async function send(uid, phone, expectedName, text, beforeSend = () => {}) {
    return withSessionLock(uid, async () => {
        const page = getPage(uid);
        const editor = await selectContact(page, phone, expectedName);
        // Preserve the live-verified quote path: exact phone/name/trailer only.
        // Inbox DOM support must not change this path's acceptance behavior.
        await editor.fill(text);
        beforeSend();
        // Any error after this point has an ambiguous outcome; caller must never auto-retry.
        await editor.press('Enter');
        return { outcome: 'needs_check' };
    });
}

// Auto-replies require the stronger inbox contract and the event's exact thread
// key. Keep this separate from the existing, live-verified quote send path.
// beforeSend is rechecked synchronously at the final boundary; it must be a
// synchronous service guard (pause/settings revision), not an async callback.
async function sendReply(uid, phone, name, text, conversationKey, beforeSend = () => {}) {
    return withSessionLock(uid, async () => {
        const page = getPage(uid);
        const { editor, contactKey } = await selectContact(page, phone, name, true);
        const legacy = await page.evaluate(snapshot);
        if (legacy.supported) {
            const target = await assertPrivate(page, phone, name, legacy);
            if (target.conversationKey !== conversationKey) throw new Error('Private thread does not match reply conversationKey');
            let proof, capturedEditor;
            try {
                proof = await captureTargetProof(page, name, true);
                capturedEditor = await proof.evaluateHandle(value => value.editor);
                await proof.evaluate(value => value.verifyReply(true));
                await capturedEditor.asElement().fill(text);
                await beforeSend();
                const current = await assertPrivate(page, phone, name);
                if (current.conversationKey !== conversationKey) throw new Error('Private thread changed before reply send');
                await proof.evaluate((value, text) => value.armReply(text), text);
                finalReplyGuard(beforeSend);
                await capturedEditor.asElement().press('Enter', { timeout: 2500 });
                return { outcome: 'needs_check' };
            } finally {
                if (capturedEditor) await capturedEditor.dispose().catch(() => {});
                await disposeProof(proof);
            }
        }
        await assertLive(page, name);
        if (contactKey !== conversationKey) throw new Error('Private thread does not match reply conversationKey');
        let proof, capturedEditor;
        let interrupted = false;
        const onNavigation = frame => { if (frame === page.mainFrame()) interrupted = true; };
        const onPopup = () => { interrupted = true; };
        page.on('framenavigated', onNavigation);
        page.on('popup', onPopup);
        try {
            proof = await captureTargetProof(page, name);
            capturedEditor = await proof.evaluateHandle(value => value.editor);
            await proof.evaluate(value => value.verifyReply(true));
            await capturedEditor.asElement().fill(text);
            await beforeSend();
            await assertLive(page, name);
            await proof.evaluate((value, text) => value.armReply(text), text);
            await proof.evaluate(value => { value.verify(); value.verifyReply(); });
            // No await/yield after this final service guard until issuing Enter.
            if (interrupted) throw new Error('Reply interrupted by navigation or popup');
            finalReplyGuard(beforeSend);
            try {
                await capturedEditor.asElement().press('Enter', { timeout: 2500 });
                let echo;
                try {
                    echo = await page.waitForFunction(({ proof, text }) => proof.replyEcho(text), { proof, text }, { timeout: 2500, polling: 50 });
                    const result = await echo.jsonValue();
                    if (result.sent) {
                        const view = await assertLive(page, name);
                        const matching = view.messages.filter(message => message.id === result.id && message.direction === 'outbound' &&
                            message.text === text.replace(/\r\n?/g, '\n').trim());
                        const current = await proof.evaluate((value, text) => value.replyEcho(text), text);
                        if (!interrupted && matching.length === 1 && current.sent && current.id === result.id) return { outcome: 'sent' };
                    }
                } finally { if (echo) await echo.dispose().catch(() => {}); }
            } catch (_) { /* An attempted Enter is never retried, including on timeout. */ }
            return { outcome: 'needs_check' };
        } finally {
            page.off('framenavigated', onNavigation);
            page.off('popup', onPopup);
            if (capturedEditor) await capturedEditor.dispose().catch(() => {});
            await disposeProof(proof);
        }
    });
}

// Conditional runtime proof, not authenticated end-to-end image verification.
// Validate local bytes before even looking up/navigating the browser session.
async function sendImage(uid, phone, name, imagePath, caption = '', beforeSend = () => {}, conversationKey, expectedSha256) {
    return withSessionLock(uid, async () => {
        let digest;
        try {
            if (typeof imagePath !== 'string' || !imagePath || typeof caption !== 'string') throw new Error();
            const bytes = await fs.promises.readFile(imagePath);
            const raster = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
                (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
                /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) ||
                (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') ||
                bytes.subarray(0, 2).toString() === 'BM';
            if (!raster || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error();
            digest = sha256(bytes);
            if (expectedSha256 !== undefined && (typeof expectedSha256 !== 'string' ||
                !/^[a-f0-9]{64}$/i.test(expectedSha256) || expectedSha256.toLowerCase() !== digest)) throw new Error();
        } catch (_) {
            throw new Error('Unsupported Zalo image UI: invalid/missing image file or SHA256; no action performed');
        }
        const page = getPage(uid);
        const { contactKey } = await selectContact(page, phone, name, true);
        if (conversationKey !== undefined && conversationKey !== contactKey) throw new Error('Private thread does not match image conversationKey');
        await assertLive(page, name);
        let proof;
        try {
            proof = await captureTargetProof(page, name);
            await proof.evaluate(value => value.verify(true));
            return await sendImageOnPage({ page, imagePath, caption, expectedSha256: expectedSha256 || digest,
                verifyTarget: async () => {
                    await assertLive(page, name);
                    return proof.evaluate(value => value.verify());
                }, beforeSend });
        } finally { await disposeProof(proof); }
    });
}

function unsupportedInbox(detail) {
    const error = new Error('Unsupported Zalo inbox DOM: ' + detail);
    error.domDetail = detail;
    return error;
}
function assertHistoryReady(view) {
    if (!view.historyReady) throw unsupportedInbox('Explicit verified initial history-ready evidence required (data-history-ready=true); real DOM verification required');
}

function remember(watcher, key) {
    if (watcher.seen.has(key)) return;
    if (watcher.seen.size >= MAX_SEEN) {
        const error = new Error('Session dedup capacity reached; watcher stopped instead of forgetting IDs');
        error.capacity = true;
        throw error;
    }
    watcher.seen.add(key);
}
const liveDetail = watcher => `Theo dõi liên hệ thử đã đối chiếu số và tên. Chỉ xử lý tin mới có giờ từ ${new Date(watcher.readyAt).toLocaleTimeString('vi-VN')} với bằng chứng nối thêm sau khi kết nối, kể cả cùng phút; bỏ qua lịch sử ban đầu. ` +
    'Không thao tác trong cửa sổ Zalo riêng khi app đang gửi. Bộ đọc dựa trên DOM đã quan sát; chưa xác nhận đầu cuối trên tài khoản thật. Gửi QR chỉ tiếp tục khi xác minh đúng ảnh và nút gửi; kết quả chưa rõ cần kiểm tra, không tự gửi lại.';
function isOpen(uid) { return contexts.has(uid); }
function getWatchStatus(uid) {
    return { open: isOpen(uid), watching: watchers.has(uid) && statuses.get(uid)?.state === 'monitoring',
        ...(statuses.get(uid) || { state: 'paused', detail: 'Watcher not started; observed DOM adapter and conditional image UI are not live end-to-end verified' }),
        capabilities: { text: true, inbox: 'observed_web_dom', image: true } };
}
function setStatus(uid, state, detail, watcher) {
    statuses.set(uid, { state, detail, ...(watcher?.reader ? { reader: { ...watcher.reader } } : {}), ...(watcher && watcher.mode === 'live' ? { readyAt: watcher.readyAt } : {}) });
    if (watcher && typeof watcher.onStatus === 'function') {
        const status = getWatchStatus(uid);
        // Never expose callback errors (which may contain secrets) or log them.
        Promise.resolve().then(() => watcher.onStatus(status)).catch(() => {
            if (watchers.get(uid) === watcher) {
                stopWatching(uid);
                statuses.set(uid, { state: 'error', detail: 'Status callback failed; watcher stopped' });
            }
        });
    }
}
function stopWatching(uid) {
    const watcher = watchers.get(uid);
    if (watcher) {
        watcher.stopped = true;
        clearTimeout(watcher.timer);
        const proof = watcher.inboxProof;
        watcher.inboxProof = null;
        if (proof) void disposeProof(proof);
        watchers.delete(uid);
    }
    setStatus(uid, 'paused', 'Watcher paused', watcher);
}

async function startWatching(uid, { phone, name, onMessage, onStatus } = {}) {
    if (typeof phone !== 'string' || !phone || typeof name !== 'string' || !name.trim() || typeof onMessage !== 'function') {
        throw new Error('Watcher requires one phone, confirmed name, and onMessage callback');
    }
    // Reserve the same lock before replacing any previous watcher.
    let watcher;
    await withSessionLock(uid, async () => {
        stopWatching(uid);
        watcher = { phone, name, onMessage, onStatus, stopped: false, seen: new Set(), baseline: null,
                    baselineSeen: new Set(),
                    reader: { pollCount: 0, deliveredCount: 0, readableMessages: 0, inboundMessages: 0, eligibleMessages: 0 } };
        watchers.set(uid, watcher);
        setStatus(uid, 'connecting', 'Đang chờ Zalo và xác minh liên hệ thử; chưa bắt đầu nhận tin.', watcher);
        try {
            const page = getPage(uid);
            const selected = await selectContact(page, phone, name, true);
            const legacy = await page.evaluate(snapshot);
            if (legacy.supported) {
                watcher.mode = 'legacy';
                assertHistoryReady(await assertPrivate(page, phone, name, legacy));
            } else {
                watcher.mode = 'live';
                watcher.contactKey = selected.contactKey;
                await assertLive(page, name);
                const proof = await captureTargetProof(page, name, false, { phone, cardId: selected.cardId });
                if (watcher.stopped || watchers.get(uid) !== watcher) {
                    await disposeProof(proof);
                    return;
                }
                watcher.inboxProof = proof;
                await page.evaluate(resetLiveInboxTracker);
                await page.evaluate(trackLiveInbox);
                const view = await assertLive(page, name);
                if (watcher.stopped || watchers.get(uid) !== watcher) return;
                if (!view.tracking) throw unsupportedInbox('Missing observed DOM tracker baseline');
                watcher.initialBaselineMinute = Math.floor(view.capturedAt / 60000) * 60000;
                watcher.readyAt = new Date(view.capturedAt).toISOString();
                watcher.reader.observationStartedAt = watcher.readyAt;
                watcher.reader.implementation = 'observed-dom-mutation-trace-1';
                // Include incomplete/non-text initial rows, not only parsed text.
                const initialIds = await page.evaluate(() => [...document.querySelectorAll('article#chatView .message-view__scroll__inner .message-frame[data-qid]')]
                    .map(node => node.getAttribute('data-qid')));
                for (const id of initialIds) {
                    const key = sha256('zalo:' + id);
                    remember(watcher, key);
                    watcher.baselineSeen.add(key);
                }
            }
        } catch (error) {
            if (watchers.get(uid) === watcher) {
                stopWatching(uid);
                setStatus(uid, error.capacity ? 'capacity' : 'unsupported', error.capacity ? error.message :
                    error.domDetail || 'Cannot verify exact contact and private DOM contract; no monitoring or sending', watcher);
            }
        }
    });
    const active = () => !watcher.stopped && watchers.get(uid) === watcher;
    const tick = async () => {
        if (!active()) return;
        try {
            // A quote/send owns the session until completion. Skip, never overlap.
            if (locks.has(uid)) return;
            const events = await withSessionLock(uid, async () => {
                if (!active()) return [];
                const page = getPage(uid);
                if (watcher.mode === 'live') {
                    // Search/click on every poll mutates the live chat and can
                    // baseline an arrival before it is read. Keep the originally
                    // verified nodes instead; any loss of identity stops this epoch.
                    if (!watcher.inboxProof) throw unsupportedInbox('Missing pinned inbox identity proof');
                    await watcher.inboxProof.evaluate(value => value.verify());
                    await page.evaluate(trackLiveInbox);
                    const view = await assertLive(page, name);
                    await watcher.inboxProof.evaluate(value => value.verify());
                    if (!active()) return [];
                    if (!view.tracking) throw unsupportedInbox('Observed DOM tracker unavailable');
                    const eligible = new Set(view.tracking.eligible);
                    const skipped = { ...view.skipped, time: 0, baseline: 0, untracked: 0, duplicate: 0, future: 0 };
                    watcher.reader = {
                        ...watcher.reader, lastPollAt: new Date().toISOString(), pollCount: watcher.reader.pollCount + 1,
                        readableMessages: view.messages.length,
                        inboundMessages: view.messages.filter(message => message.direction === 'inbound').length,
                        eligibleMessages: eligible.size,
                        observationStartedAt: watcher.readyAt,
                        trackerEpoch: view.tracking.epoch, atBottom: view.atBottom,
                        candidateCount: view.tracking.candidateCount,
                        resetReason: view.tracking.resetReason,
                        skipped,
                        resetCounts: { ...(view.tracking.resetCounts || {}) },
                        trace: view.tracking.trace || [],
                    };
                    const result = [];
                    for (const message of view.messages) {
                        const sourceMessageId = sha256('zalo:' + message.id);
                        if (message.direction !== 'inbound') continue;
                        if (watcher.baselineSeen.has(sourceMessageId)) { skipped.baseline++; continue; }
                        if (watcher.seen.has(sourceMessageId)) { skipped.duplicate++; continue; }
                        // Never consume incomplete/future rows: later hydration may
                        // supply proof. Baseline IDs, however, stay suppressed.
                        if (message.createdMinute === null) { skipped.time++; continue; }
                        if (message.createdMinute < watcher.initialBaselineMinute) {
                            skipped.baseline++;
                            remember(watcher, sourceMessageId);
                        } else if (message.createdMinute > view.capturedAt) { skipped.future++; }
                        else if (!eligible.has(message.id)) { skipped.untracked++; }
                        else if (message.text) {
                            remember(watcher, sourceMessageId);
                            result.push({ sourceMessageId, conversationKey: watcher.contactKey, text: message.text, phone, name });
                        }
                    }
                    return result;
                }
                await page.evaluate(trackInbox);
                const view = await assertPrivate(page, phone, name);
                assertHistoryReady(view);
                const tracking = view.tracking;
                if (!tracking) throw new Error('Missing DOM tracker');
                const baseline = JSON.stringify([view.conversationKey, tracking.token, tracking.epoch]);
                const reset = watcher.baseline !== baseline;
                watcher.baseline = baseline;
                if (reset) watcher.baselineAt = view.capturedAt;
                const eligible = new Set(tracking.eligible);
                const result = [];
                for (const message of view.messages) {
                    const key = JSON.stringify([view.conversationKey, message.id]);
                    if (!reset && !watcher.seen.has(key) && eligible.has(message.id) && message.direction === 'inbound') {
                        // Mounting at the bottom proves neither live arrival nor
                        // freshness. Never treat delayed history as a new event.
                        if (!message.liveArrival || message.createdAt === null ||
                            message.createdAt <= watcher.baselineAt || message.createdAt > view.capturedAt) {
                            throw unsupportedInbox('New inbound row lacks verified live-arrival evidence and an absolute timestamp newer than baseline (and not future); real DOM verification required');
                        }
                        if (message.text) result.push({ sourceMessageId: message.id, conversationKey: view.conversationKey,
                            text: message.text, phone, name });
                    }
                    // Session-only suppression, not durable delivery/retention.
                    // The main store must persist dedup by uid + conversationKey + sourceMessageId.
                    remember(watcher, key);
                }
                return result;
            });
            if (!active()) return;
            setStatus(uid, 'monitoring', watcher.mode === 'live' ? liveDetail(watcher) :
                'Monitoring explicit private/history-ready/live-arrival fixture contract; real DOM semantics are not live-verified', watcher);
            // Callbacks run outside the session lock so they may dispatch a reply.
            for (const event of events) {
                if (!active()) break;
                try {
                    await onMessage(event);
                    watcher.reader.deliveredCount++;
                    setStatus(uid, 'monitoring', watcher.mode === 'live' ? liveDetail(watcher) : 'Monitoring fixture contract', watcher);
                }
                catch (_) {
                    if (active()) {
                        stopWatching(uid);
                        setStatus(uid, 'error', 'Message callback failed; watcher stopped (no automatic retry)', watcher);
                    }
                    break;
                }
            }
        } catch (error) {
            if (active()) {
                stopWatching(uid);
                setStatus(uid, error.capacity ? 'capacity' : 'unsupported', (error.capacity ? error.message :
                    error.domDetail || 'Private DOM evidence lost or ambiguous') + '; watcher stopped. Reconnect to establish a new baseline', watcher);
            }
        } finally {
            if (active()) {
                watcher.timer = setTimeout(tick, 2000);
                if (watcher.timer.unref) watcher.timer.unref();
            }
        }
    };
    await tick();
    return () => { if (watchers.get(uid) === watcher) stopWatching(uid); };
}
async function diagnostics(uid) {
    return withSessionLock(uid, async () => {
        const context = contexts.get(uid);
        if (!context) throw new Error('Hãy mở Zalo và đăng nhập trước');
        const pages = context.pages().filter(page => /^https:\/\/chat\.zalo\.me(?:\/|$)/.test(page.url()));
        if (!pages.length) throw new Error('Không tìm thấy cửa sổ Zalo Web');
        const reports = [];
        for (const [index, page] of pages.entries()) {
            const frames = [];
            for (const [frameIndex, frame] of page.frames().entries()) {
                // Do not inspect authentication/payment/third-party frames.
                if (!/^https:\/\/chat\.zalo\.me(?:\/|$)/.test(frame.url())) continue;
                try {
                    frames.push({ index: frameIndex, main: frame === page.mainFrame(), report: await frame.evaluate(require('./zaloDomDiagnostics').inspectStructure) });
                } catch (_) { frames.push({ index: frameIndex, unavailable: true }); }
            }
            reports.push({ index, totalFrames: page.frames().length, frames });
        }
        return {
            version: 3,
            editorFound: reports.some(page => page.frames.some(frame => frame.report?.editorFound)),
            detail: 'Kiểm tra các tab Zalo và frame cùng origin; chỉ xuất cấu trúc, không xuất nội dung tin, URL, cookie hoặc giá trị thuộc tính. Observed DOM and conditional image adapter are not live end-to-end verified.',
            pages: reports,
        };
    });
}
module.exports = { open, send, sendReply, isOpen, withSessionLock, startWatching, stopWatching, getWatchStatus, sendImage, diagnostics };
