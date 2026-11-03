(() => {
    const list = document.getElementById('quote-list');
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = n => Number(n).toLocaleString('vi-VN') + 'đ';
    const statusLabel = { draft: 'Bản nháp', approved: 'Đã duyệt', ready: 'Chờ gửi thủ công', queued: 'Chờ n8n điều phối', sending: 'Đang thao tác Zalo', needs_check: 'Cần kiểm tra Zalo', dispatch_failed: 'Không kết nối được n8n', sent: 'Đã gửi', skipped: 'Đã bỏ qua', cancelled: 'Đã hủy' };
    let state;
    let creating = false;
    const rowHtml = (item = {}) => '<div class="flex flex-wrap gap-2" data-item><label>Tên món <input required maxlength="300" data-label value="' + esc(item.label) + '"></label><label>Số tiền <input required data-amount type="number" min="0" step="1" value="' + esc(item.amount ?? '') + '"></label><input type="hidden" data-source value="' + esc(item.sourceItemId) + '"><button type="button" data-action="remove-item">Xóa món</button></div>';
    const readItems = container => Array.from(container.querySelectorAll('[data-item]'), row => ({ label: row.querySelector('[data-label]').value, amount: row.querySelector('[data-amount]').value, sourceItemId: row.querySelector('[data-source]').value }));
    const form = document.getElementById('quote-create-form');
    const createItems = document.getElementById('quote-create-items');
    createItems.innerHTML = rowHtml();
    document.getElementById('quote-create-add-item').addEventListener('click', () => createItems.insertAdjacentHTML('beforeend', rowHtml()));
    createItems.addEventListener('click', event => { if (event.target.closest('[data-action="remove-item"]')) event.target.closest('[data-item]').remove(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true;
        const status = document.getElementById('quote-create-status');
        status.textContent = 'Đang lưu...';
        try {
            await api('/api/quotes', { method: 'POST', body: { customerId: document.getElementById('quote-create-customer').value, items: readItems(createItems), shippingNote: document.getElementById('quote-create-shipping').value } });
            createItems.innerHTML = rowHtml();
            status.textContent = 'Đã tạo báo giá nháp.';
            await window.loadQuotes();
        } catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
    });
    async function api(url, options = {}) {
        const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Có lỗi xảy ra'); return result;
    }
    window.createQuote = async username => {
        if (creating) return;
        creating = true;
        try {
            const source = window.getQuoteOrderSource?.();
            await api('/api/quotes', { method: 'POST', body: { username, ...(source ? { source } : {}) } });
            window.switchView('quotes');
        } catch (e) { alert(e.message); }
        finally { creating = false; }
    };
    document.getElementById('zalo-experimental-open').addEventListener('click', async () => {
        try { await api('/api/quotes/zalo/open', { method: 'POST', body: {} }); alert('Hãy đăng nhập tài khoản Zalo phụ trong cửa sổ vừa mở.'); } catch (e) { alert(e.message); }
    });
    window.loadQuotes = async () => {
        try {
            state = await api('/api/quotes');
            const select = document.getElementById('quote-create-customer');
            const selected = select.value;
            select.innerHTML = '<option value="">Chọn khách hàng</option>' + state.customers.map(c => '<option value="' + esc(c.id) + '">' + esc(c.displayName || c.tiktokUsername) + '</option>').join('');
            if (state.customers.some(c => c.id === selected)) select.value = selected;
            document.getElementById('quote-count').textContent = state.deliveries.filter(d => {
                const q = state.quotes.find(item => item.id === d.quoteId);
                const c = state.customers.find(item => item.id === q?.customerId);
                return d.status === 'ready' && c && c.consent?.quoteMessages !== 'denied' && !c.consent?.optedOutAt;
            }).length || '';
            list.innerHTML = state.quotes.map(q => {
                const c = state.customers.find(x => x.id === q.customerId) || {};
                const d = state.deliveries.find(x => x.quoteId === q.id && x.quoteVersion === q.version);
                const blocked = c.consent?.quoteMessages === 'denied' || c.consent?.optedOutAt;
                const preview = 'Chào ' + (c.displayName || c.tiktokUsername || '') + ', shop đã ghi nhận đơn của bạn:\n' + q.items.map(i => '- ' + i.label + ': ' + money(i.amount)).join('\n') + '\nTổng tiền hàng: ' + money(q.total) + ' (' + q.shippingNote + ').\nBạn kiểm tra và xác nhận thông tin nhận hàng giúp shop nhé.';
                const phone = String(c.contact?.zaloPhone || c.phone || '').replace(/[^0-9+]/g, '');
                const username = String(c.tiktokUsername || '').replace(/[^a-zA-Z0-9._]/g, '');
                return '<article class="panel p-4 space-y-3" data-quote="' + esc(q.id) + '" data-version="' + q.version + '"><div><strong>' + esc(c.displayName || c.tiktokUsername || 'Khách đã xóa') + '</strong> · ' + esc(money(q.total)) + ' · v' + q.version + ' · ' + esc(statusLabel[d?.status || q.status] || d?.status || q.status) + '</div>' +
                    '<p class="text-sm">' + (blocked ? 'Khách đã từ chối nhận tin.' : c.consent?.quoteMessages === 'granted' ? 'Khách đã đồng ý nhận báo giá.' : 'Chưa ghi nhận đồng ý; chỉ gửi khi khách đã chủ động yêu cầu.') + '</p>' +
                    (c.id ? '<label>Đồng ý nhận báo giá <select data-consent><option value="unknown" ' + (!c.consent?.quoteMessages || c.consent.quoteMessages === 'unknown' ? 'selected' : '') + '>Chưa rõ</option><option value="granted" ' + (c.consent?.quoteMessages === 'granted' ? 'selected' : '') + '>Đã đồng ý</option><option value="denied" ' + (blocked ? 'selected' : '') + '>Từ chối</option></select></label> <button type="button" data-action="consent" data-customer="' + esc(c.id) + '">Lưu trạng thái</button>' : '') +
                    '<details><summary>Sửa món và ghi chú</summary><p class="text-sm">Lưu tạo phiên bản nháp mới và hủy mục đang chờ. Báo giá đang gửi hoặc cần kiểm tra phải được xử lý trước.</p><div class="space-y-2" data-edit-items>' + q.items.map(rowHtml).join('') + '</div><button type="button" data-action="add-item">Thêm món</button><label>Ghi chú vận chuyển <input data-shipping maxlength="300" value="' + esc(q.shippingNote) + '"></label> <button type="button" data-action="save-items">Lưu món</button></details><button type="button" data-action="delete">Xóa báo giá</button>' +
                    '<textarea class="w-full p-3 rounded-xl" rows="6" aria-label="Nội dung báo giá" ' + (q.status !== 'draft' ? 'readonly' : '') + '>' + esc(d?.renderedText || preview) + '</textarea>' +
                    '<div class="flex flex-wrap gap-2">' + (q.status === 'draft' ? '<select data-channel aria-label="Kênh gửi"><option value="zalo">Zalo</option><option value="tiktok">TikTok</option></select><button type="button" data-action="approve">Duyệt để gửi thủ công</button><button type="button" data-action="approve-auto">Gửi thử Zalo qua n8n</button><button type="button" data-action="cancel">Hủy</button>' : '') +
                    (q.status === 'draft' ? '<p class="text-sm">Duyệt thủ công chỉ lưu nội dung để bạn tự gửi. Gửi thử qua n8n thao tác Zalo Web, chỉ tới số thử đã cấu hình và cần đăng nhập Zalo trước.</p>' : '') +
                    (d?.status === 'ready' ? '<p class="text-sm">Chưa tự gửi tin. Sao chép nội dung rồi mở Zalo hoặc TikTok để tự gửi.</p>' : '') +
                    (d?.status === 'needs_check' ? '<p class="text-sm">Kết quả chưa rõ. Kiểm tra cuộc hội thoại Zalo trước khi xác nhận hoặc bỏ qua.</p>' : '') +
                    (d?.status === 'ready' && !blocked && c.id ? '<button type="button" data-action="copy">Sao chép nội dung</button>' + (phone ? '<a target="_blank" rel="noopener noreferrer" href="https://zalo.me/' + encodeURIComponent(phone) + '">Mở Zalo</a><button type="button" data-action="phone" data-phone="' + esc(phone) + '">Sao chép SĐT</button>' : '') + (username ? '<a target="_blank" rel="noopener noreferrer" href="https://www.tiktok.com/@' + encodeURIComponent(username) + '">Mở TikTok</a>' : '') : '') +
                    (['queued', 'dispatch_failed'].includes(d?.status) ? '<button type="button" data-action="cancel">Hủy yêu cầu</button>' : '') + (['ready', 'needs_check'].includes(d?.status) && !blocked && c.id ? '<button type="button" data-action="sent" data-delivery="' + esc(d.deliveryId) + '">Đã gửi</button>' : '') + (['ready', 'needs_check'].includes(d?.status) ? '<button type="button" data-action="skipped" data-delivery="' + esc(d.deliveryId) + '">Bỏ qua</button>' : '') + '</div></article>';
            }).join('') || '<div class="panel p-4">Chưa có báo giá. Tạo báo giá tại đây hoặc từ Đơn hàng.</div>';
        } catch (e) { list.textContent = e.message; }
    };
    list.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]'); if (!button) return;
        const card = button.closest('[data-quote]'), id = encodeURIComponent(card.dataset.quote), action = button.dataset.action;
        const version = Number(card.dataset.version);
        if (action === 'add-item') { card.querySelector('[data-edit-items]').insertAdjacentHTML('beforeend', rowHtml()); return; }
        if (action === 'remove-item') { button.closest('[data-item]').remove(); return; }
        if (card.dataset.busy) return;
        card.dataset.busy = '1';
        button.disabled = true;
        try {
            if (action === 'delete') {
                if (!confirm('Xóa báo giá này? Các yêu cầu đang chờ sẽ bị hủy.')) return;
                await api('/api/quotes/' + id, { method: 'DELETE', body: { version } });
            }
            if (action === 'copy' || action === 'phone') { await navigator.clipboard.writeText(action === 'phone' ? button.dataset.phone : card.querySelector('textarea').value); return; }
            if (action === 'consent') { const value = card.querySelector('[data-consent]').value; if (!confirm('Xác nhận cập nhật trạng thái đồng ý theo thông tin khách đã cung cấp?')) return; await api('/api/customers/' + encodeURIComponent(button.dataset.customer) + '/quote-consent', { method: 'POST', body: { quoteMessages: value } }); }
            if (action === 'save-items') { await api('/api/quotes/' + id, { method: 'PATCH', body: { version, items: readItems(card), shippingNote: card.querySelector('[data-shipping]').value } }); }
            if (action === 'approve-auto') {
                const channel = card.querySelector('[data-channel]').value;
                if (channel !== 'zalo') throw new Error('Gửi thử qua n8n chỉ hỗ trợ Zalo. Hãy chọn kênh Zalo.');
                const autoName = prompt('Nhập chính xác tên Zalo của người nhận thử:');
                if (!autoName) return;
                if (!confirm('Duyệt và gửi nội dung này qua n8n tới số thử đã cấu hình?')) return;
                await api('/api/quotes/' + id + '/approve', { method: 'POST', body: { version, channel, text: card.querySelector('textarea').value, autoName } });
            }
            if (action === 'approve') await api('/api/quotes/' + id + '/approve', { method: 'POST', body: { version, channel: card.querySelector('[data-channel]').value, text: card.querySelector('textarea').value } });
            if (action === 'cancel') await api('/api/quotes/' + id + '/cancel', { method: 'POST', body: { version } });
            if (action === 'sent' || action === 'skipped') { const reason = action === 'skipped' ? prompt('Lý do bỏ qua:') : ''; if (action === 'skipped' && !reason) return; await api('/api/quotes/delivery/' + encodeURIComponent(button.dataset.delivery), { method: 'POST', body: { action, reason } }); }
            await window.loadQuotes();
        } catch (e) { alert(e.message); }
        finally { delete card.dataset.busy; button.disabled = false; }
    });
    window.loadQuotes();
})();
