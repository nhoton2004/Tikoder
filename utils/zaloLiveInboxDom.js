'use strict';

// Structural adapter for the sanitized version-3 DOM export, not an authenticated
// end-to-end verification. All exports are standalone page.evaluate functions.
// supported means readable markup ONLY. The parent must first select the exact
// phone/name, then verify a pinned node identity proof before and after each read.
// Searching/reselecting every poll mutates history and is not an observation.
// #chatView is reused across contacts: rootKey is NOT a conversation/peer key.
// The parent must also deduplicate IDs in its own verified-contact namespace and
// require tracker eligibility, createdMinute >= its initial baseline minute floor,
// and createdMinute <= its clock. Previously unmounted same-minute history can
// be indistinguishable from a live tail append; DOM proof cannot resolve that.
function snapshotLive(document = globalThis.document) {
    const fail = detail => ({ supported: false, detail, requiresIdentityGuard: true, messages: [] });
    if (!document || !document.defaultView) return fail('Browser document required');
    const view = document.defaultView;
    const visible = element => !!(element && element.getClientRects().length &&
        view.getComputedStyle(element).visibility === 'visible');
    const one = (parent, selector) => {
        const nodes = parent.querySelectorAll(selector);
        return nodes.length === 1 ? nodes[0] : null;
    };
    const validId = value => typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,200}$/u.test(value);
    const roots = [...document.querySelectorAll('#chatView')].filter(visible);
    if (roots.length !== 1 || roots[0].tagName !== 'ARTICLE') return fail('Expected one visible article#chatView');
    const root = roots[0];
    const editors = [...document.querySelectorAll('#richInput[contenteditable="true"]')].filter(visible);
    if (editors.length !== 1 || !root.contains(editors[0])) return fail('Expected one visible editor inside #chatView');
    const editor = editors[0];
    const editorName = (editor.getAttribute('data-trailer') || '').trim();
    if (!editorName || editorName.length > 200 || /[\x00-\x1f\x7f]/u.test(editorName)) {
        return fail('Missing or invalid bounded editor trailer for parent verification');
    }
    const messageView = one(root, '.message-view');
    const outer = messageView && one(messageView, '.message-view__scroll');
    const inner = outer && one(outer, '.message-view__scroll__inner');
    if (!inner || !visible(inner) || inner.contains(editor)) return fail('Missing unique visible message history structure');
    let scroll = null;
    for (let node = inner.parentElement; node && outer.contains(node); node = node.parentElement) {
        if (node.matches('.transform-gpu, .message-view__scroll') && visible(node) && node.clientHeight > 0 &&
            /^(auto|scroll|overlay)$/.test(view.getComputedStyle(node).overflowY)) { scroll = node; break; }
    }
    if (!scroll) return fail('Missing observed history scroll container');
    const atBottom = scroll.scrollTop >= -1 && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 32;
    const capturedAt = Date.now();
    const skipped = {};
    const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
    const rows = [...root.querySelectorAll('.chat-item')];
    if (rows.some(row => !inner.contains(row) || row.querySelector('.chat-item'))) return fail('Ambiguous history row nesting/container');

    function createdMinute(row, frame) {
        const block = row.closest('.block-date');
        if (!block || !inner.contains(block)) return null;

        let nearestDateSep = null;
        let timeOnlySep = null;


        for (let sibling = row.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
            if (sibling.matches('.chat-date')) {
                const label = one(sibling, '.content');
                if (label && visible(label)) {
                    const text = label.innerText.replace(/\s+/g, ' ').trim();
                    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) {
                        if (!timeOnlySep) timeOnlySep = text;
                        continue;
                    }
                    if (!nearestDateSep) nearestDateSep = { el: sibling, text };
                    break;
                }
            }
        }

        if (!nearestDateSep) {
            for (let prevBlock = block.previousElementSibling; prevBlock; prevBlock = prevBlock.previousElementSibling) {
                if (prevBlock.matches('.block-date')) {
                    const seps = [...prevBlock.querySelectorAll('.chat-date')];
                    for (let i = seps.length - 1; i >= 0; i--) {
                        const label = one(seps[i], '.content');
                        if (label && visible(label)) {
                            const text = label.innerText.replace(/\s+/g, ' ').trim();
                            if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) {
                                nearestDateSep = { el: seps[i], text };
                                break;
                            }
                        }
                    }
                    if (nearestDateSep) break;
                }
            }
        }

        if (!nearestDateSep || nearestDateSep.text.length > 80) return null;

        const dayText = nearestDateSep.text;
        const now = new Date(capturedAt);
        let year, month, day;


        const relativeDay = /^(?:(?:[01]\d|2[0-3]):[0-5]\d )?hôm (nay|qua)$/iu.exec(dayText);
        if (relativeDay) {
            const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (/^qua$/iu.test(relativeDay[1])) {
                date.setDate(date.getDate() - 1);
            }
            [year, month, day] = [date.getFullYear(), date.getMonth(), date.getDate()];
        } else {
            const match = /^(?:(?:thứ (?:hai|ba|tư|năm|sáu|bảy|[2-7])|chủ nhật|t[2-7]|cn),?\s+)?(\d{2})\/(\d{2})\/(\d{4})$/iu.exec(dayText);
            if (!match) return null;
            [day, month, year] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
            if (year < 1000 || year > 9999) return null;
        }

        let hour = null, minute = null;

        const times = frame.querySelectorAll('.card-send-time');
        if (times.length > 1) return null;
        const time = times[0];
        if (time && !visible(time)) return null;
        if (time) {
            const timeText = time.innerText.replace(/\s+/g, ' ').trim();
            if (timeText.length <= 120) {
                const matches = [...timeText.matchAll(/(?:^|\s)([0-2]\d:[0-5]\d)(?=\s|$)/g)];
                if (matches.length === 1 && (timeText.match(/:/g) || []).length === 1) {
                    const [h, m] = matches[0][1].split(':').map(Number);
                    if (h <= 23) { hour = h; minute = m; }
                }
            }
        }

        // An invalid explicit clock must not be rescued by a separator.
        if (time && hour === null) return null;
        if (!time && timeOnlySep) {
            const [h, m] = timeOnlySep.split(':').map(Number);
            if (h <= 23) { hour = h; minute = m; }
        }


        if (hour === null || minute === null) return null;

        const date = new Date(year, month, day, hour, minute, 0, 0);
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day ||
            date.getHours() !== hour || date.getMinutes() !== minute) return null;

        return date.getTime() <= capturedAt ? date.getTime() : null;
    }

    function plainText(frame) {
        const action = one(frame, '.message-action');
        const payload = action && action.parentElement;
        if (!action || !visible(action) || !payload.matches('div[data-id]') || payload.parentElement !== frame) return null;
        // These are conservative rejection heuristics, NOT asserted Zalo text
        // selectors. Unknown widgets, quotations, attachments and previews skip
        // the entire row instead of mixing their labels into a customer's text.
        const blockedClass = /(?:^|[-_])(quote|quoted|reply|replied|preview|attachment|file|image|photo|video|audio|sticker|button)(?:$|[-_])/i;
        for (const node of [action, ...action.querySelectorAll('*')]) {
            // Zalo's text renderer uses numbered span tags (observed SPAN-15).
            // Their descendants still pass the same attachment/widget checks.
            const numberedTextSpan = /^SPAN-\d+$/.test(node.tagName) && !!node.closest('.text-message__container');
            if ((!/^(DIV|SPAN|P|BR|B|STRONG|I|EM|U|S|DEL|SMALL|A|CODE|PRE)$/.test(node.tagName) && !numberedTextSpan) ||
                [...node.classList].some(value => blockedClass.test(value)) ||
                (node.hasAttribute('role') && !['none', 'presentation'].includes(node.getAttribute('role'))) ||
                node.hasAttribute('onclick') || node.hasAttribute('contenteditable') || node.hasAttribute('download') ||
                node.hasAttribute('data-file') || node.hasAttribute('data-attachment')) return null;
        }
        // Reject obvious sibling previews/quotes too, but don't inspect the
        // floating menu, send-time or reaction region outside the actual action.
        for (const node of frame.querySelectorAll('*')) {
            if (node === action || action.contains(node) || node.closest('.card-send-time, .message-reaction-container')) continue;
            if ([...node.classList].some(value => blockedClass.test(value)) ||
                /^(IMG|VIDEO|AUDIO|IFRAME|OBJECT|EMBED|BUTTON|INPUT)$/.test(node.tagName)) return null;
        }
        const text = action.innerText.replace(/\r\n?/g, '\n').trim();
        if (!text || text.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) return null;
        return text;
    }

    const messages = [];
    const identities = new Map();
    const ids = new Set(), frameIds = new Set(), chatIds = new Set();
    for (const row of rows) {
        const content = one(row, '.chat-content');
        const chat = content && one(content, '.chat-message');
        const wrapper = chat && one(chat, '.message-wrapper');
        const contentWrapper = wrapper && one(wrapper, '.message-content-wrapper');
        const render = contentWrapper && one(contentWrapper, '.message-content-render');
        const frame = render && one(render, '.message-frame');
        if (!frame || content.parentElement !== row || chat.parentElement !== content || wrapper.parentElement !== chat ||
            contentWrapper.parentElement !== wrapper || render.parentElement !== contentWrapper || frame.parentElement !== render ||
            !visible(row) || !visible(frame)) { skip('structure'); continue; }
        const id = frame.getAttribute('data-qid');
        const frameId = frame.id, chatMessageId = chat.id;
        if (!validId(id) || !validId(frameId) || !validId(chatMessageId)) { skip('identity'); continue; }
        // These are independent identifiers. The export proves their presence,
        // not that chat-message.id, frame.id and data-qid have equal values.
        if (ids.has(id) || frameIds.has(frameId) || chatIds.has(chatMessageId)) return fail('Duplicate message identifiers');
        ids.add(id); frameIds.add(frameId); chatIds.add(chatMessageId);
        const menus = render.querySelectorAll('.floating-menu-wrapper, .floating-menu-wrapper--other, .floating-menu-wrapper--me');
        if (menus.length !== 1 || menus[0].parentElement !== render) { skip('direction'); continue; }
        const menu = menus[0];
        const own = [row, chat, frame].map(node => node.classList.contains('me'));
        const otherMenu = menu.classList.contains('floating-menu-wrapper--other');
        const ownMenu = menu.classList.contains('floating-menu-wrapper--me');
        let direction;
        if (own.every(Boolean) && wrapper.classList.contains('message-wrapper--me') && ownMenu && !otherMenu) direction = 'outbound';
        else if (own.every(value => !value) && !wrapper.classList.contains('message-wrapper--me') && otherMenu && !ownMenu) direction = 'inbound';
        else { skip('direction'); continue; }
        const text = plainText(frame);
        if (text === null) { skip('plaintext'); continue; }
        const minute = createdMinute(row, frame);
        messages.push({ id, frameId, chatMessageId, text, direction, createdMinute: minute });
        identities.set(id, { row, frame, chat });
    }
    const tracker = view.__tikoderLiveInboxTracker;
    let tracking = null;
    if (tracker && !tracker.invalidated && tracker.root === root && tracker.inner === inner &&
        tracker.scroll === scroll && tracker.editor === editor && tracker.editorName === editorName &&
        tracker.rows.length === rows.length && tracker.rows.every((row, index) => row === rows[index])) {
        const eligible = [];
        for (const message of messages) {
            const nodes = identities.get(message.id);
            const entry = tracker.eligible.get(nodes.row);
            if (!entry || tracker.baselineRows.has(nodes.row) || tracker.candidates.get(nodes.row) !== entry ||
                entry.id !== message.id || entry.frameId !== message.frameId || entry.chatMessageId !== message.chatMessageId ||
                entry.frame !== nodes.frame || entry.chat !== nodes.chat || message.direction !== 'inbound') continue;
            // Only a previously observed own clock can survive validated grouping.
            // Never synthesize a minute for a candidate first read without its time.
            if (entry.suppression) {
                message.createdMinute = tracker.validSuppression(entry) && entry.createdMinute !== undefined ? entry.createdMinute : null;
            } else if (message.createdMinute !== null) {
                const times = nodes.frame.querySelectorAll('.card-send-time');
                if (entry.clock && (times.length !== 1 || !visible(times[0]) ||
                    !times[0].innerText.split(/\s+/).includes(entry.clock))) {
                    message.createdMinute = null;
                    continue;
                }
                if (entry.createdMinute === undefined) entry.createdMinute = message.createdMinute;
                if (entry.createdMinute !== message.createdMinute) message.createdMinute = null;
            }
            if (atBottom && tracker.atBottom && !tracker.pendingTailFollow &&
                message.createdMinute !== null && message.createdMinute >= tracker.baselineMinute && message.createdMinute <= capturedAt) {
                eligible.push(message.id);
            }
        }
        tracking = { token: tracker.token, epoch: tracker.epoch, baselineMinute: tracker.baselineMinute, atBottom, eligible,
            pendingTailFollow: !!tracker.pendingTailFollow, candidateCount: tracker.candidates.size,
            resetReason: tracker.resetReason, resetCounts: { ...tracker.resetCounts },
                        trace: tracker.trace.map(event => ({ ...event, mutations: event.mutations.map(mutation => ({ ...mutation })) })) };
    }
    return { supported: true, detail: 'Observed live DOM shape only; parent contact identity guard required every poll',
        requiresIdentityGuard: true, editorName, rootKey: root.id, capturedAt, atBottom, messages, skipped, tracking };
}

