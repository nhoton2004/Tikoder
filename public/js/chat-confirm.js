/**
 * chat-confirm.js — Helper dùng chung (browser + Node) cho việc gán msgId ổn định
 * cho từng comment chat và build payload confirm-item.
 *
 * Mục đích: Track trạng thái "ĐÃ IN" theo TỪNG COMMENT (msgId), không theo username.
 *
 * UMD: hoạt động cả trong browser (window.ChatConfirm) lẫn Node (module.exports).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ChatConfirm = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Global sequence để fallback msgId luôn unique trong cùng một phiên
    let globalSeq = 0;

    /**
     * Lấy một chuỗi msgId ổn định cho comment. Ưu tiên ID do TikTok/server cấp.
     * @param {Object} msg - payload comment (data.msgId, messageId, commentId, id, uniqueId, comment, createTime, timestamp...)
     * @returns {string} msgId ổn định
     */
    function ensureChatMessageId(msg) {
        if (!msg) return '';
        const raw = msg.msgId || msg.messageId || msg.commentId || msg.id;
        if (raw !== undefined && raw !== null && String(raw).trim() !== '' && String(raw) !== '0') {
            return String(raw);
        }
        // Fallback ổn định: kết hợp username + thời điểm + nội dung + sequence
        const username = msg.uniqueId || msg.username || msg.nickname || 'unknown';
        const createTime = msg.createTime || msg.timestamp || Date.now();
        const text = String(msg.comment || msg.text || '').slice(0, 60);
        globalSeq += 1;
        return `fallback:${username}:${createTime}:${text}:${globalSeq}`;
    }

    /**
     * Build payload gửi qua socket 'confirm-item'.
     * Luôn kèm sourceMsgId để server echo lại -> client map đúng comment.
     * @param {Object} opts
     * @returns {Object} payload
     */
    function buildConfirmPayload(opts = {}) {
        const msgId = ensureChatMessageId(opts);
        return {
            uniqueId: opts.uniqueId || opts.username || '',
            nickname: opts.nickname || '',
            profilePictureUrl: opts.profilePictureUrl || '',
            comment: opts.comment || '',
            price: Number(opts.price || 0),
            isManual: !!opts.isManual,
            sourceMsgId: msgId
        };
    }

    /**
     * CSS.escape polyfill nhẹ (cho selector attribute).
     * @param {string} str
     * @returns {string}
     */
    function cssEscape(str) {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(str);
        }
        return String(str).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
    }

    return {
        ensureChatMessageId,
        buildConfirmPayload,
        cssEscape
    };
});
