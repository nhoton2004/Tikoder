        const socket = io();
        const ordersContainer = document.getElementById('orders-container');
        const chatFeed = document.getElementById('chat-feed');
        const tiktokIdInput = document.getElementById('tiktok-id');
        const btnConnect = document.getElementById('btn-connect');
        const statusMsg = document.getElementById('status-msg');
        const printerIpInput = document.getElementById('printer-ip');
        const tiktokApiKeyInput = document.getElementById('tiktok-api-key');
        const systemStatusMsg = document.getElementById('system-status-msg');
        const settingsPanel = document.getElementById('settings-panel');
        const historyModal = document.getElementById('history-modal');
        const historyListContent = document.getElementById('history-list-content');
        const sectionConnect = document.getElementById('section-connect');
        const sectionKpi = document.getElementById('section-kpi');
        const sectionComments = document.getElementById('section-comments');
        const sectionOrders = document.getElementById('section-orders');
        const sectionOverview = document.getElementById('section-overview');
        const rightCol = document.getElementById('right-col');
        const menuItems = document.querySelectorAll('.menu-item[data-view]');

        let ordersData = {};
        let kpiComments = 0;
        let currentLang = localStorage.getItem('app_lang') || 'vi';
        let topShopStats = [];
        let activeBroadcasterId = '';
        const seenChatMsgIds = new Set();
        let mobilePopoverEl = null;
        let mobilePopoverHideTimer = null;

        const i18n = {
            vi: {
                'menu.overview': 'Tổng quan',
                'menu.live': 'Live',
                'menu.orders': 'Đơn hàng',
                'menu.shop': 'Shop',
                'menu.reports': 'Báo cáo',
                'menu.settings': 'Cài đặt',
                'subtitle': 'Quản lý đơn hàng & luồng bình luận chuyên nghiệp cho TikTok Live',
                'live.connect': 'Kết nối Live',
                'live.helper': 'Nhập ID TikTok chủ live để theo dõi bình luận & đơn hàng realtime.',
                'live.connectBtn': 'Kết nối',
                'status.disconnected': 'Chưa kết nối',
                'status.connected': 'Đã kết nối',
                'kpi.orders': 'Đơn hôm nay',
                'kpi.comments': 'Bình luận',
                'kpi.revenue': 'Doanh thu',
                'kpi.liveStatus': 'Trạng thái',
                'comments.title': 'Luồng bình luận',
                'orders.current': 'Đơn hàng hiện tại',
                'actions.saveSession': 'Lưu phiên',
                'actions.printSummary': 'In tổng kết',
                'settings.title': 'Cấu hình hệ thống',
                'settings.printer': 'Máy in',
                'settings.apiKey': 'TikTok Sign API Key',
                'settings.save': 'Lưu cấu hình',
                'backup.title': 'Backup dữ liệu',
                'backup.mine': 'Dữ liệu tài khoản hiện tại',
                'backup.all': 'Toàn bộ dữ liệu (Admin)',
                'tips.title': 'Hướng dẫn',
                'tips.desc': 'Nhập ID TikTok của chủ live để kết nối và bắt đầu theo dõi luồng bình luận, đơn hàng theo thời gian thực.',
                'history.title': 'Lịch sử phiên Live',
                'sessions.title': 'Lịch sử Phiên Live',
                'sessions.merge': 'Gộp phiên đã chọn',
                'merge.title': 'Kết quả gộp phiên',
                'merge.print': 'In đơn gộp',
                'ov.title': 'Tổng quan',
                'ov.subtitle': 'Theo dõi nhanh tình hình đơn hàng, live và doanh thu',
                'ov.range': '7 ngày qua',
                'ov.liveActive': 'Live đang hoạt động',
                'ov.closeRate': 'Tỷ lệ chốt',
                'ov.orders7d': 'Đơn hàng 7 ngày gần đây',
                'ov.revenue7d': 'Doanh thu 7 ngày gần đây',
                'ov.topShop': 'Top shop doanh thu',
                'ov.latestOrders': 'Đơn mới nhất',
                'ov.viewAll': 'Xem tất cả',
                'tb.customer': 'Khách',
                'tb.value': 'Giá trị',
                'tb.status': 'Trạng thái'
            },
            en: {
                'menu.overview': 'Overview',
                'menu.live': 'Live',
                'menu.orders': 'Orders',
                'menu.shop': 'Shop',
                'menu.reports': 'Reports',
                'menu.settings': 'Settings',
                'subtitle': 'Manage TikTok Live comments and orders in real time',
                'live.connect': 'Connect Live',
                'live.helper': 'Enter broadcaster TikTok ID to track comments and live orders.',
                'live.connectBtn': 'Connect',
                'status.disconnected': 'Disconnected',
                'status.connected': 'Connected',
                'kpi.orders': 'Orders today',
                'kpi.comments': 'Comments',
                'kpi.revenue': 'Revenue',
                'kpi.liveStatus': 'Status',
                'comments.title': 'Comment Stream',
                'orders.current': 'Current Orders',
                'actions.saveSession': 'Save Session',
                'actions.printSummary': 'Print Summary',
                'settings.title': 'System Settings',
                'settings.printer': 'Printer',
                'settings.apiKey': 'TikTok Sign API Key',
                'settings.save': 'Save settings',
                'backup.title': 'Data Backup',
                'backup.mine': 'Current account data',
                'backup.all': 'All data (Admin)',
                'tips.title': 'Guide',
                'tips.desc': 'Input TikTok broadcaster ID to connect and monitor comments and orders in real time.',
                'history.title': 'Live Session History',
                'sessions.title': 'Saved Live Sessions',
                'sessions.merge': 'Merge selected sessions',
                'merge.title': 'Merged session result',
                'merge.print': 'Print merged orders',
                'ov.title': 'Overview',
                'ov.subtitle': 'Track orders, live sessions and revenue at a glance',
                'ov.range': 'Last 7 days',
                'ov.liveActive': 'Active live sessions',
                'ov.closeRate': 'Close rate',
                'ov.orders7d': 'Orders in last 7 days',
                'ov.revenue7d': 'Revenue in last 7 days',
                'ov.topShop': 'Top revenue shops',
                'ov.latestOrders': 'Latest orders',
                'ov.viewAll': 'View all',
                'tb.customer': 'Customer',
                'tb.value': 'Value',
                'tb.status': 'Status'
            }
        };

        function t(key) {
            return i18n[currentLang]?.[key] || i18n.vi[key] || key;
        }

        function setLang(lang) {
            currentLang = lang;
            localStorage.setItem('app_lang', lang);
            document.documentElement.lang = lang === 'en' ? 'en' : 'vi';
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                el.textContent = t(key);
            });
            document.getElementById('btn-lang-vi').classList.toggle('bg-red-50', lang === 'vi');
            document.getElementById('btn-lang-en').classList.toggle('bg-red-50', lang === 'en');
        }
        window.setLang = setLang;
        menuItems.forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });

        function calculateKpis() {
            let totalOrders = 0;
            let totalRevenue = 0;
            Object.values(ordersData).forEach(o => {
                totalOrders += Array.isArray(o.items) ? o.items.length : 0;
                totalRevenue += Number(o.total || 0);
            });
            document.getElementById('kpi-orders').textContent = totalOrders;
            document.getElementById('kpi-comments').textContent = kpiComments;
            document.getElementById('kpi-revenue').textContent = formatMoney(totalRevenue);
            document.getElementById('chat-count').textContent = `${chatFeed.children.length} items`;
            const ovOrders = document.getElementById('ov-orders');
            const ovComments = document.getElementById('ov-comments');
            const ovRevenue = document.getElementById('ov-revenue');
            const ovLiveActive = document.getElementById('ov-live-active');
            const ovCloseRate = document.getElementById('ov-close-rate');
            if (ovOrders) ovOrders.textContent = totalOrders;
            if (ovComments) ovComments.textContent = kpiComments;
            if (ovRevenue) ovRevenue.textContent = formatMoney(totalRevenue);
            if (ovLiveActive) ovLiveActive.textContent = Object.keys(ordersData).length > 0 ? '1' : '0';
            if (ovCloseRate) {
                const totalVisitors = Math.max(kpiComments, 1);
                const closeRate = Math.min(99.9, (totalOrders / totalVisitors) * 100);
                ovCloseRate.textContent = `${closeRate.toFixed(1)}%`;
            }
            renderOverviewLatestOrders();
        }

        function buildConfirmedAmountTooltip(userId) {
            const total = Number(ordersData?.[userId]?.total || 0);
            if (currentLang === 'en') {
                return total > 0 ? `Confirmed amount: ${formatMoney(total)}` : 'Confirmed amount: 0';
            }
            return total > 0 ? `Đã chốt: ${formatMoney(total)}` : 'Đã chốt: 0';
        }

        function refreshCommentUserTooltips() {
            const nodes = document.querySelectorAll('[data-comment-userid]');
            nodes.forEach(node => {
                const userId = node.getAttribute('data-comment-userid') || '';
                node.setAttribute('title', buildConfirmedAmountTooltip(userId));
            });
        }

        function isCoarsePointer() {
            return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        }

        function ensureMobilePopover() {
            if (mobilePopoverEl) return mobilePopoverEl;
            const el = document.createElement('div');
            el.className = 'comment-amount-popover';
            document.body.appendChild(el);
            mobilePopoverEl = el;
            return el;
        }

        function hideMobilePopover() {
            if (!mobilePopoverEl) return;
            mobilePopoverEl.classList.remove('show');
        }

        function showMobilePopover(anchorEl, text) {
            if (!isCoarsePointer()) return;
            const el = ensureMobilePopover();
            el.textContent = text;
            const rect = anchorEl.getBoundingClientRect();
            const top = rect.top - 8;
            const left = rect.left + (rect.width / 2);
            el.style.left = `${Math.max(12, Math.min(window.innerWidth - 12, left))}px`;
            el.style.top = `${Math.max(12, top)}px`;
            el.style.transform = 'translate(-50%, -100%)';
            el.classList.add('show');

            if (mobilePopoverHideTimer) clearTimeout(mobilePopoverHideTimer);
            mobilePopoverHideTimer = setTimeout(() => hideMobilePopover(), 2200);
        }

        function setupMobileCommentPopover() {
            document.addEventListener('click', (event) => {
                const target = event.target;
                const commentUserEl = target.closest?.('[data-comment-userid]');
                if (!commentUserEl) {
                    hideMobilePopover();
                    return;
                }
                if (!isCoarsePointer()) return;
                const userId = commentUserEl.getAttribute('data-comment-userid') || '';
                showMobilePopover(commentUserEl, buildConfirmedAmountTooltip(userId));
            });
        }

        function renderOverviewLatestOrders() {
            const tbody = document.getElementById('overview-latest-orders');
            if (!tbody) return;
            const rows = [];
            Object.values(ordersData).forEach(customer => {
                (customer.items || []).forEach(item => {
                    rows.push({
                        id: String(item.id || '').slice(-10) || '—',
                        customer: customer.nickname || customer.username || '—',
                        shop: (tiktokIdInput.value || '').replace('@', '').trim() || '—',
                        value: Number(item.price || 0),
                        status: 'done',
                        time: item.time || ''
                    });
                });
            });
            const latest = rows.slice(-5).reverse();
            if (latest.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-gray-400">${currentLang === 'en' ? 'No orders yet' : 'Chưa có đơn hàng'}</td></tr>`;
                return;
            }
            tbody.innerHTML = latest.map(r => `
                <tr class="border-b">
                    <td class="py-2">#${r.id}</td>
                    <td class="py-2">${r.customer}</td>
                    <td class="py-2">${r.shop}</td>
                    <td class="py-2">${formatMoney(r.value)}</td>
                    <td class="py-2"><span class="px-2 py-1 rounded text-[10px] font-bold ${r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${r.status === 'done' ? (currentLang === 'en' ? 'Done' : 'Đã chốt') : (currentLang === 'en' ? 'Pending' : 'Chờ chốt')}</span></td>
                </tr>
            `).join('');
        }

        async function refreshOverviewTopShops() {
            const container = document.getElementById('overview-top-shop-list');
            if (!container) return;
            try {
                const res = await fetch('/api/live-sessions');
                const data = await res.json();
                const sessions = Array.isArray(data.sessions) ? data.sessions : [];
                const shopMap = {};
                sessions.forEach(s => {
                    const shopKey = (s.tiktokUsername || '').trim() || 'unknown';
                    if (!shopMap[shopKey]) {
                        shopMap[shopKey] = { shop: shopKey, revenue: 0 };
                    }
                    shopMap[shopKey].revenue += Number(s.summary?.totalRevenue || 0);
                });
                topShopStats = Object.values(shopMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
            } catch (e) {
                topShopStats = [];
            }
            renderOverviewTopShops();
        }

        function renderOverviewTopShops() {
            const container = document.getElementById('overview-top-shop-list');
            if (!container) return;
            if (!topShopStats.length) {
                container.innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'No saved session data yet' : 'Chưa có dữ liệu phiên đã lưu'}</p>`;
                return;
            }
            const maxRevenue = Math.max(...topShopStats.map(s => s.revenue), 1);
            container.innerHTML = topShopStats.map((s, idx) => {
                const width = Math.max(8, Math.round((s.revenue / maxRevenue) * 100));
                const rankClass = idx === 0
                    ? 'bg-amber-100 text-amber-700'
                    : idx === 1
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-orange-100 text-orange-700';
                return `
                    <div class="flex items-center gap-3">
                        <span class="w-7 h-7 rounded-full ${rankClass} font-bold flex items-center justify-center">${idx + 1}</span>
                        <span class="w-28 truncate">@${s.shop}</span>
                        <div class="h-2 bg-gray-100 rounded-full flex-1">
                            <div class="h-2 bg-red-500 rounded-full" style="width:${width}%"></div>
                        </div>
                        <span class="font-bold">${formatMoney(s.revenue)}</span>
                    </div>
                `;
            }).join('');
        }

        function switchView(view) {
            menuItems.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });

            if (view === 'overview') {
                sectionOverview.classList.remove('hidden');
                sectionConnect.classList.add('hidden');
                sectionKpi.classList.add('hidden');
                sectionComments.classList.add('hidden');
                sectionOrders.classList.add('hidden');
                rightCol.classList.add('hidden');
                return;
            }

            if (view === 'live') {
                sectionOverview.classList.add('hidden');
                sectionConnect.classList.remove('hidden');
                sectionKpi.classList.remove('hidden');
                sectionComments.classList.remove('hidden');
                sectionOrders.classList.add('hidden');
                rightCol.classList.remove('hidden');
                return;
            }

            if (view === 'orders') {
                sectionOverview.classList.add('hidden');
                sectionConnect.classList.add('hidden');
                sectionKpi.classList.add('hidden');
                sectionComments.classList.add('hidden');
                sectionOrders.classList.remove('hidden');
                rightCol.classList.add('hidden');
            }
        }
        window.switchView = switchView;

        window.toggleSettings = () => settingsPanel.classList.toggle('hidden');
        window.saveSettings = () => {
            socket.emit('update-settings', {
                printerInterface: printerIpInput.value.trim(),
                tiktokSignApiKey: tiktokApiKeyInput.value.trim()
            });
        };
        window.downloadBackup = (format) => {
            const scope = document.getElementById('backup-scope').value;
            const url = `/api/export-data?format=${encodeURIComponent(format)}&scope=${encodeURIComponent(scope)}`;
            window.open(url, '_blank');
        };
        window.showHistory = () => { historyModal.classList.remove('hidden'); socket.emit('get-history-list'); };
        window.closeHistory = () => historyModal.classList.add('hidden');

        socket.on('history-list', (list) => {
            historyListContent.innerHTML = list.map(f => `
                <div class="flex justify-between items-center p-3 border rounded-lg hover:bg-blue-50 transition cursor-pointer" onclick="loadHistory('${f.fileName}')">
                    <div>
                        <p class="font-bold text-gray-800 text-sm">${f.fileName.replace('.json', '')}</p>
                        <p class="text-[10px] text-gray-400">${new Date(f.mtime).toLocaleString()}</p>
                    </div>
                    <button class="text-blue-600 font-bold text-xs uppercase">Open</button>
                </div>
            `).join('') || '<p class="text-center text-gray-400 py-10">No history.</p>';
        });

        window.loadHistory = (fileName) => {
            if (confirm(currentLang === 'en' ? 'Load this history and overwrite current list?' : 'Tải lịch sử này sẽ ghi đè danh sách đang hiện?')) {
                socket.emit('load-history-file', fileName);
                closeHistory();
            }
        };

        socket.on('history-data', (res) => {
            ordersData = res.data;
            ordersContainer.innerHTML = '';
            Object.values(res.data).forEach(order => renderOrderCard(order));
            statusMsg.innerText = (currentLang === 'en' ? 'History: ' : 'Lịch sử: ') + res.fileName;
            calculateKpis();
            refreshCommentUserTooltips();
        });

        socket.on('system-config', (config) => {
            printerIpInput.value = config.printerInterface;
            tiktokApiKeyInput.value = config.tiktokSignApiKey;
        });

        socket.on('system-status', (msg) => {
            systemStatusMsg.innerText = msg;
            setTimeout(() => systemStatusMsg.innerText = '', 3000);
        });
        socket.on('printer-error', (msg) => { alert(msg); });

        socket.on('all-confirmed-orders', (allOrders) => {
            ordersData = allOrders;
            ordersContainer.innerHTML = '';
            Object.values(allOrders).forEach(order => renderOrderCard(order));
            calculateKpis();
            refreshCommentUserTooltips();
        });

        function resetChatFeed() {
            chatFeed.innerHTML = '';
            kpiComments = 0;
            seenChatMsgIds.clear();
            calculateKpis();
        }

        function renderChatRow(data) {
            const msgId = data.msgId || `${data.nickname || ''}_${data.comment || ''}_${data.timestamp || ''}`;
            if (seenChatMsgIds.has(msgId)) return;
            seenChatMsgIds.add(msgId);
            if (seenChatMsgIds.size > 1200) {
                // Giữ set ở mức hợp lý để tránh phình bộ nhớ
                const arr = Array.from(seenChatMsgIds);
                seenChatMsgIds.clear();
                arr.slice(-600).forEach(id => seenChatMsgIds.add(id));
            }

            kpiComments += 1;
            const now = data.timestamp
                ? new Date(data.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const row = document.createElement('div');
            row.className = 'chat-row border border-gray-100 rounded-xl p-3 flex gap-3 items-start';
            const priceTag = data.suggestedPrice > 0 ? `<span class="text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded">${formatMoney(data.suggestedPrice)}</span>` : '';
            const commenterId = data.uniqueId || data.username || '';
            const tooltip = buildConfirmedAmountTooltip(commenterId);
            row.innerHTML = `
                <img src="${data.profilePictureUrl}" class="w-10 h-10 rounded-full border cursor-help" data-comment-userid="${commenterId}" title="${tooltip}">
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center">
                        <p class="font-bold text-gray-800 truncate text-sm cursor-help" data-comment-userid="${commenterId}" title="${tooltip}">${data.nickname}</p>
                        <span class="text-[10px] text-gray-400 font-mono">${now}</span>
                    </div>
                    <p class="text-gray-700 my-1 text-sm">${data.comment}</p>
                    <div class="flex items-center gap-2 mt-2">
                        ${priceTag}
                        <button onclick="manualConfirm('${data.uniqueId}', '${data.nickname}', '${data.profilePictureUrl}', '${data.comment.replace(/'/g, "\\'")}', ${data.suggestedPrice})" class="bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded uppercase">${currentLang === 'en' ? 'CONFIRM' : 'CHỐT'}</button>
                    </div>
                </div>
            `;
            chatFeed.appendChild(row);
            chatFeed.scrollTop = chatFeed.scrollHeight;
            if (chatFeed.children.length > 300) chatFeed.removeChild(chatFeed.firstChild);
            calculateKpis();
        }

        btnConnect.addEventListener('click', () => {
            const id = tiktokIdInput.value.trim().replace('@', '');
            if (!id) return alert(currentLang === 'en' ? 'Please input TikTok ID' : 'Nhập ID');
            resetChatFeed();
            socket.emit('start-live', id);
        });

        socket.on('status', (data) => {
            const connectedText = currentLang === 'en' ? `Connected: ${data.roomId}` : `Kết nối: ${data.roomId}`;
            const errorText = currentLang === 'en' ? `Error: ${data.error}` : `Lỗi: ${data.error}`;
            statusMsg.innerText = data.connected ? connectedText : errorText;
            statusMsg.className = data.connected ? 'mt-3 text-sm text-green-600 font-semibold' : 'mt-3 text-sm text-red-600 font-semibold';
            document.getElementById('kpi-status').textContent = data.connected ? t('status.connected') : t('status.disconnected');
            document.getElementById('kpi-status').className = data.connected ? 'text-base font-bold mt-3 text-green-600' : 'text-base font-bold mt-3 text-gray-500';
            if (data.connected && data.broadcasterId) {
                activeBroadcasterId = data.broadcasterId;
                localStorage.setItem('lastBroadcasterId', data.broadcasterId);
                socket.emit('get-chat-buffer', { broadcasterId: data.broadcasterId });
            }
        });

        socket.on('raw-chat', (data) => {
            if (activeBroadcasterId && data.broadcasterId && data.broadcasterId !== activeBroadcasterId) return;
            renderChatRow(data);
        });

        socket.on('chat-buffer', (payload) => {
            const broadcasterId = payload?.broadcasterId || '';
            const comments = Array.isArray(payload?.comments) ? payload.comments : [];
            if (!broadcasterId || (activeBroadcasterId && broadcasterId !== activeBroadcasterId)) return;

            resetChatFeed();
            comments.forEach(renderChatRow);
        });

        window.manualConfirm = (uniqueId, nickname, profilePictureUrl, comment, suggestedPrice) => {
            const inputText = currentLang === 'en' ? 'Enter price (e.g. 50000):' : 'Nhập giá (vd: 50000):';
            let price = suggestedPrice || parseFloat(prompt(inputText, '')) || 0;
            if (price > 0) socket.emit('confirm-item', { uniqueId, nickname, profilePictureUrl, comment, price });
        };

        socket.on('order-confirmed', (userOrder) => {
            ordersData[userOrder.username] = userOrder;
            renderOrderCard(userOrder);
            calculateKpis();
            refreshCommentUserTooltips();
        });

        function formatMoney(amount) {
            return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount).replace('₫', 'đ');
        }

        function renderOrderCard(order) {
            let card = document.getElementById(`card-${order.username}`);
            if (!card) {
                card = document.createElement('div');
                card.id = `card-${order.username}`;
                card.className = 'bg-white rounded-xl shadow border border-gray-200 flex flex-col overflow-hidden';
                ordersContainer.prepend(card);
            }
            const itemsHtml = order.items.map(i => `
                <div class="group flex justify-between items-center text-[10px] py-2 border-b border-gray-50 hover:bg-gray-50 px-2 transition">
                    <span class="text-gray-600 truncate mr-2 flex-1">${i.text}</span>
                    <div class="flex items-center gap-3 ml-2">
                        <span class="font-bold text-red-500 whitespace-nowrap">${formatMoney(i.price)}</span>
                        <div class="flex gap-2 border-l pl-2 border-gray-200">
                            <button onclick="reprintItem('${order.username}', ${i.id})" class="text-green-600 p-1 bg-green-50 rounded">🖨️</button>
                            <button onclick="editItem('${order.username}', ${i.id}, ${i.price})" class="text-blue-500 p-1 bg-blue-50 rounded">✏️</button>
                            <button onclick="deleteItem('${order.username}', ${i.id})" class="text-red-500 p-1 bg-red-50 rounded">🗑️</button>
                        </div>
                    </div>
                </div>
            `).join('');

            card.innerHTML = `
                <div class="p-3 bg-gray-50 flex items-center justify-between border-b">
                    <div class="flex items-center gap-2">
                        <img src="${order.profilePictureUrl}" class="w-8 h-8 rounded-full border">
                        <div class="overflow-hidden">
                            <h3 class="font-bold text-xs truncate">${order.nickname}</h3>
                            <p class="text-[9px] text-gray-400">@${order.username}</p>
                        </div>
                    </div>
                    <button onclick="deleteCustomer('${order.username}')" class="text-gray-400 hover:text-red-500 text-sm">✕</button>
                </div>
                <div class="flex-1 max-h-48 overflow-y-auto">${itemsHtml}</div>
                <div class="p-3 bg-red-50 flex justify-between items-center border-t">
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold text-gray-700 uppercase">TOTAL</span>
                        <button onclick="reprintTotal('${order.username}')" class="text-[9px] bg-white border border-gray-300 px-1 py-0.5 rounded">${currentLang === 'en' ? 'Reprint total' : 'In lại tổng'}</button>
                    </div>
                    <span class="text-sm font-black text-red-600">${formatMoney(order.total)}</span>
                </div>
            `;
        }

        window.reprintItem = (username, itemId) => socket.emit('reprint-item', { username, itemId });
        window.reprintTotal = (username) => socket.emit('reprint-total', username);
        window.deleteCustomer = (username) => {
            const msg = currentLang === 'en' ? `Delete all orders for @${username}?` : `Xóa toàn bộ đơn của khách @${username}?`;
            if (confirm(msg)) socket.emit('delete-customer', username);
        };
        window.deleteItem = (username, itemId) => {
            const msg = currentLang === 'en' ? 'Delete this item?' : 'Xóa món hàng này?';
            if (confirm(msg)) socket.emit('delete-item', { username, itemId });
        };
        window.editItem = (username, itemId, oldPrice) => {
            const promptText = currentLang === 'en' ? 'Enter new price:' : 'Nhập giá mới:';
            const newPrice = parseFloat(prompt(promptText, oldPrice));
            if (!isNaN(newPrice) && newPrice !== oldPrice) {
                socket.emit('edit-item-price', { username, itemId, newPrice });
            }
        };

        window.printAllSummary = () => {
            let html = `<div style="font-family: 'Times New Roman', Times, serif; width: 80mm; margin: 0 auto; color: black;">`;
            html += `<div style="text-align:center;"><h2 style="margin: 0;">TONG KET PHIEN LIVE</h2><hr style="border: 1px solid black;"></div>`;
            let totalOverall = 0;
            Object.values(ordersData).forEach(o => {
                totalOverall += o.total;
                html += `<div style="margin-bottom: 10px; border-bottom: 1px dashed black; padding-bottom: 5px;">`;
                html += `<div style="font-weight: bold; font-size: 16px;">${o.nickname} (@${o.username})</div>`;
                o.items.forEach(i => {
                    html += `<div style="display: flex; justify-content: space-between; font-size: 13px; margin-top: 2px;">`;
                    html += `<span style="flex: 1;">- ${i.text} <small>(${i.time})</small></span>`;
                    html += `<span style="font-weight: bold;">${formatMoney(i.price)}</span>`;
                    html += `</div>`;
                });
                html += `<div style="text-align:right; font-weight: bold; font-size: 14px; margin-top: 5px;">Cong: ${formatMoney(o.total)}</div>`;
                html += `</div>`;
            });
            html += `<div style="text-align:right; margin-top: 15px; border-top: 2px solid black; padding-top: 5px;">`;
            html += `<h3 style="margin: 0;">TONG CONG: ${formatMoney(totalOverall)}</h3>`;
            html += `</div></div>`;
            document.getElementById('print-section').innerHTML = html;
            window.print();
        };

        window.logout = async () => {
            const msg = currentLang === 'en' ? 'Do you want to logout?' : 'Đại ca muốn đăng xuất hả?';
            if (confirm(msg)) {
                await fetch('/logout', { method: 'POST' });
                window.location.href = '/login';
            }
        };

        (async () => {
            switchView('overview');
            setLang(currentLang);
            setupMobileCommentPopover();
            refreshOverviewTopShops();
            const lastBroadcasterId = (localStorage.getItem('lastBroadcasterId') || '').trim();
            if (lastBroadcasterId) {
                tiktokIdInput.value = lastBroadcasterId;
                activeBroadcasterId = lastBroadcasterId;
                socket.emit('start-live', lastBroadcasterId);
            }
            try {
                const res = await fetch('/api/me');
                const data = await res.json();
                if (data.loggedIn && data.user) {
                    const bar = document.getElementById('user-bar');
                    const avatar = document.getElementById('user-avatar');
                    const nameEl = document.getElementById('user-name');
                    const emailEl = document.getElementById('user-email');

                    emailEl.textContent = data.user.email || '';
                    nameEl.textContent = data.user.name || data.user.email?.split('@')[0] || '';

                    if (data.user.picture) {
                        avatar.src = data.user.picture;
                        avatar.classList.remove('hidden');
                    }

                    bar.classList.remove('hidden');
                    bar.style.display = 'flex';

                    if (data.user.role === 'admin' || data.user.role === 'super_admin') {
                        document.getElementById('btn-admin').classList.remove('hidden');
                    }

                    if (data.devSkipAuth) {
                        document.getElementById('dev-mode-badge').classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.warn('Could not load user info:', e);
            }
            calculateKpis();
        })();

        let selectedSessionIds = new Set();
        let lastMergeData = null;

        window.saveCurrentSession = async () => {
            if (Object.keys(ordersData).length === 0) {
                return alert(currentLang === 'en' ? 'No orders to save yet!' : 'Chưa có đơn hàng nào để lưu!');
            }
            const tiktokId = tiktokIdInput.value.trim().replace('@', '') || '';
            const defaultName = `Live ${tiktokId ? '@' + tiktokId + ' ' : ''}${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
            const liveName = prompt(currentLang === 'en' ? 'Session name:' : 'Đặt tên cho phiên live:', defaultName);
            if (!liveName) return;

            try {
                const res = await fetch('/api/live-sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        liveName,
                        tiktokUsername: tiktokId,
                        startedAt: new Date().toISOString(),
                        endedAt: new Date().toISOString(),
                        orders: ordersData
                    })
                });
                const data = await res.json();
                if (data.success) {
                    alert((currentLang === 'en' ? 'Saved session:' : 'Đã lưu phiên: ') + liveName);
                    refreshOverviewTopShops();
                } else {
                    alert('Error: ' + (data.error || 'Unknown'));
                }
            } catch (e) {
                alert('Connection error: ' + e.message);
            }
        };

        window.showLiveSessions = async () => {
            selectedSessionIds.clear();
            document.getElementById('live-sessions-modal').classList.remove('hidden');
            document.getElementById('live-sessions-list').innerHTML = '<p class="text-center text-gray-400 py-10">Loading...</p>';
            updateMergeBtn();
            try {
                const res = await fetch('/api/live-sessions');
                const data = await res.json();
                renderLiveSessionsList(data.sessions || []);
            } catch (e) {
                document.getElementById('live-sessions-list').innerHTML = '<p class="text-center text-red-400 py-10">Load error</p>';
            }
        };

        window.closeLiveSessions = () => document.getElementById('live-sessions-modal').classList.add('hidden');

        function updateMergeBtn() {
            const btn = document.getElementById('btn-merge');
            const count = document.getElementById('merge-count');
            if (selectedSessionIds.size > 0) {
                btn.classList.remove('hidden');
                count.textContent = selectedSessionIds.size;
            } else {
                btn.classList.add('hidden');
            }
        }

        window.toggleSessionSelect = (sessionId) => {
            if (selectedSessionIds.has(sessionId)) selectedSessionIds.delete(sessionId);
            else selectedSessionIds.add(sessionId);
            const cb = document.getElementById('cb-' + sessionId);
            if (cb) cb.checked = selectedSessionIds.has(sessionId);
            updateMergeBtn();
        };

        function renderLiveSessionsList(sessions) {
            const container = document.getElementById('live-sessions-list');
            if (sessions.length === 0) {
                container.innerHTML = '<p class="text-center text-gray-400 py-10">No session saved yet.</p>';
                return;
            }
            container.innerHTML = sessions.map(s => {
                const date = new Date(s.createdAt).toLocaleString('vi-VN');
                const revenue = s.summary ? formatMoney(s.summary.totalRevenue) : '0đ';
                const orders = s.summary ? s.summary.totalOrders : 0;
                const qty = s.summary ? s.summary.totalQuantity : 0;
                return `
                <div class="flex items-start gap-3 p-3 border rounded-lg hover:bg-purple-50 transition group">
                    <input type="checkbox" id="cb-${s.id}" class="mt-1 accent-purple-600 w-4 h-4 cursor-pointer" onchange="toggleSessionSelect('${s.id}')" ${selectedSessionIds.has(s.id) ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="font-bold text-gray-800 text-sm">${s.liveName}</p>
                                <p class="text-[10px] text-gray-400">${date}${s.tiktokUsername ? ' • @' + s.tiktokUsername : ''}</p>
                            </div>
                            <div class="text-right">
                                <span class="text-xs font-bold text-red-500">${revenue}</span>
                                <p class="text-[9px] text-gray-400">${orders} orders • ${qty} qty</p>
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button onclick="viewSessionDetail('${s.id}')" class="text-blue-500 p-1 bg-blue-50 rounded text-xs">👁️</button>
                        <button onclick="deleteSession('${s.id}')" class="text-red-500 p-1 bg-red-50 rounded text-xs">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }

        window.deleteSession = async (sessionId) => {
            if (!confirm('Delete this session?')) return;
            try {
                await fetch('/api/live-sessions/' + sessionId, { method: 'DELETE' });
                selectedSessionIds.delete(sessionId);
                showLiveSessions();
            } catch (e) { alert('Delete error: ' + e.message); }
        };

        window.viewSessionDetail = async (sessionId) => {
            try {
                const res = await fetch('/api/live-sessions/' + sessionId);
                const data = await res.json();
                if (!data.session) return alert('Not found');
                const s = data.session;
                lastMergeData = {
                    selectedSessions: [{ id: s.id, liveName: s.liveName }],
                    summary: { totalSessions: 1, ...s.summary },
                    mergedOrders: s.orders || [],
                    productSummary: [],
                    customerSummary: []
                };
                renderMergeResults(lastMergeData, s.liveName);
                document.getElementById('merge-modal').classList.remove('hidden');
            } catch (e) { alert('Error: ' + e.message); }
        };

        window.mergeSelectedSessions = async () => {
            if (selectedSessionIds.size === 0) return alert('No session selected');
            try {
                const res = await fetch('/api/live-sessions/merge-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionIds: Array.from(selectedSessionIds) })
                });
                const data = await res.json();
                if (data.error) return alert('Error: ' + data.error);
                lastMergeData = data;
                renderMergeResults(data, `Merge ${data.summary.totalSessions} sessions`);
                document.getElementById('merge-modal').classList.remove('hidden');
            } catch (e) { alert('Error: ' + e.message); }
        };

        window.closeMergeModal = () => document.getElementById('merge-modal').classList.add('hidden');

        function renderMergeResults(data) {
            const s = data.summary;
            const container = document.getElementById('merge-results-content');
            let html = `
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div class="bg-purple-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Sessions</p><p class="text-xl font-black text-purple-700">${s.totalSessions}</p></div>
                    <div class="bg-blue-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Orders</p><p class="text-xl font-black text-blue-700">${s.totalOrders}</p></div>
                    <div class="bg-green-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Quantity</p><p class="text-xl font-black text-green-700">${s.totalQuantity}</p></div>
                    <div class="bg-red-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Revenue</p><p class="text-xl font-black text-red-600">${formatMoney(s.totalRevenue)}</p></div>
                </div>`;

            if (data.customerSummary && data.customerSummary.length > 0) {
                html += `<div class="mb-4"><h4 class="text-xs font-bold text-gray-500 uppercase mb-2">By customer</h4>
                    <table class="w-full text-xs border-collapse"><thead><tr class="bg-gray-100">
                    <th class="p-2 text-left border">Customer</th><th class="p-2 text-center border">Orders</th><th class="p-2 text-right border">Total</th></tr></thead><tbody>`;
                data.customerSummary.forEach(c => {
                    html += `<tr class="hover:bg-gray-50"><td class="p-2 border">${c.customerName || ''} ${c.customerUsername ? '(@' + c.customerUsername + ')' : ''}</td><td class="p-2 border text-center">${c.orders.length}</td><td class="p-2 border text-right font-bold text-red-500">${formatMoney(c.total)}</td></tr>`;
                });
                html += '</tbody></table></div>';
            }

            container.innerHTML = html;
        }

        window.printMergeResults = () => {
            if (!lastMergeData) return;
            const d = lastMergeData;
            let html = `<div style="font-family: 'Times New Roman', Times, serif; width: 80mm; margin: 0 auto; color: black;">`;
            html += `<div style="text-align:center;"><h2 style="margin:0;">MERGED SUMMARY</h2><hr style="border:1px solid black;"></div>`;
            html += `<p style="font-size:12px;">Sessions: ${d.summary.totalSessions} | Orders: ${d.summary.totalOrders} | Qty: ${d.summary.totalQuantity}</p>`;
            html += `<p style="font-weight:bold; font-size:16px;">TOTAL: ${formatMoney(d.summary.totalRevenue)}</p>`;
            html += `</div>`;
            document.getElementById('print-section').innerHTML = html;
            window.print();
        };
