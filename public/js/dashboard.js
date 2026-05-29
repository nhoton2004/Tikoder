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
        const sectionLiveOrders = document.getElementById('section-live-orders');
        const sectionOverview = document.getElementById('section-overview');
        const rightCol = document.getElementById('right-col');
        const guidePanel = document.getElementById('guide-panel');
        const menuItems = document.querySelectorAll('.menu-item[data-view]');
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
        const liveOrdersCompact = document.getElementById('live-orders-compact');
        const overviewStartInput = document.getElementById('overview-start');
        const overviewEndInput = document.getElementById('overview-end');
        const overviewRangeButtons = document.querySelectorAll('.overview-range-btn');

        let ordersData = {};
        let kpiComments = 0;
        let currentLang = localStorage.getItem('app_lang') || 'vi';
        let topShopStats = [];
        let overviewData = null;
        let overviewRefreshTimer = null;
        let activeBroadcasterId = '';
        let guideCollapsed = false;
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
                'settings.subtitle': 'Quản lý tùy chọn kết nối, hiển thị và dữ liệu của bạn.',
                'settings.languageTitle': 'Ngôn ngữ hiển thị',
                'settings.languageDesc': 'Chọn ngôn ngữ giao diện cho ứng dụng.',
                'settings.integrationTitle': 'Kết nối & Tích hợp',
                'settings.integrationDesc': 'Cấu hình các dịch vụ bên thứ ba và thiết bị ngoại vi.',
                'settings.online': 'Online',
                'settings.printer': 'Máy in hóa đơn',
                'settings.printerDesc': 'Địa chỉ IP hoặc cổng kết nối của máy in.',
                'settings.apiKey': 'TikTok Sign API Key',
                'settings.apiKeyDesc': 'Khóa bảo mật để đồng bộ với hệ thống TikTok.',
                'settings.save': 'Lưu thay đổi',
                'settings.quickTools': 'Tiện ích hệ thống',
                'settings.logout': 'Đăng xuất',
                'backup.title': 'Quản lý dữ liệu',
                'backup.desc': 'Sao lưu và xuất dữ liệu hệ thống.',
                'backup.mine': 'Dữ liệu tài khoản hiện tại',
                'backup.all': 'Toàn bộ dữ liệu (Admin)',
                'backup.exportExcel': 'Xuất Excel',
                'backup.exportCsv': 'Xuất CSV',
                'backup.exportJson': 'Xuất JSON',
                'tips.title': 'Hướng dẫn',
                'tips.desc': 'Nhập ID TikTok của chủ live để kết nối và bắt đầu theo dõi luồng bình luận, đơn hàng theo thời gian thực.',
                'history.title': 'Lịch sử phiên Live',
                'sessions.title': 'Lịch sử Phiên Live',
                'sessions.emptyTitle': 'Chưa có phiên live nào được lưu',
                'sessions.emptyDesc': 'Sau khi có đơn trong màn Live, hệ thống sẽ tự lưu lịch sử và hiển thị lại ở đây.',
                'sessions.merge': 'Gộp phiên đã chọn',
                'merge.title': 'Kết quả gộp phiên',
                'merge.save': 'Lưu phiên gộp',
                'merge.saved': 'Đã lưu phiên gộp',
                'merge.printSummary': 'In tổng hợp',
                'merge.printDetails': 'In chi tiết',
                'ov.title': 'Tổng quan',
                'ov.subtitle': 'Theo dõi nhanh tình hình đơn hàng, live và doanh thu',
                'ov.orders': 'Đơn đã chốt',
                'ov.comments': 'Bình luận live',
                'ov.revenue': 'Doanh thu',
                'ov.today': 'Hôm nay',
                'ov.range': '7 ngày qua',
                'ov.last30': '30 ngày',
                'ov.liveActive': 'Live đang hoạt động',
                'ov.closeRate': 'Tỷ lệ chốt',
                'ov.orders7d': 'Đơn hàng 7 ngày gần đây',
                'ov.revenue7d': 'Doanh thu 7 ngày gần đây',
                'ov.topShop': 'Top khách chốt đơn',
                'ov.latestOrders': 'Đơn mới nhất',
                'ov.viewAll': 'Xem tất cả',
                'tb.customer': 'Khách',
                'tb.time': 'Thời gian',
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
                'settings.subtitle': 'Manage your connection, display and data preferences.',
                'settings.languageTitle': 'Display language',
                'settings.languageDesc': 'Choose the app interface language.',
                'settings.integrationTitle': 'Connections & Integrations',
                'settings.integrationDesc': 'Configure third-party services and external devices.',
                'settings.online': 'Online',
                'settings.printer': 'Invoice printer',
                'settings.printerDesc': 'Printer IP address or connection port.',
                'settings.apiKey': 'TikTok Sign API Key',
                'settings.apiKeyDesc': 'Security key used to sync with TikTok services.',
                'settings.save': 'Save changes',
                'settings.quickTools': 'System tools',
                'settings.logout': 'Logout',
                'backup.title': 'Data management',
                'backup.desc': 'Back up and export system data.',
                'backup.mine': 'Current account data',
                'backup.all': 'All data (Admin)',
                'backup.exportExcel': 'Export Excel',
                'backup.exportCsv': 'Export CSV',
                'backup.exportJson': 'Export JSON',
                'tips.title': 'Guide',
                'tips.desc': 'Input TikTok broadcaster ID to connect and monitor comments and orders in real time.',
                'history.title': 'Live Session History',
                'sessions.title': 'Saved Live Sessions',
                'sessions.emptyTitle': 'No saved live sessions yet',
                'sessions.emptyDesc': 'After orders are created in Live, the system auto-saves history and shows it here.',
                'sessions.merge': 'Merge selected sessions',
                'merge.title': 'Merged session result',
                'merge.save': 'Save merged session',
                'merge.saved': 'Merged session saved',
                'merge.printSummary': 'Print summary',
                'merge.printDetails': 'Print details',
                'ov.title': 'Overview',
                'ov.subtitle': 'Track orders, live sessions and revenue at a glance',
                'ov.orders': 'Confirmed orders',
                'ov.comments': 'Live comments',
                'ov.revenue': 'Revenue',
                'ov.today': 'Today',
                'ov.range': 'Last 7 days',
                'ov.last30': 'Last 30 days',
                'ov.liveActive': 'Active live sessions',
                'ov.closeRate': 'Close rate',
                'ov.orders7d': 'Orders in last 7 days',
                'ov.revenue7d': 'Revenue in last 7 days',
                'ov.topShop': 'Top closing customers',
                'ov.latestOrders': 'Latest orders',
                'ov.viewAll': 'View all',
                'tb.customer': 'Customer',
                'tb.time': 'Time',
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
            document.getElementById('btn-lang-vi').classList.toggle('active', lang === 'vi');
            document.getElementById('btn-lang-en').classList.toggle('active', lang === 'en');
        }
        window.setLang = setLang;
        menuItems.forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });
        mobileNavItems.forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.view) {
                    switchView(btn.dataset.view);
                }
            });
        });
        overviewRangeButtons.forEach(btn => {
            btn.addEventListener('click', () => setOverviewRange(btn.dataset.range || '7'));
        });
        [overviewStartInput, overviewEndInput].forEach(input => {
            input.addEventListener('change', () => {
                const apiDate = parseDisplayDate(input.value);
                if (apiDate) input.value = formatApiDate(apiDate);
                overviewRangeButtons.forEach(btn => {
                    btn.classList.remove('bg-red-50', 'border-red-200', 'text-red-600');
                });
                refreshOverviewData();
            });
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
            renderLiveOrdersCompact();
            scheduleOverviewRefresh();
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

        function toDateInputValue(date) {
            const d = String(date.getDate()).padStart(2, '0');
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const y = date.getFullYear();
            return `${d}/${m}/${y}`;
        }

        function toApiDateValue(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function parseDisplayDate(value) {
            const match = String(value || '').trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
            if (!match) return '';
            const day = Number(match[1]);
            const month = Number(match[2]);
            const year = Number(match[3]);
            const date = new Date(year, month - 1, day);
            if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
            return toApiDateValue(date);
        }

        function formatApiDate(value) {
            const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return value || '';
            return `${match[3]}/${match[2]}/${match[1]}`;
        }

        function setOverviewRange(mode) {
            const today = new Date();
            let start = new Date(today);
            if (mode === 'today') {
                start = new Date(today);
            } else {
                start.setDate(start.getDate() - (Number(mode || 7) - 1));
            }
            overviewStartInput.value = toDateInputValue(start);
            overviewEndInput.value = toDateInputValue(today);
            overviewRangeButtons.forEach(btn => {
                btn.classList.toggle('bg-red-50', btn.dataset.range === mode);
                btn.classList.toggle('border-red-200', btn.dataset.range === mode);
                btn.classList.toggle('text-red-600', btn.dataset.range === mode);
            });
            refreshOverviewData();
        }

        function scheduleOverviewRefresh() {
            if (!parseDisplayDate(overviewStartInput.value) || !parseDisplayDate(overviewEndInput.value)) return;
            if (overviewRefreshTimer) clearTimeout(overviewRefreshTimer);
            overviewRefreshTimer = setTimeout(() => refreshOverviewData(false), 800);
        }

        async function refreshOverviewData(showLoading = true) {
            const startDate = parseDisplayDate(overviewStartInput.value);
            const endDate = parseDisplayDate(overviewEndInput.value);
            if (!startDate || !endDate) return;
            if (showLoading) {
                document.getElementById('overview-top-shop-list').innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'Loading...' : 'Đang tải...'}</p>`;
            }
            try {
                const params = new URLSearchParams({
                    start: startDate,
                    end: endDate
                });
                const res = await fetch(`/api/overview?${params.toString()}`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Load overview error');
                overviewData = data;
                renderOverview(data);
            } catch (e) {
                console.warn('Overview load error:', e);
            }
        }

        function renderOverview(data) {
            const summary = data?.summary || {};
            document.getElementById('ov-orders').textContent = Number(summary.orders || 0);
            document.getElementById('ov-comments').textContent = Number(summary.comments || 0);
            document.getElementById('ov-revenue').textContent = formatMoney(Number(summary.revenue || 0));
            document.getElementById('ov-live-active').textContent = Number(summary.activeLive || 0);
            document.getElementById('ov-close-rate').textContent = `${Number(summary.closeRate || 0).toFixed(1)}%`;
            document.getElementById('ov-orders-note').textContent = `${formatApiDate(data.meta?.start)} → ${formatApiDate(data.meta?.end)}`;
            document.getElementById('ov-comments-note').textContent = currentLang === 'en' ? 'Current live only' : 'Chỉ live hiện tại';
            document.getElementById('ov-revenue-note').textContent = currentLang === 'en' ? 'Real orders' : 'Đơn thật';
            topShopStats = Array.isArray(data.topShops) ? data.topShops : [];
            renderOverviewChart('overview-orders-chart', data.daily || [], 'orders');
            renderOverviewChart('overview-revenue-chart', data.daily || [], 'revenue');
            renderOverviewTopShops();
            renderOverviewLatestOrders();
        }

        function renderOverviewChart(containerId, daily, metric) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const values = daily.map(d => Number(d[metric] || 0));
            const maxValue = Math.max(...values, 0);
            if (!daily.length || maxValue === 0) {
                container.innerHTML = `<div class="h-full flex items-center justify-center text-sm text-gray-400">${currentLang === 'en' ? 'No data in this range' : 'Không có dữ liệu trong khoảng này'}</div>`;
                return;
            }
            container.innerHTML = `
                <div class="overview-bars">
                    ${daily.map(d => {
                        const value = Number(d[metric] || 0);
                        const height = Math.max(6, Math.round((value / maxValue) * 100));
                        const label = metric === 'revenue' ? formatMoney(value) : value;
                        return `
                            <div class="overview-bar" title="${d.date}: ${label}">
                                <div class="overview-bar-value" style="height:${height}%"></div>
                                <span>${d.date.slice(5)}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        function renderOverviewLatestOrders() {
            const tbody = document.getElementById('overview-latest-orders');
            const cards = document.getElementById('overview-latest-cards');
            if (!tbody) return;
            const latest = Array.isArray(overviewData?.latestOrders) ? overviewData.latestOrders : [];
            if (latest.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-gray-400">${currentLang === 'en' ? 'No orders yet' : 'Chưa có đơn hàng'}</td></tr>`;
                if (cards) cards.innerHTML = `<p class="py-4 text-center text-gray-400 text-sm">${currentLang === 'en' ? 'No orders yet' : 'Chưa có đơn hàng'}</p>`;
                return;
            }
            tbody.innerHTML = latest.map(r => `
                <tr class="border-b">
                    <td class="py-2">#${String(r.id || '').slice(-10) || '—'}</td>
                    <td class="py-2">${r.customer || '—'}</td>
                    <td class="py-2">${[r.date, r.time].filter(Boolean).join(' ') || '—'}</td>
                    <td class="py-2">${formatMoney(Number(r.value || 0))}</td>
                    <td class="py-2"><span class="px-2 py-1 rounded text-[10px] font-bold ${r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${r.status === 'done' ? (currentLang === 'en' ? 'Done' : 'Đã chốt') : (currentLang === 'en' ? 'Pending' : 'Chờ chốt')}</span></td>
                </tr>
            `).join('');
            if (cards) {
                cards.innerHTML = latest.map(r => `
                    <div class="overview-order-card">
                        <div class="min-w-0">
                            <p class="font-bold text-sm truncate">${r.customer || '—'}</p>
                            <p class="text-[10px] text-gray-400 truncate">#${String(r.id || '').slice(-10) || '—'} • ${[r.date, r.time].filter(Boolean).join(' ') || '—'}</p>
                        </div>
                        <div class="text-right">
                            <p class="font-black text-red-600 whitespace-nowrap">${formatMoney(Number(r.value || 0))}</p>
                            <span class="inline-block mt-1 px-2 py-1 rounded text-[10px] font-bold ${r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${r.status === 'done' ? (currentLang === 'en' ? 'Done' : 'Đã chốt') : (currentLang === 'en' ? 'Pending' : 'Chờ chốt')}</span>
                        </div>
                    </div>
                `).join('');
            }
        }

        async function refreshOverviewTopShops() {
            await refreshOverviewData();
        }

        function renderOverviewTopShops() {
            const container = document.getElementById('overview-top-shop-list');
            if (!container) return;
            if (!topShopStats.length) {
                container.innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'No closing customers in this range' : 'Chưa có khách chốt đơn trong khoảng này'}</p>`;
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
                        <span class="w-36 min-w-0">
                            <span class="block truncate font-bold">${s.customer || s.customerUsername || '—'}</span>
                            ${s.customerUsername ? `<span class="block truncate text-[10px] text-gray-400">@${s.customerUsername}</span>` : ''}
                        </span>
                        <div class="h-2 bg-gray-100 rounded-full flex-1">
                            <div class="h-2 bg-red-500 rounded-full" style="width:${width}%"></div>
                        </div>
                        <span class="font-bold text-right whitespace-nowrap">${formatMoney(s.revenue)}<span class="block text-[10px] text-gray-400">${s.orders || 0} đơn</span></span>
                    </div>
                `;
            }).join('');
        }

        function switchView(view) {
            document.body.dataset.view = view;
            menuItems.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });
            mobileNavItems.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });

            if (view === 'overview') {
                sectionOverview.classList.remove('hidden');
                sectionConnect.classList.add('hidden');
                sectionKpi.classList.add('hidden');
                sectionComments.classList.add('hidden');
                sectionOrders.classList.add('hidden');
                sectionLiveOrders.classList.add('hidden');
                rightCol.classList.add('hidden');
                settingsPanel.classList.add('hidden');
                guidePanel.classList.add('hidden');
                return;
            }

            if (view === 'live') {
                sectionOverview.classList.add('hidden');
                sectionConnect.classList.remove('hidden');
                sectionKpi.classList.remove('hidden');
                sectionComments.classList.remove('hidden');
                sectionOrders.classList.add('hidden');
                sectionLiveOrders.classList.remove('hidden');
                rightCol.classList.remove('hidden');
                settingsPanel.classList.add('hidden');
                guidePanel.classList.remove('hidden');
                return;
            }

            if (view === 'orders') {
                sectionOverview.classList.add('hidden');
                sectionConnect.classList.add('hidden');
                sectionKpi.classList.add('hidden');
                sectionComments.classList.add('hidden');
                sectionOrders.classList.remove('hidden');
                sectionLiveOrders.classList.add('hidden');
                rightCol.classList.add('hidden');
                settingsPanel.classList.add('hidden');
                guidePanel.classList.add('hidden');
                return;
            }

            if (view === 'settings') {
                sectionOverview.classList.add('hidden');
                sectionConnect.classList.add('hidden');
                sectionKpi.classList.add('hidden');
                sectionComments.classList.add('hidden');
                sectionOrders.classList.add('hidden');
                sectionLiveOrders.classList.add('hidden');
                rightCol.classList.remove('hidden');
                settingsPanel.classList.remove('hidden');
                guidePanel.classList.add('hidden');
            }
        }
        window.switchView = switchView;

        function setGuideCollapsed(collapsed) {
            guideCollapsed = collapsed;
            const body = document.getElementById('guide-body');
            const icon = document.getElementById('guide-toggle-icon');
            if (!body || !icon) return;
            body.classList.toggle('hidden', collapsed);
            icon.textContent = collapsed ? '+' : '-';
        }

        window.toggleGuide = () => setGuideCollapsed(!guideCollapsed);

        window.toggleSettings = () => switchView('settings');
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

        window.openLegacyHistorySession = (fileName) => {
            if (confirm(currentLang === 'en' ? 'Load this history and overwrite current list?' : 'Tải lịch sử này sẽ ghi đè danh sách đang hiện?')) {
                socket.emit('load-history-file', fileName);
                closeLiveSessions();
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
            if (data.connected) setGuideCollapsed(true);
            if (data.connected && data.broadcasterId) {
                activeBroadcasterId = data.broadcasterId;
                localStorage.setItem('lastBroadcasterId', data.broadcasterId);
                socket.emit('get-chat-buffer', { broadcasterId: data.broadcasterId });
            }
            scheduleOverviewRefresh();
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

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function escapeJsString(value) {
            return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
        }

        function renderLiveOrdersCompact() {
            if (!liveOrdersCompact) return;
            const orders = Object.values(ordersData || {});
            if (orders.length === 0) {
                liveOrdersCompact.innerHTML = `<p class="text-center text-gray-400 py-6 text-sm">${currentLang === 'en' ? 'No current orders' : 'Chưa có đơn hàng hiện tại'}</p>`;
                return;
            }

            liveOrdersCompact.innerHTML = orders.map(order => {
                const items = Array.isArray(order.items) ? order.items : [];
                const itemsHtml = items.map(item => `
                    <div class="live-order-item">
                        <span class="truncate text-gray-700">${item.text || ''}</span>
                        <span class="font-black text-red-600 whitespace-nowrap">${formatMoney(Number(item.price || 0))}</span>
                        <div class="flex items-center gap-1">
                            <button onclick="reprintItem('${order.username}', ${item.id})" class="live-order-action text-green-600 bg-green-50" title="In lại">🖨️</button>
                            <button onclick="editItem('${order.username}', ${item.id}, ${item.price})" class="live-order-action text-blue-600 bg-blue-50" title="Sửa giá">✏️</button>
                            <button onclick="deleteItem('${order.username}', ${item.id})" class="live-order-action text-red-600 bg-red-50" title="Xóa">🗑️</button>
                        </div>
                    </div>
                `).join('');

                return `
                    <div class="live-order-card">
                        <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0">
                                <p class="font-bold text-sm truncate">${order.nickname || order.username}</p>
                                <p class="text-[10px] text-gray-400 truncate">@${order.username}</p>
                            </div>
                            <div class="flex items-center gap-1">
                                <button onclick="reprintTotal('${order.username}')" class="text-[10px] bg-white border border-gray-200 px-2 py-1 rounded font-bold">${currentLang === 'en' ? 'Print' : 'In'}</button>
                                <button onclick="deleteCustomer('${order.username}')" class="text-[10px] bg-red-50 text-red-600 px-2 py-1 rounded font-bold">${currentLang === 'en' ? 'Delete' : 'Xóa'}</button>
                            </div>
                        </div>
                        <div class="mt-2 space-y-1">${itemsHtml}</div>
                        <div class="mt-2 pt-2 border-t flex items-center justify-between">
                            <span class="text-[10px] font-bold text-gray-500 uppercase">TOTAL</span>
                            <span class="text-sm font-black text-red-600">${formatMoney(Number(order.total || 0))}</span>
                        </div>
                    </div>
                `;
            }).join('');
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
            setGuideCollapsed(false);
            setOverviewRange('7');
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
        let lastMergeSourceIds = [];

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
                container.innerHTML = `
                    <div class="text-center py-12 px-4">
                        <p class="text-base font-bold text-gray-700">${t('sessions.emptyTitle')}</p>
                        <p class="text-sm text-gray-400 mt-2 max-w-md mx-auto">${t('sessions.emptyDesc')}</p>
                    </div>
                `;
                return;
            }
            container.innerHTML = sessions.map(s => {
                const date = new Date(s.createdAt).toLocaleString('vi-VN');
                const revenue = s.summary ? formatMoney(s.summary.totalRevenue) : '0đ';
                const orders = s.summary ? s.summary.totalOrders : 0;
                const qty = s.summary ? s.summary.totalQuantity : 0;
                const isLegacy = s.source === 'legacy_history';
                const openLabel = currentLang === 'en' ? 'OPEN' : 'MỞ';
                const safeSessionId = escapeJsString(s.id);
                const safeSessionName = escapeJsString(s.liveName);
                const safeFileName = escapeJsString(s.fileName || '');
                const actionButtons = isLegacy
                    ? `
                        <button onclick="openLegacyHistorySession('${safeFileName}')" class="text-blue-600 px-2 py-1 bg-blue-50 rounded text-xs font-bold">${openLabel}</button>
                        <button onclick="deleteSession('${safeSessionId}', '${safeSessionName}')" class="text-red-500 p-1 bg-red-50 rounded text-xs">🗑️</button>
                    `
                    : `
                        <button onclick="viewSessionDetail('${safeSessionId}')" class="text-blue-500 p-1 bg-blue-50 rounded text-xs">👁️</button>
                        <button onclick="deleteSession('${safeSessionId}', '${safeSessionName}')" class="text-red-500 p-1 bg-red-50 rounded text-xs">🗑️</button>
                    `;
                return `
                <div class="flex items-start gap-3 p-3 border rounded-lg hover:bg-purple-50 transition group">
                    <input type="checkbox" id="cb-${escapeHtml(s.id)}" class="mt-1 accent-purple-600 w-4 h-4 cursor-pointer" onchange="toggleSessionSelect('${safeSessionId}')" ${selectedSessionIds.has(s.id) ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="font-bold text-gray-800 text-sm">${escapeHtml(s.liveName)}</p>
                                <p class="text-[10px] text-gray-400">${date}${s.tiktokUsername ? ' • @' + escapeHtml(s.tiktokUsername) : ''}</p>
                            </div>
                            <div class="text-right">
                                <span class="text-xs font-bold text-red-500">${revenue}</span>
                                <p class="text-[9px] text-gray-400">${orders} orders • ${qty} qty</p>
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                        ${actionButtons}
                    </div>
                </div>`;
            }).join('');
        }

        window.deleteSession = async (sessionId, sessionName = '') => {
            const displayName = sessionName || sessionId;
            const msg = currentLang === 'en'
                ? `Delete live session history "${displayName}"?`
                : `Xóa lịch sử "${displayName}"?`;
            if (!confirm(msg)) return;
            try {
                const res = await fetch('/api/live-sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return alert('Error: ' + (data.error || 'Delete error'));
                selectedSessionIds.delete(sessionId);
                showLiveSessions();
                refreshOverviewData(false);
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
                lastMergeSourceIds = [];
                renderMergeResults(lastMergeData, s.liveName);
                document.getElementById('merge-modal').classList.remove('hidden');
            } catch (e) { alert('Error: ' + e.message); }
        };

        window.mergeSelectedSessions = async () => {
            if (selectedSessionIds.size === 0) return alert('No session selected');
            try {
                const sourceIds = Array.from(selectedSessionIds);
                const res = await fetch('/api/live-sessions/merge-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionIds: sourceIds })
                });
                const data = await res.json();
                if (data.error) return alert('Error: ' + data.error);
                lastMergeData = data;
                lastMergeSourceIds = sourceIds;
                renderMergeResults(data, `Merge ${data.summary.totalSessions} sessions`);
                document.getElementById('merge-modal').classList.remove('hidden');
            } catch (e) { alert('Error: ' + e.message); }
        };

        window.closeMergeModal = () => document.getElementById('merge-modal').classList.add('hidden');

        function renderMergeResults(data) {
            const s = data.summary;
            const container = document.getElementById('merge-results-content');
            const saveBtn = document.getElementById('btn-save-merged');
            const saveStatus = document.getElementById('merge-save-status');
            if (saveBtn) saveBtn.classList.toggle('hidden', lastMergeSourceIds.length === 0 || Boolean(data.savedSessionId));
            if (saveStatus) saveStatus.textContent = data.savedSessionId ? t('merge.saved') : '';
            let html = `
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div class="bg-purple-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Sessions</p><p class="text-xl font-black text-purple-700">${s.totalSessions}</p></div>
                    <div class="bg-blue-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Orders</p><p class="text-xl font-black text-blue-700">${s.totalOrders}</p></div>
                    <div class="bg-green-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Quantity</p><p class="text-xl font-black text-green-700">${s.totalQuantity}</p></div>
                    <div class="bg-red-50 p-3 rounded-lg text-center"><p class="text-[10px] text-gray-500 uppercase">Revenue</p><p class="text-xl font-black text-red-600">${formatMoney(s.totalRevenue)}</p></div>
                </div>`;

            const customerSummary = getMergeCustomerSummary(data);
            if (customerSummary.length > 0) {
                html += `<div class="mb-4"><h4 class="text-xs font-bold text-gray-500 uppercase mb-2">By customer</h4>
                    <table class="w-full text-xs border-collapse"><thead><tr class="bg-gray-100">
                    <th class="p-2 text-left border">Customer</th><th class="p-2 text-center border">Orders</th><th class="p-2 text-right border">Total</th></tr></thead><tbody>`;
                customerSummary.forEach((c, idx) => {
                    const detailLabel = currentLang === 'en' ? 'Detail' : 'Chi tiết';
                    html += `<tr class="hover:bg-gray-50"><td class="p-2 border">${escapeHtml(c.customerName || '')} ${c.customerUsername ? '(@' + escapeHtml(c.customerUsername) + ')' : ''}</td><td class="p-2 border text-center">${c.orders.length}</td><td class="p-2 border text-right font-bold text-red-500"><span>${formatMoney(c.total)}</span><button onclick="printMergeCustomerDetails(${idx})" class="ml-2 px-2 py-1 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">${detailLabel}</button></td></tr>`;
                });
                html += '</tbody></table></div>';
            }

            container.innerHTML = html;
        }

        function getMergeCustomerSummary(data) {
            if (Array.isArray(data?.customerSummary) && data.customerSummary.length > 0) {
                return data.customerSummary;
            }
            const customerMap = {};
            (data?.mergedOrders || []).forEach(order => {
                const key = order.customerUsername || order.customerName || 'unknown';
                if (!customerMap[key]) {
                    customerMap[key] = {
                        customerName: order.customerName || '',
                        customerUsername: order.customerUsername || '',
                        orders: [],
                        total: 0
                    };
                }
                customerMap[key].orders.push(order);
                customerMap[key].total += Number(order.total || order.price || 0);
            });
            return Object.values(customerMap).sort((a, b) => b.total - a.total);
        }

        window.saveMergedSession = async () => {
            if (!lastMergeData || lastMergeSourceIds.length === 0) {
                return alert(currentLang === 'en' ? 'No merged result to save.' : 'Chưa có kết quả gộp để lưu.');
            }
            try {
                const res = await fetch('/api/live-sessions/merged', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionIds: lastMergeSourceIds })
                });
                const data = await res.json();
                if (!res.ok || !data.success) return alert('Error: ' + (data.error || 'Save error'));
                lastMergeData.savedSessionId = data.session?.id || '';
                const saveBtn = document.getElementById('btn-save-merged');
                const saveStatus = document.getElementById('merge-save-status');
                if (saveBtn) saveBtn.classList.add('hidden');
                if (saveStatus) saveStatus.textContent = t('merge.saved');
                refreshOverviewData(false);
            } catch (e) {
                alert('Save error: ' + e.message);
            }
        };

        window.printMergeSummary = () => {
            if (!lastMergeData) return;
            const d = lastMergeData;
            const customerSummary = getMergeCustomerSummary(d);
            let html = `<div style="font-family: 'Times New Roman', Times, serif; width: 80mm; margin: 0 auto; color: black;">`;
            html += `<div style="text-align:center;"><h2 style="margin:0;">TONG HOP PHIEN GOP</h2><hr style="border:1px solid black;"></div>`;
            html += `<p style="font-size:12px;">Sessions: ${d.summary.totalSessions} | Orders: ${d.summary.totalOrders} | Qty: ${d.summary.totalQuantity}</p>`;
            html += `<p style="font-weight:bold; font-size:16px;">TOTAL: ${formatMoney(d.summary.totalRevenue)}</p>`;
            customerSummary.forEach(c => {
                html += `<div style="display:flex; justify-content:space-between; gap:8px; border-top:1px dashed black; padding:4px 0; font-size:12px;">`;
                html += `<span>${escapeHtml(c.customerName || '')}${c.customerUsername ? ' (@' + escapeHtml(c.customerUsername) + ')' : ''}<br>${c.orders.length} don</span>`;
                html += `<b>${formatMoney(c.total)}</b>`;
                html += `</div>`;
            });
            html += `</div>`;
            document.getElementById('print-section').innerHTML = html;
            window.print();
        };

        window.printMergeDetails = () => {
            if (!lastMergeData) return;
            const d = lastMergeData;
            const customerSummary = getMergeCustomerSummary(d);
            let html = `<div style="font-family: 'Times New Roman', Times, serif; width: 80mm; margin: 0 auto; color: black;">`;
            html += `<div style="text-align:center;"><h2 style="margin:0;">CHI TIET PHIEN GOP</h2><hr style="border:1px solid black;"></div>`;
            html += `<p style="font-size:12px;">Sessions: ${d.summary.totalSessions} | Orders: ${d.summary.totalOrders} | Qty: ${d.summary.totalQuantity}</p>`;
            customerSummary.forEach(c => {
                html += `<div style="margin-bottom:10px; border-bottom:1px dashed black; padding-bottom:6px;">`;
                html += `<div style="font-weight:bold; font-size:15px;">${escapeHtml(c.customerName || '')}${c.customerUsername ? ' (@' + escapeHtml(c.customerUsername) + ')' : ''}</div>`;
                c.orders.forEach((order, index) => {
                    html += `<div style="display:flex; justify-content:space-between; gap:8px; font-size:12px; margin-top:3px;">`;
                    html += `<span>${index + 1}. ${escapeHtml(order.productName || order.text || 'Don hang')} ${order.time ? '(' + escapeHtml(order.time) + ')' : ''}</span>`;
                    html += `<b>${formatMoney(Number(order.total || order.price || 0))}</b>`;
                    html += `</div>`;
                });
                html += `<div style="text-align:right; font-weight:bold; font-size:13px; margin-top:5px;">Cong: ${formatMoney(c.total)}</div>`;
                html += `</div>`;
            });
            html += `<div style="text-align:center; font-weight:bold; font-size:16px;">TONG CONG: ${formatMoney(d.summary.totalRevenue)}</div>`;
            html += `</div>`;
            document.getElementById('print-section').innerHTML = html;
            window.print();
        };

        window.printMergeCustomerDetails = (customerIndex) => {
            if (!lastMergeData) return;
            const customerSummary = getMergeCustomerSummary(lastMergeData);
            const customer = customerSummary[customerIndex];
            if (!customer) return;

            let html = `<div style="font-family: 'Times New Roman', Times, serif; width: 80mm; margin: 0 auto; color: black;">`;
            html += `<div style="text-align:center;"><h2 style="margin:0;">CHI TIET KHACH</h2><hr style="border:1px solid black;"></div>`;
            html += `<div style="font-weight:bold; font-size:17px; margin-bottom:4px;">${escapeHtml(customer.customerName || '')}</div>`;
            if (customer.customerUsername) {
                html += `<div style="font-size:12px; margin-bottom:8px;">@${escapeHtml(customer.customerUsername)}</div>`;
            }
            customer.orders.forEach((order, index) => {
                html += `<div style="display:flex; justify-content:space-between; gap:8px; border-top:1px dashed black; padding:4px 0; font-size:12px;">`;
                html += `<span>${index + 1}. ${escapeHtml(order.productName || order.text || 'Don hang')} ${order.time ? '(' + escapeHtml(order.time) + ')' : ''}</span>`;
                html += `<b>${formatMoney(Number(order.total || order.price || 0))}</b>`;
                html += `</div>`;
            });
            html += `<hr style="border:1px solid black; margin:8px 0;">`;
            html += `<div style="display:flex; justify-content:space-between; font-weight:bold; font-size:16px;"><span>TONG:</span><span>${formatMoney(customer.total)}</span></div>`;
            html += `<div style="font-size:12px; margin-top:4px;">Orders: ${customer.orders.length}</div>`;
            html += `</div>`;
            document.getElementById('print-section').innerHTML = html;
            window.print();
        };

        window.printMergeResults = window.printMergeSummary;
