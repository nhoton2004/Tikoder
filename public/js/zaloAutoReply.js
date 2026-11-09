(() => {
    'use strict';
    const section = document.getElementById('section-zalo-inbox');
    const el = id => document.getElementById('zar-' + id);
    const base = '/api/zalo-auto-reply';
    const labels = {
        pending: 'Chờ xem xét', queued: 'Chờ điều phối', sending: 'Đang thao tác Zalo, chưa xác minh',
        needs_check: 'Cần kiểm tra Zalo, chưa xác minh', dispatch_failed: 'Điều phối thất bại',
        sent: 'Đã xác nhận tin đi trên Zalo', skipped: 'Đã bỏ qua', cooldown: 'Trong thời gian chờ', cancelled: 'Đã hủy'
    };
    const ruleLabels = { phone: 'Nội dung', qr: 'Ảnh QR' };
    let loaded = false;
    let dirty = false;
    let busy = false;
    let timer;
    let imageKey;
    let imageAvailable = false;
    let savedSettings;
    let customRules = [];

    const visible = () => !section.hidden && document.visibilityState === 'visible';
    function markDirty(value) {
        dirty = value;
        el('dirty').textContent = dirty ? 'Có thay đổi chưa lưu. Làm mới không ghi đè bản nháp.' : 'Cấu hình đang hiển thị là bản đã lưu.';
        updateControls();
    }
    function updateControls() {
        el('config').disabled = busy || !loaded;
        el('refresh').disabled = busy;
        el('diagnostics').disabled = busy || !loaded;
        el('pause').disabled = busy || !loaded;
        el('connect').disabled = busy || !loaded || dirty;
        const hasFile = !!(el('image') && el('image').files && el('image').files.length);
        el('upload').disabled = busy || !hasFile;
        section.querySelectorAll('[data-zar-action]').forEach(button => { button.disabled = busy; });
        section.setAttribute('aria-busy', String(busy));
    }
    async function api(path = '', method = 'GET', body) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(base + path, {
                method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
                headers: { 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.error || `Yêu cầu ${method} ${path || '/'} thất bại (HTTP ${response.status}).`);
            if (method === 'GET' && !path && (!result?.settings || !Array.isArray(result.messages) || !result.connection)) {
                throw new Error('Phản hồi cấu hình Zalo không hợp lệ. Không thể xác nhận trạng thái.');
            }
            return result;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('Yêu cầu quá thời gian chờ. Trạng thái chưa rõ; hãy làm mới để kiểm tra, không gửi lại tự động.');
            throw error;
        } finally { clearTimeout(timeout); }
    }
    function fillSettings(settings) {
        el('enabled').checked = settings.enabled === true;
        el('cooldown').value = settings.cooldownSeconds ?? 30;
        el('target-phone').value = settings.target?.phone || '';
        el('target-name').value = settings.target?.name || '';
        for (const key of ['phone', 'qr']) {
            const rule = settings.rules?.[key] || {};
            el(key + '-enabled').checked = rule.enabled === true;
            el(key + '-triggers').value = Array.isArray(rule.triggers) ? rule.triggers.join(', ') : '';
            el(key === 'phone' ? 'phone-text' : 'qr-caption').value = (key === 'phone' ? rule.text : rule.caption) || '';
        }
        customRules = Array.isArray(settings.rules?.custom) ? JSON.parse(JSON.stringify(settings.rules.custom)) : [];
        renderCustomRules();
        markDirty(false);
    }

    function renderCustomRules() {
        const container = el('custom-rules-container');
        if (!container) return;
        container.replaceChildren();
        if (!customRules.length) {
            const empty = node('p', 'Chưa có mẫu trả lời tùy chỉnh nào. Bấm nút "+ Thêm mẫu mới" ở trên để tạo.', 'zar-help');
            container.append(empty);
            return;
        }

        customRules.forEach((rule, index) => {
            const item = node('div', '', 'zar-custom-rule-item');

            const head = node('div', '', 'zar-custom-rule-head');
            const leftHead = node('div', '', '');
            leftHead.style.display = 'flex';
            leftHead.style.alignItems = 'center';
            leftHead.style.gap = '10px';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'zar-rule-name-input';
            nameInput.value = rule.name || `Mẫu #${index + 1}`;
            nameInput.placeholder = 'Tên mẫu (ví dụ: Địa chỉ shop)';
            nameInput.addEventListener('input', e => {
                rule.name = e.target.value;
                markDirty(true);
            });

            const switchLabel = node('label', '', 'zar-switch');
            const switchInput = document.createElement('input');
            switchInput.type = 'checkbox';
            switchInput.checked = rule.enabled === true;
            switchInput.addEventListener('change', e => {
                rule.enabled = e.target.checked;
                markDirty(true);
            });
            const slider = node('span', '', 'zar-slider');
            switchLabel.append(switchInput, slider);

            leftHead.append(switchLabel, nameInput);

            const delBtn = node('button', 'Xóa mẫu', 'zar-btn-delete-rule');
            delBtn.type = 'button';
            delBtn.addEventListener('click', () => {
                if (confirm(`Xóa mẫu "${rule.name || 'này'}"?`)) {
                    customRules.splice(index, 1);
                    renderCustomRules();
                    markDirty(true);
                }
            });

            head.append(leftHead, delBtn);

            const groupTriggers = node('div', '', 'zar-form-group');
            groupTriggers.append(node('label', 'Từ khóa kích hoạt (cách nhau bởi dấu phẩy):'));
            const trigInput = document.createElement('input');
            trigInput.type = 'text';
            trigInput.value = Array.isArray(rule.triggers) ? rule.triggers.join(', ') : '';
            trigInput.placeholder = 'địa chỉ, o dau, ở đâu, shop o dau';
            trigInput.addEventListener('input', e => {
                rule.triggers = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                markDirty(true);
            });
            groupTriggers.append(trigInput);

            const groupText = node('div', '', 'zar-form-group');
            groupText.append(node('label', 'Nội dung trả lời tự động:'));
            const textInput = document.createElement('textarea');
            textInput.rows = 2;
            textInput.value = rule.text || '';
            textInput.placeholder = 'Dạ địa chỉ cửa hàng tại: 123 Đường ABC...';
            textInput.addEventListener('input', e => {
                rule.text = e.target.value;
                markDirty(true);
            });
            groupText.append(textInput);

            item.append(head, groupTriggers, groupText);
            container.append(item);
        });
    }
    function renderImage(image) {
        const key = image ? `${image.sha256}:${image.filename}` : null;
        if (key === imageKey) return;
        imageKey = key;
        imageAvailable = !!image;
        el('image-preview').hidden = !image;
        el('image-info').textContent = image ? `Ảnh đã lưu: ${image.filename} (${image.mime})` : 'Chưa có ảnh QR.';
        if (image) {
            // Same-origin image requests use the authenticated session cookie, never a public asset URL.
            el('image-preview').src = base + '/image?v=' + encodeURIComponent(image.sha256 || 'current');
        } else el('image-preview').removeAttribute('src');
        updateControls();
    }
    function node(tag, text, className) {
        const item = document.createElement(tag);
        item.textContent = text;
        if (className) item.className = className;
        return item;
    }
    function renderMessages(messages) {
        const fragment = document.createDocumentFragment();
        const latest = [...messages].sort((a, b) => (Date.parse(b.receivedAt) || 0) - (Date.parse(a.receivedAt) || 0));
        for (const message of latest) {
            const card = node('article', '', 'zar-message');
            card.dataset.messageId = String(message.id);
            card.append(node('strong', labels[message.status] || `Trạng thái: ${message.status || 'chưa rõ'}`));
            const date = new Date(message.receivedAt);
            card.append(node('p', Number.isNaN(date.getTime()) ? 'Không rõ thời gian nhận' : date.toLocaleString('vi-VN'), 'zar-help'));
            card.append(node('p', message.text || '', 'zar-message-text'));
            card.append(node('p', 'Quy tắc phù hợp: ' + (Array.isArray(message.candidates) && message.candidates.length
                ? message.candidates.map(key => ruleLabels[key] || String(key)).join(', ') : 'Không có'), 'zar-help'));
            if (message.reason) card.append(node('p', 'Lý do: ' + message.reason, 'zar-help'));
            const actions = node('div', '', 'zar-actions');
            const addAction = (action, label) => {
                const button = node('button', label);
                button.type = 'button';
                button.dataset.zarAction = action;
                button.disabled = busy;
                actions.append(button);
            };
            if (message.status === 'needs_check') addAction('sent', 'Đã kiểm tra: đã gửi');
            if (['needs_check', 'queued', 'pending', 'dispatch_failed'].includes(message.status)) addAction('skipped', 'Bỏ qua');
            card.append(actions);
            fragment.append(card);
        }
        if (!latest.length) fragment.append(node('p', 'Chưa có tin nhắn. Kết nối và xác nhận đúng cuộc trò chuyện thử để theo dõi tin đến mới.', 'zar-help'));
        el('messages').replaceChildren(fragment);
    }
    async function refreshData() {
        const data = await api();
        savedSettings = data.settings;
        if (!dirty) fillSettings(data.settings);
        renderImage(data.settings.rules?.qr?.image);
        const connection = data.connection;
        el('connection').textContent = `Trình duyệt: ${connection.open ? 'đang mở' : 'chưa mở'}. Theo dõi: ${connection.watching ? 'đang bật' : 'đã dừng'}. Trạng thái: ${connection.state || 'chưa rõ'}. ${connection.detail || ''}`;
        const runtime = connection.runtime;
        const phaseLabels = { connecting: 'Đang xác minh kết nối', waiting_zalo: 'Đang chờ Zalo, sẽ tự thử lại', monitoring: 'Đang theo dõi', paused: 'Đã tạm dừng', disconnected: 'Chưa kết nối', dispatching: 'Đang điều phối qua n8n', needs_check: 'Cần kiểm tra kết quả gửi' };
        if (runtime) {
            const reader = runtime.reader || {};
            const skipped = reader.skipped || {};
            const lastPoll = runtime.lastPollAt ? new Date(runtime.lastPollAt).toLocaleTimeString('vi-VN') : 'chưa có';
            const retry = runtime.nextRetryAt ? ` Tự thử lại lúc ${new Date(runtime.nextRetryAt).toLocaleTimeString('vi-VN')}.` : '';
                        const resetLabels = {
                            'initial-baseline': 'ghi nhận lịch sử ban đầu',
                            'structure-or-identity-change': 'cấu trúc hoặc định danh thay đổi',
                            'candidate-proof-change': 'bằng chứng xác minh tin mới thay đổi',
                            'root-detached': 'vùng hội thoại bị gỡ khỏi trang',
                            'return-to-bottom': 'quay lại cuối hội thoại',
                            'tail-follow-timeout': 'hết thời gian chờ theo cuối hội thoại',
                            'viewport-change': 'khung nhìn thay đổi',
                            'scroll-away': 'cuộn khỏi cuối hội thoại',
                            'unrecognized-layout-change': 'bố cục thay đổi chưa nhận diện được',
                            'local-day-change': 'sang ngày mới theo giờ máy',
                            'user-scroll': 'người dùng cuộn hội thoại',
                            'history-reorder': 'thứ tự lịch sử thay đổi',
                            'baseline-mutation': 'lịch sử đã ghi nhận thay đổi',
                            'message-replacement': 'phần tử tin nhắn bị thay thế',
                            'message-identity-change': 'định danh tin nhắn thay đổi',
                            'outside-history-mutation': 'thay đổi ngoài vùng lịch sử tin nhắn',
                            'unrecognized-history-mutation': 'thay đổi lịch sử chưa nhận diện được',
                            'candidate-capacity': 'đạt giới hạn tin đang xác minh',
                            'not-at-bottom': 'không ở cuối hội thoại'
                        };
                        const diagnostics = [];
                        if (reader.observationStartedAt) diagnostics.push(`Bắt đầu quan sát (ISO): ${reader.observationStartedAt}`);
                        if (typeof reader.trackerEpoch === 'number') diagnostics.push(`Phiên theo dõi: ${reader.trackerEpoch}`);
                        if (typeof reader.atBottom === 'boolean') diagnostics.push(`Ở cuối hội thoại: ${reader.atBottom ? 'có' : 'không'}`);
                        if (typeof reader.candidateCount === 'number') diagnostics.push(`Tin đang xác minh: ${reader.candidateCount}`);
                        if (Object.hasOwn(resetLabels, reader.resetReason)) diagnostics.push(`Lý do đặt lại theo dõi: ${resetLabels[reader.resetReason]}`);
                        const skipLabels = { identity: 'không xác minh được định danh', baseline: 'thuộc lịch sử ban đầu', untracked: 'chưa được theo dõi để xác minh là tin mới', duplicate: 'đã ghi nhận trước đó', future: 'thời điểm tin nằm trong tương lai' };
                        for (const [key, label] of Object.entries(skipLabels)) {
                            if (typeof skipped[key] === 'number') diagnostics.push(`Bỏ qua do ${label}: ${skipped[key]}`);
                        }
                        if (reader.resetCounts) {
                            for (const [key, label] of Object.entries(resetLabels)) {
                                if (typeof reader.resetCounts[key] === 'number') diagnostics.push(`Số lần đặt lại do ${label}: ${reader.resetCounts[key]}`);
                            }
                        }
                        if (reader.implementation === 'observed-dom-mutation-trace-1') diagnostics.push('Bộ nhận có ghi vết mutation');
                        const latestReset = Array.isArray(reader.trace) ? [...reader.trace].reverse().find(event => event.event === 'reset') : null;
                        if (latestReset && Object.hasOwn(resetLabels, latestReset.reason)) {
                            diagnostics.push(`Reset ghi vết lúc ${latestReset.at}: ${resetLabels[latestReset.reason]}; ứng viên trước reset: ${latestReset.candidatesBefore}; số mutation: ${latestReset.mutationCount}`);
                            diagnostics.push('Dùng Xuất kiểm tra DOM để lấy chuỗi sự kiện đã ẩn dữ liệu, không chỉ ảnh chụp cấu trúc');
                        }
                        const diagnosticText = diagnostics.length ? ` ${diagnostics.join('. ')}.` : '';
            el('reader').textContent = `${phaseLabels[runtime.phase] || 'Chưa rõ trạng thái'}.${retry} Lần đọc cuối: ${lastPoll}. Tin đọc được: ${reader.readableMessages || 0}; tin khách: ${reader.inboundMessages || 0}; tin mới đủ điều kiện: ${reader.eligibleMessages || 0}; đã đưa vào hàng đợi: ${runtime.ingested || 0}. Bỏ qua do cấu trúc: ${skipped.structure || 0}, chiều tin: ${skipped.direction || 0}, nội dung: ${skipped.plaintext || 0}, thời gian: ${skipped.time || 0}. n8n HTTP: ${runtime.lastDispatchStatus || 'chưa gọi'}.${diagnosticText}`;
        } else el('reader').textContent = 'Chưa có số liệu bộ nhận tin. Cần khởi động lại server để nạp bản ghi trạng thái mới.';
        const rules = data.settings.rules || {};
        const warnings = [];
        const hasActiveCustom = Array.isArray(rules.custom) && rules.custom.some(r => r.enabled);
        if (!rules.phone?.enabled && !rules.qr?.enabled && !hasActiveCustom) warnings.push('Chưa bật quy tắc nào. Hãy bật ít nhất SĐT, QR hoặc một mẫu tùy chỉnh rồi Lưu.');
        if (rules.qr?.enabled && !rules.qr?.image) warnings.push('Chưa có ảnh QR. Muốn trả QR, tải đúng ảnh của shop rồi bật quy tắc QR.');
        el('rules-warning').textContent = warnings.join(' ');
        renderMessages(data.messages);
        loaded = true;
    }
    async function run(task, pending, clearError = true) {
        if (busy) return;
        busy = true;
        if (clearError) el('error').textContent = '';
        el('status').textContent = pending;
        updateControls();
        try {
            await task();
            el('status').textContent = '';
        } catch (error) {
            el('status').textContent = '';
            el('error').textContent = error.message || 'Không thể kết nối API Zalo. Trạng thái chưa được xác nhận.';
        } finally {
            busy = false;
            updateControls();
        }
    }
    window.loadZaloAutoReply = () => {
        if (!visible()) return;
        return run(refreshData, 'Đang tải cấu hình và tin nhắn...');
    };
    function schedule() {
        clearInterval(timer);
        timer = undefined;
        if (visible()) timer = setInterval(() => {
            if (visible()) run(refreshData, 'Đang làm mới trạng thái...', false);
        }, 5000);
    }
    new MutationObserver(schedule).observe(section, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', schedule);
    el('form').addEventListener('input', event => {
        if (event.target.id !== 'zar-image') markDirty(true);
    });
    el('image').addEventListener('change', () => {
        const file = el('image').files[0];
        if (file) {
            el('image-info').textContent = `Đã chọn: ${file.name} (${Math.round(file.size / 1024)} KB). Hãy bấm "Tải ảnh lên lưu trữ".`;
        }
        updateControls();
    });
    el('image-preview').addEventListener('error', () => {
        el('image-preview').hidden = true;
        el('image-info').textContent = 'Không tải được ảnh QR qua phiên đăng nhập. Hãy kiểm tra ảnh và phiên đăng nhập trước khi bật.';
    });
    el('refresh').addEventListener('click', window.loadZaloAutoReply);
    el('diagnostics').addEventListener('click', () => run(async () => {
        const report = await api('/diagnostics');
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'tikoder-zalo-dom-diagnostics.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'Đang xuất cấu trúc DOM, không lấy nội dung tin nhắn...'));
    el('form').addEventListener('submit', event => {
        event.preventDefault();
        if (busy || !loaded || !el('form').reportValidity()) return;
        const triggers = key => el(key + '-triggers').value.split(',').map(value => value.trim()).filter(Boolean);
        const payload = {
            enabled: el('enabled').checked,
            cooldownSeconds: Number(el('cooldown').value),
            target: { phone: el('target-phone').value.trim(), name: el('target-name').value.trim() },
            rules: {
                phone: { enabled: el('phone-enabled').checked, triggers: triggers('phone'), text: el('phone-text').value },
                qr: { enabled: el('qr-enabled').checked, triggers: triggers('qr'), caption: el('qr-caption').value },
                custom: customRules.map(r => ({
                    id: r.id || 'c_' + Math.random().toString(36).slice(2, 10),
                    name: r.name || 'Mẫu tùy chỉnh',
                    enabled: r.enabled === true,
                    triggers: Array.isArray(r.triggers) ? r.triggers : [],
                    text: r.text || ''
                }))
            }
        };
        if (!Number.isInteger(payload.cooldownSeconds) || payload.cooldownSeconds < 30) {
            el('error').textContent = 'Thời gian chờ phải là số nguyên từ 30 giây.'; return;
        }
        if (payload.enabled && (!payload.target.phone || !payload.target.name)) {
            el('error').textContent = 'Nhập số điện thoại và tên Zalo chính xác của liên hệ thử trước khi bật.'; return;
        }
        const hasActiveCustom = payload.rules.custom.some(r => r.enabled);
        if (payload.enabled && !payload.rules.phone.enabled && !payload.rules.qr.enabled && !hasActiveCustom) {
            el('error').textContent = 'Hãy bật ít nhất một quy tắc (SĐT, QR hoặc tùy chỉnh) trước khi bật trả lời tự động.'; return;
        }
        if (payload.enabled && payload.rules.qr.enabled && !imageAvailable) {
            el('error').textContent = 'Tải ảnh QR trước khi bật quy tắc ảnh.'; return;
        }
        if (payload.enabled && !confirm(`Bật trả lời tự động chỉ cho liên hệ thử ${payload.target.name} (${payload.target.phone})? App sẽ tự gửi mẫu đã lưu khi khớp quy tắc, không cần duyệt từng tin. Chỉ kết quả chưa rõ mới cần kiểm tra Zalo.`)) return;
        run(async () => {
            await api('/settings', 'PUT', payload);
            markDirty(false);
            await refreshData();
        }, 'Đang lưu cấu hình; chưa xác nhận kết quả...');
    });
    for (const action of ['connect', 'pause']) {
        el(action).addEventListener('click', () => {
            if (action === 'connect' && dirty) return;
            if (action === 'connect' && !confirm(`Mở trình duyệt Zalo và theo dõi liên hệ thử ${savedSettings?.target?.name || '(chưa cấu hình)'}? Chỉ tiếp tục sau khi kiểm tra đúng cuộc trò chuyện riêng tư trong Zalo.`)) return;
            run(async () => { await api('/' + action, 'POST', {}); await refreshData(); }, action === 'pause' ? 'Đang yêu cầu tạm dừng...' : 'Đang yêu cầu kết nối; hãy kiểm tra cửa sổ Zalo...');
        });
    }
    el('upload').addEventListener('click', () => run(async () => {
        const file = el('image').files[0];
        if (!file) throw new Error('Chọn ảnh QR trước khi tải lên.');
        if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Chỉ chấp nhận ảnh PNG hoặc JPEG.');
        if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Ảnh phải có dữ liệu và không vượt quá 5 MB.');
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
            reader.readAsDataURL(file);
        });
        await api('/image', 'POST', { data, mime: file.type });
        el('image').value = '';
        imageKey = undefined;
        await refreshData();
    }, 'Đang tải ảnh QR; không gửi tin nhắn...'));
    el('messages').addEventListener('click', event => {
        const button = event.target.closest('button[data-zar-action]');
        if (!button || busy) return;
        const action = button.dataset.zarAction;
        if (action === 'sent' && !confirm('Bạn đã mở đúng cuộc trò chuyện Zalo và kiểm tra tin này thực sự đã gửi? Chỉ xác nhận sau khi kiểm tra, không gửi lại.')) return;
        if (action === 'skipped' && !confirm('Bỏ qua tin này? Với kết quả chưa rõ, hãy kiểm tra Zalo trước. Thao tác này không thu hồi tin đã gửi.')) return;
        const id = button.closest('[data-message-id]').dataset.messageId;
        run(async () => { await api('/messages/' + encodeURIComponent(id) + '/resolve', 'POST', { action }); await refreshData(); }, 'Đang lưu kết quả kiểm tra...');
    });
    const addBtn = el('add-custom-rule');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            customRules.push({
                id: 'c_' + Math.random().toString(36).slice(2, 10),
                name: `Mẫu mới #${customRules.length + 1}`,
                enabled: true,
                triggers: [],
                text: ''
            });
            renderCustomRules();
            markDirty(true);
        });
    }

    updateControls();
})();
