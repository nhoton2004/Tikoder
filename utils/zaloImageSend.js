'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const UI_TIMEOUT = 2500;
const unsupported = detail => new Error(`Unsupported Zalo image UI: ${detail}; do not retry automatically`);
const needsCheck = detail => ({ outcome: 'needs_check', detail: `${detail}. Delivery cannot be guaranteed; inspect the conversation before any retry.` });

// Runtime-conditional support, NOT a verified authenticated Zalo upload contract.
// The caller must hold its shared browser lock, persist the claim first, and mark
// EVERY post-upload error needs_check. Never replay this operation automatically.
// verifyTarget() must validate the selected contact, current editor AND thread,
// throwing (or returning false) on failure. beforeSend() is a synchronous revision/
// pause/target guard; undefined is an allowed successful assertion result.
async function sendImageOnPage({ page, imagePath, caption = '', expectedSha256, verifyTarget, beforeSend } = {}) {
    if (!page || typeof page.evaluateHandle !== 'function' || typeof verifyTarget !== 'function' || typeof beforeSend !== 'function') {
        throw unsupported('page, verifyTarget and synchronous beforeSend are required');
    }
    if (typeof imagePath !== 'string' || !imagePath || typeof caption !== 'string' ||
        typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
        throw unsupported('imagePath, string caption and expected SHA256 are required');
    }
    const bytes = await fs.readFile(imagePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== expectedSha256.toLowerCase()) throw unsupported('source SHA256 mismatch');
    // Freeze the verified bytes in memory: setFiles(path) could reopen a changed
    // file after verification. Only bounded raster formats are supported here.
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw unsupported('image must be between 1 byte and 20 MiB');
    let mimeType;
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) mimeType = 'image/png';
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mimeType = 'image/jpeg';
    else if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) mimeType = 'image/gif';
    else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') mimeType = 'image/webp';
    else if (bytes.subarray(0, 2).toString() === 'BM') mimeType = 'image/bmp';
    else throw unsupported('unrecognized raster image format');
    const payload = { name: path.basename(imagePath), mimeType, buffer: bytes };
    const guard = () => {
        const result = beforeSend();
        if (result && typeof result.then === 'function') {
            Promise.resolve(result).catch(() => {});
            throw unsupported('beforeSend must be synchronous');
        }
        if (result === false) throw unsupported('beforeSend refused the action');
    };
    const verify = async () => {
        if (await verifyTarget() === false) throw unsupported('target verification refused the action');
    };

    let session, photo, chooserPromise;
    const confirm = async () => {
        let result;
        try {
            checkNavigation();
            await verify();
            result = await page.waitForFunction(({ session, base64, caption }) => {
                try { return session.pollDelivery(base64, caption); }
                catch (_) { return { error: true }; }
            }, { session, base64: bytes.toString('base64'), caption }, { timeout: UI_TIMEOUT, polling: 50 });
            const status = await result.jsonValue();
            checkNavigation();
            await verify();
            if (status.sent && await session.evaluate((s, args) => s.delivery(args.base64, args.caption), { base64: bytes.toString('base64'), caption }).then(value => !!value.sent)) {
                return { outcome: 'sent', detail: 'One new matching outgoing image with positive send acceptance verified in the guarded conversation' };
            }
        } catch (_) { /* An unresolved upload/send is never replayed. */ }
        finally { if (result) await result.dispose().catch(() => {}); }
        return needsCheck('No unique matching outgoing image with positive send acceptance and a cleared draft was verified');
    };
    let interrupted = false;
    const onNavigation = frame => { if (frame === page.mainFrame()) interrupted = true; };
    const onPopup = () => { interrupted = true; };
    page.on('framenavigated', onNavigation);
    page.on('popup', onPopup);
    const checkNavigation = () => { if (interrupted) throw unsupported('navigation or popup interrupted the operation'); };
    try {
        session = await page.evaluateHandle(createImageSession);
        photo = await session.evaluateHandle(s => s.photo);
        await session.evaluate(s => s.beforeUpload());
        await verify();
        // No awaited work between this synchronous service guard and the action.
        chooserPromise = page.waitForEvent('filechooser', { timeout: UI_TIMEOUT })
            .then(chooser => ({ chooser }), error => ({ error }));
        checkNavigation();
        guard();
        await photo.asElement().click({ timeout: UI_TIMEOUT });
        const event = await chooserPromise;
        if (event.error) throw unsupported('photo click did not open a file chooser (menu/redirect behavior is unsupported)');
        checkNavigation();
        if (event.chooser.page() !== page) throw unsupported('file chooser belongs to another page');
        await session.evaluate(s => s.beforeUpload());
        await verify();
        checkNavigation();
        guard();
        // This may itself send. Exactly one setFiles, even if it throws.
        await event.chooser.setFiles(payload, { timeout: UI_TIMEOUT });
        checkNavigation();

        let ready;
        try {
            ready = await page.waitForFunction(s => s.ready(), session, { timeout: UI_TIMEOUT, polling: 50 });
            const status = await ready.jsonValue();
            if (status.error) throw new Error(status.error);
        } catch (error) {
            if (error.name !== 'TimeoutError') throw error;
            throw unsupported('no unambiguous new outgoing image or local preview appeared after upload');
        } finally {
            if (ready) await ready.dispose();
        }
        let outgoing = await session.evaluate(s => s.outgoing());
        if (outgoing) return await confirm();
        const preview = await session.evaluate((s, length) => s.previewBytes(length), bytes.length);
        if (createHash('sha256').update(Buffer.from(preview.base64, 'base64')).digest('hex') !== digest) {
            throw unsupported('preview SHA256 mismatch or transformed preview');
        }
        // Fetching/decoding the preview was awaited. Recheck identity, not just
        // its hash, before editing anything. No remote image URL is fetched.
        await session.evaluate(s => s.assertPreview());
        outgoing = await session.evaluate(s => s.outgoing());
        if (outgoing) return await confirm();
        if (caption) {
            await verify();
            checkNavigation();
            guard();
            const filled = await session.evaluate((s, text) => s.fillCaption(text), caption);
            if (!filled) return await confirm();
        }
        await session.evaluate(s => s.assertPreview());
        await verify();
        checkNavigation();
        guard();
        // The final outgoing/preview/button/draft recheck and click share one
        // browser task. No Enter, locator retargeting, auto-waiting or retry.
        await session.evaluate(s => s.send());
        return await confirm();
    } finally {
        page.off('framenavigated', onNavigation);
        page.off('popup', onPopup);
        // Cleanup cannot change the outcome of a possibly completed upload/send.
        if (session) {
            await session.evaluate(s => s.disconnect()).catch(() => {});
            await session.dispose().catch(() => {});
        }
        if (photo) await photo.dispose().catch(() => {});
        // Consume a failed/timed-out chooser waiter even when a guard threw.
        if (chooserPromise) await chooserPromise;
    }
}

