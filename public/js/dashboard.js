        const socket = io();
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
        const sectionComments = document.getElementById('section-comments');
        const sectionOrders = document.getElementById('section-orders');
        const sectionCurrentOrders = document.getElementById('section-current-orders');
        const sectionLiveWorkspace = document.getElementById('section-live-workspace');
        const sectionOverview = document.getElementById('section-overview');
        const sectionCustomers = document.getElementById('section-customers');
        const sectionShop = document.getElementById('section-shop');
        const sectionReports = document.getElementById('section-reports');
        const rightCol = document.getElementById('right-col');
        const dashboardSections = Array.from(document.querySelectorAll('.dashboard-section'));
        const menuItems = document.querySelectorAll('.menu-item[data-view]');
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
        const overviewStartInput = document.getElementById('overview-start');
        const overviewEndInput = document.getElementById('overview-end');
        const overviewRangeButtons = document.querySelectorAll('.overview-range-btn');
        const customerSearchInput = document.getElementById('customer-search');
        const customerForm = document.getElementById('customer-form');
        const customersTableBody = document.getElementById('customers-table-body');
        const appShell = document.querySelector('.app-shell');
        const sidebar = document.getElementById('app-sidebar');
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const sidebarMobileToggle = document.getElementById('sidebar-mobile-toggle');
        const sidebarBackdrop = document.getElementById('sidebar-backdrop');
        const themeButtons = document.querySelectorAll('[data-theme-option]');
        const themeStatusLabel = document.getElementById('theme-status-label');
        const userMenu = document.getElementById('user-menu');
        const userMenuTrigger = document.getElementById('user-bar');
        const userMenuDropdown = document.getElementById('user-menu-dropdown');
        const userMenuName = document.getElementById('user-menu-name');
        const userMenuEmail = document.getElementById('user-menu-email');
        const userMenuRole = document.getElementById('user-menu-role');
        const sidebarAdminItem = document.getElementById('sidebar-admin-item');
        const pageTitle = document.getElementById('page-title');
        const pageLiveStatus = document.getElementById('page-live-status');
        const topbarSaveSessionBtn = document.getElementById('topbar-save-session-btn');

        let ordersData = {};
        let customersData = [];
        let kpiComments = 0;
        let currentLang = localStorage.getItem('app_lang') || 'vi';
        let topShopStats = [];
        let overviewData = null;
        let overviewComparison = null;
        let overviewRefreshTimer = null;
        let customerSearchTimer = null;
        let activeBroadcasterId = '';
        let currentUserUid = '';
        let currentUserRole = 'user';
        let currentView = 'overview';
        const seenChatMsgIds = new Set();
        let mobilePopoverEl = null;
        let mobilePopoverHideTimer = null;

        const i18n = {
            vi: {
                'menu.overview': 'Tổng quan',
                'menu.live': 'Live',
                'menu.orders': 'Đơn hàng',
                'menu.customers': 'Khách hàng',
                'menu.shop': 'Shop',
                'menu.reports': 'Báo cáo',
                'menu.settings': 'Cài đặt',
                'menu.admin': 'Admin',
                'subtitle': 'Quản lý đơn hàng & luồng bình luận chuyên nghiệp cho TikTok Live',
                'live.connect': 'Kết nối Live',
                'live.helper': 'Nhập ID TikTok chủ live để theo dõi bình luận & đơn hàng realtime.',
                'live.connectBtn': 'Kết nối',
                'live.ordersSession': 'Đơn phát sinh trong phiên',
                'status.disconnected': 'Chưa kết nối',
                'status.connected': 'Đã kết nối',
                'kpi.orders': 'Đơn hôm nay',
                'kpi.comments': 'Bình luận',
                'kpi.revenue': 'Doanh thu',
                'kpi.liveStatus': 'Trạng thái',
                'comments.title': 'Luồng bình luận',
                'orders.current': 'Đơn đang chốt',
                'orders.title': 'Đơn hàng',
                'orders.subtitle': 'Quản lý toàn bộ đơn hàng theo tài khoản, shop và thời gian.',
                'customers.title': 'Khách hàng',
                'customers.subtitle': 'Lưu địa chỉ theo từng tài khoản để xuất file đi đơn.',
                'customers.new': 'Thêm khách',
                'customers.importHistory': 'Lấy từ lịch sử chốt',
                'actions.saveSession': 'Lưu phiên',
                'settings.defaultTiktokId': 'TikTok ID mặc định',
                'settings.defaultTiktokIdDesc': 'ID TikTok chủ live sẽ tự động kết nối mỗi khi đăng nhập.',
                'settings.autoConnect': 'Tự động kết nối khi đăng nhập',
                'live.autoSaved': 'Phiên live đã được tự động lưu',
                'live.liveEnded': 'Khách đã xuống live. Đang lưu phiên...',
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
                'settings.appearanceTitle': 'Giao diện',
                'settings.appearanceDesc': 'Chọn chế độ sáng hoặc tối cho toàn bộ ứng dụng.',
                'settings.lightMode': 'Chế độ sáng',
                'settings.darkMode': 'Chế độ tối',
                'settings.quickTools': 'Tiện ích hệ thống',
                'settings.logout': 'Đăng xuất',
                'sidebar.collapse': 'Thu gọn',
                'sidebar.expand': 'Mở rộng',
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
                'ov.pending': 'Đơn cần xử lý',
                'ov.today': 'Hôm nay',
                'ov.range': '7 ngày qua',
                'ov.last30': '30 ngày',
                'ov.liveActive': 'Live đang hoạt động',
                'ov.closeRate': 'Tỷ lệ chốt',
                'ov.trendTitle': 'Xu hướng doanh thu',
                'ov.emptyTitle': 'Chưa có dữ liệu trong khoảng thời gian này',
                'ov.emptyDesc': 'Hãy kết nối live hoặc import đơn hàng để bắt đầu theo dõi',
                'ov.actionLive': 'Kết nối live',
                'ov.actionImport': 'Import đơn hàng',
                'ov.orders7d': 'Đơn hàng 7 ngày gần đây',
                'ov.revenue7d': 'Doanh thu 7 ngày gần đây',
                'ov.topShop': 'Top khách chốt đơn',
                'ov.topProducts': 'Top sản phẩm',
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
                'menu.customers': 'Customers',
                'menu.shop': 'Shop',
                'menu.reports': 'Reports',
                'menu.settings': 'Settings',
                'menu.admin': 'Admin',
                'subtitle': 'Manage TikTok Live comments and orders in real time',
                'live.connect': 'Connect Live',
                'live.helper': 'Enter broadcaster TikTok ID to track comments and live orders.',
                'live.connectBtn': 'Connect',
                'live.ordersSession': 'Orders In This Live Session',
                'status.disconnected': 'Disconnected',
                'status.connected': 'Connected',
                'kpi.orders': 'Orders today',
                'kpi.comments': 'Comments',
                'kpi.revenue': 'Revenue',
                'kpi.liveStatus': 'Status',
                'comments.title': 'Comment Stream',
                'orders.current': 'Active Orders',
                'orders.title': 'Orders',
                'orders.subtitle': 'Manage all orders by account, shop and date range.',
                'customers.title': 'Customers',
                'customers.subtitle': 'Save delivery addresses per account for shipping exports.',
                'customers.new': 'New customer',
                'customers.importHistory': 'Import from history',
                'actions.saveSession': 'Save Session',
                'settings.defaultTiktokId': 'Default TikTok ID',
                'settings.defaultTiktokIdDesc': 'TikTok Live ID to auto-connect on login.',
                'settings.autoConnect': 'Auto-connect on login',
                'live.autoSaved': 'Live session was auto-saved',
                'live.liveEnded': 'Host ended the live. Saving session...',
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
                'settings.appearanceTitle': 'Appearance',
                'settings.appearanceDesc': 'Choose light or dark mode for the whole app.',
                'settings.lightMode': 'Light mode',
                'settings.darkMode': 'Dark mode',
                'settings.quickTools': 'System tools',
                'settings.logout': 'Logout',
                'sidebar.collapse': 'Collapse',
                'sidebar.expand': 'Expand',
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
                'ov.pending': 'Needs processing',
                'ov.today': 'Today',
                'ov.range': 'Last 7 days',
                'ov.last30': 'Last 30 days',
                'ov.liveActive': 'Active live sessions',
                'ov.closeRate': 'Close rate',
                'ov.trendTitle': 'Revenue trend',
                'ov.emptyTitle': 'No data in this time range',
                'ov.emptyDesc': 'Connect live or import orders to start tracking',
                'ov.actionLive': 'Connect live',
                'ov.actionImport': 'Import orders',
                'ov.orders7d': 'Orders in last 7 days',
                'ov.revenue7d': 'Revenue in last 7 days',
                'ov.topShop': 'Top closing customers',
                'ov.topProducts': 'Top products',
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
            syncSidebarLabels();
            syncThemeControls();
            if (userMenuRole) {
                userMenuRole.textContent = currentUserRole ? `${currentLang === 'en' ? 'Role' : 'Vai trò'}: ${currentUserRole}` : '';
            }
            if (overviewData) {
                renderOverview(overviewData, overviewComparison);
            }
            renderEmptyCommentState();
        }
        window.setLang = setLang;

        function isMobileLayout() {
            return window.matchMedia && window.matchMedia('(max-width: 980px)').matches;
        }

        function syncSidebarLabels() {
            menuItems.forEach(btn => {
                const label = btn.querySelector('.menu-label')?.textContent?.trim();
                if (label) btn.dataset.tooltip = label;
            });
        }

        function applySidebarState(collapsed) {
            const isCollapsed = Boolean(collapsed);
            if (appShell) appShell.dataset.sidebarCollapsed = isCollapsed ? 'true' : 'false';
            document.body.dataset.sidebarCollapsed = isCollapsed ? 'true' : 'false';
            if (sidebarToggle) {
                sidebarToggle.setAttribute('aria-label', isCollapsed ? t('sidebar.expand') : t('sidebar.collapse'));
                sidebarToggle.title = isCollapsed ? t('sidebar.expand') : t('sidebar.collapse');
                const label = sidebarToggle.querySelector('.sidebar-toggle-label');
                const icon = sidebarToggle.querySelector('.sidebar-toggle-icon');
                if (label) label.textContent = isCollapsed ? t('sidebar.expand') : t('sidebar.collapse');
                if (icon) icon.textContent = isCollapsed ? '›' : '‹';
            }
        }

        function setSidebarCollapsed(collapsed) {
            localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
            applySidebarState(collapsed);
        }

        function setSidebarDrawerOpen(open) {
            const sidebar = document.getElementById('app-sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (sidebar) sidebar.classList.toggle('open', Boolean(open));
            if (backdrop) {
                backdrop.classList.toggle('active', Boolean(open));
                backdrop.hidden = !open;
            }
            if (sidebarMobileToggle) sidebarMobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function initSidebar() {
            syncSidebarLabels();
            applySidebarState(localStorage.getItem('sidebarCollapsed') === 'true');
            sidebarToggle?.addEventListener('click', () => {
                if (isMobileLayout()) {
                    setSidebarDrawerOpen(false);
                    return;
                }
                setSidebarCollapsed(localStorage.getItem('sidebarCollapsed') !== 'true');
            });
            sidebarMobileToggle?.addEventListener('click', () => {
                const sidebar = document.getElementById('app-sidebar');
                setSidebarDrawerOpen(!sidebar.classList.contains('open'));
            });
            sidebarBackdrop?.addEventListener('click', () => setSidebarDrawerOpen(false));
            
            // Mobile header menu toggle
            const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
            if (mobileMenuToggle) {
                mobileMenuToggle.addEventListener('click', () => {
                    setSidebarDrawerOpen(true);
                });
            }
            
            window.addEventListener('resize', () => {
                if (!isMobileLayout()) setSidebarDrawerOpen(false);
            });
        }

        function applyTheme(theme) {
            const nextTheme = theme === 'dark' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', nextTheme);
            localStorage.setItem('theme', nextTheme);
            syncThemeControls();
        }

        function syncThemeControls() {
            const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            themeButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.themeOption === theme);
            });
            if (themeStatusLabel) {
                themeStatusLabel.textContent = theme === 'dark' ? t('settings.darkMode') : t('settings.lightMode');
            }
        }

        function initTheme() {
            applyTheme(localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'light');
            themeButtons.forEach(btn => btn.addEventListener('click', () => applyTheme(btn.dataset.themeOption)));
        }

        function setUserMenuOpen(open) {
            if (!userMenuDropdown) return;
            userMenuDropdown.classList.toggle('hidden', !open);
            userMenuTrigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function initUserAvatarMenu() {
            if (!userMenu || !userMenuTrigger || !userMenuDropdown) return;
            userMenuTrigger.addEventListener('click', (event) => {
                event.stopPropagation();
                const isOpen = !userMenuDropdown.classList.contains('hidden');
                setUserMenuOpen(!isOpen);
            });
            document.addEventListener('click', (event) => {
                if (!userMenu.contains(event.target)) {
                    setUserMenuOpen(false);
                }
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') setUserMenuOpen(false);
            });
        }

        const Sidebar = { init: initSidebar };
        const Topbar = { init: initUserAvatarMenu };
        const UserAvatarMenu = { close: () => setUserMenuOpen(false) };

        Sidebar.init();
        initTheme();
        Topbar.init();

        menuItems.forEach(btn => {
            btn.addEventListener('click', () => {
                switchView(btn.dataset.view);
                if (isMobileLayout()) setSidebarDrawerOpen(false);
            });
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
        if (customerSearchInput) {
            customerSearchInput.addEventListener('input', () => {
                if (customerSearchTimer) clearTimeout(customerSearchTimer);
                customerSearchTimer = setTimeout(() => loadCustomers(), 250);
            });
        }
        if (customerForm) {
            customerForm.addEventListener('submit', saveCustomerForm);
        }

        function getCurrentOrdersTotals() {
            let totalOrders = 0;
            let totalRevenue = 0;
            Object.values(ordersData).forEach(o => {
                totalOrders += Array.isArray(o.items) ? o.items.length : 0;
                totalRevenue += Number(o.total || 0);
            });
            return { totalOrders, totalRevenue };
        }

        function calculateKpis() {
            const { totalOrders, totalRevenue } = getCurrentOrdersTotals();
            const kpiOrdersEl = document.getElementById('kpi-orders');
            const kpiCommentsEl = document.getElementById('kpi-comments');
            const kpiRevenueEl = document.getElementById('kpi-revenue');
            if (kpiOrdersEl) kpiOrdersEl.textContent = totalOrders;
            if (kpiCommentsEl) kpiCommentsEl.textContent = kpiComments;
            if (kpiRevenueEl) kpiRevenueEl.textContent = formatMoney(totalRevenue);
            const commentCount = chatFeed.querySelectorAll('[data-chat-row="1"]').length;
            const chatCountEl = document.getElementById('chat-count');
            if (chatCountEl) chatCountEl.textContent = `${commentCount} items`;
            renderCurrentOrders(totalOrders, totalRevenue);
            scheduleOverviewRefresh();
        }

        function updateLiveOrdersToggleLabel() {
            const panel = document.getElementById('live-current-orders-panel');
            const toggle = panel?.querySelector('[data-live-orders-toggle]');
            const label = panel?.querySelector('[data-live-orders-toggle-label]');
            const icon = toggle?.querySelector('.material-symbols-outlined');
            if (!panel || !toggle) return;
            const isCollapsed = panel.classList.contains('is-collapsed');
            toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
            toggle.setAttribute('title', isCollapsed
                ? (currentLang === 'en' ? 'Show current orders' : 'Mở đơn đang chốt')
                : (currentLang === 'en' ? 'Collapse current orders' : 'Thu gọn đơn đang chốt'));
            if (label) {
                label.textContent = isCollapsed
                    ? (currentLang === 'en' ? 'Show' : 'Mở đơn')
                    : (currentLang === 'en' ? 'Collapse' : 'Thu gọn');
            }
            if (icon) {
                icon.textContent = isCollapsed ? 'keyboard_double_arrow_left' : 'keyboard_double_arrow_right';
            }
        }

        window.toggleLiveOrdersPanel = () => {
            const panel = document.getElementById('live-current-orders-panel');
            const workspace = document.getElementById('section-live-workspace');
            if (!panel) return;
            const isCollapsed = panel.classList.toggle('is-collapsed');
            if (workspace) {
                workspace.classList.toggle('is-orders-collapsed', isCollapsed);
            }
            updateLiveOrdersToggleLabel();
        };

        function renderCurrentOrders(totalOrders = 0, totalRevenue = 0) {
            const panels = Array.from(document.querySelectorAll('[data-current-orders-panel]'));
            const orders = Object.values(ordersData || {})
                .map(order => ({
                    ...order,
                    username: normalizeTikTokUsername(order.username || order.customerUsername || '')
                }))
                .filter(order => order.username);

            const ordersHtml = orders.map(order => {
                const items = Array.isArray(order.items) ? order.items : [];
                const username = normalizeTikTokUsername(order.username || order.customerUsername || '');
                const usernameArg = escapeHtml(JSON.stringify(username));
                const customerName = getDisplayName(order.nickname || order.displayName || '', username);
                const customerLabel = buildCustomerLabel(order.nickname || order.displayName || '', username);
                const handle = formatTikTokUsername(username);
                const total = Number(order.total || items.reduce((sum, item) => sum + Number(item.price || 0), 0));
                const avatarSrc = isAvatarUrl(order.profilePictureUrl) ? order.profilePictureUrl : buildInitialAvatarDataUri(customerLabel);
                const itemRows = items.map(item => {
                    const itemIdArg = escapeHtml(JSON.stringify(item.id ?? null));
                    const itemTextArg = escapeHtml(JSON.stringify(normalizeDisplayText(item.text || item.productName || '')));
                    const price = Number(item.price || 0);
                    return `
                        <div class="live-order-item live-order-comment-row">
                            <div class="live-order-comment-main">
                                <strong>${escapeHtml(normalizeDisplayText(item.text || item.productName || 'Sản phẩm'))}</strong>
                                <span>${escapeHtml(normalizeDisplayText(item.time || 'Vừa chốt'))}</span>
                            </div>
                            <strong class="live-order-comment-price">${formatMoney(price)}</strong>
                            <div class="live-order-item-actions">
                                <button type="button" class="icon-btn" title="In lại dòng này" onclick="reprintItem(${usernameArg}, ${itemIdArg})"><span class="material-symbols-outlined">print</span></button>
                                <button type="button" class="icon-btn" title="Sửa bình luận" onclick="editItem(${usernameArg}, ${itemIdArg}, ${itemTextArg}, ${price})"><span class="material-symbols-outlined">edit</span></button>
                                <button type="button" class="icon-btn danger" title="Xóa bình luận" onclick="deleteItem(${usernameArg}, ${itemIdArg})"><span class="material-symbols-outlined">delete</span></button>
                            </div>
                        </div>
                    `;
                }).join('');

                return `
                    <article class="live-order-card">
                        <div class="live-order-card-head">
                            <img src="${escapeHtml(avatarSrc)}" alt="">
                            <div>
                                <h4>${escapeHtml(customerName)}</h4>
                                <p>${escapeHtml(handle || username)}</p>
                            </div>
                            <div class="live-order-card-actions">
                                <button type="button" class="icon-btn add" title="Thêm bình luận" onclick="addOrderItem(${usernameArg})"><span class="material-symbols-outlined">add</span></button>
                                <button type="button" class="icon-btn danger" title="Xóa khách" onclick="deleteCustomer(${usernameArg})"><span class="material-symbols-outlined">close</span></button>
                            </div>
                        </div>
                        <div class="live-order-card-stats">
                            <div><span>Số đơn</span><strong>${items.length} đơn</strong></div>
                            <div><span>Số tiền</span><strong>${formatMoney(total)}</strong></div>
                        </div>
                        <div class="live-order-items">${itemRows}</div>
                        <div class="live-order-card-foot">
                            <div><span>Tổng đơn</span><strong>${formatMoney(total)}</strong></div>
                            <button type="button" onclick="reprintTotal(${usernameArg})">In lại tổng</button>
                        </div>
                    </article>
                `;
            }).join('');

            panels.forEach(panel => {
                const grid = panel.querySelector('[data-current-orders-grid]');
                const empty = panel.querySelector('[data-current-orders-empty]');
                const count = panel.querySelector('[data-current-orders-count]');
                if (count) {
                    count.textContent = `${totalOrders} đơn · ${formatMoney(totalRevenue)}`;
                }
                if (!grid) return;

                if (orders.length === 0) {
                    grid.innerHTML = '';
                    if (empty) {
                        empty.hidden = false;
                        empty.classList.remove('hidden');
                    }
                    return;
                }

                if (empty) {
                    empty.hidden = true;
                    empty.classList.add('hidden');
                }
                grid.innerHTML = ordersHtml;
            });
            updateLiveOrdersToggleLabel();
        }

        function renderEmptyCommentState() {
            if (!chatFeed) return;
            const hasCommentRows = chatFeed.querySelector('[data-chat-row="1"]');
            const existingEmpty = document.getElementById('chat-feed-empty');
            if (hasCommentRows) {
                if (existingEmpty) existingEmpty.remove();
                return;
            }
            if (existingEmpty) {
                existingEmpty.innerHTML = currentLang === 'en'
                    ? '<span class="material-symbols-outlined">chat_bubble_outline</span><strong>No realtime comments yet</strong><small>Connect a Live ID to start tracking comments.</small>'
                    : '<span class="material-symbols-outlined">chat_bubble_outline</span><strong>Chưa có bình luận realtime</strong><small>Kết nối ID Live để bắt đầu theo dõi bình luận.</small>';
                return;
            }
            const empty = document.createElement('div');
            empty.id = 'chat-feed-empty';
            empty.className = 'live-empty-state';
            empty.innerHTML = currentLang === 'en'
                ? '<span class="material-symbols-outlined">chat_bubble_outline</span><strong>No realtime comments yet</strong><small>Connect a Live ID to start tracking comments.</small>'
                : '<span class="material-symbols-outlined">chat_bubble_outline</span><strong>Chưa có bình luận realtime</strong><small>Kết nối ID Live để bắt đầu theo dõi bình luận.</small>';
            chatFeed.appendChild(empty);
        }

        function buildConfirmedAmountTooltip(userId) {
            const normalizedUserId = normalizeTikTokUsername(userId);
            const total = Number(ordersData?.[normalizedUserId]?.total || 0);
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

        function toLocalDate(value) {
            const date = new Date(`${value}T00:00:00`);
            return Number.isNaN(date.getTime()) ? null : date;
        }

        function formatApiDateShort(value) {
            const formatted = formatApiDate(value);
            return String(formatted || '').slice(0, 5) || formatted || '';
        }

        function renderOverviewInlineEmpty(show) {
            const emptyStateEl = document.getElementById('overview-empty-state');
            const miniMetricsEl = document.getElementById('overview-mini-metrics');
            if (emptyStateEl) emptyStateEl.classList.toggle('hidden', !show);
            if (miniMetricsEl) miniMetricsEl.classList.toggle('overview-mini-metrics-dimmed', show);
        }

        function buildComparisonLine(comparison = {}) {
            const ordersDiff = Number(comparison.ordersDiff || 0);
            const revenueDiff = Number(comparison.revenueDiff || 0);
            const hasPreviousData = Boolean(comparison.hasPreviousData);
            const hasCurrentData = Boolean(comparison.hasCurrentData);
            if (!hasPreviousData && hasCurrentData) {
                return currentLang === 'en'
                    ? 'No previous-period data to compare yet.'
                    : 'Chưa có dữ liệu kỳ trước để so sánh.';
            }
            const hasDelta = ordersDiff !== 0 || revenueDiff !== 0;
            if (!hasDelta) {
                return currentLang === 'en'
                    ? 'Stable compared to previous period.'
                    : 'Ổn định so với kỳ trước.';
            }
            const parts = [];
            if (ordersDiff !== 0) {
                const ordersDirection = ordersDiff > 0
                    ? (currentLang === 'en' ? 'up' : 'tăng')
                    : (currentLang === 'en' ? 'down' : 'giảm');
                parts.push(currentLang === 'en'
                    ? `orders ${ordersDirection} ${Math.abs(ordersDiff)}`
                    : `đơn ${ordersDirection} ${Math.abs(ordersDiff)}`);
            }
            if (revenueDiff !== 0) {
                const revenueDirection = revenueDiff > 0
                    ? (currentLang === 'en' ? 'up' : 'tăng')
                    : (currentLang === 'en' ? 'down' : 'giảm');
                parts.push(currentLang === 'en'
                    ? `revenue ${revenueDirection} ${formatMoney(Math.abs(revenueDiff))}`
                    : `doanh thu ${revenueDirection} ${formatMoney(Math.abs(revenueDiff))}`);
            }
            if (currentLang === 'en') {
                return `Compared to previous period: ${parts.join(', ')}.`;
            }
            return `So với kỳ trước: ${parts.join(', ')}.`;
        }

        function renderOverview(data, comparison = null) {
            const summary = data?.summary || {};
            const totalOrders = Number(summary.orders || 0);
            const totalRevenue = Number(summary.revenue || 0);
            const comments = Number(summary.comments || 0);
            const pendingOrders = Number(summary.pendingOrders || 0);
            const activeLive = Number(summary.activeLive || 0);
            const closeRate = Number(summary.closeRate || 0);
            const hasData = totalOrders > 0 || totalRevenue > 0;
            const startText = formatApiDate(data?.meta?.start || '');
            const endText = formatApiDate(data?.meta?.end || '');
            const rangeText = `${startText} → ${endText}`;

            setText(document.getElementById('ov-orders'), totalOrders);
            setText(document.getElementById('ov-comments'), comments);
            setText(document.getElementById('ov-revenue'), formatMoney(totalRevenue));
            setText(document.getElementById('ov-pending'), pendingOrders);
            setText(document.getElementById('ov-live-active'), String(activeLive));
            setText(document.getElementById('ov-close-rate'), `${closeRate.toFixed(1)}%`);
            setText(document.getElementById('ov-orders-note'), rangeText);
            setText(document.getElementById('ov-revenue-note'), currentLang === 'en' ? 'Confirmed orders only' : 'Chỉ tính đơn đã chốt');
            setText(document.getElementById('ov-pending-note'), pendingOrders > 0
                ? (currentLang === 'en' ? 'Need follow-up' : 'Cần xử lý thêm')
                : (currentLang === 'en' ? 'No pending orders' : 'Không có đơn treo'));

            setText(document.getElementById('ov-orders-meta'), totalOrders);
            setText(document.getElementById('ov-pending-meta'), pendingOrders);
            setText(document.getElementById('ov-revenue-meta'), formatMoney(totalRevenue));
            setText(document.getElementById('ov-comments-meta'), comments);

            const insightText = hasData
                ? (currentLang === 'en'
                    ? `Period ${rangeText}: ${totalOrders} orders, ${formatMoney(totalRevenue)} revenue.`
                    : `${rangeText}: ${totalOrders} đơn, ${formatMoney(totalRevenue)} doanh thu.`)
                : (currentLang === 'en'
                    ? 'No recorded orders in this period.'
                    : 'Chưa ghi nhận đơn hàng trong khoảng này.');
            setText(document.getElementById('overview-insight-text'), insightText);
            const deltaEl = document.getElementById('overview-insight-delta');
            const deltaText = buildComparisonLine({
                ...(comparison || {}),
                hasCurrentData: hasData
            });
            setText(deltaEl, deltaText);
            if (deltaEl) {
                deltaEl.classList.remove('is-positive', 'is-negative', 'is-neutral');
                const ordersDiff = Number(comparison?.ordersDiff || 0);
                const revenueDiff = Number(comparison?.revenueDiff || 0);
                if (ordersDiff > 0 || revenueDiff > 0) {
                    deltaEl.classList.add('is-positive');
                } else if (ordersDiff < 0 || revenueDiff < 0) {
                    deltaEl.classList.add('is-negative');
                } else {
                    deltaEl.classList.add('is-neutral');
                }
            }

            const trendTitle = document.getElementById('overview-trend-title');
            if (trendTitle) trendTitle.textContent = totalRevenue > 0 ? t('ov.trendTitle') : t('ov.orders7d');
            const trendSubtitle = document.getElementById('overview-trend-subtitle');
            if (trendSubtitle) {
                trendSubtitle.textContent = currentLang === 'en'
                    ? `From ${formatApiDateShort(data?.meta?.start)} to ${formatApiDateShort(data?.meta?.end)}`
                    : `Từ ${formatApiDateShort(data?.meta?.start)} đến ${formatApiDateShort(data?.meta?.end)}`;
            }

            renderOverviewInlineEmpty(!hasData);
            topShopStats = Array.isArray(data.topShops) ? data.topShops : [];
            renderOverviewChart('overview-trend-chart', data.daily || [], totalRevenue > 0 ? 'revenue' : 'orders');
            renderOverviewChart('overview-hourly-chart', data.hourly || [], 'revenue');
            renderOverviewTopShops();
            renderOverviewLatestOrders();
        }

        async function refreshOverviewData(showLoading = true) {
            const startDate = parseDisplayDate(overviewStartInput.value);
            const endDate = parseDisplayDate(overviewEndInput.value);
            if (!startDate || !endDate) return;
            if (showLoading) {
                document.getElementById('overview-top-shop-list').innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'Loading...' : 'Đang tải...'}</p>`;
                const overviewTopProductsList = document.getElementById('overview-top-products-list');
                if (overviewTopProductsList) overviewTopProductsList.innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'Loading...' : 'Đang tải...'}</p>`;
            }
            try {
                const startObj = toLocalDate(startDate);
                const endObj = toLocalDate(endDate);
                if (!startObj || !endObj) return;
                const daySpan = Math.max(1, Math.floor((endObj - startObj) / 86400000) + 1);
                const previousEndObj = new Date(startObj);
                previousEndObj.setDate(previousEndObj.getDate() - 1);
                const previousStartObj = new Date(previousEndObj);
                previousStartObj.setDate(previousStartObj.getDate() - (daySpan - 1));

                const params = new URLSearchParams({
                    start: startDate,
                    end: endDate
                });
                const previousParams = new URLSearchParams({
                    start: toDateInputValue(previousStartObj),
                    end: toDateInputValue(previousEndObj)
                });

                const [currentRes, previousRes] = await Promise.all([
                    fetch(`/api/overview?${params.toString()}`),
                    fetch(`/api/overview?${previousParams.toString()}`)
                ]);
                const [currentData, previousData] = await Promise.all([currentRes.json(), previousRes.json()]);
                if (!currentRes.ok) throw new Error(currentData.error || 'Load overview error');

                const previousSummary = previousRes.ok ? (previousData?.summary || {}) : {};
                const currentSummary = currentData?.summary || {};
                const previousOrders = Number(previousSummary.orders || 0);
                const previousRevenue = Number(previousSummary.revenue || 0);
                const currentOrders = Number(currentSummary.orders || 0);
                const currentRevenue = Number(currentSummary.revenue || 0);
                overviewComparison = {
                    ordersDiff: currentOrders - previousOrders,
                    revenueDiff: currentRevenue - previousRevenue,
                    hasPreviousData: previousOrders > 0 || previousRevenue > 0,
                    hasCurrentData: currentOrders > 0 || currentRevenue > 0
                };
                overviewData = currentData;
                renderOverview(currentData, overviewComparison);
            } catch (e) {
                console.warn('Overview load error:', e);
            }
        }

        function renderOverviewChart(containerId, data, metric) {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            const values = data.map(d => Number(d[metric] || 0));
            const maxValue = Math.max(...values, 0);
            
            if (!data.length || maxValue === 0) {
                container.innerHTML = `<div class="h-full flex items-center justify-center text-sm text-gray-400">${currentLang === 'en' ? 'No data in this range' : 'Không có dữ liệu trong khoảng này'}</div>`;
                return;
            }

            container.innerHTML = `
                <div class="overview-bars">
                    ${data.map(d => {
                        const value = Number(d[metric] || 0);
                        const height = Math.max(6, Math.round((value / maxValue) * 100));
                        const label = (metric === 'revenue' || d.hour !== undefined) ? formatMoney(value) : value;
                        const dateLabel = d.hour !== undefined ? `${d.hour}h` : d.date.slice(5);
                        return `
                            <div class="overview-bar" title="${d.hour !== undefined ? d.hour + 'h' : d.date}: ${label}">
                                <div class="overview-bar-value" style="height:${height}%"></div>
                                <span class="text-[9px]">${dateLabel}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        function renderOverviewConversionChart(containerId, daily) {
            const container = document.getElementById(containerId);
            if (!container) return;

            if (!daily || daily.length === 0) {
                container.innerHTML = `<div class="h-full flex items-center justify-center text-sm text-gray-400">${currentLang === 'en' ? 'No data' : 'Chưa có dữ liệu'}</div>`;
                return;
            }

            container.innerHTML = `
                <div class="overview-bars">
                    ${daily.map(d => {
                        const convRate = d.comments > 0 ? (d.orders / d.comments) * 100 : 0;
                        const height = Math.max(6, Math.min(100, Math.round(convRate)));
                        return `
                            <div class="overview-bar" title="${d.date}: ${convRate.toFixed(1)}%">
                                <div class="overview-bar-value bg-rose-500" style="height:${height}%"></div>
                                <span class="text-[9px]">${d.date.slice(5)}</span>
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
            tbody.innerHTML = latest.map(r => {
                const customerName = buildCustomerLabel(r.customer || '', r.customerUsername || '');
                return `
                <tr class="border-b">
                    <td class="py-2">#${String(r.id || '').slice(-10) || '—'}</td>
                    <td class="py-2 customer-display-name" title="${escapeHtml(customerName)}">${escapeHtml(customerName || '—')}</td>
                    <td class="py-2">${[r.date, r.time].filter(Boolean).join(' ') || '—'}</td>
                    <td class="py-2">${formatMoney(Number(r.value || 0))}</td>
                    <td class="py-2"><span class="px-2 py-1 rounded text-[10px] font-bold ${r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${r.status === 'done' ? (currentLang === 'en' ? 'Done' : 'Đã chốt') : (currentLang === 'en' ? 'Pending' : 'Chờ chốt')}</span></td>
                </tr>
            `;
            }).join('');
            if (cards) {
                cards.innerHTML = latest.map(r => {
                    const customerName = buildCustomerLabel(r.customer || '', r.customerUsername || '');
                    return `
                    <div class="overview-order-card">
                        <div class="min-w-0">
                            <p class="font-bold text-sm truncate customer-display-name" title="${escapeHtml(customerName)}">${escapeHtml(customerName || '—')}</p>
                            <p class="text-[10px] text-gray-400 truncate">#${String(r.id || '').slice(-10) || '—'} • ${[r.date, r.time].filter(Boolean).join(' ') || '—'}</p>
                        </div>
                        <div class="text-right">
                            <p class="font-black text-red-600 whitespace-nowrap">${formatMoney(Number(r.value || 0))}</p>
                            <span class="inline-block mt-1 px-2 py-1 rounded text-[10px] font-bold ${r.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${r.status === 'done' ? (currentLang === 'en' ? 'Done' : 'Đã chốt') : (currentLang === 'en' ? 'Pending' : 'Chờ chốt')}</span>
                        </div>
                    </div>
                `;
                }).join('');
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
                            <span class="block truncate font-bold customer-display-name" title="${escapeHtml(getDisplayName(s.customer || '', s.customerUsername || ''))}">${escapeHtml(getDisplayName(s.customer || '', s.customerUsername || ''))}</span>
                            ${formatTikTokUsername(s.customerUsername) ? `<span class="block truncate text-[10px] text-gray-400">${escapeHtml(formatTikTokUsername(s.customerUsername))}</span>` : ''}
                        </span>
                        <div class="h-2 bg-gray-100 rounded-full flex-1">
                            <div class="h-2 bg-red-500 rounded-full" style="width:${width}%"></div>
                        </div>
                        <span class="font-bold text-right whitespace-nowrap">${formatMoney(s.revenue)}<span class="block text-[10px] text-gray-400">${s.orders || 0} đơn</span></span>
                    </div>
                `;
            }).join('');
        }

        function renderOverviewTopProducts() {
            // Đã xóa phần top sản phẩm theo yêu cầu
        }

        function setSectionVisibility(sectionEl, visible) {
            if (!sectionEl) return;
            const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (visible) {
                sectionEl.hidden = false;
                sectionEl.classList.remove('tab-enter');
                if (!prefersReducedMotion) {
                    // Retrigger animation each time a section becomes visible.
                    void sectionEl.offsetWidth;
                    sectionEl.classList.add('tab-enter');
                }
                return;
            }
            sectionEl.classList.remove('tab-enter');
            sectionEl.hidden = true;
        }

        function switchView(view) {
            if (view === 'admin') {
                if (currentUserRole === 'admin' || currentUserRole === 'super_admin') {
                    window.location.href = '/admin';
                } else {
                    alert(currentLang === 'en' ? 'You do not have admin access.' : 'Bạn không có quyền truy cập Admin.');
                }
                return;
            }

            currentView = view;
            document.body.dataset.view = view;
            menuItems.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });
            mobileNavItems.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });
            const sectionMap = {
                overview: [sectionOverview],
                live: [sectionConnect, sectionLiveWorkspace],
                orders: [sectionOrders],
                customers: [sectionCustomers],
                shop: [sectionShop],
                reports: [sectionReports],
                settings: [settingsPanel]
            };
            const activeSections = sectionMap[view] || sectionMap.overview;
            dashboardSections.forEach(sectionEl => setSectionVisibility(sectionEl, activeSections.includes(sectionEl)));
            setSectionVisibility(rightCol, view === 'settings');
            if (pageTitle) {
                pageTitle.textContent = view === 'live' ? 'TikTok Live Management' : 'TikTok Order';
            }
            if (pageLiveStatus) {
                pageLiveStatus.hidden = view !== 'live';
            }
            if (topbarSaveSessionBtn) {
                topbarSaveSessionBtn.hidden = view !== 'live';
            }
            UserAvatarMenu.close();

            if (view === 'customers') {
                loadCustomers();
            }
            if (view === 'live') {
                LivePage.refresh();
            }
            if (view === 'orders') {
                OrdersPage.refresh();
            }
            if (view === 'settings') {
                // Đợi DOM hiển thị xong rồi load settings UI
                setTimeout(() => loadSettingsUI(), 50);
            }
        }
        window.switchView = switchView;

        const LivePage = {
            refresh: () => {
                const { totalOrders, totalRevenue } = getCurrentOrdersTotals();
                renderCurrentOrders(totalOrders, totalRevenue);
                refreshCommentUserTooltips();
                renderEmptyCommentState();
            }
        };
        const OrdersPage = {
            refresh: () => {
                const { totalOrders, totalRevenue } = getCurrentOrdersTotals();
                renderCurrentOrders(totalOrders, totalRevenue);
            }
        };

        window.toggleSettings = () => switchView('settings');
        window.saveSettings = () => {
            const defaultTikTokIdInput = document.getElementById('default-tiktok-id');
            const autoConnectCheckbox = document.getElementById('auto-connect-enabled');
            const defaultTikTokId = (defaultTikTokIdInput?.value || '').trim().replace('@', '');
            const autoConnectEnabled = autoConnectCheckbox?.checked || false;

            socket.emit('update-settings', {
                printerInterface: printerIpInput.value.trim(),
                tiktokSignApiKey: tiktokApiKeyInput.value.trim()
            });

            // Lưu default TikTok ID và auto-connect flag vào localStorage (per-user)
            const scopedDefaultKey = getScopedStorageKey('defaultTikTokId');
            const scopedAutoKey = getScopedStorageKey('autoConnectEnabled');
            if (scopedDefaultKey) {
                if (defaultTikTokId) {
                    localStorage.setItem(scopedDefaultKey, defaultTikTokId);
                } else {
                    localStorage.removeItem(scopedDefaultKey);
                }
            }
            if (scopedAutoKey) {
                localStorage.setItem(scopedAutoKey, autoConnectEnabled ? 'true' : 'false');
            }

            // Sync toggle UI
            syncAutoConnectToggleUI(autoConnectEnabled);

            const msg = document.getElementById('system-status-msg');
            if (msg) {
                msg.textContent = currentLang === 'en' ? '✅ Settings saved!' : '✅ Đã lưu cài đặt!';
                msg.style.color = '#16a34a';
                setTimeout(() => { msg.textContent = ''; }, 3000);
            }
        };

        window.testConnectionFromSettings = () => {
            const defaultTikTokIdInput = document.getElementById('default-tiktok-id');
            const defaultTikTokId = (defaultTikTokIdInput?.value || '').trim().replace('@', '');
            if (!defaultTikTokId) {
                alert(currentLang === 'en' ? 'Please enter TikTok ID first!' : 'Vui lòng nhập ID TikTok trước!');
                return;
            }
            
            // Tự lưu cài đặt trước khi kết nối
            saveSettings();
            
            // Thiết lập trạng thái và phát sự kiện kết nối
            resetChatFeed();
            activeBroadcasterId = defaultTikTokId;
            socket.emit('start-live', {
                uniqueId: defaultTikTokId,
                sessionId: null // Buộc tạo session mới khi chủ động kết nối từ Settings
            });
            
            // Chuyển ngay sang màn hình Live
            switchView('live');
        };

        function syncAutoConnectToggleUI(enabled) {
            const track = document.getElementById('auto-connect-track');
            const checkbox = document.getElementById('auto-connect-enabled');
            if (track) {
                track.style.cssText = `
                    display: inline-block;
                    width: 38px;
                    height: 22px;
                    border-radius: 11px;
                    background: ${enabled ? '#ef4444' : '#d1d5db'};
                    position: relative;
                    transition: background 0.2s;
                    cursor: pointer;
                `;
                // Nút tròn bên trong toggle
                let knob = track.querySelector('.toggle-knob');
                if (!knob) {
                    knob = document.createElement('span');
                    knob.className = 'toggle-knob';
                    track.appendChild(knob);
                }
                knob.style.cssText = `
                    display: block;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #fff;
                    position: absolute;
                    top: 3px;
                    left: ${enabled ? '19px' : '3px'};
                    transition: left 0.2s;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                `;
            }
            if (checkbox) checkbox.checked = enabled;
        }

        function loadSettingsUI() {
            const scopedDefaultKey = getScopedStorageKey('defaultTikTokId');
            const scopedAutoKey = getScopedStorageKey('autoConnectEnabled');
            const defaultTikTokId = scopedDefaultKey ? (localStorage.getItem(scopedDefaultKey) || '') : '';
            const autoConnectEnabled = scopedAutoKey ? localStorage.getItem(scopedAutoKey) === 'true' : false;

            const defaultTikTokIdInput = document.getElementById('default-tiktok-id');
            if (defaultTikTokIdInput) defaultTikTokIdInput.value = defaultTikTokId;

            const track = document.getElementById('auto-connect-track');
            if (track && !track.querySelector('.toggle-knob')) {
                // Khởi tạo lần đầu
            }
            syncAutoConnectToggleUI(autoConnectEnabled);

            // Gắn event click cho toggle track
            const autoTrack = document.getElementById('auto-connect-track');
            if (autoTrack && !autoTrack.dataset.listenerAttached) {
                autoTrack.dataset.listenerAttached = 'true';
                autoTrack.addEventListener('click', () => {
                    const cb = document.getElementById('auto-connect-enabled');
                    const newVal = !(cb?.checked || false);
                    syncAutoConnectToggleUI(newVal);
                });
            }
        }
        window.downloadBackup = (format) => {
            const scope = document.getElementById('backup-scope').value;
            const url = `/api/export-data?format=${encodeURIComponent(format)}&scope=${encodeURIComponent(scope)}`;
            window.open(url, '_blank');
        };
        window.showHistory = () => { historyModal.classList.remove('hidden'); socket.emit('get-history-list'); };
        window.closeHistory = () => historyModal.classList.add('hidden');

        // Load session orders to current view (để có thể chỉnh sửa)
        window.loadSessionOrdersToCurrentView = async (sessionId) => {
            try {
                console.log(`🔍 Loading session: ${sessionId}`);
                const res = await fetch('/api/live-sessions/' + encodeURIComponent(sessionId));
                console.log(`📡 Response status: ${res.status}`);

                if (!res.ok) {
                    const errData = await res.json();
                    alert(`❌ Load error (${res.status}): ${errData.error}`);
                    return;
                }

                const data = await res.json();
                console.log('📦 Data:', data);

                if (!data || !data.session) {
                    alert('Không tìm thấy phiên');
                    return;
                }

                const orders = data.orders || [];
                console.log(`✅ Loaded ${orders.length} orders`);

                ordersData = normalizeSessionOrdersArray(orders);
                socket.emit('replace-confirmed-orders', {
                    orders: ordersData,
                    broadcasterId: data.session.tiktokUsername || data.session.liveName || ''
                });
                calculateKpis();
                refreshCommentUserTooltips();
                const totalOrders = Object.values(ordersData).reduce((sum, order) => {
                    return sum + (Array.isArray(order.items) ? order.items.length : 0);
                }, 0);

                switchView('orders');
                if (sectionCurrentOrders) {
                    sectionCurrentOrders.scrollIntoView({ block: 'start' });
                }
                const currentOrdersGrid = document.getElementById('current-orders-grid');
                if (currentOrdersGrid) currentOrdersGrid.scrollTop = 0;

                // Close history modal
                closeLiveSessions();

                // Show success notification
                console.log(`✅ Loaded ${totalOrders} orders from session: ${data.session.liveName}`);
                alert(`✅ Loaded ${totalOrders} orders từ: ${data.session.liveName}`);

            } catch (e) {
                console.error('Load session orders error:', e);
                alert('Lỗi load orders: ' + e.message);
            }
        };

        socket.on('history-list', (list) => {
            historyListContent.innerHTML = list.map(f => `
                <div class="flex justify-between items-center p-3 border rounded-lg hover:bg-blue-50 transition cursor-pointer" onclick="loadHistory('${f.fileName}')">
                    <div>
                        <p class="font-bold text-gray-800 text-sm">${f.fileName.replace(/^shared:/, '[Shared] ').replace('.json', '')}</p>
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
            ordersData = normalizeOrdersMap(res.data);
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
            ordersData = normalizeOrdersMap(allOrders);
            calculateKpis();
            refreshCommentUserTooltips();

            // Tắt spin
            const iconEl = document.querySelector('[onclick="refreshCurrentOrders()"] .material-symbols-outlined');
            if (iconEl) iconEl.classList.remove('spinning');
        });

        // Thêm hàm refresh để gọi lại danh sách đơn chốt hiện tại
        window.refreshCurrentOrders = function () {
            const refreshBtn = document.querySelector('[onclick="refreshCurrentOrders()"]');
            const iconEl = refreshBtn?.querySelector('.material-symbols-outlined');

            // Spin animation
            if (iconEl) iconEl.classList.add('spinning');

            if (!socket.connected) {
                if (refreshBtn) {
                    refreshBtn.disabled = true;
                    refreshBtn.title = 'Đang kết nối lại...';
                }
                showLiveToast('⚠️ Đang kết nối lại...', 'warning');
                socket.connect();
                socket.once('connect', () => {
                    if (refreshBtn) {
                        refreshBtn.disabled = false;
                        refreshBtn.title = 'Làm mới đơn chốt';
                    }
                    socket.emit('get-current-orders');
                });
                return;
            }

            socket.emit('get-current-orders');
            showLiveToast('Đang cập nhật...', 'info');
        };

        function normalizeOrdersMap(orderMap) {
            return Object.values(orderMap || {}).reduce((result, order) => {
                const username = normalizeTikTokUsername(order.username || order.customerUsername || '');
                if (!username) return result;
                result[username] = {
                    ...order,
                    username,
                    nickname: cleanDisplayText(order.nickname || order.displayName || ''),
                    items: Array.isArray(order.items)
                        ? order.items.map(item => ({
                            ...item,
                            text: normalizeDisplayText(item.text || item.productName || '')
                        }))
                        : []
                };
                return result;
            }, {});
        }

        function normalizeSessionOrdersArray(orders) {
            return (Array.isArray(orders) ? orders : []).reduce((result, order, index) => {
                const username = normalizeTikTokUsername(order.customerUsername || order.username || order.tiktokUsername || order.customer || '');
                if (!username) return result;

                const customerName = cleanDisplayText(order.customerName || order.nickname || order.displayName || order.customer || '');
                const productName = normalizeDisplayText(order.productName || order.product || order.text || '');
                const price = Number(order.price || order.total || 0);
                const createdAt = order.createdAt ? new Date(order.createdAt) : null;
                const fallbackTime = createdAt && !Number.isNaN(createdAt.getTime())
                    ? createdAt.toLocaleTimeString('vi-VN')
                    : '';

                if (!result[username]) {
                    result[username] = {
                        username,
                        customerUsername: username,
                        nickname: customerName,
                        displayName: customerName,
                        profilePictureUrl: order.profilePictureUrl || '',
                        items: [],
                        total: 0
                    };
                }

                result[username].items.push({
                    id: order.id || `${username}_${index}`,
                    text: productName,
                    productName,
                    price,
                    time: normalizeDisplayText(order.time || fallbackTime)
                });
                result[username].total += price;

                return result;
            }, {});
        }

        function resetChatFeed() {
            chatFeed.innerHTML = '';
            kpiComments = 0;
            seenChatMsgIds.clear();
            calculateKpis();
            renderEmptyCommentState();
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
            row.dataset.chatRow = '1';
            row.className = 'chat-row border border-gray-100 rounded-xl p-3 flex gap-3 items-start';
            const commenterId = normalizeTikTokUsername(data.uniqueId || data.username || '');
            const rawNickname = cleanDisplayText(data.nickname || data.displayName || '');
            const nickname = getDisplayName(rawNickname, commenterId);
            const comment = normalizeDisplayText(data.comment || '');
            const profilePictureUrl = normalizeDisplayText(data.profilePictureUrl || '');
            const tooltip = buildConfirmedAmountTooltip(commenterId);

            const avatar = document.createElement('img');
            avatar.src = profilePictureUrl;
            avatar.className = 'w-10 h-10 rounded-full border cursor-help';
            avatar.dataset.commentUserid = commenterId;
            avatar.title = tooltip;
            row.appendChild(avatar);

            const body = document.createElement('div');
            body.className = 'flex-1 min-w-0';
            const header = document.createElement('div');
            header.className = 'flex justify-between items-center gap-2';
            const nameEl = document.createElement('p');
            nameEl.className = 'font-bold text-gray-800 truncate text-sm cursor-help customer-display-name';
            nameEl.dataset.commentUserid = commenterId;
            nameEl.title = tooltip;
            nameEl.textContent = nickname;
            const timeEl = document.createElement('span');
            timeEl.className = 'text-[10px] text-gray-400 font-mono whitespace-nowrap';
            timeEl.textContent = now;
            header.append(nameEl, timeEl);

            const commentEl = document.createElement('p');
            commentEl.className = 'text-gray-700 my-1 text-sm';
            commentEl.textContent = comment;

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-2 mt-2';
            if (data.suggestedPrice > 0) {
                const priceTag = document.createElement('span');
                priceTag.className = 'text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded';
                priceTag.textContent = formatMoney(data.suggestedPrice);
                actions.appendChild(priceTag);
            }
            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 'bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded uppercase';
            confirmBtn.textContent = currentLang === 'en' ? 'CONFIRM' : 'CHỐT';
            confirmBtn.addEventListener('click', () => manualConfirm(commenterId, rawNickname, profilePictureUrl, comment, data.suggestedPrice));
            actions.appendChild(confirmBtn);

            body.append(header, commentEl, actions);
            row.appendChild(body);
            const emptyState = document.getElementById('chat-feed-empty');
            if (emptyState) emptyState.remove();
            chatFeed.appendChild(row);
            chatFeed.scrollTop = chatFeed.scrollHeight;
            const commentRows = Array.from(chatFeed.querySelectorAll('[data-chat-row="1"]'));
            if (commentRows.length > 300) commentRows[0].remove();
            calculateKpis();
        }

        if (btnConnect) {
            btnConnect.addEventListener('click', () => {
                const id = tiktokIdInput ? tiktokIdInput.value.trim().replace('@', '') : '';
                if (!id) return alert(currentLang === 'en' ? 'Please input TikTok ID' : 'Nhập ID');
                resetChatFeed();
                // Xóa ordersData tạm thời của phiên cũ để bắt đầu phiên hoàn toàn mới khi người dùng đổi account thủ công
                ordersData = {}; 
                calculateKpis();
                socket.emit('start-live', id);
            });
        }

        socket.on('status', (data) => {
            const connectedText = currentLang === 'en' ? `Connected: ${data.roomId}` : `Kết nối: ${data.roomId}`;
            const errorText = currentLang === 'en' ? `Error: ${data.error}` : `Lỗi: ${data.error}`;
            statusMsg.innerText = data.connected ? connectedText : errorText;
            statusMsg.className = data.connected ? 'live-status-text text-green-600 font-semibold' : 'live-status-text text-red-600 font-semibold';
            const kpiStatusEl = document.getElementById('kpi-status');
            if (kpiStatusEl) {
                kpiStatusEl.textContent = data.connected ? (currentLang === 'en' ? 'Live' : 'Đang Live') : t('status.disconnected');
                kpiStatusEl.className = data.connected ? 'text-base font-bold mt-3 text-green-600' : 'text-base font-bold mt-3 text-gray-500';
            }
            if (data.connected && data.broadcasterId) {
                activeBroadcasterId = data.broadcasterId;
                const scopedLastBroadcasterKey = getScopedStorageKey('lastBroadcasterId');
                if (scopedLastBroadcasterKey) {
                    localStorage.setItem(scopedLastBroadcasterKey, data.broadcasterId);
                }
                socket.emit('get-chat-buffer', { broadcasterId: data.broadcasterId });
            }
            if (pageLiveStatus) {
                pageLiveStatus.classList.toggle('is-offline', !data.connected);
                const label = data.connected ? 'Connected' : 'Disconnected';
                pageLiveStatus.lastChild.textContent = ` ${label}`;
            }
            scheduleOverviewRefresh();
        });

        socket.on('raw-chat', (data) => {
            if (activeBroadcasterId && data.broadcasterId && data.broadcasterId !== activeBroadcasterId) return;
            renderChatRow(data);
        });

        socket.on('debt-alert', (data) => {
            const existing = document.getElementById('debt-toast-container');
            if (existing) existing.remove();

            const toast = document.createElement('div');
            toast.id = 'debt-toast-container';
            toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;';
            toast.innerHTML = `
                <div class="debt-toast">
                    <span style="font-size:16px;">💸</span>
                    <span style="font-weight:600;">${data.message}</span>
                    <button onclick="this.closest('#debt-toast-container').remove()" style="background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:16px;padding:0 4px;">✕</button>
                </div>`;
            document.body.appendChild(toast);
            setTimeout(() => {
                const el = document.getElementById('debt-toast-container');
                if (el) el.style.opacity = '0';
                if (el) el.style.transform = 'translateX(-50%) translateY(-10px)';
                setTimeout(() => el?.remove(), 300);
            }, 6000);
        });

        socket.on('chat-buffer', (payload) => {
            const broadcasterId = payload?.broadcasterId || '';
            const comments = Array.isArray(payload?.comments) ? payload.comments : [];
            if (!broadcasterId || (activeBroadcasterId && broadcasterId !== activeBroadcasterId)) return;

            resetChatFeed();
            comments.forEach(renderChatRow);
            if (comments.length === 0) renderEmptyCommentState();
        });

        window.manualConfirm = (uniqueId, nickname, profilePictureUrl, comment, suggestedPrice) => {
            const inputText = currentLang === 'en' ? 'Enter price (e.g. 50000):' : 'Nhập giá (vd: 50000):';
            let price = suggestedPrice || parseFloat(prompt(inputText, '')) || 0;
            if (price > 0) {
                const username = normalizeTikTokUsername(uniqueId);
                socket.emit('confirm-item', {
                    uniqueId: username,
                    nickname: cleanDisplayText(nickname),
                    profilePictureUrl: normalizeDisplayText(profilePictureUrl),
                    comment: normalizeDisplayText(comment),
                    price
                });
            }
        };

        socket.on('order-confirmed', (userOrder) => {
            const username = normalizeTikTokUsername(userOrder.username || userOrder.customerUsername || '');
            const normalizedOrder = {
                ...userOrder,
                username,
                nickname: cleanDisplayText(userOrder.nickname || userOrder.displayName || '')
            };
            ordersData[username || userOrder.username] = normalizedOrder;
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

        const DISPLAY_NAME_FALLBACK = 'Khách TikTok';
        const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/g;
        const INVISIBLE_FORMAT_RE = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

        function cleanDisplayText(value) {
            return String(value ?? '')
                .normalize('NFC')
                .replace(CONTROL_CHAR_RE, ' ')
                .replace(INVISIBLE_FORMAT_RE, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function normalizeTextForDisplay(value) {
            return cleanDisplayText(value).normalize('NFKC').normalize('NFC');
        }

        function hasReplacementChar(value) {
            return String(value ?? '').includes('\uFFFD');
        }

        function normalizeDisplayName(name, fallback = DISPLAY_NAME_FALLBACK) {
            const displayName = normalizeTextForDisplay(name);
            if (displayName && !hasReplacementChar(displayName)) return displayName;

            const displayFallback = normalizeTextForDisplay(fallback);
            if (displayFallback && !hasReplacementChar(displayFallback)) return displayFallback;

            return DISPLAY_NAME_FALLBACK;
        }

        function normalizeDisplayText(value) {
            return cleanDisplayText(value).replace(/\uFFFD/g, '');
        }

        function normalizeTikTokUsername(username) {
            return normalizeDisplayText(username).replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
        }

        function formatTikTokUsername(username) {
            const normalized = normalizeTikTokUsername(username);
            return normalized ? `@${normalized}` : '';
        }

        function getDisplayName(name, username) {
            return normalizeDisplayName(name, formatTikTokUsername(username) || DISPLAY_NAME_FALLBACK);
        }

        function buildCustomerLabel(name, username) {
            const displayName = getDisplayName(name, username);
            const handle = formatTikTokUsername(username);
            return handle && displayName !== handle ? `${displayName} (${handle})` : displayName;
        }

        function setText(el, value) {
            if (el) el.textContent = normalizeDisplayText(value);
        }

        function isAvatarUrl(value) {
            const url = normalizeDisplayText(value);
            return /^https?:\/\//i.test(url) || /^data:image\//i.test(url);
        }

        function buildInitialAvatarDataUri(seedText) {
            const cleaned = normalizeDisplayText(seedText);
            const first = (cleaned.charAt(0) || 'U').toUpperCase();
            const second = (cleaned.charAt(1) || '').toUpperCase();
            const chars = second ? `${first}${second}` : first;
            const fontSize = chars.length > 1 ? '24' : '32';
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e5e7eb"/><text x="50%" y="54%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#4b5563">${escapeHtml(chars)}</text></svg>`;
            return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        }

        function applyUserAvatar(avatarEl, pictureUrl, name, email) {
            if (!avatarEl) return;
            const safePictureUrl = normalizeDisplayText(pictureUrl);
            const fallbackAvatar = buildInitialAvatarDataUri(name || email || 'User');
            avatarEl.onerror = () => {
                avatarEl.onerror = null;
                avatarEl.src = fallbackAvatar;
            };
            avatarEl.src = isAvatarUrl(safePictureUrl) ? safePictureUrl : fallbackAvatar;
            avatarEl.classList.remove('hidden');
        }

        function getScopedStorageKey(baseKey) {
            return currentUserUid ? `${baseKey}_${currentUserUid}` : '';
        }

        function clearRealtimeUi() {
            ordersData = {};
            customersData = [];
            kpiComments = 0;
            seenChatMsgIds.clear();
            activeBroadcasterId = '';
            if (chatFeed) chatFeed.textContent = '';
            if (customersTableBody) customersTableBody.textContent = '';
            calculateKpis();
            renderEmptyCommentState();
            refreshCommentUserTooltips();
        }

        function getCustomerFormData() {
            return {
                tiktokUsername: normalizeTikTokUsername(document.getElementById('customer-tiktok').value),
                displayName: cleanDisplayText(document.getElementById('customer-display-name').value),
                phone: normalizeDisplayText(document.getElementById('customer-phone').value),
                province: normalizeDisplayText(document.getElementById('customer-province').value),
                district: normalizeDisplayText(document.getElementById('customer-district').value),
                ward: normalizeDisplayText(document.getElementById('customer-ward').value),
                addressDetail: normalizeDisplayText(document.getElementById('customer-address-detail').value),
                addressNote: normalizeDisplayText(document.getElementById('customer-address-note').value),
                customerCode: normalizeDisplayText(document.getElementById('customer-code').value)
            };
        }

        function setCustomerFormData(customer = {}) {
            document.getElementById('customer-id').value = customer.id || '';
            document.getElementById('customer-tiktok').value = customer.tiktokUsername || '';
            document.getElementById('customer-display-name').value = customer.displayName || '';
            document.getElementById('customer-phone').value = customer.phone || '';
            document.getElementById('customer-province').value = customer.province || '';
            document.getElementById('customer-district').value = customer.district || '';
            document.getElementById('customer-ward').value = customer.ward || '';
            document.getElementById('customer-address-detail').value = customer.addressDetail || '';
            document.getElementById('customer-address-note').value = customer.addressNote || '';
            document.getElementById('customer-code').value = customer.customerCode || '';
            document.getElementById('customer-form-title').textContent = customer.id ? 'Sửa khách hàng' : 'Thêm khách hàng';
            document.getElementById('customer-form-status').textContent = '';
        }

        async function loadCustomers() {
            if (!customersTableBody) return;
            const q = customerSearchInput ? customerSearchInput.value.trim() : '';
            customersTableBody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-400">Đang tải...</td></tr>`;
            try {
                const res = await fetch('/api/customers?q=' + encodeURIComponent(q));
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Load customers error');
                customersData = data.customers || [];
                renderCustomersTable();
            } catch (error) {
                customersTableBody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-red-500">${escapeHtml(error.message)}</td></tr>`;
            }
        }

        function renderCustomersTable() {
            if (!customersTableBody) return;
            customersTableBody.textContent = '';
            if (!customersData.length) {
                customersTableBody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-400">Chưa có khách hàng</td></tr>`;
                return;
            }

            customersData.forEach(customer => {
                const address = [customer.addressDetail, customer.ward, customer.district, customer.province].filter(Boolean).join(', ');
                const username = normalizeTikTokUsername(customer.tiktokUsername || '');
                const handle = formatTikTokUsername(username);
                const displayName = getDisplayName(customer.displayName || '', username);

                const row = document.createElement('tr');
                row.className = 'border-b hover:bg-gray-50';

                const usernameCell = document.createElement('td');
                usernameCell.className = 'p-3 font-bold customer-table-username';
                usernameCell.title = handle;
                usernameCell.textContent = handle || '—';

                const nameCell = document.createElement('td');
                nameCell.className = 'p-3 customer-table-name customer-display-name';
                nameCell.title = displayName;
                nameCell.textContent = displayName;

                const phoneCell = document.createElement('td');
                phoneCell.className = 'p-3 customer-table-phone';
                if (normalizeDisplayText(customer.phone || '')) {
                    phoneCell.textContent = normalizeDisplayText(customer.phone);
                } else {
                    const missing = document.createElement('span');
                    missing.className = 'customer-missing text-amber-600';
                    missing.textContent = 'Thiếu SĐT';
                    phoneCell.appendChild(missing);
                }

                const addressCell = document.createElement('td');
                addressCell.className = 'p-3 customer-table-address';
                addressCell.title = normalizeDisplayText(address);
                if (normalizeDisplayText(address)) {
                    addressCell.textContent = normalizeDisplayText(address);
                } else {
                    const missing = document.createElement('span');
                    missing.className = 'customer-missing text-amber-600';
                    missing.textContent = 'Thiếu địa chỉ';
                    addressCell.appendChild(missing);
                }

                const actionsCell = document.createElement('td');
                actionsCell.className = 'p-3 text-right customer-table-actions';
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'customer-action-btn bg-blue-50 text-blue-600';
                editBtn.textContent = 'Sửa';
                editBtn.addEventListener('click', () => editCustomer(customer.id));
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'customer-action-btn bg-red-50 text-red-600';
                removeBtn.textContent = 'Xóa';
                removeBtn.addEventListener('click', () => removeCustomer(customer.id));
                actionsCell.append(editBtn, removeBtn);

                row.append(usernameCell, nameCell, phoneCell, addressCell, actionsCell);
                customersTableBody.appendChild(row);
            });
        }

        async function saveCustomerForm(event) {
            event.preventDefault();
            const customerId = document.getElementById('customer-id').value;
            const payload = getCustomerFormData();
            const status = document.getElementById('customer-form-status');
            if (!payload.displayName) {
                status.textContent = 'Tên người nhận là bắt buộc.';
                status.className = 'text-xs text-red-500 mt-1';
                return;
            }

            try {
                const res = await fetch(customerId ? `/api/customers/${encodeURIComponent(customerId)}` : '/api/customers', {
                    method: customerId ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Save customer error');
                resetCustomerForm(false);
                status.textContent = (data.warnings || []).join(', ') || 'Đã lưu khách hàng.';
                status.className = data.warnings?.length ? 'text-xs text-amber-600 mt-1' : 'text-xs text-green-600 mt-1';
                await loadCustomers();
            } catch (error) {
                status.textContent = error.message;
                status.className = 'text-xs text-red-500 mt-1';
            }
        }

        window.resetCustomerForm = (clearStatus = true) => {
            setCustomerFormData({});
            const autoInput = document.getElementById('customer-auto-input');
            if (autoInput) autoInput.value = '';
            if (clearStatus) {
                document.getElementById('customer-form-status').textContent = '';
            }
        };

        window.autoFillCustomerForm = async () => {
            const raw = (document.getElementById('customer-auto-input')?.value || '').trim();
            if (!raw) {
                // Try to read from clipboard if textarea is empty
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) document.getElementById('customer-auto-input').value = text.trim();
                } catch (_) {}
                return;
            }

            // Normalize: split by comma, newline, or semicolon
            const parts = raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
            if (parts.length === 0) return;

            let phone = '';
            let province = '';
            let district = '';
            let ward = '';
            let addressParts = [];

            // Phone pattern: 10-11 digits, may start with 0 or +84
            const phoneRe = /^(\+84|84|0)[0-9]{8,10}$/;

            // Vietnamese address keywords
            const provinceKws = ['tỉnh', 'tp', 'tp.', 'thành phố', 'city', 'tinh'];
            const districtKws = ['quận', 'quan', 'huyện', 'huyen', 'q.', 'h.', 'tx', 'thị xã'];
            const wardKws = ['phường', 'phuong', 'xã', 'xa', 'thị trấn', 'thi tran', 'p.', 'x.'];

            const normalize = s => s.toLowerCase().normalize('NFC');

            parts.forEach(part => {
                const n = normalize(part);
                if (phoneRe.test(part.replace(/\s/g, ''))) { phone = part.replace(/\s/g, ''); return; }
                if (provinceKws.some(k => n.startsWith(k) || n.includes(' ' + k + ' '))) { province = part; return; }
                if (districtKws.some(k => n.startsWith(k) || n.includes(' ' + k + ' '))) { district = part; return; }
                if (wardKws.some(k => n.startsWith(k) || n.includes(' ' + k + ' '))) { ward = part; return; }
                // Everything else → address detail
                addressParts.push(part);
            });

            const addressDetail = addressParts.join(', ');

            // Fill into form (không điền tên)
            if (phone) document.getElementById('customer-phone').value = phone;
            if (province) document.getElementById('customer-province').value = province;
            if (district) document.getElementById('customer-district').value = district;
            if (ward) document.getElementById('customer-ward').value = ward;
            if (addressDetail) document.getElementById('customer-address-detail').value = addressDetail;

            // Status feedback
            const status = document.getElementById('customer-form-status');
            if (status) {
                const filled = [phone && 'SĐT', province && 'Tỉnh', district && 'Huyện', ward && 'Xã/Phường', addressDetail && 'Địa chỉ'].filter(Boolean);
                status.textContent = filled.length ? `✅ Đã điền: ${filled.join(', ')}` : '⚠️ Không nhận ra định dạng. Hãy nhập thêm dữ liệu.';
                status.className = filled.length ? 'text-xs text-green-600 mt-1' : 'text-xs text-amber-600 mt-1';
            }
        };



        window.editCustomer = (customerId) => {
            const customer = customersData.find(item => item.id === customerId);
            if (!customer) return;
            setCustomerFormData(customer);
        };

        window.removeCustomer = async (customerId) => {
            if (!confirm('Xóa khách hàng này?')) return;
            try {
                const res = await fetch('/api/customers/' + encodeURIComponent(customerId), { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Delete customer error');
                resetCustomerForm();
                await loadCustomers();
            } catch (error) {
                alert('Lỗi xóa khách hàng: ' + error.message);
            }
        };

        window.importCustomersFromHistory = async () => {
            const msg = currentLang === 'en'
                ? 'Import TikTok usernames and customer names from saved live-session history?'
                : 'Lấy TikTok username và tên khách từ lịch sử phiên live đã lưu?';
            if (!confirm(msg)) return;
            try {
                const res = await fetch('/api/customers/import-from-history', { method: 'POST' });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Import error');
                await loadCustomers();
                const importedCount = Array.isArray(data.imported) ? data.imported.length : 0;
                const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
                if (importedCount > 0) {
                    alert(`✅ Đã thêm ${importedCount} khách hàng mới từ lịch sử.${skippedCount > 0 ? `\n(${skippedCount} khách đã có trong danh sách, giữ nguyên.)` : ''}`);
                } else {
                    alert(`ℹ️ Tất cả ${skippedCount} khách đã có trong danh sách rồi. Không có khách mới để thêm.`);
                }
            } catch (error) {
                alert('Lỗi lấy khách từ lịch sử: ' + error.message);
            }
        };


        window.reprintItem = (username, itemId) => socket.emit('reprint-item', { username: normalizeTikTokUsername(username), itemId });
        window.reprintTotal = (username) => socket.emit('reprint-total', normalizeTikTokUsername(username));
        window.deleteCustomer = (username) => {
            const handle = formatTikTokUsername(username);
            const msg = currentLang === 'en' ? `Delete all orders for ${handle}?` : `Xóa toàn bộ đơn của khách ${handle}?`;
            if (confirm(msg)) socket.emit('delete-customer', normalizeTikTokUsername(username));
        };
        window.deleteItem = (username, itemId) => {
            const msg = currentLang === 'en' ? 'Delete this item?' : 'Xóa món hàng này?';
            if (confirm(msg)) socket.emit('delete-item', { username: normalizeTikTokUsername(username), itemId });
        };
        window.addOrderItem = (username) => {
            const normalizedUsername = normalizeTikTokUsername(username);
            const customer = ordersData[normalizedUsername];
            if (!customer) return;
            const commentPrompt = currentLang === 'en' ? 'Enter comment/product:' : 'Nhập bình luận/sản phẩm:';
            const comment = normalizeDisplayText(prompt(commentPrompt, '') || '');
            if (!comment) return;
            const pricePrompt = currentLang === 'en' ? 'Enter price:' : 'Nhập giá:';
            const price = parseFloat(prompt(pricePrompt, ''));
            if (Number.isNaN(price) || price <= 0) return;
            socket.emit('confirm-item', {
                uniqueId: normalizedUsername,
                nickname: customer.nickname || customer.displayName || normalizedUsername,
                profilePictureUrl: customer.profilePictureUrl || '',
                comment,
                price
            });
        };

        window.filterOrdersGrid = (query) => {
            const q = (query || '').toLowerCase().trim();
            const grids = document.querySelectorAll('[data-current-orders-grid]');
            grids.forEach(grid => {
                const cards = grid.querySelectorAll('.order-card, .live-order-card, [data-username]');
                cards.forEach(card => {
                    if (!q) { card.style.display = ''; return; }
                    const username = (card.dataset.username || card.getAttribute('data-username') || '').toLowerCase();
                    const name = (card.querySelector('.customer-name, .order-nickname, [data-name]')?.textContent || '').toLowerCase();
                    const cardText = (card.textContent || '').toLowerCase();
                    const match = username.includes(q) || name.includes(q) || cardText.includes(q);
                    card.style.display = match ? '' : 'none';
                });
            });
        };

        window.printAllSummary = () => {

            let html = `<div style="font-family: 'Times New Roman', Times, serif; width: 80mm; margin: 0 auto; color: black;">`;
            html += `<div style="text-align:center;"><h2 style="margin: 0;">TONG KET PHIEN LIVE</h2><hr style="border: 1px solid black;"></div>`;
            let totalOverall = 0;
            Object.values(ordersData).forEach(o => {
                totalOverall += o.total;
                const username = normalizeTikTokUsername(o.username || o.customerUsername || '');
                const customerLabel = buildCustomerLabel(o.nickname || o.displayName || '', username);
                html += `<div style="margin-bottom: 10px; border-bottom: 1px dashed black; padding-bottom: 5px;">`;
                html += `<div style="font-weight: bold; font-size: 16px;">${escapeHtml(customerLabel)}</div>`;
                o.items.forEach(i => {
                    html += `<div style="display: flex; justify-content: space-between; font-size: 13px; margin-top: 2px;">`;
                    html += `<span style="flex: 1;">- ${escapeHtml(normalizeDisplayText(i.text || i.productName || ''))} <small>(${escapeHtml(normalizeDisplayText(i.time || ''))})</small></span>`;
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
                const scopedLastBroadcasterKey = getScopedStorageKey('lastBroadcasterId');
                if (scopedLastBroadcasterKey) {
                    localStorage.removeItem(scopedLastBroadcasterKey);
                }
                clearRealtimeUi();
                await fetch('/logout', { method: 'POST' });
                window.location.href = '/login';
            }
        };

        (async () => {
            switchView('overview');
            setLang(currentLang);
            setupMobileCommentPopover();
            setOverviewRange('7');
            try {
                const res = await fetch('/api/me');
                const data = await res.json();
                if (data.loggedIn && data.user) {
                    currentUserUid = normalizeDisplayText(data.user.uid || '');
                    const avatar = document.getElementById('user-avatar');
                    const nameEl = document.getElementById('user-name');
                    const emailEl = document.getElementById('user-email');
                    currentUserRole = normalizeDisplayText(data.user.role || 'user').toLowerCase() || 'user';

                    emailEl.textContent = data.user.email || '';
                    nameEl.textContent = data.user.name || data.user.email?.split('@')[0] || '';
                    if (userMenuName) userMenuName.textContent = nameEl.textContent;
                    if (userMenuEmail) userMenuEmail.textContent = emailEl.textContent;
                    if (userMenuRole) userMenuRole.textContent = currentUserRole ? `${currentLang === 'en' ? 'Role' : 'Vai trò'}: ${currentUserRole}` : '';

                    applyUserAvatar(avatar, data.user.picture, nameEl.textContent, emailEl.textContent);

                    if (userMenu) {
                        userMenu.classList.remove('hidden');
                        userMenu.style.display = 'block';
                    }
                    if (userMenuTrigger) {
                        userMenuTrigger.classList.remove('hidden');
                        userMenuTrigger.style.display = 'inline-flex';
                    }

                    if (currentUserRole === 'admin' || currentUserRole === 'super_admin') {
                        document.getElementById('btn-admin').classList.remove('hidden');
                        if (sidebarAdminItem) sidebarAdminItem.classList.remove('hidden');
                    }

                    if (data.devSkipAuth) {
                        const devBadge = document.getElementById('dev-mode-badge');
                        if (devBadge) devBadge.classList.remove('hidden');
                    }

                    // --- AUTO-CONNECT LOGIC ---
                    // Ưu tiên: defaultTikTokId (từ Settings) nếu autoConnectEnabled = true
                    // Fallback: lastBroadcasterId (phiên cuối)
                    const scopedDefaultKey = getScopedStorageKey('defaultTikTokId');
                    const scopedAutoKey = getScopedStorageKey('autoConnectEnabled');
                    const scopedLastBroadcasterKey = getScopedStorageKey('lastBroadcasterId');

                    const defaultTikTokId = scopedDefaultKey ? (localStorage.getItem(scopedDefaultKey) || '').trim() : '';
                    const autoConnectEnabled = scopedAutoKey ? localStorage.getItem(scopedAutoKey) === 'true' : false;
                    const lastBroadcasterId = scopedLastBroadcasterKey ? (localStorage.getItem(scopedLastBroadcasterKey) || '').trim() : '';

                    // Chọn ID để kết nối
                    let idToConnect = '';
                    if (autoConnectEnabled && defaultTikTokId) {
                        // Dùng ID mặc định đã set trong Settings
                        idToConnect = defaultTikTokId;
                    } else if (lastBroadcasterId) {
                        // Fallback: phiên cuối cùng
                        idToConnect = lastBroadcasterId;
                    }

                    if (idToConnect) {
                        if (tiktokIdInput) tiktokIdInput.value = idToConnect;
                        activeBroadcasterId = idToConnect;
                        
                        const sessionKey = getScopedStorageKey('activeSessionId');
                        const storedSessionId = sessionKey ? localStorage.getItem(sessionKey) : null;
                        socket.emit('start-live', {
                            uniqueId: idToConnect,
                            sessionId: storedSessionId
                        });

                        // Tự chuyển sang tab Live nếu auto-connect
                        if (autoConnectEnabled && defaultTikTokId) {
                            setTimeout(() => switchView('live'), 300);
                        }
                    }
                } else {
                    clearRealtimeUi();
                    window.location.href = '/login';
                }
            } catch (e) {
                console.warn('Could not load user info:', e);
                clearRealtimeUi();
            }
            calculateKpis();
            renderEmptyCommentState();
        })();

        // --- LẮNG NGHE SESSION INFO TỪ SERVER ---
        socket.on('session-info', (data) => {
            activeBroadcasterId = data.broadcasterId;
            const sessionKey = getScopedStorageKey('activeSessionId');
            const broadcasterKey = getScopedStorageKey('lastBroadcasterId');
            if (sessionKey) localStorage.setItem(sessionKey, data.sessionId);
            if (broadcasterKey) localStorage.setItem(broadcasterKey, data.broadcasterId);

            if (data.isContinuation) {
                showLiveToast(currentLang === 'en' ? '🔄 Resumed previous live session' : '🔄 Đã kết nối lại phiên live trước', 'success');
            }
        });

        // --- AUTO-SAVE KHI LIVE KẾT THÚC ---
        socket.on('live-ended', async (data) => {
            const broadcasterId = data?.broadcasterId || activeBroadcasterId || '';
            const msg = currentLang === 'en' ? t('live.liveEnded') : 'Khách đã xuống live. Đang tự động lưu phiên...';
            showLiveToast(msg, 'info');

            // Xoá Session ID khỏi localStorage nếu server thông báo kết thúc hẳn
            if (data?.clearSession) {
                const sessionKey = getScopedStorageKey('activeSessionId');
                if (sessionKey) localStorage.removeItem(sessionKey);
            }

            // Cập nhật UI trạng thái
            const kpiStatusEl = document.getElementById('kpi-status');
            if (kpiStatusEl) {
                kpiStatusEl.textContent = currentLang === 'en' ? 'Live ended' : 'Live đã kết thúc';
                kpiStatusEl.className = 'text-base font-bold mt-3 text-amber-500';
            }
            if (pageLiveStatus) {
                pageLiveStatus.classList.add('is-offline');
                pageLiveStatus.lastChild.textContent = ' Disconnected';
            }

            // Auto-save nếu có đơn
            if (Object.keys(ordersData).length > 0) {
                await autoSaveCurrentSession(broadcasterId);
            }
        });

        // Auto-save không cần prompt
        async function autoSaveCurrentSession(broadcasterId) {
            const tiktokId = broadcasterId || (tiktokIdInput ? tiktokIdInput.value.trim().replace('@', '') : '') || activeBroadcasterId || '';
            const now = new Date();
            const liveName = `Live ${tiktokId ? '@' + tiktokId + ' ' : ''}${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} (tự động)`;
            try {
                const res = await fetch('/api/live-sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        liveName,
                        tiktokUsername: tiktokId,
                        startedAt: now.toISOString(),
                        endedAt: now.toISOString(),
                        orders: ordersData
                    })
                });
                const result = await res.json();
                if (result.success) {
                    showLiveToast(
                        (currentLang === 'en' ? '✅ ' + t('live.autoSaved') : '✅ Phiên live đã được tự động lưu: ') + liveName,
                        'success'
                    );
                    refreshOverviewTopShops?.();
                }
            } catch (e) {
                console.warn('Auto-save session error:', e);
            }
        }

        // Toast thông báo nhẹ (không block UI)
        function showLiveToast(message, type = 'info') {
            const existing = document.getElementById('live-toast-bar');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.id = 'live-toast-bar';
            const colors = { success: '#16a34a', info: '#2563eb', warning: '#d97706', error: '#dc2626' };
            toast.style.cssText = `
                position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
                z-index: 9999; background: ${colors[type] || colors.info};
                color: #fff; padding: 10px 20px; border-radius: 12px;
                font-size: 13px; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
                max-width: 90vw; text-align: center; pointer-events: none;
                animation: fadeInDown 0.3s ease;
            `;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s';
                setTimeout(() => toast.remove(), 300);
            }, 5000);
        }

        let selectedSessionIds = new Set();
        let lastMergeData = null;
        let lastMergeSourceIds = [];
        let lastExportSessionIds = [];

        window.saveCurrentSession = async () => {
            if (Object.keys(ordersData).length === 0) {
                return alert(currentLang === 'en' ? 'No orders to save yet!' : 'Chưa có đơn hàng nào để lưu!');
            }
            const tiktokId = activeBroadcasterId || (tiktokIdInput ? tiktokIdInput.value.trim().replace('@', '') : '') || '';
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
            document.getElementById('live-sessions-list').innerHTML = '<p class="text-center text-gray-400 py-10">Loading...</p>';
            document.getElementById('btn-merge').classList.add('hidden');
            document.getElementById('btn-export-selected').classList.add('hidden');
            document.getElementById('merge-count').textContent = '0';
            document.getElementById('live-sessions-modal').classList.remove('hidden');
            try {
                const res = await fetch('/api/live-sessions');
                if (!res.ok) {
                    const status = res.status;
                    let text = 'Lỗi không xác định';
                    try { const err = await res.json(); text = err.error || text; } catch (_) {}
                    document.getElementById('live-sessions-list').innerHTML = `<p class="text-center text-red-400 py-10">Load error (${status}): ${text}</p>`;
                    return;
                }
                const data = await res.json();
                const sessions = Array.isArray(data.sessions) ? data.sessions : [];
                if (sessions.length === 0) {
                    document.getElementById('live-sessions-list').innerHTML = `<p class="text-center text-gray-400 py-10">Chưa có phiên live nào.</p>`;
                } else {
                    renderLiveSessionsList(sessions);
                }
            } catch (e) {
                document.getElementById('live-sessions-list').innerHTML = `<p class="text-center text-red-400 py-10">Load error: ${e.message}</p>`;
            }
        };

        window.closeLiveSessions = () => document.getElementById('live-sessions-modal').classList.add('hidden');

        function updateMergeBtn() {
            const btn = document.getElementById('btn-merge');
            const exportBtn = document.getElementById('btn-export-selected');
            const count = document.getElementById('merge-count');
            if (selectedSessionIds.size > 0) {
                btn.classList.remove('hidden');
                exportBtn.classList.remove('hidden');
                count.textContent = selectedSessionIds.size;
            } else {
                btn.classList.add('hidden');
                exportBtn.classList.add('hidden');
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
                const ownerDisplay = s.ownerUserId
                    ? (s.ownerUserId === currentUserUid
                        ? (currentLang === 'en' ? 'Mine' : 'Của tôi')
                        : s.ownerUserId)
                    : '';
                const ownerLabel = s.ownerUserId
                    ? (s.ownerUserId === currentUserUid
                        ? ownerDisplay
                        : `User: ${ownerDisplay}`)
                    : '';
                const ownerBadge = ownerLabel
                    ? `<span class="inline-block mt-1 max-w-[220px] truncate rounded bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500 align-middle" title="${escapeHtml(ownerLabel)}">${escapeHtml(ownerLabel)}</span>`
                    : '';
                const userLabel = s.tiktokUsername ? `@${s.tiktokUsername}` : (ownerDisplay || s.liveName || '');
                const openLabel = currentLang === 'en' ? 'OPEN' : 'MỞ';
                const safeSessionId = escapeJsString(s.id);
                const safeSessionName = escapeJsString(s.liveName);
                const safeFileName = escapeJsString(s.fileName || '');
                const canOpenLegacy = isLegacy && (!s.ownerUserId || s.ownerUserId === currentUserUid || s.userId === 'shared-admin-legacy');
                const actionButtons = isLegacy
                    ? canOpenLegacy ? `
                        <button onclick="openLegacyHistorySession('${safeFileName}')" class="text-blue-600 px-2 py-1 bg-blue-50 rounded text-xs font-bold">${openLabel}</button>
                        <button onclick="loadSessionOrdersToCurrentView('${safeSessionId}')" class="text-white px-3 py-1 bg-red-500 rounded text-xs font-bold">Load đơn</button>
                        <button onclick="deleteSession('${safeSessionId}', '${safeSessionName}')" class="text-red-600 px-2 py-1 bg-red-50 rounded text-xs font-bold">XOA</button>
                    ` : `
                        <button onclick="loadSessionOrdersToCurrentView('${safeSessionId}')" class="text-white px-3 py-1 bg-red-500 rounded text-xs font-bold">Load đơn</button>
                        <button onclick="deleteSession('${safeSessionId}', '${safeSessionName}')" class="text-red-600 px-2 py-1 bg-red-50 rounded text-xs font-bold">XOA</button>
                    `
                    : `
                        <button onclick="loadSessionOrdersToCurrentView('${safeSessionId}')" class="text-white px-3 py-1 bg-red-500 rounded text-xs font-bold">Load đơn</button>
                        <button onclick="deleteSession('${safeSessionId}', '${safeSessionName}')" class="text-red-600 px-2 py-1 bg-red-50 rounded text-xs font-bold">XOA</button>
                    `;
                return `
                <div class="flex items-start gap-3 p-3 border rounded-lg hover:bg-purple-50 transition group">
                    <input type="checkbox" id="cb-${escapeHtml(s.id)}" class="mt-1 accent-purple-600 w-4 h-4 cursor-pointer" onchange="toggleSessionSelect('${safeSessionId}')" ${selectedSessionIds.has(s.id) ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start">
                            <div>
                                <p class="font-bold text-gray-800 text-sm">${escapeHtml(s.liveName)}</p>
                                <p class="text-[10px] text-gray-400">${date}${s.tiktokUsername ? ' • @' + escapeHtml(s.tiktokUsername) : ''}</p>
                                <div class="mt-2 flex flex-wrap gap-1 text-[10px]">
                                    <span class="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-600">User: ${escapeHtml(userLabel)}</span>
                                    <span class="rounded bg-blue-50 px-2 py-0.5 font-bold text-blue-600">${orders} đơn</span>
                                    <span class="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">Tổng: ${revenue}</span>
                                </div>
                                ${ownerBadge}
                            </div>
                            <div class="text-right">
                                <span class="text-xs font-bold text-red-500">${revenue}</span>
                                <p class="text-[9px] text-gray-400">${orders} orders • ${qty} qty</p>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-wrap justify-end gap-1 opacity-100 transition">
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
                const res = await fetch('/api/live-sessions/' + encodeURIComponent(sessionId));
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
                lastExportSessionIds = [s.id];
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
                lastExportSessionIds = sourceIds;
                renderMergeResults(data, `Merge ${data.summary.totalSessions} sessions`);
                document.getElementById('merge-modal').classList.remove('hidden');
            } catch (e) { alert('Error: ' + e.message); }
        };

        window.closeMergeModal = () => document.getElementById('merge-modal').classList.add('hidden');

        window.loadMergedSessionToView = () => {
            if (!lastMergeData || !lastMergeData.savedSessionId) return;
            loadSessionOrdersToCurrentView(lastMergeData.savedSessionId);
            closeMergeModal();
        };

        function renderMergeResults(data) {
            const s = data.summary;
            const container = document.getElementById('merge-results-content');
            const saveBtn = document.getElementById('btn-save-merged');
            const loadBtn = document.getElementById('btn-load-merged');
            const saveStatus = document.getElementById('merge-save-status');
            
            if (saveBtn) saveBtn.classList.toggle('hidden', lastMergeSourceIds.length === 0 || Boolean(data.savedSessionId));
            if (loadBtn) loadBtn.classList.toggle('hidden', !Boolean(data.savedSessionId));
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
                    const customerLabel = buildCustomerLabel(c.customerName || '', c.customerUsername || '');
                    html += `<tr class="hover:bg-gray-50"><td class="p-2 border customer-display-name" title="${escapeHtml(customerLabel)}">${escapeHtml(customerLabel)}</td><td class="p-2 border text-center">${c.orders.length}</td><td class="p-2 border text-right font-bold text-red-500"><span>${formatMoney(c.total)}</span><button onclick="printMergeCustomerDetails(${idx})" class="ml-2 px-2 py-1 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">${detailLabel}</button></td></tr>`;
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
                        customerName: getDisplayName(order.customerName || order.nickname || '', order.customerUsername || order.tiktokUsername || ''),
                        customerUsername: normalizeTikTokUsername(order.customerUsername || order.tiktokUsername || ''),
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
                const loadBtn = document.getElementById('btn-load-merged');
                const saveStatus = document.getElementById('merge-save-status');
                if (saveBtn) saveBtn.classList.add('hidden');
                if (loadBtn) loadBtn.classList.remove('hidden');
                if (saveStatus) saveStatus.textContent = t('merge.saved');
                refreshOverviewData(false);
            } catch (e) {
                alert('Save error: ' + e.message);
            }
        };

        function parseFilenameFromDisposition(disposition) {
            const match = String(disposition || '').match(/filename="?([^";]+)"?/i);
            return match ? match[1] : `delivery-orders-${Date.now()}.xlsx`;
        }

        function decodeMissingCustomers(headerValue) {
            if (!headerValue) return [];
            try {
                const bytes = Uint8Array.from(atob(headerValue), char => char.charCodeAt(0));
                return JSON.parse(new TextDecoder('utf-8').decode(bytes));
            } catch (error) {
                console.warn('Could not decode missing customers header:', error);
                return [];
            }
        }

        async function downloadDeliveryExcel(payload) {
            const res = await fetch('/api/orders/export-delivery-excel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const contentType = res.headers.get('Content-Type') || '';
                const data = contentType.includes('application/json') ? await res.json() : { error: await res.text() };
                throw new Error(data.error || 'Export Excel error');
            }

            const blob = await res.blob();
            const filename = parseFilenameFromDisposition(res.headers.get('Content-Disposition'));
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            const missingCustomers = decodeMissingCustomers(res.headers.get('X-Missing-Customers'));
            if (missingCustomers.length > 0) {
                showDeliveryWarnings(missingCustomers);
            }
        }

        window.exportSelectedSessionsExcel = async () => {
            if (selectedSessionIds.size === 0) return alert('Chưa chọn phiên live.');
            try {
                const sourceIds = Array.from(selectedSessionIds);
                const res = await fetch('/api/live-sessions/merge-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionIds: sourceIds })
                });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error || 'Không lấy được đơn từ phiên đã chọn');
                await downloadDeliveryExcel({ orders: data.mergedOrders || [] });
            } catch (error) {
                alert('Lỗi xuất Excel: ' + error.message);
            }
        };

        window.exportMergedExcel = async () => {
            if (!lastMergeData) return alert('Chưa có dữ liệu để xuất.');
            try {
                const orders = Array.isArray(lastMergeData.mergedOrders) ? lastMergeData.mergedOrders : [];
                if (orders.length > 0) {
                    await downloadDeliveryExcel({ orders });
                    return;
                }
                await downloadDeliveryExcel({ sessionIds: lastExportSessionIds });
            } catch (error) {
                alert('Lỗi xuất Excel: ' + error.message);
            }
        };

        function showDeliveryWarnings(missingCustomers) {
            const modal = document.getElementById('delivery-warning-modal');
            const list = document.getElementById('delivery-warning-list');
            const labels = {
                phone: 'Số điện thoại',
                province: 'Tỉnh/Thành phố',
                district: 'Quận/Huyện',
                ward: 'Xã/Phường',
                addressDetail: 'Địa chỉ chi tiết'
            };
            list.innerHTML = `
                <p class="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">File đã được xuất, nhưng các khách dưới đây thiếu thông tin bắt buộc. Hãy bổ sung trong tab Khách hàng trước lần xuất tiếp theo.</p>
                ${missingCustomers.map(customer => `
                    <div class="border rounded-xl p-3">
                        <p class="font-bold text-sm customer-display-name" title="${escapeHtml(buildCustomerLabel(customer.customerName || '', customer.customerUsername || ''))}">${escapeHtml(buildCustomerLabel(customer.customerName || '', customer.customerUsername || ''))}</p>
                        <p class="text-xs text-gray-500 mt-1">Thiếu: ${(customer.missingFields || []).map(field => labels[field] || field).join(', ')}</p>
                    </div>
                `).join('')}
            `;
            modal.classList.remove('hidden');
        }

        window.closeDeliveryWarnings = () => {
            document.getElementById('delivery-warning-modal').classList.add('hidden');
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
                html += `<span>${escapeHtml(buildCustomerLabel(c.customerName || '', c.customerUsername || ''))}<br>${c.orders.length} don</span>`;
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
                html += `<div style="font-weight:bold; font-size:15px;">${escapeHtml(buildCustomerLabel(c.customerName || '', c.customerUsername || ''))}</div>`;
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
            html += `<div style="font-weight:bold; font-size:17px; margin-bottom:4px;">${escapeHtml(getDisplayName(customer.customerName || '', customer.customerUsername || ''))}</div>`;
            if (customer.customerUsername) {
                html += `<div style="font-size:12px; margin-bottom:8px;">${escapeHtml(formatTikTokUsername(customer.customerUsername))}</div>`;
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
