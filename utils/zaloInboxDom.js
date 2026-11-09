// Fail-closed contract, NOT live-verified Zalo markup. The known search/editor
// selectors do not prove private-thread identity or message direction.
// A supported DOM must explicitly supply the attributes below. Missing evidence
// is diagnostic, never permission to infer an incoming message or recipient.
// Contract (fixture-tested only):
// - One visible #chatView/#chat-view, data-chat-type="private", a nonempty
//   data-thread-id (or data-conversation-id), data-peer-phone/data-peer-name.
// - One contained #richInput[contenteditable="true"] with matching data-trailer,
//   and one visible [data-message-scroll] history viewport.
// - .chat-item rows with unique data-message-id/data-msg-id/id; multiple ID
//   attributes must agree. Explicit data-direction="inbound"/"outbound" or
//   .incoming/.from-them vs .me/.from-me. Not-me NEVER implies incoming.
// - Text comes only from one [data-message-text] or .message-text per row.
//   Nontext rows are baselined but do not emit text events.
// - Watching additionally requires root data-history-ready="true". Each newly
//   eligible inbound row must have data-live-arrival="true" and data-created-at:
//   an absolute ISO timestamp with timezone or a 13-digit Unix epoch millisecond
//   timestamp, strictly newer than the baseline and not in the future.
// These are explicit fixture contract attributes, NOT guessed Zalo attributes.
// Real history-ready/live-arrival semantics and clock alignment must be verified
// against authenticated DOM before inbox support can honestly be enabled.
// Names are identity guards, never conversation IDs. No selector here is a
// claim that an authenticated Zalo version currently emits these markers.
function snapshot(document = globalThis.document) {
    const fail = detail => ({ supported: false, detail, messages: [] });
    const visible = element => !!(element && element.getClientRects().length &&
        document.defaultView.getComputedStyle(element).visibility !== 'hidden');
    const roots = [...document.querySelectorAll('#chatView, #chat-view')].filter(visible);
    if (roots.length !== 1) return fail('Expected one visible #chatView or #chat-view');
    const root = roots[0];
    const type = root.getAttribute('data-chat-type');
    if (type !== 'private' || root.querySelector('[data-chat-type="group"], .group-chat')) {
        return fail('Explicit private-chat evidence required; groups are unsupported');
    }
    const thread = root.getAttribute('data-thread-id') || root.getAttribute('data-conversation-id');
    if (!thread || !thread.trim()) return fail('Missing explicit private thread ID');
    if (root.hasAttribute('data-thread-id') && root.hasAttribute('data-conversation-id') &&
        root.getAttribute('data-thread-id') !== root.getAttribute('data-conversation-id')) {
        return fail('Conflicting thread IDs');
    }
    const phone = root.getAttribute('data-peer-phone');
    const name = root.getAttribute('data-peer-name');
    if (!phone || !name) return fail('Missing explicit private peer phone/name');
    const editors = [...document.querySelectorAll('#richInput[contenteditable="true"]')].filter(visible);
    if (editors.length !== 1 || !root.contains(editors[0])) return fail('Missing unique editor inside private thread');
    const normalize = value => String(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
    if (normalize(editors[0].getAttribute('data-trailer') || '') !== normalize(name)) {
        return fail('Editor trailer does not match private peer');
    }
    const scrolls = root.querySelectorAll('[data-message-scroll]');
    if (scrolls.length !== 1 || !visible(scrolls[0])) return fail('Missing unique explicit message scroll container');
    const capturedAt = Date.now();
    const absoluteTime = value => {
        if (!value) return null;
        let time = NaN;
        if (/^\d{13}$/.test(value)) time = Number(value);
        else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) time = Date.parse(value);
        return Number.isFinite(time) && time > 0 ? time : null;
    };
    const ids = new Set();
    const messages = [];
    // Inspect all mounted rows, including offscreen history, so hidden duplicates
    // or unknown directions cannot silently weaken the contract.
    for (const row of root.querySelectorAll('.chat-item')) {
        if (!scrolls[0].contains(row) || row.querySelector('.chat-item')) return fail('Ambiguous message row nesting/container');
        const values = ['data-message-id', 'data-msg-id', 'id'].map(key => row.getAttribute(key)).filter(Boolean);
        if (!values.length || values.some(value => value !== values[0]) || !values[0].trim()) {
            return fail('Every message needs one unambiguous stable ID');
        }
        const id = values[0];
        if (ids.has(id)) return fail('Duplicate stable message IDs');
        ids.add(id);
        const direction = row.getAttribute('data-direction');
        if (direction && !['inbound', 'outbound'].includes(direction)) return fail('Unknown message direction');
        const outgoing = row.matches('.me, .from-me') || direction === 'outbound';
        const incoming = row.matches('.from-them, .incoming') || direction === 'inbound';
        if (outgoing === incoming) return fail('Explicit, non-conflicting inbound/outbound markers required');
        const bodies = row.querySelectorAll('[data-message-text], .message-text');
        if (bodies.length > 1) return fail('Ambiguous message text');
        messages.push({ id, direction: incoming ? 'inbound' : 'outbound', text: bodies.length ? bodies[0].textContent.trim() : '',
            liveArrival: row.getAttribute('data-live-arrival') === 'true',
            createdAt: absoluteTime(row.getAttribute('data-created-at')) });
    }
    const tracker = document.defaultView.__tikoderInboxTracker;
    const tracking = tracker && tracker.root === root ? {
        token: tracker.token, epoch: tracker.epoch,
        eligible: [...tracker.eligible].map(row => row.getAttribute('data-message-id') || row.getAttribute('data-msg-id') || row.id)
    } : null;
    return { supported: true, tracking, capturedAt, historyReady: root.getAttribute('data-history-ready') === 'true', detail: 'Explicit private DOM contract present (not live-verified selectors)',
        conversationKey: 'private:' + thread, phone, name, messages };
}

// Browser-serializable. Track structural changes between polls; scrolling,
// history insertion, row replacement, or loss of the root invalidates baseline.
// No external closures and no text/credentials retained in the tracker.
function trackInbox() {
    const key = '__tikoderInboxTracker';
    const root = document.querySelector('#chatView, #chat-view');
    const old = window[key];
    if (old && old.root === root && root && root.isConnected) return;
    if (old) old.dispose();
    if (!root) { delete window[key]; return; }
    const rows = () => [...root.querySelectorAll('.chat-item')];
    const tracker = { root, token: crypto.randomUUID(), epoch: 0, rows: rows(), eligible: new Set() };
    const reset = () => { tracker.epoch++; tracker.eligible.clear(); };
    const bottom = () => {
        // Require a single explicit scroll container rather than guessing which
        // ancestor owns the conversation's history viewport.
        const views = root.querySelectorAll('[data-message-scroll]');
        return views.length === 1 && views[0].scrollHeight - views[0].clientHeight - views[0].scrollTop <= 32;
    };
    const observer = new MutationObserver(records => {
        if (records.some(record => record.type === 'attributes' && record.target === root)) reset();
        const next = rows();
        const prefix = tracker.rows.every((row, index) => row === next[index]);
        if (!prefix || !bottom()) reset();
        else for (const row of next.slice(tracker.rows.length)) tracker.eligible.add(row);
        const mounted = new Set(next);
        for (const row of tracker.eligible) if (!mounted.has(row)) tracker.eligible.delete(row);
        tracker.rows = next;
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    document.addEventListener('scroll', reset, true);
    tracker.dispose = () => { observer.disconnect(); document.removeEventListener('scroll', reset, true); };
    window[key] = tracker;
}

module.exports = { snapshot, trackInbox };
