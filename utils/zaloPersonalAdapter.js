'use strict';

const crypto = require('node:crypto');

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function privateThread(type) { return type === 0 || type === 'USER' || type === 'user'; }
function textOf(message) { return message && message.data && typeof message.data.content === 'string' ? message.data.content.trim() : ''; }
function imageDimensions(bytes, mime) {
    if (mime === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
        let offset = 2;
        while (offset + 9 < bytes.length) {
            if (bytes[offset] !== 255) { offset++; continue; }
            const marker = bytes[offset + 1], size = bytes.readUInt16BE(offset + 2);
            if ([194, 193, 192].includes(marker) && offset + 8 < bytes.length) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
            if (size < 2) break;
            offset += 2 + size;
        }
    }
    fail('Unsupported QR image');
}
function sourceId(message) {
    const value = message?.data?.msgId ?? message?.data?.cliMsgId;
    if (value !== undefined && value !== null && String(value)) return String(value);
    return '';
}
function createAdapter({ client, postEvent = async () => {}, seen = new Set(), results = new Map(), onCommandResult = () => {} } = {}) {
    if (!client || typeof client.sendMessage !== 'function') fail('Zalo client is required');
    if (typeof postEvent !== 'function' || !(seen instanceof Set) || !(results instanceof Map) || typeof onCommandResult !== 'function') fail('Invalid adapter options');
    async function handleMessage(message) {
        if (!message || message.isSelf === true || !privateThread(message.type)) return false;
        const text = textOf(message), threadId = String(message.threadId || ''), sourceMessageId = sourceId(message);
        if (!text || !threadId || !sourceMessageId || seen.has(sourceMessageId)) return false;
        const timestamp = Number(message.data?.ts);
        if (!Number.isFinite(timestamp)) return false;
        const event = { sourceMessageId, conversationId: threadId, threadId, threadType: message.type, text, receivedAt: new Date(timestamp).toISOString(), isSelf: false };
        seen.add(sourceMessageId);
        try { await postEvent(event); return true; }
        catch (error) { seen.delete(sourceMessageId); throw error; }
    }
    async function executeCommand(body, headers = {}, secret, now = Date.now()) {
        if (!secret || !body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid adapter command');
        const timestamp = String(headers['x-adapter-timestamp'] || ''), signature = String(headers['x-adapter-signature'] || ''), raw = JSON.stringify(body);
        if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^sha256=[a-f0-9]{64}$/.test(signature)) fail('Adapter authentication failed', 401);
        const expected = crypto.createHmac('sha256', secret).update(timestamp + '.' + raw).digest();
        const actual = Buffer.from(signature.slice(7), 'hex');
        if (!crypto.timingSafeEqual(expected, actual)) fail('Adapter authentication failed', 401);
        if (typeof body.eventId !== 'string' || !body.eventId || typeof body.threadId !== 'string' || !privateThread(body.threadType)) fail('Invalid adapter command');
        if (body.action === 'send_text' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000)) fail('Unsupported adapter command');
        if (body.action === 'send_image') {
            if (typeof body.filename !== 'string' || !/^[A-Za-z0-9_-]{1,120}\.(?:png|jpg|jpeg)$/.test(body.filename) || !['image/png', 'image/jpeg'].includes(body.mime) || typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) fail('Unsupported adapter command');
        } else if (body.action !== 'send_text') fail('Unsupported adapter command');
        if (seen.has('command:' + body.eventId)) return results.get(body.eventId) || { status: 'sent', eventId: body.eventId };
        seen.add('command:' + body.eventId);
        try {
            let content;
            if (body.action === 'send_image') {
                const data = Buffer.from(body.data, 'base64');
                if (!data.length || data.toString('base64') !== body.data || data.length > 5 * 1024 * 1024) fail('Invalid QR image');
                const dimensions = imageDimensions(data, body.mime);
                content = { msg: typeof body.caption === 'string' ? body.caption.slice(0, 1000) : '', attachments: { data, filename: body.filename, metadata: { totalSize: data.length, ...dimensions } } };
            } else content = { msg: body.text };
            const result = await client.sendMessage(content, body.threadId, body.threadType === 'USER' || body.threadType === 'user' ? 0 : body.threadType);
            const outcome = { status: 'sent', eventId: body.eventId, messageId: result?.message?.msgId || result?.msgId || null };
            results.set(body.eventId, outcome);
            onCommandResult(outcome);
            return outcome;
        } catch (error) { seen.delete('command:' + body.eventId); throw error; }
    }
    return { handleMessage, executeCommand };
}
module.exports = { createAdapter, privateThread };