// Browser-side state is tied to actual nodes, not artificial DOM attributes or
// recipient selectors. Observed v3 selectors are used only for editor/history/
// photo discovery. Preview and Send discovery are conditional runtime evidence.
function createImageSession() {
    const fail = detail => { throw new Error(`Unsupported Zalo image UI: ${detail}; outcome may need checking; do not retry automatically`); };
    const visible = node => {
        if (!node || !node.isConnected || ![...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
        for (let current = node; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
        }
        return true;
    };
    const all = (scope, selector) => [...scope.querySelectorAll(selector)];
    const single = (nodes, detail) => nodes.length === 1 ? nodes[0] : fail(detail);
    const dialogs = () => all(document, 'dialog, [role="dialog"]').filter(visible);
    const root = single(all(document, '#chatView').filter(visible), 'expected one visible #chatView');
    const editor = single(all(document, '#richInput[contenteditable="true"]').filter(visible), 'expected one visible actual editor');
    const composer = editor.closest('.chat-box-input-container');
    if (!composer || !root.contains(composer) || !visible(composer)) fail('missing observed editor composer');
    const history = single(all(root, '.message-view').filter(visible), 'missing unique visible message history');
    if (history.contains(composer) || composer.contains(history)) fail('history/composer overlap');
    const photo = single(all(document, '.chat-box-toolbar .chat-box-toolbar-button').filter(node =>
        visible(node) && node.querySelector('i.fa-Photo_24_Line')), 'expected exactly one visible observed photo toolbar button');
    if (!root.contains(photo) || history.contains(photo)) fail('photo toolbar is outside the chosen chat');
    const initialImages = new Set(all(document, 'img'));
    let uncertain = '';
    const baseline = new Map();
    const added = new Map();
    let selection = null;
    let writtenCaption = '';
    let deliveryTask = null;
    let deliveryResult = false;
    let disconnected = false;
    const trailer = editor.getAttribute('data-trailer');
    let identityLost = false;
    const identityObserver = new MutationObserver(records => {
        if (records.some(record => record.type === 'attributes' && record.target === editor ||
            [...record.removedNodes].some(node => [root, editor, composer, history].some(target => node === target || node.contains(target))))) identityLost = true;
    });

    const emptyEditor = () => {
        if (editor.textContent.length || all(editor, '*').some(node => !/^(BR|DIV|P|SPAN)$/.test(node.tagName))) {
            fail('existing editor draft must remain untouched');
        }
    };
    const noAttachments = () => {
        emptyEditor();
        if (dialogs().length) fail('existing visible dialog is ambiguous');
        const blocked = /(?:^|[-_])(attachment|preview|upload|file|image|photo|sticker|quote|reply)(?:$|[-_])/i;
        for (const node of all(composer, '*')) {
            if (node.closest('.chat-box-toolbar')) continue;
            if (/^(IMG|VIDEO|AUDIO|CANVAS|OBJECT|EMBED|IFRAME)$/.test(node.tagName) ||
                (node.matches('input[type="file"]') && node.files.length) ||
                (node.matches('input:not([type="file"]):not([type="hidden"]), textarea') && node.value) ||
                node.matches('a[download]') || [...node.classList].some(value => blocked.test(value))) {
                fail('existing or unknown attachment draft must remain untouched');
            }
        }
    };
    const connected = () => {
        if (identityLost || editor.getAttribute('data-trailer') !== trailer ||
            !root.isConnected || !editor.isConnected || !composer.isConnected || !history.isConnected ||
            !visible(root) || !visible(editor) || !visible(composer) ||
            all(document, '#chatView').filter(visible).some(node => node !== root) ||
            all(document, '#richInput[contenteditable="true"]').filter(visible).some(node => node !== editor) ||
            editor.closest('.chat-box-input-container') !== composer || !root.contains(history) || !root.contains(editor)) {
            fail('chosen editor/history changed or became ambiguous');
        }
    };
    const readFrames = () => {
        connected();
        const frames = new Map();
        for (const row of all(root, '.chat-item.me')) {
            const nodes = all(row, '.message-frame');
            if (!history.contains(row) || row.closest('.chat-item') !== row || nodes.length !== 1 ||
                nodes[0].closest('.chat-item') !== row) fail('uncertain outgoing row structure');
            const frame = nodes[0];
            const id = frame.getAttribute('data-qid');
            if (!id || !/^[^\s\x00-\x1f\x7f]{1,200}$/u.test(id) || frames.has(id)) fail('uncertain outgoing IDs');
            frames.set(id, frame);
        }
        return frames;
    };
    const remember = frame => {
        const id = frame.getAttribute('data-qid');
        if (!id || !/^[^\s\x00-\x1f\x7f]{1,200}$/u.test(id)) { uncertain = 'outgoing frame without a reliable ID'; return; }
        if (baseline.has(id)) {
            if (baseline.get(id) !== frame) uncertain = 'outgoing baseline frame replaced';
            if (all(frame, 'img').some(image => !initialImages.has(image))) uncertain = 'new image reused an outgoing baseline ID';
        } else {
            const previous = added.get(id);
            if (previous && previous.frame !== frame) uncertain = 'duplicate new outgoing ID';
            added.set(id, { frame, image: !!frame.querySelector('img') || !!(previous && previous.image) });
        }
    };
    noAttachments();
    for (const [id, frame] of readFrames()) baseline.set(id, frame);
    const mutations = records => {
        // Retain transient added-then-removed image rows too. An unresolved or
        // removed baseline is ambiguity, never permission to click Send again.
        for (const record of records) {
            if (record.type === 'childList' && [...record.removedNodes].some(node =>
                [...baseline.values()].some(frame => node === frame || node.contains(frame)))) uncertain = 'outgoing baseline disappeared or changed';
            const nodes = record.type === 'childList' ? [...record.addedNodes, ...record.removedNodes] : [record.target];
            for (const node of nodes) {
                if (node.nodeType !== 1) continue;
                const frames = new Set(all(node, '.chat-item.me .message-frame'));
                if (node.matches('.message-frame') && node.closest('.chat-item.me')) frames.add(node);
                const parentFrame = record.target.closest && record.target.closest('.chat-item.me .message-frame');
                if (parentFrame) frames.add(parentFrame);
                for (const frame of frames) remember(frame);
                if (node.matches('img') && parentFrame) {
                    const id = parentFrame.getAttribute('data-qid');
                    if (baseline.has(id) && !initialImages.has(node)) uncertain = 'new image reused an outgoing baseline ID';
                    const entry = added.get(id);
                    if (entry) entry.image = true;
                }
            }
        }
    };
    const observer = new MutationObserver(mutations);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-qid', 'class'] });
    identityObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-trailer'] });
    const outgoing = () => {
        mutations(observer.takeRecords());
        const frames = readFrames();
        for (const [id, frame] of baseline) if (frames.get(id) !== frame) uncertain = 'outgoing baseline disappeared or changed';
        for (const frame of frames.values()) remember(frame);
        if (uncertain) fail(`outgoing detection uncertain: ${uncertain}`);
        if ([...added.values()].some(entry => !entry.image)) fail('new outgoing row is not positively an image; no replay');
        return added.size > 0;
    };
    const previewNodes = () => {
        connected();
        const modal = dialogs();
        if (modal.length > 1) fail('multiple visible semantic dialogs');
        const scopes = modal.length ? [composer, modal[0]] : [composer];
        const images = new Map();
        for (const scope of scopes) for (const img of all(scope, 'img')) {
            if (!initialImages.has(img)) images.set(img, scope);
        }
        return images;
    };
    const sendButton = scope => {
        const labels = new Set(['Gửi', 'Gửi ảnh', 'Send', 'Send photo']);
        const candidates = all(scope, 'button, [role="button"], .chat-box-input-button').filter(node => {
            if (!visible(node)) return false;
            const values = [node.getAttribute('aria-label'), node.getAttribute('title'), node.innerText].map(value => (value || '').trim());
            return values.some(value => labels.has(value));
        });
        const button = single(candidates, 'expected exactly one semantic Send control in the preview scope');
        if (button.matches(':disabled') || button.closest('[aria-disabled="true"], [inert]')) fail('Send control is disabled');
        return button;
    };
    const source = img => img.currentSrc || img.src;
    const accepted = frame => {
        const receipts = all(frame, '.card-send-time');
        if (receipts.length !== 1 || !visible(receipts[0]) || receipts[0].closest('.message-action')) return false;
        const receipt = receipts[0].innerText.normalize('NFC').replace(/\s+/g, ' ').trim();
        // Positive observed receipt text only; unknown/pending/error text cannot confirm a send.
        return /^(?:Đã (?:gửi|nhận|xem)(?: (?:[01]\d|2[0-3]):[0-5]\d)?|(?:[01]\d|2[0-3]):[0-5]\d Đã (?:gửi|nhận|xem))$/iu.test(receipt);
    };
    const assertPreview = () => {
        connected();
        if (outgoing()) return false;
        if (!selection) fail('preview was not byte-verified');
        const images = previewNodes();
        if (images.size !== 1 || images.get(selection.image) !== selection.scope || !visible(selection.image) ||
            !selection.image.complete || !selection.image.naturalWidth || source(selection.image) !== selection.source ||
            selection.image.getAttribute('src') !== selection.srcAttribute || selection.image.srcset || selection.image.closest('picture') ||
            sendButton(selection.scope) !== selection.button) fail('verified preview or Send control changed');
        if (editor.textContent !== writtenCaption) fail('editor draft changed; leave it untouched');
        return true;
    };
    return {
        photo,
        beforeUpload() {
            if (outgoing()) fail('outgoing activity before upload');
            noAttachments();
            const photos = all(document, '.chat-box-toolbar .chat-box-toolbar-button').filter(node => visible(node) && node.querySelector('i.fa-Photo_24_Line'));
            if (photos.length !== 1 || photos[0] !== photo || !visible(photo)) fail('photo toolbar changed');
        },
        outgoing,
        pollDelivery(base64, caption) {
            if (disconnected) return { error: true };
            if (deliveryResult) return deliveryResult;
            // Playwright's predicate must return false synchronously while local
            // byte verification is pending, not a truthy Promise of false.
            if (!deliveryTask) {
                deliveryTask = this.delivery(base64, caption)
                    .then(result => { deliveryResult = result; }, () => { deliveryResult = { error: true }; })
                    .finally(() => { deliveryTask = null; });
            }
            return false;
        },
        async delivery(base64, caption) {
            if (!outgoing() || added.size !== 1 || editor.textContent || previewNodes().size) return false;
            const [id, entry] = [...added][0];
            if (readFrames().get(id) !== entry.frame || !visible(entry.frame) || !accepted(entry.frame)) return false;
            const images = all(entry.frame, 'img');
            const actions = all(entry.frame, '.message-action');
            if (images.length !== 1 || actions.length > 1 || (actions[0]?.innerText || '').trim() !== caption.trim()) return false;
            const image = images[0], url = source(image);
            if (!visible(image) || !image.complete || !image.naturalWidth || image.srcset || image.closest('picture') || !/^blob:|^data:image\//i.test(url)) return false;
            // Only local echo bytes are read. Never fetch an arbitrary remote URL.
            const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(500) });
            const blob = await response.blob();
            if (!response.ok || blob.size > 20 * 1024 * 1024) return false;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            if (btoa(binary) !== base64) return false;
            outgoing();
            connected();
            return added.size === 1 && readFrames().get(id) === entry.frame && source(image) === url &&
                visible(image) && all(entry.frame, 'img').length === 1 && entry.frame.contains(image) && accepted(entry.frame) &&
                (entry.frame.querySelector('.message-action')?.innerText || '').trim() === caption.trim() &&
                !editor.textContent && !previewNodes().size ? { sent: true } : false;
        },
        ready() {
            // Playwright creates its polling result promise before attaching a
            // rejection handler in a later browser command. Throwing here can
            // emit unhandledrejection/pageerror under load. Resolve terminal
            // failures as data; the awaited Node caller throws the same error.
            try {
                if (outgoing()) return { ready: true };
                const images = previewNodes();
                return images.size > 1 || [...images.keys()].some(image => visible(image) && image.complete && image.naturalWidth > 0)
                    ? { ready: true } : false;
            } catch (error) {
                return { error: error.message };
            }
        },
        async previewBytes(length) {
            if (outgoing()) fail('outgoing image appeared before digest verification; do not send again');
            const images = previewNodes();
            if (images.size !== 1) fail('expected exactly one NEW preview image in the composer or one semantic dialog');
            const [image, scope] = [...images][0];
            if (!visible(image) || !image.complete || !image.naturalWidth) fail('preview image is not visibly decoded');
            if (image.srcset || image.closest('picture')) fail('responsive preview source selection is ambiguous');
            const url = source(image);
            if (!/^blob:|^data:image\//i.test(url)) fail('preview must be a local blob/data image, not a remote URL');
            selection = { image, scope, source: url, srcAttribute: image.getAttribute('src'), button: sendButton(scope) };
            const response = await fetch(url, { redirect: 'error' });
            if (!response.ok) fail('cannot read local preview bytes');
            const buffer = new Uint8Array(await response.arrayBuffer());
            if (buffer.length !== length) fail('preview SHA256 mismatch or transformed preview size');
            let binary = '';
            for (let offset = 0; offset < buffer.length; offset += 8192) binary += String.fromCharCode(...buffer.subarray(offset, offset + 8192));
            return { base64: btoa(binary) };
        },
        assertPreview,
        fillCaption(text) {
            if (!assertPreview()) return false;
            emptyEditor();
            // Empty-only, atomic DOM entry prevents overwriting a draft inserted
            // during an awaited target check. Input handlers may themselves send.
            editor.focus();
            if (outgoing()) return false;
            emptyEditor();
            editor.textContent = text;
            writtenCaption = text;
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            return true;
        },
        send() {
            if (!assertPreview()) return false;
            const button = selection.button;
            const rect = button.getBoundingClientRect();
            const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            if (!top || !(top === button || button.contains(top))) fail('Send control is obscured or outside the viewport');
            HTMLElement.prototype.click.call(button);
            return true;
        },
        disconnect() { disconnected = true; observer.disconnect(); identityObserver.disconnect(); }
    };
}

module.exports = { sendImageOnPage };
