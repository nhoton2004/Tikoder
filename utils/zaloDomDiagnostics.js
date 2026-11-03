'use strict';

// Structural evidence only. Never export text, URLs, cookie/storage, arbitrary
// attribute values, full IDs, file paths or message payloads.
function inspectStructure(document = globalThis.document) {
    const editor = document.querySelector('#richInput[contenteditable="true"]');
    const fixedIds = new Set(['richInput', 'chatView', 'chat-view', 'contact-search-input']);
    const view = document.defaultView;
    const visible = element => !!(element.getClientRects().length && view.getComputedStyle(element).visibility !== 'hidden');
    const classes = element => [...element.classList].filter(value => /^[a-zA-Z_-][a-zA-Z0-9_-]{0,63}$/.test(value)).map(value => value.replace(/[a-f0-9]{8,}/gi, 'ID').replace(/\d{3,}/g, 'N'));
    const blocked = element => ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(element.tagName);
    function describe(element) {
        const result = {
            tag: element.tagName.toLowerCase(),
            fixedId: fixedIds.has(element.id) ? element.id : undefined,
            hasId: !!element.id,
            classes: classes(element),
            attributes: [...element.attributes].map(item => item.name).filter(value => /^(data-[a-z0-9_-]+|role|contenteditable|type|accept|aria-[a-z-]+)$/.test(value)),
            children: element.children.length, visible: visible(element),
        };
        const editable = element.getAttribute('contenteditable');
        if (['true', 'false', 'plaintext-only', ''].includes(editable)) result.editableKind = editable || 'inherited';
        if (element.tagName === 'INPUT') {
            const kind = element.type;
            result.inputKind = ['text', 'search', 'tel', 'email', 'password', 'file', 'hidden', 'button', 'submit', 'checkbox', 'radio'].includes(kind) ? kind : 'other';
            if (kind === 'file') result.acceptKinds = (element.getAttribute('accept') || '').toLowerCase().split(',').map(x => x.trim()).filter(x => ['image/*', 'image/png', 'image/jpeg', 'image/webp', 'video/*', '*/*', '.png', '.jpg', '.jpeg', '.webp'].includes(x));
        }
        if (element.scrollHeight > element.clientHeight + 8 && element.clientHeight > 0) result.scroll = { scrollable: true, nearBottom: element.scrollHeight - element.clientHeight - element.scrollTop <= 32 };
        return result;
    }
    const ancestorsOf = element => {
        const result = [];
        for (let i = 0; element && i < 10; i++, element = element.parentElement) result.push(describe(element));
        return result;
    };
    function tree(root, limit = 260) {
        const result = [], queue = root ? [{ element: root, depth: 0, parent: null }] : [];
        for (let i = 0; i < queue.length && result.length < limit; i++) {
            const { element, depth, parent } = queue[i];
            if (blocked(element)) continue;
            const index = result.length;
            const record = { index, parent, depth, ...describe(element) };
            result.push(record);
            if (depth >= 24) { if (element.children.length) record.depthLimited = true; continue; }
            // Sample repeated structural siblings independently of message text
            // and IDs. Long history/sidebar lists cannot consume the whole report.
            const groups = new Map();
            for (const child of element.children) {
                if (blocked(child)) continue;
                const key = JSON.stringify([child.tagName, classes(child), child.hasAttribute('contenteditable'), child.hasAttribute('type')]);
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(child);
            }
            const selected = new Set();
            for (const group of groups.values()) for (const child of [...group.slice(0, 2), ...group.slice(-2)]) selected.add(child);
            record.sampledChildren = selected.size;
            record.omittedChildren = [...groups.values()].reduce((sum, group) => sum + group.length, 0) - selected.size;
            for (const child of element.children) if (selected.has(child) && queue.length < 1800) queue.push({ element: child, depth: depth + 1, parent: index });
        }
        return result;
    }
    // Broad candidates are diagnostics only, never permission to type or send.
    const candidates = [...document.querySelectorAll('[contenteditable], [role="textbox"], textarea, input')]
        .filter(element => element.getAttribute('contenteditable') !== 'false' && (element.tagName !== 'INPUT' || ['text', 'search', 'tel', 'file'].includes(element.type)))
        .slice(0, 32).map(element => ({ element: describe(element), ancestors: ancestorsOf(element) }));
    // These landmarks were observed in the operator's real version-2 report.
    // Inspect each independently even if the legacy editor is absent.
    const selectors = ['#chatView, #chat-view', '.message-view', '.chat-box-input-container'];
    const sections = [];
    for (const selector of selectors) {
        for (const [index, root] of [...document.querySelectorAll(selector)].slice(0, 2).entries()) sections.push({ selector, index, structure: tree(root) });
    }
    const root = document.querySelector('#chatView, #chat-view') || document.body || document.documentElement;
    const structure = tree(root);
    const detail = editor
        ? 'Có selector ô nhập tin cũ. Chưa xác minh nhận tin hoặc gửi ảnh.'
        : sections.length
            ? 'Đã thấy vùng hội thoại Zalo nhưng thiếu selector ô nhập tin cũ. Báo cáo lấy sâu riêng danh sách tin và vùng nhập, không kết luận bạn chưa đăng nhập.'
            : 'Chưa thấy vùng hội thoại đã biết. Báo cáo vẫn chứa cấu trúc trang và các input ứng viên để đối chiếu.';
    return {
        version: 3, editorFound: !!editor, legacyEditorVisible: !!editor && visible(editor),
        documentReadyState: document.readyState, documentVisible: document.visibilityState === 'visible',
        iframeCount: document.querySelectorAll('iframe').length,
        detail, ancestors: editor ? ancestorsOf(editor) : [], candidates, sections, structure,
    };
}
module.exports = { inspectStructure };