// Call before snapshotLive on every poll (also flushes queued mutations).
// Polling capture only: transient rows removed before a poll are deliberately
// dropped. Bounded in-page tail proofs retain DOM/text for exact comparison only;
// no phone, credentials or guessed message times are retained.
function trackLiveInbox(document = globalThis.document) {
    const key = '__tikoderLiveInboxTracker';
    if (!document || !document.defaultView) return { supported: false, detail: 'Browser document required' };
    const view = document.defaultView;
    const visible = element => !!(element && element.getClientRects().length && view.getComputedStyle(element).visibility === 'visible');
    const roots = [...document.querySelectorAll('#chatView')].filter(visible);
    const root = roots.length === 1 && roots[0].tagName === 'ARTICLE' ? roots[0] : null;
    const editors = [...document.querySelectorAll('#richInput[contenteditable="true"]')].filter(visible);
    const editor = editors.length === 1 && root && root.contains(editors[0]) ? editors[0] : null;
    const inners = root ? root.querySelectorAll('.message-view .message-view__scroll .message-view__scroll__inner') : [];
    const inner = inners.length === 1 && visible(inners[0]) ? inners[0] : null;
    const outer = inner && inner.closest('.message-view__scroll');
    let scroll = null;
    for (let node = inner && inner.parentElement; node && outer.contains(node); node = node.parentElement) {
        if (node.matches('.transform-gpu, .message-view__scroll') && visible(node) && node.clientHeight > 0 &&
            /^(auto|scroll|overlay)$/.test(view.getComputedStyle(node).overflowY)) { scroll = node; break; }
    }
    const editorName = editor && (editor.getAttribute('data-trailer') || '').trim();
    const old = view[key];
    if (old && !old.invalidated && old.root === root && old.inner === inner && old.scroll === scroll &&
        old.editor === editor && old.editorName === editorName && root && root.isConnected) {
        old.flush();
        if (!old.invalidated) return { supported: true, token: old.token, epoch: old.epoch, baselineMinute: old.baselineMinute };
    }
    if (old) { old.dispose(); delete view[key]; }
    if (!root || !editor || !inner || !scroll || !editorName || editorName.length > 200) {
        return { supported: false, detail: 'Missing unique observed root, editor/trailer or scroll structure' };
    }
    const rows = () => [...inner.querySelectorAll('.chat-item')];
    const bottom = () => visible(scroll) && scroll.clientHeight > 0 && scroll.scrollTop >= -1 &&
        scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 32;
    const token = typeof view.crypto.randomUUID === 'function' ? view.crypto.randomUUID() :
        [...view.crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-');
    const validId = value => typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,200}$/u.test(value);
    const localDay = () => new Date().toDateString();
    const baselineIds = mounted => {
        const result = { id: new Set(), frameId: new Set(), chatMessageId: new Set() };
        for (const row of mounted) {
            for (const frame of row.querySelectorAll('.message-frame')) {
                if (validId(frame.getAttribute('data-qid'))) result.id.add(frame.getAttribute('data-qid'));
                if (validId(frame.id)) result.frameId.add(frame.id);
            }
            for (const chat of row.querySelectorAll('.chat-message')) if (validId(chat.id)) result.chatMessageId.add(chat.id);
        }
        return result;
    };
    const position = () => ({ top: scroll.scrollTop, height: scroll.scrollHeight, client: scroll.clientHeight });
    const tracker = { root, inner, scroll, editor, editorName, token, epoch: 0, rows: rows(),
        baselineMinute: Math.floor(Date.now() / 60000) * 60000, baselineDay: localDay(), atBottom: bottom(),
        position: position(), pendingTailFollow: null, tailFollowWindowMs: 1500, userScrollBlocked: false,
        resetReason: 'initial-baseline', resetCounts: {}, trace: [],
        eligible: new Map(), candidates: new Map(), candidateLimit: 64, invalidated: false };
    tracker.baselineRows = new Set(tracker.rows);
    tracker.baselineIds = baselineIds(tracker.rows);
    // Fixed structural roles only: never retain DOM nodes, class/attribute
    // values, IDs, payloads or contact details in the exported trace.
    const trace = (event, reason, records = []) => {
        const region = node => {
            const element = node.nodeType === 1 ? node : node.parentElement;
            if (!element) return 'detached';
            if (element === editor || editor.contains(element)) return 'editor';
            for (const [selector, role] of [
                ['.card-send-time', 'timestamp'], ['.message-action', 'payload'],
                ['.message-reaction-container', 'reaction'], ['.floating-menu-wrapper', 'menu'],
                ['.message-frame', 'frame'], ['.chat-message', 'message'], ['.chat-item', 'row'],
            ]) if (inner.contains(element) && element.closest(selector)) return role;
            if (element === inner || inner.contains(element)) return 'history';
            if (element === root) return 'root';
            return root.contains(element) ? 'outside-history' : 'outside-root';
        };
        const attributes = ['id', 'data-qid', 'class', 'style', 'contenteditable', 'data-trailer'];
        tracker.trace.push({ at: new Date().toISOString(), event, reason, epoch: tracker.epoch,
            candidatesBefore: tracker.candidates.size, rowsBefore: tracker.rows.length,
            rowsAfter: rows().length, atBottom: bottom(), mutationCount: records.length,
            mutations: records.slice(0, 8).map(record => ({
                kind: ['attributes', 'childList', 'characterData'].includes(record.type) ? record.type : 'other',
                region: region(record.target),
                attribute: record.type !== 'attributes' ? 'none' : attributes.includes(record.attributeName)
                    ? record.attributeName : record.attributeName.startsWith('aria-') ? 'aria' : 'other',
                added: record.addedNodes ? record.addedNodes.length : 0,
                removed: record.removedNodes ? record.removedNodes.length : 0,
            })) });
        if (tracker.trace.length > 24) tracker.trace.shift();
    };
    const reset = (reason, records = []) => {
        trace('reset', reason, records);
        tracker.epoch++;
        tracker.resetReason = reason;
        tracker.resetCounts[reason] = (tracker.resetCounts[reason] || 0) + 1;
        tracker.pendingTailFollow = null;
        tracker.eligible.clear();
        const candidateRows = [...tracker.candidates.keys()];
        tracker.candidates.clear();
        tracker.rows = rows();
        tracker.baselineRows = new Set(tracker.rows);
        // Removed rows can already be gone at observer delivery. Quarantine
        // their IDs too, so recycling them cannot become a same-minute arrival.
        const removedRows = records.flatMap(record => [...record.removedNodes || []].flatMap(node =>
            node.nodeType === 1 ? [ ...(node.matches('.chat-item') ? [node] : []), ...node.querySelectorAll('.chat-item') ] : []));
        tracker.baselineIds = baselineIds([...tracker.rows, ...candidateRows, ...removedRows]);
        tracker.atBottom = bottom();
        tracker.position = position();
        tracker.baselineMinute = Math.floor(Date.now() / 60000) * 60000;
        tracker.baselineDay = localDay();
        tracker.baselineReceipts = baselineReceipts();
        tailProof = groupingProof(tracker.rows[tracker.rows.length - 1]);
    };
    const removedContains = (records, node) => records.some(record => [...record.removedNodes || []]
        .some(removed => removed === node || removed.contains(node)));
    const clockOf = frame => {
        const times = frame ? frame.querySelectorAll('.card-send-time') : [];
        if (times.length !== 1 || !visible(times[0])) return null;
        const text = times[0].innerText.replace(/\s+/g, ' ').trim();
        if (text.length > 120 || (text.match(/:/g) || []).length !== 1) return null;
        const matches = [...text.matchAll(/(?:^|\s)((?:[01]\d|2[0-3]):[0-5]\d)(?=\s|$)/g)];
        return matches.length === 1 ? matches[0][1] : null;
    };
    // Only plain-text, recognized outbound receipt labels qualify. Unknown
    // widgets/markup and arbitrary text in the time region remain mutations.
    const receiptClock = text => {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        const match = normalized.match(/^(?:(Đang gửi|Đã gửi|Đã nhận|Đã xem) )?((?:[01]\d|2[0-3]):[0-5]\d)(?: (Đang gửi|Đã gửi|Đã nhận|Đã xem))?$/);
        return match && !(match[1] && match[3]) ? match[2] : null;
    };
    const outboundReceipt = row => {
        const frames = row.querySelectorAll('.message-frame'), chats = row.querySelectorAll('.chat-message');
        const wrappers = row.querySelectorAll('.message-wrapper'), menus = row.querySelectorAll('.floating-menu-wrapper');
        if (frames.length !== 1 || chats.length !== 1 || wrappers.length !== 1 || menus.length !== 1) return null;
        const frame = frames[0], chat = chats[0], wrapper = wrappers[0], menu = menus[0];
        const times = frame.querySelectorAll('.card-send-time');
        if (![row, chat, frame].every(node => node.classList.contains('me')) ||
            !wrapper.classList.contains('message-wrapper--me') || !menu.classList.contains('floating-menu-wrapper--me') ||
            menu.classList.contains('floating-menu-wrapper--other') || times.length !== 1) return null;
        const time = times[0], id = frame.getAttribute('data-qid'), frameId = frame.id, chatMessageId = chat.id;
        const clock = receiptClock(time.textContent);
        if (time.children.length || !clock || ![id, frameId, chatMessageId].every(validId)) return null;
        return { frame, chat, wrapper, menu, time, id, frameId, chatMessageId, clock };
    };
    const baselineReceipts = () => new Map(tracker.rows.flatMap(row => {
        const proof = outboundReceipt(row);
        return proof ? [[row, proof]] : [];
    }));
    tracker.baselineReceipts = baselineReceipts();
    const receiptOnly = record => {
        if (!['childList', 'characterData'].includes(record.type)) return false;
        const time = record.type === 'characterData' ? record.target.parentNode : record.target;
        const row = time && time.nodeType === 1 && time.closest('.chat-item');
        const proof = tracker.baselineReceipts.get(row);
        if (!proof || time !== proof.time) return false;
        const current = outboundReceipt(row);
        if (!current || Object.keys(proof).some(key => current[key] !== proof[key])) return false;
        if (record.type === 'characterData') return receiptClock(record.oldValue) === proof.clock &&
            receiptClock(record.target.data) === proof.clock;
        const before = [...record.removedNodes], after = [...record.addedNodes];
        return before.length > 0 && after.length > 0 && [...before, ...after].every(node => node.nodeType === 3) &&
            receiptClock(before.map(node => node.textContent).join('')) === proof.clock &&
            receiptClock(after.map(node => node.textContent).join('')) === proof.clock;
    };
    // A single prior-tail proof, plus at most candidateLimit suppressed proofs.
    // Compare objects and exact content, not just IDs or a hash of the payload.
    const cosmeticToken = value => /^(?:(?:is-|--)?(?:focus(?:ed)?|hover(?:ed)?|highlight(?:ed)?)(?:[-_][\w-]+)?|composer-focused)$/.test(value);
    const stableNodes = (row, chat, time) => {
        const result = [];
        const visit = node => {
            if (node === time) return;
            const attributes = node.nodeType === 1 ? [...node.attributes].map(attr => [attr.name,
                attr.name === 'class' ? attr.value.split(/\s+/).filter(value => value && !cosmeticToken(value) &&
                    !(node === chat && value === '-send-time')).sort().join(' ') : attr.value
            ]).sort(([a], [b]) => a.localeCompare(b)) : null;
            result.push({ node, value: attributes ? JSON.stringify(attributes) : node.textContent });
            for (const child of node.childNodes) visit(child);
        };
        visit(row);
        return result;
    };
    const timePresentation = time => {
        const clone = time.cloneNode(false);
        for (const token of [...clone.classList]) if (token === 'card-send-time' || cosmeticToken(token)) clone.classList.remove(token);
        if (!clone.className) clone.removeAttribute('class');
        if (clone.style.display === 'none') clone.style.removeProperty('display');
        if (clone.style.visibility === 'hidden') clone.style.removeProperty('visibility');
        if (!clone.style.length) clone.removeAttribute('style');
        return JSON.stringify([...clone.attributes].map(attr => [attr.name, attr.value]).sort(([a], [b]) => a.localeCompare(b)));
    };
    const groupingProof = row => {
        if (!row) return null;
        const unique = selector => { const nodes = row.querySelectorAll(selector); return nodes.length === 1 ? nodes[0] : null; };
        const chat = unique('.chat-message'), frame = unique('.message-frame');
        const wrapper = unique('.message-wrapper'), menu = unique('.floating-menu-wrapper');
        const time = unique('.card-send-time');
        if (!chat || !frame || !wrapper || !menu || !time || !visible(row) || !visible(frame) || !visible(time) ||
            [row, chat, frame].some(node => node.classList.contains('me')) || wrapper.classList.contains('message-wrapper--me') ||
            !menu.classList.contains('floating-menu-wrapper--other') || menu.classList.contains('floating-menu-wrapper--me') ||
            ![frame.getAttribute('data-qid'), frame.id, chat.id].every(validId) || time.children.length ||
            !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time.textContent.trim()) || !clockOf(frame)) return null;
        return { row, chat, frame, time, parent: time.parentNode, clock: clockOf(frame),
            text: time.textContent, presentation: timePresentation(time), nodes: stableNodes(row, chat, time) };
    };
    const unchangedGrouping = proof => {
        const current = stableNodes(proof.row, proof.chat, proof.time);
        return current.length === proof.nodes.length && current.every((item, i) =>
            item.node === proof.nodes[i].node && item.value === proof.nodes[i].value) &&
            proof.time.textContent === proof.text && timePresentation(proof.time) === proof.presentation;
    };
    const suppressed = proof => !proof.row.contains(proof.time) || !proof.time.matches('.card-send-time') || !visible(proof.time);
    let tailProof = groupingProof(tracker.rows[tracker.rows.length - 1]);
    tracker.validSuppression = entry => unchangedGrouping(entry.suppression) && suppressed(entry.suppression);
    const refreshCandidates = () => {
        const seen = Object.fromEntries(Object.entries(tracker.baselineIds).map(([key, values]) => [key, new Set(values)]));
        for (const [row, entry] of tracker.candidates) {
            const frames = row.querySelectorAll('.message-frame'), chats = row.querySelectorAll('.chat-message');
            if (frames.length > 1 || chats.length > 1) return false;
            const frame = frames[0] || null, chat = chats[0] || null;
            if ((entry.frame && entry.frame !== frame) || (entry.chat && entry.chat !== chat)) return false;
            entry.frame = frame; entry.chat = chat;
            const current = { id: frame && frame.getAttribute('data-qid'), frameId: frame && frame.id, chatMessageId: chat && chat.id };
            for (const [key, value] of Object.entries(current)) {
                // Hydration may supply missing IDs once; a valid ID may never be
                // changed, recycled from baseline, or shared by candidate rows.
                if (entry[key] && entry[key] !== value) return false;
                if (!validId(value)) continue;
                if (seen[key].has(value)) return false;
                seen[key].add(value); entry[key] = value;
            }
            // Pin the first known message clock even if text/IDs are incomplete.
            // A historical candidate cannot be promoted by editing its time.
            // Status-token updates are allowed when the actual HH:mm is stable.
            const clock = clockOf(frame);
            if (entry.suppression) {
                if (!tracker.validSuppression(entry)) return false;
            } else if (entry.clock && entry.clock !== clock) return false;
            if (clock && !entry.clock) entry.clock = clock;
            if (Object.values(current).every(validId)) tracker.eligible.set(row, entry);
            else tracker.eligible.delete(row);
        }
        return true;
    };
    const process = records => {
        if (!records.length || tracker.invalidated) return;
        if (!root.isConnected || !root.contains(inner) || !root.contains(editor) || !root.contains(scroll) ||
            removedContains(records, inner) || removedContains(records, editor) || removedContains(records, scroll) ||
            (editor.getAttribute('data-trailer') || '').trim() !== editorName) {
            reset('structure-or-identity-change', records); tracker.invalidated = true; return;
        }
        const next = rows();
        const prefix = tracker.rows.every((row, index) => row === next[index]);

        const removedStructure = records.some(record => [...record.removedNodes || []].some(node => node.nodeType === 1 &&
            (node.matches('.chat-item, .chat-message, .message-frame') || node.querySelector('.chat-item, .chat-message, .message-frame'))));
        const replacedCandidate = [...tracker.candidates.values()].some(entry =>
            (entry.frame && removedContains(records, entry.frame)) || (entry.chat && removedContains(records, entry.chat)));
        const changedId = records.some(record => record.type === 'attributes' && ['id', 'data-qid'].includes(record.attributeName) &&
            record.target.matches('.message-frame, .chat-message') && validId(record.oldValue) &&
            record.oldValue !== record.target.getAttribute(record.attributeName));
        // Reselecting the verified contact changes focus classes and composer
        // text. These are not history evidence; identity/structure records still
        // pass through the raw-record guards above and below.
        const cosmetic = record => {
            const inEditor = record.target === editor || editor.contains(record.target);
            if (record.type === 'attributes') {
                // Only known focus/hover/highlight tokens are cosmetic in history.
                // Structural, direction, payload and unknown classes remain evidence.
                if (record.attributeName === 'class') {
                    const before = new Set((record.oldValue || '').split(/\s+/).filter(Boolean));
                    const after = new Set(record.target.classList);
                    const changed = [...before, ...after].filter(value => before.has(value) !== after.has(value));
                    if (changed.every(cosmeticToken)) return true;
                }
                const composerAncestor = root.contains(record.target) && !inner.contains(record.target) && record.target.contains(editor);
                // Zalo briefly disables the same editor during contact selection.
                // snapshotLive still requires one visible contenteditable=true editor.
                if (record.target === editor && record.attributeName === 'contenteditable') return true;
                return (composerAncestor || inEditor) &&
                    (['class', 'style'].includes(record.attributeName) || record.attributeName.startsWith('aria-'));
            }
            if (record.type === 'characterData') return inEditor || record.target.parentNode === root;
            if (record.type !== 'childList' || (!inEditor && record.target !== root)) return false;
            const nodes = [...record.addedNodes, ...record.removedNodes];
            const structural = '#chatView, #richInput, .message-view, .message-view__scroll, .message-view__scroll__inner, .transform-gpu, .block-date, .chat-date, .chat-item, .chat-message, .message-frame';
            return nodes.every(node => node.nodeType === 3 || (inEditor && node.nodeType === 1 &&
                !node.matches(structural) && !node.querySelector(structural)));
        };
        const appended = next.slice(tracker.rows.length);
        // Suppression is accepted only alongside a fresh, fully identified inbound
        // tail in the same dated parent. All ordinary history/scroll guards below
        // still run; no baseline row is ever added to the candidates map.
        const nextProof = appended.length === 1 && groupingProof(appended[0]);
        const grouping = prefix && tailProof && nextProof && tracker.atBottom && !tracker.userScrollBlocked &&
            tailProof.row === tracker.rows[tracker.rows.length - 1] &&
            tailProof.row.parentElement === nextProof.row.parentElement && nextProof.clock >= tailProof.clock &&
            unchangedGrouping(tailProof) && suppressed(tailProof) ? tailProof : null;
        const groupingOnly = record => {
            if (!grouping) return false;
            if (record.type === 'childList') return record.target === grouping.parent && !record.addedNodes.length &&
                record.removedNodes.length === 1 && record.removedNodes[0] === grouping.time;
            if (record.type !== 'attributes') return false;
            if (record.attributeName === 'class' && [grouping.chat, grouping.time].includes(record.target)) {
                const token = record.target === grouping.chat ? '-send-time' : 'card-send-time';
                const before = (record.oldValue || '').split(/\s+/).filter(value => value && !cosmeticToken(value)).sort();
                const after = [...record.target.classList].filter(value => !cosmeticToken(value)).sort();
                return before.includes(token) && !after.includes(token) &&
                    before.filter(value => value !== token).join(' ') === after.join(' ');
            }
            if (record.target !== grouping.time || record.attributeName !== 'style') return false;
            const before = document.createElement('div');
            before.setAttribute('style', record.oldValue || '');
            const after = grouping.time.cloneNode(false);
            const hides = ['display', 'visibility'].some(key => before.style[key] !== after.style[key] &&
                after.style[key] === (key === 'display' ? 'none' : 'hidden'));
            for (const key of ['display', 'visibility']) {
                if (before.style[key] === after.style[key]) continue;
                if (before.style[key] || after.style[key] !== (key === 'display' ? 'none' : 'hidden')) return false;
                after.style.removeProperty(key);
            }
            return hides && before.style.cssText === after.style.cssText;
        };
        // Reject even transient edits in the old tail, including edits later
        // restored in the same commit. Candidate hydration elsewhere is unchanged.
        const groupingRecords = grouping && records.filter(record => record.target === grouping.time ||
            grouping.row === record.target || grouping.row.contains(record.target));
        const validGrouping = grouping && groupingRecords.length > 0 && groupingRecords.every(record => cosmetic(record) || groupingOnly(record));
        const presentationOnly = record => validGrouping && groupingOnly(record);
        // Unknown changes outside history still rebaseline. A reused root is
        // never treated as peer identity evidence.
        const touchedOld = records.some(record => !cosmetic(record) && !receiptOnly(record) && !presentationOnly(record) && [...tracker.baselineRows].some(row =>
            row === record.target || row.contains(record.target) || [...record.removedNodes || []]
                .some(removed => removed === row || removed.contains(row))));
        const outsideHistory = records.some(record => !inner.contains(record.target) && record.target !== inner && !cosmetic(record));
        const candidateRows = [...tracker.candidates.keys(), ...appended];
        const withinCandidate = node => candidateRows.some(row => row === node || row.contains(node));
        const inAppend = node => appended.some(row => node === row || row.contains(node) || node.contains(row));
        const newDate = node => node.nodeType === 1 && node.matches('.chat-date') &&
            tracker.rows.every(row => !!(row.compareDocumentPosition(node) & 4)) &&
            appended.some(row => row.parentElement === node.parentElement && !!(node.compareDocumentPosition(row) & 4));
        const completionOrAppend = records.every(record => {
            if (cosmetic(record) || receiptOnly(record) || presentationOnly(record) || withinCandidate(record.target)) return true;
            return record.type === 'childList' && !record.removedNodes.length && record.addedNodes.length > 0 &&
                [...record.addedNodes].every(node => inAppend(node) || newDate(node));
        });
        const current = position();
        const reason = !prefix ? 'history-reorder' : touchedOld ? 'baseline-mutation' :
            removedStructure || replacedCandidate ? 'message-replacement' : changedId ? 'message-identity-change' :
            outsideHistory ? 'outside-history-mutation' : !completionOrAppend ? 'unrecognized-history-mutation' :
            candidateRows.length > tracker.candidateLimit ? 'candidate-capacity' :
            tracker.baselineDay !== localDay() ? 'local-day-change' : tracker.userScrollBlocked ? 'user-scroll' :
            current.client !== tracker.position.client ? 'viewport-change' : current.top < tracker.position.top - 1 ? 'scroll-away' :
            tracker.pendingTailFollow && view.performance.now() > tracker.pendingTailFollow.deadline ? 'tail-follow-timeout' :
            !tracker.atBottom && !tracker.pendingTailFollow ? 'not-at-bottom' :
            !bottom() && !tracker.pendingTailFollow && current.height <= tracker.position.height ? 'scroll-away' : null;
        if (reason) { reset(reason, records); return; }
        // Only rows first seen as tail appends in this epoch may complete in
        // later React commits. Capacity overflow rebaselines instead of retaining
        // an unbounded history of candidate nodes/IDs (maximum 64 mounted rows).
        for (const row of appended) tracker.candidates.set(row, {});
        if (validGrouping && tracker.candidates.has(grouping.row)) tracker.candidates.get(grouping.row).suppression = grouping;
        if (!refreshCandidates()) { reset('candidate-proof-change', records); return; }
        if (appended.length) trace('append', 'none', records);
        tracker.rows = next;
        tailProof = groupingProof(next[next.length - 1]);
        tracker.atBottom = bottom();
        // A proven append/completion can grow scrollHeight before the app's next
        // task follows the tail. No eligibility while away, no cutoff advance,
        // and no deadline extension on subsequent commits in the same follow.
        if (tracker.atBottom) tracker.pendingTailFollow = null;
        else if (!tracker.pendingTailFollow) tracker.pendingTailFollow = { deadline: view.performance.now() + tracker.tailFollowWindowMs };
        tracker.position = current;
    };
    const observer = new view.MutationObserver(process);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true });
    // Watch root removal/reinsertion even when a virtualized UI puts the same DOM
    // object back before the next poll. This observer never reads sidebar text.
    const ancestors = new view.MutationObserver(records => {
        if (!root.isConnected || removedContains(records, root)) { reset('root-detached', records); tracker.invalidated = true; }
    });
    ancestors.observe(document.documentElement, { childList: true, subtree: true });
    const settleScroll = () => {
        if (tracker.invalidated) return;
        const current = position(), atBottom = bottom();
        if (tracker.userScrollBlocked) {
            if (atBottom) { reset('return-to-bottom'); tracker.userScrollBlocked = false; }
            else { tracker.atBottom = false; tracker.position = current; }
            return;
        }
        if (tracker.pendingTailFollow && view.performance.now() > tracker.pendingTailFollow.deadline) { reset('tail-follow-timeout'); return; }
        if (current.client !== tracker.position.client) { reset('viewport-change'); return; }
        if (current.top < tracker.position.top - 1) { reset('scroll-away'); return; }
        // Layout growth without a validated DOM append/completion is not evidence
        // of a new message. Validated growth already updated tracker.position.
        if (current.height !== tracker.position.height) { reset('unrecognized-layout-change'); return; }
        if (tracker.pendingTailFollow) {
            if (atBottom) tracker.pendingTailFollow = null;
        } else if (!atBottom && tracker.atBottom) { reset('scroll-away'); return; }
        else if (atBottom && !tracker.atBottom) { reset('return-to-bottom'); return; }
        tracker.atBottom = atBottom;
        tracker.position = current;
    };
    tracker.flush = () => {
        const rootRecords = ancestors.takeRecords();
        if (!root.isConnected || removedContains(rootRecords, root)) { reset('root-detached', rootRecords); tracker.invalidated = true; }
        const records = observer.takeRecords();
        // Relative labels must not roll yesterday's candidate into today's date.
        if (tracker.baselineDay !== localDay()) reset('local-day-change');
        else process(records);
        settleScroll();
    };
    // Drain mutation records first: scroll dispatch may precede delivery of the
    // observer callback. An at-bottom notification alone must not reset cutoff.
    const onScroll = () => tracker.flush();
    const onUserScroll = event => {
        if (event.type === 'wheel' && !event.deltaX && !event.deltaY) return;
        if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
        if (event.type === 'pointerdown' && event.target !== scroll) return;
        tracker.flush(); reset('user-scroll'); tracker.userScrollBlocked = true;
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) scroll.addEventListener(type, onUserScroll, { passive: true });
    tracker.dispose = () => {
        observer.disconnect(); ancestors.disconnect(); scroll.removeEventListener('scroll', onScroll);
        for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) scroll.removeEventListener(type, onUserScroll);
        tracker.eligible.clear(); tracker.candidates.clear(); tracker.pendingTailFollow = null; tracker.invalidated = true;
    };
    view[key] = tracker;
    return { supported: true, token, epoch: tracker.epoch, baselineMinute: tracker.baselineMinute };
}

function resetLiveInboxTracker(document = globalThis.document) {
    const view = document && document.defaultView;
    const tracker = view && view.__tikoderLiveInboxTracker;
    if (!tracker) return false;
    tracker.dispose();
    delete view.__tikoderLiveInboxTracker;
    return true;
}

module.exports = { snapshotLive, trackLiveInbox, resetLiveInboxTracker };
