        const socket = io();
        socket.on('connect', () => {
            const sessionKey = getScopedStorageKey('activeSessionId');
            const activeSessionId = sessionKey ? localStorage.getItem(sessionKey) : null;
            if (activeSessionId) {
                socket.emit('restore-live-session', { sessionId: activeSessionId });
            }
        });
        document.body.classList.add('live-disconnected');
        const chatFeed = document.getElementById('chat-feed');
        const tiktokIdInput = document.getElementById('default-tiktok-id');
        const btnConnect = document.getElementById('btn-connect');
        const statusMsg = document.getElementById('status-msg');
        const printerIpInput = document.getElementById('printer-ip');
        const printerTypeSelect = document.getElementById('printer-type');
        const printerHintEl = document.getElementById('printer-hint');
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
        const sectionDelivery = document.getElementById('section-delivery');
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
        let currentCustomerFilter = 'all';
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
        let liveOrdersData = {}; // Cách ly dữ liệu chốt đơn live stream
        let customersData = [];
        let kpiComments = 0;
        let currentLang = localStorage.getItem('app_lang') || 'vi';
        let topShopStats = [];
        let overviewData = null;
        let overviewComparison = null;
        let overviewRefreshTimer = null;
        let customerSearchTimer = null;
        let activeBroadcasterId = '';
        let activeLoadedSessionId = null; // Session đang được chỉnh sửa từ lịch sử
        let currentUserUid = '';
        let currentUserRole = 'user';
        let currentView = 'overview';
        const seenChatMsgIds = new Set();
        const confirmedMsgIds = new Set(); // Set msgId đã in/chốt — track theo comment, không theo username
        let mobilePopoverEl = null;
        let mobilePopoverHideTimer = null;

        const i18n = {
            vi: {
                'menu.overview': 'Tổng quan',
                'menu.live': 'Live',
                'menu.orders': 'Đơn hàng',
                'menu.delivery': 'Đi Đơn',
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
                'settings.defaultTiktokIdDesc': 'ID sẽ tự động dùng khi kết nối TikTok Live.',
                'settings.autoConnect': 'Tự động kết nối khi đăng nhập',
                'settings.defaultsLabel': 'Thiết lập mặc định',
                'settings.statusLabel': 'Trạng thái & Kiểm tra',
                'settings.tiktokStatusLabel': 'TikTok Live',
                'settings.tiktokStatusDesc': 'Trạng thái kết nối hiện tại',
                'settings.printerLabel': 'Máy in hóa đơn',
                'settings.printerTestDesc': 'Kiểm tra kết nối máy in',
                'settings.connectBtn': '⚡ Kết nối ngay',
                'settings.testPrinterBtn': 'Test máy in',
                'settings.defaultTiktokIdPlaceholder': 'Nhập @username hoặc ID TikTok...',
                'settings.apiKeyPlaceholder': 'Nhập API key tại đây...',
                'settings.apiKeyToggleTitle': 'Hiện/Ẩn API key',
                'settings.languageAriaLabel': 'Ngôn ngữ hiển thị',
                'settings.backupScopeAriaLabel': 'Phạm vi sao lưu',
                'live.autoSaved': 'Phiên live đã được tự động lưu',
                'live.liveEnded': 'Khách đã xuống live. Đang lưu phiên...',
                'actions.printSummary': 'In tổng kết',
                'settings.title': 'Cấu hình hệ thống',
                'settings.subtitle': 'Quản lý tùy chọn kết nối, hiển thị và dữ liệu của bạn.',
                'settings.languageTitle': 'Ngôn ngữ hiển thị',
                'settings.languageDesc': 'Chọn ngôn ngữ giao diện cho ứng dụng.',
                'settings.integrationTitle': 'Kết nối & Tích hợp',
                'settings.integrationDesc': 'Cấu hình TikTok Live, máy in và API.',
                'settings.printer': 'Máy in hóa đơn',
                'settings.printerDesc': 'Địa chỉ IP, cổng thiết bị, hoặc tên máy in hệ thống.',
                'settings.printerType': 'Loại kết nối máy in',
                'settings.printerTypeDesc': 'Chọn TCP (Wi‑Fi/LAN), USB/cổng trực tiếp, hoặc máy in hệ thống.',
                'settings.apiKey': 'TikTok Sign API Key',
                'settings.apiKeyDesc': 'Khóa bảo mật đồng bộ với hệ thống TikTok.',
                'settings.save': 'Lưu cấu hình hệ thống',
                'settings.appearanceTitle': 'Giao diện',
                'settings.appearanceDesc': 'Chọn chế độ sáng hoặc tối cho toàn bộ ứng dụng.',
                'settings.lightMode': 'Chế độ sáng',
                'settings.darkMode': 'Chế độ tối',
                'settings.systemStatus': 'Trạng thái hệ thống',
                'settings.systemStatusDesc': 'Thông tin hoạt động của hệ thống.',
                'settings.sysVersion': 'Phiên bản',
                'settings.sysPrinter': 'Máy in',
                'settings.sysTikTok': 'TikTok Live',
                'settings.sysBackup': 'Backup gần nhất',
                'settings.logout': 'Đăng xuất',
                'sidebar.collapse': 'Thu gọn',
                'sidebar.expand': 'Mở rộng',
                'backup.title': 'Quản lý dữ liệu',
                'backup.desc': 'Sao lưu và xuất dữ liệu tài khoản hiện tại.',
                'backup.mine': 'Dữ liệu tài khoản hiện tại',
                'backup.all': 'Toàn bộ dữ liệu (Admin)',
                'backup.exportExcel': 'Xuất Excel',
                'backup.exportCsv': 'Xuất CSV',
                'backup.exportJson': 'Xuất JSON',
                'backup.excelDesc': 'Dễ xem, trình bày bảng',
                'backup.csvDesc': 'Xử lý bằng Excel / Google Sheets',
                'backup.jsonDesc': 'Backup kỹ thuật, có thể import lại',
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
                'ov.customerRetentionTitle': 'Khách mới vs Khách quay lại',
                'ov.customerRetentionDesc': 'Khách mới là người có đơn đầu tiên trong kỳ này. Khách quay lại là người đã mua trước đó và tiếp tục phát sinh đơn trong kỳ.',
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
                'menu.delivery': 'Shipping',
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
                'settings.defaultTiktokIdDesc': 'ID used to auto-connect on TikTok Live.',
                'settings.autoConnect': 'Auto-connect on login',
                'settings.defaultsLabel': 'Default settings',
                'settings.statusLabel': 'Status & Testing',
                'settings.tiktokStatusLabel': 'TikTok Live',
                'settings.tiktokStatusDesc': 'Current connection status',
                'settings.printerLabel': 'Invoice printer',
                'settings.printerTestDesc': 'Check printer connection',
                'settings.connectBtn': '⚡ Connect now',
                'settings.testPrinterBtn': 'Test printer',
                'settings.defaultTiktokIdPlaceholder': 'Enter @username or TikTok ID...',
                'settings.apiKeyPlaceholder': 'Enter API key here...',
                'settings.apiKeyToggleTitle': 'Show/Hide API key',
                'settings.languageAriaLabel': 'Display language',
                'settings.backupScopeAriaLabel': 'Backup scope',
                'live.autoSaved': 'Live session was auto-saved',
                'live.liveEnded': 'Host ended the live. Saving session...',
                'actions.printSummary': 'Print Summary',
                'settings.title': 'System Settings',
                'settings.subtitle': 'Manage your connection, display and data preferences.',
                'settings.languageTitle': 'Display language',
                'settings.languageDesc': 'Choose the app interface language.',
                'settings.integrationTitle': 'Connections & Integrations',
                'settings.integrationDesc': 'Configure TikTok Live, printer and API.',
                'settings.printer': 'Invoice printer',
                'settings.printerDesc': 'IP address, device port, or system printer name.',
                'settings.printerType': 'Printer connection type',
                'settings.printerTypeDesc': 'Choose TCP (Wi‑Fi/LAN), USB/direct port, or system printer.',
                'settings.apiKey': 'TikTok Sign API Key',
                'settings.apiKeyDesc': 'Security key to sync with TikTok services.',
                'settings.save': 'Save system configuration',
                'settings.appearanceTitle': 'Appearance',
                'settings.appearanceDesc': 'Choose light or dark mode for the whole app.',
                'settings.lightMode': 'Light mode',
                'settings.darkMode': 'Dark mode',
                'settings.systemStatus': 'System status',
                'settings.systemStatusDesc': 'Current system information.',
                'settings.sysVersion': 'Version',
                'settings.sysPrinter': 'Printer',
                'settings.sysTikTok': 'TikTok Live',
                'settings.sysBackup': 'Last backup',
                'settings.logout': 'Logout',
                'sidebar.collapse': 'Collapse',
                'sidebar.expand': 'Expand',
                'backup.title': 'Data management',
                'backup.desc': 'Export current account data.',
                'backup.mine': 'Current account data',
                'backup.all': 'All data (Admin)',
                'backup.exportExcel': 'Export Excel',
                'backup.exportCsv': 'Export CSV',
                'backup.exportJson': 'Export JSON',
                'backup.excelDesc': 'Easy to view, formatted table',
                'backup.csvDesc': 'Open with Excel / Google Sheets',
                'backup.jsonDesc': 'Technical backup, re-importable',
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
                'ov.customerRetentionTitle': 'New vs Returning Customers',
                'ov.customerRetentionDesc': 'New customers placed their first order in this period. Returning customers had ordered before and purchased again in this period.',
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
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                el.setAttribute('placeholder', t(key));
            });
            document.querySelectorAll('[data-i18n-title]').forEach(el => {
                const key = el.getAttribute('data-i18n-title');
                el.setAttribute('title', t(key));
            });
            document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
                const key = el.getAttribute('data-i18n-aria-label');
                el.setAttribute('aria-label', t(key));
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
            if (currentView === 'settings') {
                loadSettingsUI();
            }
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
            
            // Submenu collapse/expand handler
            const setupGroupToggle = (toggleId, submenuId) => {
                const groupToggleBtn = document.getElementById(toggleId);
                const submenu = document.getElementById(submenuId);
                if (groupToggleBtn && submenu) {
                    groupToggleBtn.classList.add('open');
                    groupToggleBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (appShell && appShell.dataset.sidebarCollapsed === 'true') {
                            setSidebarCollapsed(false);
                            submenu.classList.remove('collapsed');
                            groupToggleBtn.classList.add('open');
                            groupToggleBtn.setAttribute('aria-expanded', 'true');
                            return;
                        }
                        const isCollapsed = submenu.classList.toggle('collapsed');
                        groupToggleBtn.classList.toggle('open', !isCollapsed);
                        groupToggleBtn.setAttribute('aria-expanded', !isCollapsed ? 'true' : 'false');
                    });
                }
            };

            setupGroupToggle('menu-orders-group-toggle', 'menu-orders-submenu');
            setupGroupToggle('menu-settings-group-toggle', 'menu-settings-submenu');

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

        function getLiveOrdersTotals() {
            let totalOrders = 0;
            let totalRevenue = 0;
            const totalCustomers = Object.keys(liveOrdersData || {}).length;
            Object.values(liveOrdersData || {}).forEach(o => {
                totalOrders += Array.isArray(o.items) ? o.items.length : 0;
                totalRevenue += Number(o.total || 0);
            });
            return { totalCustomers, totalOrders, totalRevenue };
        }

        function getManualOrdersTotals() {
            let totalOrders = 0;
            let totalRevenue = 0;
            const totalCustomers = Object.keys(ordersData || {}).length;
            Object.values(ordersData || {}).forEach(o => {
                totalOrders += Array.isArray(o.items) ? o.items.length : 0;
                totalRevenue += Number(o.total || 0);
            });
            return { totalCustomers, totalOrders, totalRevenue };
        }

        function updateLiveKpiCounters() {
            const { totalCustomers, totalOrders, totalRevenue } = getLiveOrdersTotals();
            const kpiOrdersEl = document.getElementById('kpi-orders');
            const kpiRevenueEl = document.getElementById('kpi-revenue');
            if (kpiOrdersEl) kpiOrdersEl.textContent = totalOrders;
            if (kpiRevenueEl) kpiRevenueEl.textContent = formatMoney(totalRevenue);
            
            const panel = document.getElementById('live-current-orders-panel');
            const count = panel?.querySelector('[data-current-orders-count]');
            if (count) {
                const customerText = currentLang === 'en' ? `${totalCustomers} customers` : `${totalCustomers} khách`;
                const orderText = currentLang === 'en' ? `${totalOrders} orders` : `${totalOrders} đơn`;
                count.textContent = `${customerText} · ${orderText} · ${formatMoney(totalRevenue)}`;
            }
        }

        function updateManualKpiCounters() {
            const { totalCustomers, totalOrders, totalRevenue } = getManualOrdersTotals();
            const panel = document.getElementById('section-current-orders');
            const count = panel?.querySelector('[data-current-orders-count]');
            if (count) {
                const customerText = currentLang === 'en' ? `${totalCustomers} customers` : `${totalCustomers} khách`;
                const orderText = currentLang === 'en' ? `${totalOrders} orders` : `${totalOrders} đơn`;
                count.textContent = `${customerText} · ${orderText} · ${formatMoney(totalRevenue)}`;
            }
        }

        function calculateKpis() {
            // Live stats KPIs
            updateLiveKpiCounters();
            
            const kpiCommentsEl = document.getElementById('kpi-comments');
            if (kpiCommentsEl) kpiCommentsEl.textContent = kpiComments;
            
            const commentCount = chatFeed.querySelectorAll('[data-chat-row="1"]').length;
            const chatCountEl = document.getElementById('chat-count');
            if (chatCountEl) chatCountEl.textContent = `${commentCount} items`;
            
            // Re-render grids
            renderLiveCurrentOrders();
            renderManualCurrentOrders();
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

        // ─── Bước 2: Tạo HTML cho 1 item row (dùng chung cho card build và patch) ─────
        function buildItemRowHtml(item, usernameArg) {
            const itemIdArg = escapeHtml(JSON.stringify(item.id ?? null));
            const itemTextArg = escapeHtml(JSON.stringify(normalizeDisplayText(item.text || item.productName || '')));
            const price = Number(item.price || 0);
            const safeItemId = escapeHtml(String(item.id ?? ''));
            const isPrinted = Boolean(item.printed || item.printedAt);
            const printedClass = isPrinted ? ' is-printed' : '';
            const printBtnTitle = isPrinted 
                ? (currentLang === 'en' ? 'Already printed (Click to reprint)' : 'Đã in đơn (Bấm để in lại)') 
                : (currentLang === 'en' ? 'Print item' : 'In dòng này');
            return `
                <div class="live-order-item live-order-comment-row${printedClass}" data-item-id="${safeItemId}">
                    <div class="live-order-comment-main">
                        <strong>${escapeHtml(normalizeDisplayText(item.text || item.productName || 'Sản phẩm'))}</strong>
                        <span>${escapeHtml(normalizeDisplayText(item.time || 'Vừa chốt'))}</span>
                    </div>
                    <strong class="live-order-comment-price">${formatMoney(price)}</strong>
                    <div class="live-order-item-actions">
                        <button type="button" class="icon-btn${isPrinted ? ' btn-printed' : ''}" title="${escapeHtml(printBtnTitle)}" onclick="reprintItem(${usernameArg}, ${itemIdArg})"><span class="material-symbols-outlined">print</span></button>
                        <button type="button" class="icon-btn" title="Sửa bình luận" onclick="editItem(${usernameArg}, ${itemIdArg}, ${itemTextArg}, ${price})"><span class="material-symbols-outlined">edit</span></button>
                        <button type="button" class="icon-btn danger" title="Xóa bình luận" onclick="deleteItem(${usernameArg}, ${itemIdArg})"><span class="material-symbols-outlined">delete</span></button>
                    </div>
                </div>
            `;
        }

        // ─── Bước 2: Tách buildOrderCardHtml ra khỏi renderCurrentOrders ────────────
        function buildOrderCardHtml(order) {
            const items = Array.isArray(order.items) ? order.items : [];
            const username = normalizeTikTokUsername(order.username || order.customerUsername || '');
            const usernameArg = escapeHtml(JSON.stringify(username));
            const customerName = getDisplayName(order.nickname || order.displayName || '', username);
            const customerLabel = buildCustomerLabel(order.nickname || order.displayName || '', username);
            const handle = formatTikTokUsername(username);
            const total = Number(order.total || items.reduce((sum, item) => sum + Number(item.price || 0), 0));
            const avatarSrc = isAvatarUrl(order.profilePictureUrl) ? order.profilePictureUrl : buildInitialAvatarDataUri(customerLabel);
            const itemRows = items.map(item => buildItemRowHtml(item, usernameArg)).join('');
            const isChecked = (window.selectedOrderUsernames && window.selectedOrderUsernames.has(username)) ? 'checked' : '';
            const allPrinted = items.length > 0 && items.every(i => i.printed || i.printedAt);
            const cardPrintedClass = allPrinted ? ' is-card-printed' : '';

            return `
                <article class="live-order-card${cardPrintedClass}" data-username="${escapeHtml(username)}">
                    <div class="live-order-card-head">
                        <div class="flex items-center gap-2 mr-1">
                            <input type="checkbox" class="order-select-checkbox rounded border-gray-300 dark:border-zinc-700 text-red-600 focus:ring-red-500 cursor-pointer" 
                                   data-username="${escapeHtml(username)}" ${isChecked} 
                                   onclick="toggleOrderSelect(event, ${usernameArg})">
                        </div>
                        <img src="${escapeHtml(avatarSrc)}" alt="">
                        <div class="min-w-0 flex-1">
                            <h4 class="truncate">${escapeHtml(customerName)}</h4>
                            <p class="truncate">${escapeHtml(handle || username)}</p>
                        </div>
                        <div class="live-order-card-actions shrink-0">
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
                        <button type="button" class="${allPrinted ? 'btn-printed-total' : ''}" onclick="reprintTotal(${usernameArg})">${allPrinted ? (currentLang === 'en' ? 'Reprint total' : 'In lại tổng') : (currentLang === 'en' ? 'Print total' : 'In tổng')}</button>
                    </div>
                </article>
            `;
        }

        // ─── Bước 3: Patch đúng 1 card trong live workspace ──────────────────
        function patchLiveOrderCard(username) {
            const order = liveOrdersData[username];
            const grid = document.querySelector('#live-current-orders-panel [data-current-orders-grid]');
            const panel = document.getElementById('live-current-orders-panel');
            if (!grid) return;

            const existingCard = grid.querySelector(`[data-username="${CSS.escape(username)}"]`);

            if (!order) {
                existingCard?.remove();
            } else if (existingCard) {
                const tmp = document.createElement('div');
                tmp.innerHTML = buildOrderCardHtml(order);
                const newCard = tmp.firstElementChild;
                grid.replaceChild(newCard, existingCard);
            } else {
                grid.insertAdjacentHTML('beforeend', buildOrderCardHtml(order));
            }

            if (panel) {
                const empty = panel.querySelector('[data-current-orders-empty]');
                const hasCards = grid.querySelector('[data-username]');
                if (empty) {
                    empty.hidden = !!hasCards;
                    empty.classList.toggle('hidden', !!hasCards);
                }
            }

            updateLiveKpiCounters();
            updateLiveOrdersToggleLabel();
        }

        // ─── Bước 3 (Manual): Patch đúng 1 card trong manual workspace ──────────────────
        function patchManualOrderCard(username) {
            const order = ordersData[username];
            const grid = document.querySelector('#section-current-orders [data-current-orders-grid]');
            const panel = document.getElementById('section-current-orders');
            if (!grid) return;

            const existingCard = grid.querySelector(`[data-username="${CSS.escape(username)}"]`);

            if (!order) {
                existingCard?.remove();
            } else if (existingCard) {
                const tmp = document.createElement('div');
                tmp.innerHTML = buildOrderCardHtml(order);
                const newCard = tmp.firstElementChild;
                grid.replaceChild(newCard, existingCard);
            } else {
                grid.insertAdjacentHTML('beforeend', buildOrderCardHtml(order));
            }

            if (panel) {
                const empty = panel.querySelector('[data-current-orders-empty]');
                const hasCards = grid.querySelector('[data-username]');
                if (empty) {
                    empty.hidden = !!hasCards;
                    empty.classList.toggle('hidden', !!hasCards);
                }
            }

            updateManualKpiCounters();
        }

        // ─── Bước 1 (Manual): renderManualCurrentOrders ─
        function renderManualCurrentOrders() {
            const grid = document.querySelector('#section-current-orders [data-current-orders-grid]');
            const empty = document.querySelector('#section-current-orders [data-current-orders-empty]');
            
            const orders = Object.values(ordersData || {})
                .map(order => ({
                    ...order,
                    username: normalizeTikTokUsername(order.username || order.customerUsername || '')
                }))
                .filter(order => order.username);

            updateManualKpiCounters();
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
            grid.innerHTML = orders.map(order => buildOrderCardHtml(order)).join('');
            if (typeof window.updateSelectAllCheckboxState === 'function') {
                window.updateSelectAllCheckboxState();
            }
        }

        // ─── Bước 1 (Live): renderLiveCurrentOrders ─
        function renderLiveCurrentOrders() {
            const grid = document.querySelector('#live-current-orders-panel [data-current-orders-grid]');
            const empty = document.querySelector('#live-current-orders-panel [data-current-orders-empty]');
            
            const orders = Object.values(liveOrdersData || {})
                .map(order => ({
                    ...order,
                    username: normalizeTikTokUsername(order.username || order.customerUsername || '')
                }))
                .filter(order => order.username);

            updateLiveKpiCounters();
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
            grid.innerHTML = orders.map(order => buildOrderCardHtml(order)).join('');
            if (typeof window.updateSelectAllCheckboxState === 'function') {
                window.updateSelectAllCheckboxState();
            }
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

            const isConnected = document.body.classList.contains('live-connected');
            let html = '';
            if (isConnected) {
                html = currentLang === 'en'
                    ? '<span class="material-symbols-outlined text-green-500 animate-pulse">sensors</span><strong>Connected, waiting for comments...</strong><small>Real-time comments will appear here once viewers start typing on your live stream.</small>'
                    : '<span class="material-symbols-outlined text-green-500 animate-pulse">sensors</span><strong>Đã kết nối, đang chờ bình luận...</strong><small>Bình luận realtime sẽ xuất hiện ở đây khi người xem tương tác trên live stream.</small>';
            } else {
                html = currentLang === 'en'
                    ? '<span class="material-symbols-outlined text-gray-400">power_off</span><strong>Not connected to TikTok Live</strong><small>Go to <a href="#" onclick="switchView(\'settings\'); return false;" class="text-red-500 font-bold underline">Settings</a> to configure your TikTok ID / Auto-connect.</small>'
                    : '<span class="material-symbols-outlined text-gray-400">power_off</span><strong>Chưa kết nối TikTok Live</strong><small>Vui lòng vào <a href="#" onclick="switchView(\'settings\'); return false;" class="text-red-500 font-bold underline">Cài đặt</a> để thiết lập TikTok ID và tự động kết nối.</small>';
            }

            if (existingEmpty) {
                existingEmpty.innerHTML = html;
                return;
            }
            const empty = document.createElement('div');
            empty.id = 'chat-feed-empty';
            empty.className = 'live-empty-state';
            empty.innerHTML = html;
            chatFeed.appendChild(empty);
        }

        function buildConfirmedAmountTooltip(userId) {
            const normalizedUserId = normalizeTikTokUsername(userId);
            const total = Number(liveOrdersData?.[normalizedUserId]?.total || 0);
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

            // KPI Trends
            const ordersTrendEl = document.getElementById('ov-orders-trend');
            const revenueTrendEl = document.getElementById('ov-revenue-trend');
            if (ordersTrendEl) ordersTrendEl.textContent = '';
            if (revenueTrendEl) revenueTrendEl.textContent = '';

            if (comparison && comparison.hasPreviousData) {
                const prevOrders = comparison.previousOrders || 0;
                const prevRev = comparison.previousRevenue || 0;
                const ordersPct = prevOrders > 0 ? ((comparison.ordersDiff / prevOrders) * 100) : 0;
                const revenuePct = prevRev > 0 ? ((comparison.revenueDiff / prevRev) * 100) : 0;

                if (ordersTrendEl && prevOrders > 0) {
                    const diffText = comparison.ordersDiff > 0 ? `+${ordersPct.toFixed(0)}%` : `${ordersPct.toFixed(0)}%`;
                    ordersTrendEl.textContent = diffText;
                    ordersTrendEl.className = `text-[11px] font-black ${comparison.ordersDiff > 0 ? 'text-emerald-600' : comparison.ordersDiff < 0 ? 'text-rose-600' : 'text-gray-400'}`;
                }
                if (revenueTrendEl && prevRev > 0) {
                    const diffText = comparison.revenueDiff > 0 ? `+${revenuePct.toFixed(0)}%` : `${revenuePct.toFixed(0)}%`;
                    revenueTrendEl.textContent = diffText;
                    revenueTrendEl.className = `text-[11px] font-black ${comparison.revenueDiff > 0 ? 'text-emerald-600' : comparison.revenueDiff < 0 ? 'text-rose-600' : 'text-gray-400'}`;
                }
            }

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
            renderCustomerRetention(data);
        }

        async function refreshOverviewData(showLoading = true) {
            const startDate = parseDisplayDate(overviewStartInput.value);
            const endDate = parseDisplayDate(overviewEndInput.value);
            if (!startDate || !endDate) return;
            if (showLoading) {
                document.getElementById('overview-top-shop-list').innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'Loading...' : 'Đang tải...'}</p>`;
                const overviewTopProductsList = document.getElementById('overview-top-products-list');
                if (overviewTopProductsList) overviewTopProductsList.innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'Loading...' : 'Đang tải...'}</p>`;
                const retentionContainer = document.getElementById('overview-customer-retention-content');
                if (retentionContainer) retentionContainer.innerHTML = `<p class="text-gray-400 text-sm">${currentLang === 'en' ? 'Loading...' : 'Đang tải...'}</p>`;
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
                    previousOrders,
                    previousRevenue,
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

        function formatFullDateTime(dateStr, timeStr) {
            if (!dateStr) return '—';
            let formattedDate = dateStr;
            if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                    formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
            }
            const timePart = timeStr ? timeStr.slice(0, 5) : '';
            return timePart ? `${timePart} ${formattedDate}` : formattedDate;
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
                    <td class="py-2">${formatFullDateTime(r.date, r.time)}</td>
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
                            <p class="text-[10px] text-gray-400 truncate">#${String(r.id || '').slice(-10) || '—'} • ${formatFullDateTime(r.date, r.time)}</p>
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
            let html = topShopStats.map((s, idx) => {
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

            const topRevenue = topShopStats.reduce((sum, s) => sum + s.revenue, 0);
            const totalRevenue = overviewData?.summary?.revenue || 0;
            const pct = totalRevenue > 0 ? ((topRevenue / totalRevenue) * 100).toFixed(0) : 0;
            
            html += `
                <div class="mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800/60 flex justify-between items-center text-xs text-gray-400 dark:text-gray-500 font-bold">
                    <span>Tổng doanh thu Top ${topShopStats.length} khách: <strong>${formatMoney(topRevenue)}</strong></span>
                    <span>Chiếm <strong>${pct}%</strong> tổng số</span>
                </div>
            `;
            container.innerHTML = html;
        }

        function renderCustomerRetention(data) {
            const container = document.getElementById('overview-customer-retention-content');
            if (!container) return;
            
            const retention = data?.customerRetention || {
                newCustomers: { count: 0, revenue: 0, percentage: 0 },
                returningCustomers: { count: 0, revenue: 0, percentage: 0 },
                totalCustomers: 0
            };
            
            const newCount = retention.newCustomers.count;
            const newRevenue = retention.newCustomers.revenue;
            const newPct = retention.newCustomers.percentage;
            
            const returningCount = retention.returningCustomers.count;
            const returningRevenue = retention.returningCustomers.revenue;
            const returningPct = retention.returningCustomers.percentage;
            
            const totalRevenue = newRevenue + returningRevenue;
            const revenuePct = totalRevenue > 0 ? Math.round((returningRevenue / totalRevenue) * 100) : 0;
            
            container.innerHTML = `
                <div class="flex-1 flex flex-col justify-around gap-3 pt-1">
                    <!-- Số liệu khách hàng -->
                    <div class="grid grid-cols-2 gap-3">
                        <div class="p-3 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30 rounded-xl">
                            <span class="text-xs text-blue-500 font-bold block mb-1">${currentLang === 'en' ? 'New Customers' : 'Khách mới'}</span>
                            <strong class="text-2xl font-black text-blue-600 dark:text-blue-400">${newCount}</strong>
                            <span class="text-xs text-gray-400 dark:text-gray-500 ml-1 font-bold">(${newPct}%)</span>
                            <span class="block text-[11px] text-blue-600/80 dark:text-blue-400/80 mt-1">${currentLang === 'en' ? 'Contribution:' : 'Đóng góp:'} <strong>${formatMoney(newRevenue)}</strong></span>
                        </div>
                        <div class="p-3 bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100/50 dark:border-rose-900/30 rounded-xl">
                            <span class="text-xs text-rose-500 font-bold block mb-1">${currentLang === 'en' ? 'Returning Customers' : 'Khách quay lại'}</span>
                            <strong class="text-2xl font-black text-rose-600 dark:text-rose-400">${returningCount}</strong>
                            <span class="text-xs text-gray-400 dark:text-gray-500 ml-1 font-bold">(${returningPct}%)</span>
                            <span class="block text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1">${currentLang === 'en' ? 'Contribution:' : 'Đóng góp:'} <strong>${formatMoney(returningRevenue)}</strong></span>
                        </div>
                    </div>

                    <!-- Thanh tỷ lệ (Ratio Bar) -->
                    <div class="space-y-1">
                        <div class="flex justify-between text-[11px] text-gray-400 font-bold">
                            <span>${currentLang === 'en' ? 'New Customers' : 'Khách mới'} (${newPct}%)</span>
                            <span>${currentLang === 'en' ? 'Returning Customers' : 'Khách quay lại'} (${returningPct}%)</span>
                        </div>
                        <div class="h-3 w-full bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden flex">
                            <div class="h-full bg-blue-500" style="width: ${newPct}%"></div>
                            <div class="h-full bg-rose-500" style="width: ${returningPct}%"></div>
                        </div>
                    </div>

                    <!-- Dòng phụ (Insight) -->
                    <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed italic border-l-2 border-rose-500 pl-2">
                        ${currentLang === 'en'
                            ? `Returning customers contribute <strong>${formatMoney(returningRevenue)}</strong>, accounting for <strong>${revenuePct}%</strong> of total revenue this period.`
                            : `Khách quay lại đóng góp <strong>${formatMoney(returningRevenue)}</strong>, chiếm <strong>${revenuePct}%</strong> tổng doanh thu kỳ này.`}
                    </p>
                </div>
            `;
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

            // Update parent dropdown group active and expanded state
            const orderViews = ['orders', 'delivery', 'customers'];
            const ordersToggleBtn = document.getElementById('menu-orders-group-toggle');
            const ordersSubmenu = document.getElementById('menu-orders-submenu');
            if (ordersToggleBtn && ordersSubmenu) {
                const isChildActive = orderViews.includes(view);
                ordersToggleBtn.classList.toggle('has-active-child', isChildActive);
                if (isChildActive) {
                    ordersSubmenu.classList.remove('collapsed');
                    ordersToggleBtn.classList.add('open');
                    ordersToggleBtn.setAttribute('aria-expanded', 'true');
                }
            }

            const settingsViews = ['settings', 'print-config', 'backup'];
            const settingsToggleBtn = document.getElementById('menu-settings-group-toggle');
            const settingsSubmenu = document.getElementById('menu-settings-submenu');
            if (settingsToggleBtn && settingsSubmenu) {
                const isChildActive = settingsViews.includes(view);
                settingsToggleBtn.classList.toggle('has-active-child', isChildActive);
                if (isChildActive) {
                    settingsSubmenu.classList.remove('collapsed');
                    settingsToggleBtn.classList.add('open');
                    settingsToggleBtn.setAttribute('aria-expanded', 'true');
                }
            }

            const sectionMap = {
                overview: [sectionOverview],
                live: [sectionConnect, sectionLiveWorkspace],
                orders: [sectionOrders],
                delivery: [sectionDelivery],
                customers: [sectionCustomers],
                shop: [sectionShop],
                reports: [sectionReports],
                settings: [settingsPanel],
                'print-config': [settingsPanel],
                backup: [settingsPanel]
            };
            const activeSections = sectionMap[view] || sectionMap.overview;
            dashboardSections.forEach(sectionEl => setSectionVisibility(sectionEl, activeSections.includes(sectionEl)));
            setSectionVisibility(rightCol, settingsViews.includes(view));

            if (view === 'print-config') {
                const targetCard = document.getElementById('card-settings-integration');
                targetCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (view === 'backup') {
                const targetCard = document.getElementById('card-settings-backup');
                targetCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (view === 'settings') {
                const targetCard = document.getElementById('card-settings-general');
                targetCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
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
            if (view === 'delivery') {
                loadDeliverySessions();
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
            if (typeof window.updateSelectAllCheckboxState === 'function') {
                window.updateSelectAllCheckboxState();
            }
            if (typeof window.updateBatchActionBar === 'function') {
                window.updateBatchActionBar();
            }
        }
        window.switchView = switchView;

        const LivePage = {
            refresh: () => {
                calculateKpis();
                refreshCommentUserTooltips();
                renderEmptyCommentState();
            }
        };
        const OrdersPage = {
            refresh: () => {
                calculateKpis();
            }
        };


        const PRINTER_HINTS = {
            tcp: {
                placeholder: 'tcp://192.168.1.9:9100',
                vi: 'Ví dụ: tcp://192.168.1.9:9100 (Wi‑Fi/LAN port 9100)',
                en: 'Example: tcp://192.168.1.9:9100 (Wi‑Fi/LAN port 9100)'
            },
            usb: {
                placeholder: '/dev/usb/lp0',
                vi: 'Linux: /dev/usb/lp0 · Windows: COM3 hoặc \.\COM3',
                en: 'Linux: /dev/usb/lp0 · Windows: COM3 or \.\COM3'
            },
            printer: {
                placeholder: 'EPSON TM-T82',
                vi: 'Tên máy in hệ thống (hoặc để trống = auto)',
                en: 'System printer name (blank = auto)'
            }
        };

        function detectPrinterType(iface) {
            const value = String(iface || '').trim();
            if (!value) return 'tcp';
            if (/^printer:/i.test(value)) return 'printer';
            if (
                value.startsWith('/dev/') ||
                value.startsWith('\\\\.\\') ||
                value.startsWith('//./') ||
                /^COM\d+$/i.test(value) ||
                /^LPT\d+$/i.test(value)
            ) return 'usb';
            return 'tcp';
        }

        function buildPrinterInterfaceFromUi() {
            const type = printerTypeSelect?.value || 'tcp';
            let value = (printerIpInput?.value || '').trim();
            if (!value) return '';

            if (type === 'tcp') {
                if (!/^tcp:\/\//i.test(value)) value = `tcp://${value.replace(/^\/+/, '')}`;
                try {
                    const u = new URL(value);
                    if (!u.port) {
                        u.port = '9100';
                        value = u.toString().replace(/\/$/, '');
                    }
                } catch (_) {}
                return value;
            }

            if (type === 'usb') {
                if (/^COM\d+$/i.test(value) || /^LPT\d+$/i.test(value)) {
                    return `\\\\.\\${value.toUpperCase()}`;
                }
                return value;
            }

            // system printer
            if (/^printer:/i.test(value)) return value;
            return `printer:${value || 'auto'}`;
        }

        function applyPrinterUiFromInterface(iface) {
            const type = detectPrinterType(iface);
            if (printerTypeSelect) printerTypeSelect.value = type;
            if (printerIpInput) {
                let display = String(iface || '');
                if (type === 'printer') display = display.replace(/^printer:/i, '');
                printerIpInput.value = display;
            }
            updatePrinterHint();
        }

        function updatePrinterHint() {
            const type = printerTypeSelect?.value || 'tcp';
            const hint = PRINTER_HINTS[type] || PRINTER_HINTS.tcp;
            if (printerIpInput) printerIpInput.placeholder = hint.placeholder;
            if (printerHintEl) printerHintEl.textContent = currentLang === 'en' ? hint.en : hint.vi;
        }

        if (printerTypeSelect && !printerTypeSelect.dataset.bound) {
            printerTypeSelect.dataset.bound = 'true';
            printerTypeSelect.addEventListener('change', () => {
                updatePrinterHint();
                // clear value when switching type to avoid mixing formats
                if (printerIpInput) printerIpInput.value = '';
            });
        }

        window.toggleSettings = () => switchView('settings');
        window.saveSettings = () => {
            const defaultTikTokIdInput = document.getElementById('default-tiktok-id');
            const autoConnectCheckbox = document.getElementById('auto-connect-enabled');
            const defaultTikTokId = (defaultTikTokIdInput?.value || '').trim().replace('@', '');
            const autoConnectEnabled = autoConnectCheckbox?.checked || false;

            socket.emit('update-settings', {
                printerInterface: buildPrinterInterfaceFromUi(),
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

            // Cập nhật trạng thái API key
            updateApiKeyStatus();

            // Cập nhật panel trạng thái hệ thống
            const printerStatusText = document.getElementById('status-printer-text');
            const printerStatusIcon = document.getElementById('status-printer-icon');
            const builtPrinter = buildPrinterInterfaceFromUi();
            if (printerStatusText) {
                printerStatusText.textContent = builtPrinter
                    ? builtPrinter
                    : (currentLang === 'en' ? 'Not configured' : 'Chưa cấu hình');
            }
            if (printerStatusIcon) {
                printerStatusIcon.style.color = builtPrinter ? '#22c55e' : '#94a3b8';
            }

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

            // Gắn event change cho checkbox để tránh double-toggle và lệch UI
            const autoCb = document.getElementById('auto-connect-enabled');
            if (autoCb && !autoCb.dataset.listenerAttached) {
                autoCb.dataset.listenerAttached = 'true';
                autoCb.addEventListener('change', () => {
                    syncAutoConnectToggleUI(autoCb.checked);
                });
            }

            // Cập nhật trạng thái API key
            updateApiKeyStatus();

            // Cập nhật panel trạng thái hệ thống
            const printerIp = document.getElementById('printer-ip');
            if (printerIp) {
                const printerStatusText = document.getElementById('status-printer-text');
                const printerStatusIcon = document.getElementById('status-printer-icon');
                if (printerStatusText) {
                    printerStatusText.textContent = printerIp.value.trim()
                        ? printerIp.value.trim()
                        : (currentLang === 'en' ? 'Not configured' : 'Chưa cấu hình');
                }
                if (printerStatusIcon) {
                    printerStatusIcon.style.color = printerIp.value.trim() ? '#22c55e' : '#94a3b8';
                }
            }

            // Cập nhật trạng thái backup (UI placeholder — chưa có backend)
            const backupText = document.getElementById('status-backup-text');
            if (backupText) {
                // TODO: Gọi API kiểm tra backup gần nhất
                backupText.textContent = currentLang === 'en' ? 'Manual only' : 'Thủ công';
            }

            // Cập nhật trạng thái TikTok Live trong Settings
            const tiktokBadge = document.getElementById('tiktok-live-status-badge');
            const tiktokStatusText = document.getElementById('status-tiktok-text');
            const tiktokStatusIcon = document.getElementById('status-tiktok-icon');
            const isConnected = document.body.classList.contains('live-connected');
            if (tiktokBadge) {
                if (isConnected) {
                    tiktokBadge.textContent = currentLang === 'en' ? 'Connected' : 'Đã kết nối';
                    tiktokBadge.style.borderColor = '#22c55e';
                    tiktokBadge.style.color = '#22c55e';
                    tiktokBadge.style.background = 'rgba(34,197,94,0.1)';
                } else {
                    tiktokBadge.textContent = currentLang === 'en' ? 'Disconnected' : 'Chưa kết nối';
                    tiktokBadge.style.borderColor = '#64748b';
                    tiktokBadge.style.color = '#94a3b8';
                    tiktokBadge.style.background = 'rgba(255,255,255,0.05)';
                }
            }
            if (tiktokStatusText) {
                tiktokStatusText.textContent = isConnected
                    ? (activeBroadcasterId || (currentLang === 'en' ? 'Connected' : 'Đã kết nối'))
                    : (currentLang === 'en' ? 'Disconnected' : 'Chưa kết nối');
                tiktokStatusText.style.color = isConnected ? '#22c55e' : '';
            }
            if (tiktokStatusIcon) {
                tiktokStatusIcon.style.color = isConnected ? '#22c55e' : '#94a3b8';
            }

            // Cập nhật trạng thái máy in trong Settings
            const printerBadge = document.getElementById('printer-status-badge');
            if (printerBadge) {
                const currentText = printerBadge.textContent.trim();
                if (currentText === 'Chưa kiểm tra' || currentText === 'Not checked' || currentText === 'Chưa hỗ trợ' || currentText === 'Unavailable' || currentText === 'Đang kiểm tra...' || currentText === 'Testing...') {
                    if (currentText === 'Chưa hỗ trợ' || currentText === 'Unavailable') {
                        printerBadge.textContent = currentLang === 'en' ? 'Unavailable' : 'Chưa hỗ trợ';
                    } else if (currentText === 'Đang kiểm tra...' || currentText === 'Testing...') {
                        printerBadge.textContent = currentLang === 'en' ? 'Testing...' : 'Đang kiểm tra...';
                    } else {
                        printerBadge.textContent = currentLang === 'en' ? 'Not checked' : 'Chưa kiểm tra';
                    }
                }
            }

            // Đồng bộ lại title cho nút hiện/ẩn API key theo type hiện tại của input
            const apiKeyInput = document.getElementById('tiktok-api-key');
            const toggleBtn = document.getElementById('btn-toggle-api-key');
            if (apiKeyInput && toggleBtn) {
                const isPassword = apiKeyInput.type === 'password';
                if (currentLang === 'en') {
                    toggleBtn.setAttribute('title', isPassword ? 'Show API key' : 'Hide API key');
                } else {
                    toggleBtn.setAttribute('title', isPassword ? 'Hiện API key' : 'Ẩn API key');
                }
            }
        }

        function updateApiKeyStatus() {
            const keyInput = document.getElementById('tiktok-api-key');
            const statusEl = document.getElementById('api-key-status');
            if (!keyInput || !statusEl) return;
            const val = keyInput.value.trim();
            if (val) {
                statusEl.textContent = currentLang === 'en' ? 'Configured' : 'Đã cấu hình';
                statusEl.className = 'settings-key-status configured';
            } else {
                statusEl.textContent = currentLang === 'en' ? 'Not configured' : 'Chưa cấu hình';
                statusEl.className = 'settings-key-status not-configured';
            }
        }

        window.toggleApiKeyVisibility = () => {
            const keyInput = document.getElementById('tiktok-api-key');
            const toggleBtn = document.getElementById('btn-toggle-api-key');
            if (!keyInput || !toggleBtn) return;
            const isPassword = keyInput.type === 'password';
            keyInput.type = isPassword ? 'text' : 'password';
            toggleBtn.textContent = isPassword ? '🙈' : '👁';
            if (currentLang === 'en') {
                toggleBtn.setAttribute('title', isPassword ? 'Show API key' : 'Hide API key');
            } else {
                toggleBtn.setAttribute('title', isPassword ? 'Hiện API key' : 'Ẩn API key');
            }
        }

        window.testPrinterConnection = () => {
            const badge = document.getElementById('printer-status-badge');
            const iface = buildPrinterInterfaceFromUi();
            if (!iface) {
                if (badge) {
                    badge.textContent = currentLang === 'en' ? 'No target' : 'Chưa có máy in';
                    badge.style.borderColor = '#f59e0b';
                    badge.style.color = '#f59e0b';
                }
                return;
            }
            if (badge) {
                badge.textContent = currentLang === 'en' ? 'Testing...' : 'Đang kiểm tra...';
                badge.style.borderColor = '#3b82f6';
                badge.style.color = '#3b82f6';
            }
            socket.emit('test-printer', { interface: iface });
        }
        document.addEventListener('DOMContentLoaded', () => {
            const testBtn = document.getElementById('btn-test-printer');
            if (testBtn) testBtn.addEventListener('click', window.testPrinterConnection);
        });

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
                    broadcasterId: data.session.tiktokUsername || data.session.liveName || '',
                    isManual: true
                });

                // Ghi nhớ session đang làm việc và thông báo server
                activeLoadedSessionId = sessionId;
                socket.emit('set-active-session', { sessionId });

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

        socket.on('manual-history-data', (res) => {
            ordersData = normalizeOrdersMap(res.data);
            activeLoadedSessionId = res.sessionId;
            statusMsg.innerText = (currentLang === 'en' ? 'History: ' : 'Lịch sử: ') + res.fileName;
            calculateKpis();
            refreshCommentUserTooltips();
        });

        socket.on('system-config', (config) => {
            applyPrinterUiFromInterface(config.printerInterface || '');
            tiktokApiKeyInput.value = config.tiktokSignApiKey;
            // Cập nhật UI trạng thái sau khi nhận config từ server
            updateApiKeyStatus();
            const pst = document.getElementById('status-printer-text');
            const psi = document.getElementById('status-printer-icon');
            if (pst) pst.textContent = config.printerInterface || (currentLang === 'en' ? 'Not configured' : 'Chưa cấu hình');
            if (psi) psi.style.color = config.printerInterface ? '#22c55e' : '#94a3b8';
        });

        socket.on('system-status', (msg) => {
            systemStatusMsg.innerText = msg;
            setTimeout(() => systemStatusMsg.innerText = '', 3000);
        });
        socket.on('printer-error', (msg) => { alert(msg); });
        socket.on('printer-test-result', (res) => {
            const badge = document.getElementById('printer-status-badge');
            const ok = !!res?.ok;
            const message = res?.message || (ok ? 'OK' : 'Failed');
            if (badge) {
                badge.textContent = ok
                    ? (currentLang === 'en' ? 'Connected' : 'Kết nối OK')
                    : (currentLang === 'en' ? 'Failed' : 'Lỗi');
                badge.style.borderColor = ok ? '#22c55e' : '#ef4444';
                badge.style.color = ok ? '#22c55e' : '#ef4444';
                badge.style.background = ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
            }
            const msg = document.getElementById('system-status-msg');
            if (msg) {
                msg.textContent = message;
                msg.style.color = ok ? '#16a34a' : '#dc2626';
                setTimeout(() => { if (msg.textContent === message) msg.textContent = ''; }, 4000);
            }
        });

        socket.on('all-confirmed-orders', (allOrders) => {
            liveOrdersData = normalizeOrdersMap(allOrders);
            calculateKpis();
            refreshCommentUserTooltips();
            syncConfirmedMsgIdsFromOrders(liveOrdersData);

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
                const items = Array.isArray(order.items)
                    ? order.items.map(item => ({
                        ...item,
                        text: normalizeDisplayText(item.text || item.productName || '')
                    }))
                    : [];
                const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
                result[username] = {
                    ...order,
                    username,
                    nickname: cleanDisplayText(order.nickname || order.displayName || ''),
                    items,
                    total
                };
                return result;
            }, {});
        }

        // Đồng bộ confirmedMsgIds từ danh sách đơn đã chốt (load session / reconnect / manual)
        function syncConfirmedMsgIdsFromOrders(orderMap) {
            Object.values(orderMap || {}).forEach(order => {
                (Array.isArray(order.items) ? order.items : []).forEach(item => {
                    const msgId = item.sourceMsgId || item.msgId || '';
                    if (msgId) {
                        confirmedMsgIds.add(msgId);
                    }
                });
            });
            // Re-render trạng thái badge cho các row đang hiển thị
            chatFeed.querySelectorAll('.chat-row[data-msg-id]').forEach(row => {
                const msgId = row.dataset.msgId || '';
                const actions = row.querySelector('.flex.items-center.gap-2');
                if (!actions || !msgId) return;
                const hasBadge = !!actions.querySelector('[data-printed-badge="1"]');
                const shouldPrinted = confirmedMsgIds.has(msgId);
                if (shouldPrinted && !hasBadge) {
                    const confirmBtn = actions.querySelector('button[data-confirm-btn]');
                    if (confirmBtn) confirmBtn.remove();
                    const userid = row.dataset.commentUserid || '';
                    actions.appendChild(createPrintedBadge(userid, msgId));
                } else if (!shouldPrinted && hasBadge) {
                    actions.querySelector('[data-printed-badge="1"]')?.remove();
                }
            });
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

         function resetChatFeed(options = {}) {
             const keepConfirmed = Boolean(options.keepConfirmed);
             chatFeed.innerHTML = '';
             kpiComments = 0;
             seenChatMsgIds.clear();
             if (!keepConfirmed) {
                 confirmedMsgIds.clear();
             }
             // Reset session đang load để không sync lẫn vào session cũ
             if (activeLoadedSessionId) {
                 activeLoadedSessionId = null;
                 socket.emit('set-active-session', { sessionId: null });
             }
             calculateKpis();
             renderEmptyCommentState();
         }

        function createPrintedBadge(username, msgId) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'badge bg-amber-900 hover:bg-amber-800 text-white text-[10px] font-black px-2.5 py-1 rounded uppercase flex items-center gap-1 border border-amber-800 shadow-sm transition-colors cursor-pointer';
            btn.innerHTML = `<span class="material-symbols-outlined text-[14px]">check_circle</span> ${currentLang === 'en' ? 'PRINTED' : 'ĐÃ IN'}`;
            btn.dataset.printedBadge = '1';
            if (msgId) {
                btn.dataset.msgId = msgId;
            }
            if (username) {
                btn.dataset.username = username;
            }
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetUser = btn.dataset.username || username;
                const confirmMsg = currentLang === 'en'
                    ? 'Orders for this customer have ALREADY been printed. Do you want to print again?'
                    : 'Đơn của khách này ĐÃ IN rồi. Bạn có muốn in lại lần nữa không?';
                if (confirm(confirmMsg)) {
                    if (targetUser) {
                        reprintTotal(targetUser);
                    }
                }
            });
            return btn;
        }

        // Đánh dấu ĐÃ IN cho ĐÚNG comment (theo msgId). Fallback: theo username.
        function updateCommentRowPrintedStatus(username, msgId) {
            if (msgId) {
                confirmedMsgIds.add(msgId);
                const row = chatFeed.querySelector(`.chat-row[data-msg-id="${(window.ChatConfirm && window.ChatConfirm.cssEscape) ? window.ChatConfirm.cssEscape(msgId) : String(msgId).replace(/"/g, '\\"')}"]`);
                if (row) {
                    const actions = row.querySelector('.flex.items-center.gap-2');
                    if (!actions) return;
                    const confirmBtn = actions.querySelector('button[data-confirm-btn]');
                    if (confirmBtn) confirmBtn.remove();
                    if (!actions.querySelector('[data-printed-badge="1"]')) {
                        const userid = row.dataset.commentUserid || username || '';
                        actions.appendChild(createPrintedBadge(userid, msgId));
                    }
                }
                return;
            }
            if (!username) return;
            const norm = normalizeTikTokUsername(username);
            const rows = document.querySelectorAll(`.chat-row[data-comment-userid="${CSS.escape(norm)}"]`);
            rows.forEach(row => {
                const actions = row.querySelector('.flex.items-center.gap-2');
                if (!actions) return;
                const confirmBtn = actions.querySelector('button:not([data-printed-badge="1"])');
                if (confirmBtn) {
                    confirmBtn.remove();
                }
                if (!actions.querySelector('[data-printed-badge="1"]')) {
                    actions.appendChild(createPrintedBadge(norm, row.dataset.msgId || msgId || ''));
                }
            });
        }

        function revertCommentRowPrintedStatus(username, msgId) {
            if (msgId) {
                confirmedMsgIds.delete(msgId);
                const row = chatFeed.querySelector(`.chat-row[data-msg-id="${(window.ChatConfirm && window.ChatConfirm.cssEscape) ? window.ChatConfirm.cssEscape(msgId) : String(msgId).replace(/"/g, '\\"')}"]`);
                if (row) {
                    const actions = row.querySelector('.flex.items-center.gap-2');
                    if (!actions) return;
                    const badge = actions.querySelector('[data-printed-badge="1"]');
                    if (badge) badge.remove();
                    if (!actions.querySelector('button')) {
                        const confirmBtn = document.createElement('button');
                        confirmBtn.type = 'button';
                        confirmBtn.className = 'bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded uppercase transition-colors';
                        confirmBtn.textContent = currentLang === 'en' ? 'CONFIRM' : 'CHỐT';
                        confirmBtn.dataset.confirmBtn = msgId;
                        confirmBtn.addEventListener('click', () => {
                            if (confirmBtn.disabled) return;
                            confirmBtn.disabled = true;
                            confirmBtn.textContent = currentLang === 'en' ? '✔ CONFIRMED' : '✔ Đã chốt';
                            confirmBtn.classList.remove('bg-red-500');
                            confirmBtn.classList.add('bg-green-500');
                            
                            const rawNickname = row.querySelector('.customer-display-name')?.textContent || username;
                            const avatarUrl = row.querySelector('img')?.src || '';
                            const commentText = row.querySelector('p.text-gray-700')?.textContent || '';
                            const ok = manualConfirm(norm, rawNickname, avatarUrl, commentText, 0, msgId);
                            if (!ok) {
                                confirmBtn.disabled = false;
                                confirmBtn.textContent = currentLang === 'en' ? 'CONFIRM' : 'CHỐT';
                                confirmBtn.classList.remove('bg-green-500');
                                confirmBtn.classList.add('bg-red-500');
                            }
                        });
                        actions.appendChild(confirmBtn);
                    }
                    return;
                }
            }
            if (!username) return;
            const norm = normalizeTikTokUsername(username);
            const rows = document.querySelectorAll(`.chat-row[data-comment-userid="${CSS.escape(norm)}"]`);
            rows.forEach(row => {
                const actions = row.querySelector('.flex.items-center.gap-2');
                if (!actions) return;
                const badge = actions.querySelector('[data-printed-badge="1"]');
                if (badge) {
                    badge.remove();
                    if (!actions.querySelector('button')) {
                        const confirmBtn = document.createElement('button');
                        confirmBtn.type = 'button';
                        confirmBtn.className = 'bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded uppercase transition-colors';
                        confirmBtn.textContent = currentLang === 'en' ? 'CONFIRM' : 'CHỐT';
                        confirmBtn.dataset.confirmBtn = row.dataset.msgId || '';
                        confirmBtn.addEventListener('click', () => {
                            if (confirmBtn.disabled) return;
                            confirmBtn.disabled = true;
                            confirmBtn.textContent = currentLang === 'en' ? '✔ CONFIRMED' : '✔ Đã chốt';
                            confirmBtn.classList.remove('bg-red-500');
                            confirmBtn.classList.add('bg-green-500');
                            
                            const rawNickname = row.querySelector('.customer-display-name')?.textContent || norm;
                            const avatarUrl = row.querySelector('img')?.src || '';
                            const commentText = row.querySelector('p.text-gray-700')?.textContent || '';
                            const ok = manualConfirm(norm, rawNickname, avatarUrl, commentText, 0, row.dataset.msgId || '');
                            if (!ok) {
                                confirmBtn.disabled = false;
                                confirmBtn.textContent = currentLang === 'en' ? 'CONFIRM' : 'CHỐT';
                                confirmBtn.classList.remove('bg-green-500');
                                confirmBtn.classList.add('bg-red-500');
                            }
                        });
                        actions.appendChild(confirmBtn);
                    }
                }
            });
        }

        function renderChatRow(data) {
            const msgId = (window.ChatConfirm && window.ChatConfirm.ensureChatMessageId) ? window.ChatConfirm.ensureChatMessageId(data) : (data.msgId || `${data.nickname || ''}_${data.comment || ''}_${data.timestamp || ''}`);
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
            row.dataset.msgId = msgId;
            const commenterId = normalizeTikTokUsername(data.uniqueId || data.username || '');
            row.dataset.commentUserid = commenterId;
            row.className = 'chat-row border border-gray-100 rounded-xl p-3 flex gap-3 items-start';
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

            const isUserPrinted = confirmedMsgIds.has(msgId);

            if (isUserPrinted) {
                actions.appendChild(createPrintedBadge(commenterId, msgId));
            } else {
                const confirmBtn = document.createElement('button');
                confirmBtn.type = 'button';
                confirmBtn.className = 'bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded uppercase transition-colors';
                confirmBtn.textContent = currentLang === 'en' ? 'CONFIRM' : 'CHỐT';
                confirmBtn.dataset.confirmBtn = msgId;
                confirmBtn.addEventListener('click', () => {
                    if (confirmBtn.disabled) return;
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = currentLang === 'en' ? '✔ CONFIRMED' : '✔ Đã chốt';
                    confirmBtn.classList.remove('bg-red-500');
                    confirmBtn.classList.add('bg-green-500');
                    
                    const ok = manualConfirm(commenterId, rawNickname, profilePictureUrl, comment, data.suggestedPrice, msgId);
                    if (!ok) {
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = currentLang === 'en' ? 'CONFIRM' : 'CHỐT';
                        confirmBtn.classList.remove('bg-green-500');
                        confirmBtn.classList.add('bg-red-500');
                    }
                });
                actions.appendChild(confirmBtn);
            }

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
            btnConnect.addEventListener('click', async () => {
                const isConnected = document.body.classList.contains('live-connected');
                if (isConnected) {
                    // Nếu đang kết nối, bấm vào sẽ ngắt kết nối
                    socket.emit('stop-live');
                    return;
                }

                const id = tiktokIdInput ? tiktokIdInput.value.trim().replace('@', '') : '';
                if (!id) return alert(currentLang === 'en' ? 'Please input TikTok ID first in Settings!' : 'Vui lòng cấu hình TikTok ID trong cài đặt trước!');

                const sessionKey = getScopedStorageKey('activeSessionId');

                // Mở Modal chọn phiên lưu và hiển thị trạng thái loading
                const modal = document.getElementById('select-session-modal');
                const listEl = document.getElementById('select-session-list');
                const btnNew = document.getElementById('btn-select-session-new');
                const btnCancel = document.getElementById('btn-select-session-cancel');

                if (!modal || !listEl) {
                    // Fallback nếu không tìm thấy modal
                    resetChatFeed();
                    socket.emit('start-live', { uniqueId: id, sessionId: null });
                    return;
                }

                listEl.innerHTML = '<p class="text-xs text-center text-slate-400 py-6">Đang tải lịch sử phiên...</p>';
                modal.classList.remove('hidden');

                // Đóng modal khi bấm Hủy
                btnCancel.onclick = () => {
                    modal.classList.add('hidden');
                };

                // Bấm Tạo phiên mới tinh
                btnNew.onclick = () => {
                    modal.classList.add('hidden');
                    resetChatFeed();
                    if (sessionKey) localStorage.removeItem(sessionKey);
                    liveOrdersData = {};
                    calculateKpis();
                    socket.emit('start-live', {
                        uniqueId: id,
                        sessionId: null
                    });
                };

                // Bấm ra ngoài overlay để đóng modal
                modal.onclick = (e) => {
                    if (e.target === modal) {
                        modal.classList.add('hidden');
                    }
                };

                // Hàm click chọn phiên cũ trực tiếp từ danh sách
                window.selectLiveSessionForConnection = (sessionId) => {
                    modal.classList.add('hidden');
                    resetChatFeed();
                    if (sessionKey) localStorage.setItem(sessionKey, sessionId);
                    socket.emit('start-live', {
                        uniqueId: id,
                        sessionId: sessionId
                    });
                };

                try {
                    // Lấy danh sách phiên live
                    const res = await fetch('/api/live-sessions');
                    if (!res.ok) throw new Error('Không thể lấy danh sách phiên');
                    const data = await res.json();
                    const sessions = Array.isArray(data.sessions) ? data.sessions : [];

                    // Lọc: lấy phiên live của kênh này + phiên gộp (merged_session) của người dùng
                    const filtered = sessions.filter(s =>
                        (s.tiktokUsername && s.tiktokUsername.toLowerCase() === id.toLowerCase()) ||
                        s.type === 'merged_session'
                    ).slice(0, 8);

                    if (filtered.length === 0) {
                        listEl.innerHTML = '<p class="text-xs text-center text-slate-400 py-6">Không có phiên live cũ nào của tài khoản này.</p>';
                    } else {
                        let html = '';
                        filtered.forEach(s => {
                            const date = s.startedAt ? new Date(s.startedAt).toLocaleString('vi-VN') : (s.createdAt ? new Date(s.createdAt).toLocaleString('vi-VN') : '');
                            const revenue = s.summary ? formatMoney(s.summary.totalRevenue) : '0đ';
                            const orders = s.summary ? s.summary.totalOrders : 0;
                            const qty = s.summary ? s.summary.totalQuantity : 0;
                            const userLabel = s.tiktokUsername ? `@${s.tiktokUsername}` : (s.liveName || '');
                            const ownerDisplay = s.ownerUserId === currentUserUid ? (currentLang === 'en' ? 'Mine' : 'Của tôi') : (s.ownerUserId || '');
                            const ownerBadge = ownerDisplay
                                ? `<span class="inline-block mt-1 max-w-[220px] truncate rounded bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500 align-middle">${escapeHtml(ownerDisplay)}</span>`
                                : '';
                            const safeId = escapeJsString(s.id);
                            html += `
                                <div class="flex items-start gap-3 p-3 border rounded-lg hover:bg-purple-50 transition cursor-pointer group" onclick="selectLiveSessionForConnection('${safeId}')">
                                    <div class="flex-1 min-w-0">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <p class="font-bold text-gray-800 text-sm">${escapeHtml(s.liveName || ('Live ' + date))}</p>
                                                <p class="text-[10px] text-gray-400">${date}${s.tiktokUsername ? ' • @' + escapeHtml(s.tiktokUsername) : ''}</p>
                                                <div class="mt-2 flex flex-wrap gap-1 text-[10px]">
                                                    <span class="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-600">User: ${escapeHtml(userLabel)}</span>
                                                    <span class="rounded bg-blue-50 px-2 py-0.5 font-bold text-blue-600">${orders} đơn</span>
                                                    <span class="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">Tổng: ${revenue}</span>
                                                </div>
                                                ${ownerBadge}
                                            </div>
                                            <div class="text-right ml-2 shrink-0">
                                                <span class="text-xs font-bold text-red-500">${revenue}</span>
                                                <p class="text-[9px] text-gray-400">${orders} orders • ${qty} qty</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        });
                        listEl.innerHTML = html;
                    }
                } catch (err) {
                    listEl.innerHTML = `<p class="text-xs text-center text-red-400 py-6">Lỗi tải phiên: ${err.message}</p>`;
                }
            });
        }

        socket.on('status', (data) => {
            const connectedText = currentLang === 'en' ? `Connected: ${data.roomId}` : `Kết nối: ${data.roomId}`;
            const errorText = currentLang === 'en' ? `Error: ${data.error}` : `Lỗi: ${data.error}`;
            statusMsg.innerText = data.connected ? connectedText : errorText;
            statusMsg.className = data.connected ? 'live-status-text text-green-600 font-semibold' : 'live-status-text text-red-600 font-semibold';
            
            document.body.classList.toggle('live-connected', !!data.connected);
            document.body.classList.toggle('live-disconnected', !data.connected);

            // Cập nhật nút bấm kết nối trên thanh Live Connect
            if (btnConnect) {
                if (data.connected) {
                    btnConnect.innerHTML = '❌ ' + (currentLang === 'en' ? 'Disconnect' : 'Ngắt kết nối');
                    btnConnect.className = 'px-2.5 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1';
                } else {
                    btnConnect.innerHTML = '⚡ ' + (currentLang === 'en' ? 'Connect' : 'Kết nối');
                    btnConnect.className = 'px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1';
                }
            }

            const btnOpenSettings = document.getElementById('btn-open-settings');
            if (btnOpenSettings) {
                btnOpenSettings.classList.toggle('hidden', !!data.connected);
            }

            const kpiStatusEl = document.getElementById('kpi-status');
            if (kpiStatusEl) {
                kpiStatusEl.textContent = data.connected ? (currentLang === 'en' ? 'Live' : 'Đang Live') : t('status.disconnected');
                kpiStatusEl.className = data.connected ? 'text-base font-bold mt-3 text-green-600' : 'text-base font-bold mt-3 text-gray-500';
            }

            // Cập nhật trạng thái TikTok trong Settings
            const tiktokBadge = document.getElementById('tiktok-live-status-badge');
            const tiktokStatusText = document.getElementById('status-tiktok-text');
            const tiktokStatusIcon = document.getElementById('status-tiktok-icon');
            if (tiktokBadge) {
                if (data.connected) {
                    tiktokBadge.textContent = currentLang === 'en' ? 'Connected' : 'Đã kết nối';
                    tiktokBadge.style.borderColor = '#22c55e';
                    tiktokBadge.style.color = '#22c55e';
                    tiktokBadge.style.background = 'rgba(34,197,94,0.1)';
                } else {
                    tiktokBadge.textContent = currentLang === 'en' ? 'Disconnected' : 'Chưa kết nối';
                    tiktokBadge.style.borderColor = '#64748b';
                    tiktokBadge.style.color = '#94a3b8';
                    tiktokBadge.style.background = 'rgba(255,255,255,0.05)';
                }
            }
            if (tiktokStatusText) {
                tiktokStatusText.textContent = data.connected
                    ? (data.roomId || (currentLang === 'en' ? 'Connected' : 'Đã kết nối'))
                    : (currentLang === 'en' ? 'Disconnected' : 'Chưa kết nối');
                tiktokStatusText.style.color = data.connected ? '#22c55e' : '';
            }
            if (tiktokStatusIcon) {
                tiktokStatusIcon.style.color = data.connected ? '#22c55e' : '#94a3b8';
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
            renderEmptyCommentState();
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

            resetChatFeed({ keepConfirmed: true });
            comments.forEach(renderChatRow);
            if (comments.length === 0) renderEmptyCommentState();
        });

        window.manualConfirm = (uniqueId, nickname, profilePictureUrl, comment, suggestedPrice, msgId) => {
            const inputText = currentLang === 'en' ? 'Enter price (e.g. 50000):' : 'Nhập giá (vd: 50000):';
            let price = suggestedPrice || parseFloat(prompt(inputText, '')) || 0;
            if (price > 0) {
                const username = normalizeTikTokUsername(uniqueId);
                const sourceMsgId = msgId || (window.ChatConfirm && window.ChatConfirm.ensureChatMessageId
                    ? window.ChatConfirm.ensureChatMessageId({ uniqueId: username, comment, nickname })
                    : '');
                socket.emit('confirm-item', {
                    uniqueId: username,
                    nickname: cleanDisplayText(nickname),
                    profilePictureUrl: normalizeDisplayText(profilePictureUrl),
                    comment: normalizeDisplayText(comment),
                    price,
                    sourceMsgId
                });
                return true;
            }
            return false;
        };

        // ─── Bước 4: Dùng patchOrderCard thay vì calculateKpis toàn bộ ──────────────
        // ─── Bước 4 (Fix 3): Lắng nghe xóa item/khách — không re-render toàn bộ ─────────
        // ─── LẮNG NGHE CẬP NHẬT LIVE WORKSPACE TỪ SERVER ──────────────────────────
        socket.on('order-item-deleted', ({ username, itemId }) => {
            const norm = normalizeTikTokUsername(username);
            if (liveOrdersData[norm]) {
                liveOrdersData[norm].items = (liveOrdersData[norm].items || []).filter(i => String(i.id) !== String(itemId));
                liveOrdersData[norm].total = liveOrdersData[norm].items.reduce((s, i) => s + Number(i.price || 0), 0);
                if (liveOrdersData[norm].items.length === 0) {
                    delete liveOrdersData[norm];
                    revertCommentRowPrintedStatus(norm);
                }
                patchLiveOrderCard(norm);
            } else {
                updateLiveKpiCounters();
            }
        });

        socket.on('order-customer-deleted', ({ username }) => {
            const norm = normalizeTikTokUsername(username);
            delete liveOrdersData[norm];
            revertCommentRowPrintedStatus(norm);
            const grid = document.querySelector('#live-current-orders-panel [data-current-orders-grid]');
            if (grid) {
                grid.querySelector(`[data-username="${CSS.escape(norm)}"]`)?.remove();
                const panel = grid.closest('[data-current-orders-panel]');
                if (panel) {
                    const empty = panel.querySelector('[data-current-orders-empty]');
                    const hasCards = grid.querySelector('[data-username]');
                    if (empty) {
                        empty.hidden = !!hasCards;
                        empty.classList.toggle('hidden', !!hasCards);
                    }
                }
            }
            updateLiveKpiCounters();
            updateLiveOrdersToggleLabel();
        });

        socket.on('order-confirmed', (userOrder) => {
            const username = normalizeTikTokUsername(userOrder.username || userOrder.customerUsername || '');
            if (!username) return;

            const items = Array.isArray(userOrder.items)
                ? userOrder.items.map(item => ({
                    ...item,
                    text: normalizeDisplayText(item.text || item.productName || '')
                }))
                : [];
            const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);

            liveOrdersData[username] = {
                ...userOrder,
                username,
                nickname: cleanDisplayText(userOrder.nickname || userOrder.displayName || ''),
                items,
                total
            };
            patchLiveOrderCard(username);
            updateLiveKpiCounters();
            refreshCommentUserTooltips();
            updateCommentRowPrintedStatus(username, userOrder.sourceMsgId || '');
        });

        // ─── LẮNG NGHE CẬP NHẬT MANUAL WORKSPACE TỪ SERVER ────────────────────────
        socket.on('manual-all-confirmed-orders', (payload) => {
            const data = payload?.data || {};
            ordersData = normalizeOrdersMap(data);
            activeLoadedSessionId = payload?.sessionId || null;
            renderManualCurrentOrders();
            syncConfirmedMsgIdsFromOrders(ordersData);
        });

        socket.on('manual-order-item-deleted', ({ username, itemId }) => {
            const norm = normalizeTikTokUsername(username);
            if (ordersData[norm]) {
                ordersData[norm].items = (ordersData[norm].items || []).filter(i => String(i.id) !== String(itemId));
                ordersData[norm].total = ordersData[norm].items.reduce((s, i) => s + Number(i.price || 0), 0);
                if (ordersData[norm].items.length === 0) {
                    delete ordersData[norm];
                    revertCommentRowPrintedStatus(norm);
                }
                patchManualOrderCard(norm);
            } else {
                updateManualKpiCounters();
            }
        });

        socket.on('manual-order-customer-deleted', ({ username }) => {
            const norm = normalizeTikTokUsername(username);
            delete ordersData[norm];
            revertCommentRowPrintedStatus(norm);
            const grid = document.querySelector('#section-current-orders [data-current-orders-grid]');
            if (grid) {
                grid.querySelector(`[data-username="${CSS.escape(norm)}"]`)?.remove();
                const panel = grid.closest('[data-current-orders-panel]');
                if (panel) {
                    const empty = panel.querySelector('[data-current-orders-empty]');
                    const hasCards = grid.querySelector('[data-username]');
                    if (empty) {
                        empty.hidden = !!hasCards;
                        empty.classList.toggle('hidden', !!hasCards);
                    }
                }
            }
            updateManualKpiCounters();
        });

        socket.on('manual-order-confirmed', (userOrder) => {
            const username = normalizeTikTokUsername(userOrder.username || userOrder.customerUsername || '');
            if (!username) return;

            const items = Array.isArray(userOrder.items)
                ? userOrder.items.map(item => ({
                    ...item,
                    text: normalizeDisplayText(item.text || item.productName || '')
                }))
                : [];
            const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);

            ordersData[username] = {
                ...userOrder,
                username,
                nickname: cleanDisplayText(userOrder.nickname || userOrder.displayName || ''),
                items,
                total
            };
            patchManualOrderCard(username);
            refreshCommentUserTooltips();
            updateCommentRowPrintedStatus(username, userOrder.sourceMsgId || '');
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

        function normalizePhone(phone) {
            if (!phone) return '';
            let cleaned = String(phone).trim().replace(/[\s\.\-\(\)]/g, '');
            if (cleaned.startsWith('+84')) {
                cleaned = '0' + cleaned.slice(3);
            } else if (cleaned.startsWith('84') && cleaned.length > 9) {
                cleaned = '0' + cleaned.slice(2);
            }
            return cleaned.replace(/[^\d\+]/g, '');
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
            liveOrdersData = {};
            customersData = [];
            kpiComments = 0;
            seenChatMsgIds.clear();
            confirmedMsgIds.clear();
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
                phone: normalizePhone(document.getElementById('customer-phone').value),
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

        async function updateOverallCustomerStats() {
            try {
                const res = await fetch('/api/customers');
                const data = await res.json();
                if (res.ok) {
                    const allC = data.customers || [];
                    const total = allC.length;
                    const hasPhone = allC.filter(c => !!c.phone).length;
                    const hasAddress = allC.filter(c => !!c.addressDetail && !!c.ward && !!c.district && !!c.province).length;
                    const missing = allC.filter(c => !c.phone || !c.addressDetail || !c.ward || !c.district || !c.province).length;
                    
                    const totalEl = document.getElementById('stats-total-customers');
                    const phoneEl = document.getElementById('stats-phone-customers');
                    const addrEl = document.getElementById('stats-address-customers');
                    const missEl = document.getElementById('stats-missing-customers');
                    if (totalEl) totalEl.textContent = total;
                    if (phoneEl) phoneEl.textContent = hasPhone;
                    if (addrEl) addrEl.textContent = hasAddress;
                    if (missEl) missEl.textContent = missing;
                }
            } catch (e) {
                console.error('Error loading customer stats:', e);
            }
        }

        window.selectedCustomerIds = new Set();

        window.toggleCustomerSelect = (customerId, checked) => {
            if (checked) {
                window.selectedCustomerIds.add(customerId);
            } else {
                window.selectedCustomerIds.delete(customerId);
            }
            updateCustomerSelectState();
        };

        window.toggleSelectAllCustomers = (checked) => {
            const checkboxes = customersTableBody?.querySelectorAll('.customer-select-checkbox');
            checkboxes?.forEach(cb => {
                cb.checked = checked;
                if (checked) {
                    window.selectedCustomerIds.add(cb.dataset.id);
                } else {
                    window.selectedCustomerIds.delete(cb.dataset.id);
                }
            });
            updateCustomerSelectState();
        };

        function updateCustomerSelectState() {
            const count = window.selectedCustomerIds.size;
            const btnMerge = document.getElementById('btn-merge-customers');
            const countBadge = document.getElementById('selected-customers-count');
            const selectAllCb = document.getElementById('customer-select-all');

            if (btnMerge) {
                btnMerge.disabled = count < 2;
            }
            if (countBadge) {
                countBadge.textContent = count;
                countBadge.classList.toggle('hidden', count === 0);
            }
            if (selectAllCb && customersTableBody) {
                const totalCbs = customersTableBody.querySelectorAll('.customer-select-checkbox').length;
                selectAllCb.checked = totalCbs > 0 && count === totalCbs;
            }
        }

        window.openMergeSelectedCustomersModal = () => {
            const selectedIds = Array.from(window.selectedCustomerIds);
            if (selectedIds.length < 2) {
                return alert(currentLang === 'en' ? 'Please select at least 2 customers to merge.' : 'Vui lòng tích chọn ít nhất 2 khách hàng để gộp.');
            }
            showMergeCustomersModal(selectedIds);
        };

        window.openMergeCustomerWithOthers = (customerId) => {
            window.selectedCustomerIds.add(customerId);
            updateCustomerSelectState();
            if (window.selectedCustomerIds.size < 2) {
                const cust = customersData.find(c => c.id === customerId);
                if (cust) {
                    const match = customersData.find(c => c.id !== customerId && ((c.phone && c.phone === cust.phone) || (c.displayName && c.displayName.toLowerCase() === cust.displayName.toLowerCase())));
                    if (match) window.selectedCustomerIds.add(match.id);
                }
            }
            if (window.selectedCustomerIds.size < 2) {
                return alert(currentLang === 'en' ? 'Please tick checkboxes for at least 2 customers to merge.' : 'Vui lòng tích chọn thêm ít nhất 1 khách hàng nữa để gộp.');
            }
            updateCustomerSelectState();
            showMergeCustomersModal(Array.from(window.selectedCustomerIds));
        };

        function showMergeCustomersModal(customerIds) {
            const modal = document.getElementById('merge-customers-modal');
            const primaryContainer = document.getElementById('merge-primary-select-container');
            const handlesPreview = document.getElementById('merge-tiktok-preview');
            const summaryPreview = document.getElementById('merge-customer-summary-preview');
            if (!modal || !primaryContainer) return;

            const targetCustomers = customersData.filter(c => customerIds.includes(c.id));
            if (targetCustomers.length < 2) return;

            let defaultPrimaryId = targetCustomers.find(c => c.phone && c.addressDetail)?.id || targetCustomers[0].id;

            function renderPrimaryOptions() {
                primaryContainer.innerHTML = targetCustomers.map(c => {
                    const isSelected = c.id === defaultPrimaryId;
                    const handles = String(c.tiktokUsername || '').split(/[\s,]+/).filter(Boolean).map(h => `@${h.replace(/^@+/, '')}`).join(', ');
                    const address = [c.addressDetail, c.ward, c.district, c.province].filter(Boolean).join(', ');
                    return `
                        <label class="flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/30' : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'}">
                            <input type="radio" name="primary-customer-radio" value="${escapeHtml(c.id)}" ${isSelected ? 'checked' : ''} class="mt-1 text-purple-600 focus:ring-purple-500" onchange="window.selectPrimaryCustomerForMerge('${escapeHtml(c.id)}')">
                            <div class="min-w-0 flex-1 text-xs">
                                <div class="flex items-center justify-between">
                                    <strong class="text-sm font-black ${isSelected ? 'text-purple-900 dark:text-purple-200' : 'text-gray-900 dark:text-gray-100'}">${escapeHtml(c.displayName || 'Khách hàng')}</strong>
                                    ${isSelected ? '<span class="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded-full font-bold">Khách chính</span>' : ''}
                                </div>
                                <p class="text-purple-700 dark:text-purple-400 font-bold mt-0.5">${escapeHtml(handles || 'Chưa có TikTok handle')}</p>
                                <p class="text-gray-500 dark:text-gray-400 mt-0.5">SĐT: ${escapeHtml(c.phone || 'Chưa có')} | Địa chỉ: ${escapeHtml(address || 'Chưa có')}</p>
                            </div>
                        </label>
                    `;
                }).join('');

                const allHandlesSet = new Set();
                targetCustomers.forEach(c => {
                    String(c.tiktokUsername || '').split(/[\s,]+/).forEach(h => {
                        const clean = h.replace(/^@+/, '').trim();
                        if (clean) allHandlesSet.add(clean);
                    });
                });
                handlesPreview.innerHTML = Array.from(allHandlesSet).map(h => `<span class="bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 text-xs px-2 py-1 rounded-lg font-bold border border-purple-300 dark:border-purple-700">@${escapeHtml(h)}</span>`).join('');

                const primaryCust = targetCustomers.find(c => c.id === defaultPrimaryId);
                const finalAddress = [
                    primaryCust.addressDetail || targetCustomers.find(c => c.addressDetail)?.addressDetail,
                    primaryCust.ward || targetCustomers.find(c => c.ward)?.ward,
                    primaryCust.district || targetCustomers.find(c => c.district)?.district,
                    primaryCust.province || targetCustomers.find(c => c.province)?.province
                ].filter(Boolean).join(', ');

                summaryPreview.innerHTML = `
                    <p class="font-bold text-gray-800 dark:text-gray-200">📌 Thông tin sau khi gộp:</p>
                    <p>• <strong>Hồ sơ chính:</strong> ${escapeHtml(primaryCust.displayName)} (${escapeHtml(primaryCust.phone || targetCustomers.find(c => c.phone)?.phone || 'Chưa có SĐT')})</p>
                    <p>• <strong>Địa chỉ giao hàng:</strong> ${escapeHtml(finalAddress || 'Chưa có địa chỉ')}</p>
                    <p>• <strong>Số lượng tài khoản TikTok gộp:</strong> ${allHandlesSet.size} nick TikTok</p>
                `;
            }

            window.selectPrimaryCustomerForMerge = (id) => {
                defaultPrimaryId = id;
                renderPrimaryOptions();
            };

            renderPrimaryOptions();
            modal.classList.remove('hidden');
        }

        window.closeMergeCustomersModal = () => {
            const modal = document.getElementById('merge-customers-modal');
            if (modal) modal.classList.add('hidden');
        };

        window.executeMergeCustomers = async () => {
            const primaryRadio = document.querySelector('input[name="primary-customer-radio"]:checked');
            if (!primaryRadio) return alert('Vui lòng chọn khách hàng chính.');

            const primaryId = primaryRadio.value;
            const selectedIds = Array.from(window.selectedCustomerIds);
            const secondaryIds = selectedIds.filter(id => id !== primaryId);

            if (secondaryIds.length === 0) {
                return alert('Cần có ít nhất 1 khách hàng phụ để gộp.');
            }

            try {
                const res = await fetch('/api/customers/merge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ primaryId, secondaryIds })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Lỗi khi gộp khách hàng');

                if (typeof showLiveToast === 'function') {
                    showLiveToast(`✅ Đã gộp thành công ${secondaryIds.length + 1} tài khoản khách hàng!`, 'success');
                } else {
                    alert(`✅ Đã gộp thành công ${secondaryIds.length + 1} tài khoản khách hàng!`);
                }
                closeMergeCustomersModal();
                window.selectedCustomerIds.clear();
                updateCustomerSelectState();
                await loadCustomers();
            } catch (err) {
                alert('❌ Lỗi: ' + err.message);
            }
        };

        async function loadCustomers() {
            if (!customersTableBody) return;
            const q = customerSearchInput ? customerSearchInput.value.trim() : '';
            customersTableBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">Đang tải...</td></tr>`;
            try {
                const res = await fetch('/api/customers?q=' + encodeURIComponent(q));
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Load customers error');
                customersData = data.customers || [];
                renderCustomersTable();
                updateOverallCustomerStats();
            } catch (error) {
                customersTableBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500">${escapeHtml(error.message)}</td></tr>`;
            }
        }

        function renderCustomersTable() {
            if (!customersTableBody) return;
            customersTableBody.textContent = '';
            
            let filteredData = [...customersData];
            if (currentCustomerFilter === 'missing-phone') {
                filteredData = filteredData.filter(c => !c.phone);
            } else if (currentCustomerFilter === 'missing-address') {
                filteredData = filteredData.filter(c => !c.addressDetail || !c.ward || !c.district || !c.province);
            } else if (currentCustomerFilter === 'has-note') {
                filteredData = filteredData.filter(c => !!c.addressNote);
            }

            if (!filteredData.length) {
                customersTableBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">Chưa có khách hàng phù hợp bộ lọc</td></tr>`;
                return;
            }

            filteredData.forEach(customer => {
                const address = [customer.addressDetail, customer.ward, customer.district, customer.province].filter(Boolean).join(', ');
                const isChecked = window.selectedCustomerIds.has(customer.id);
                const rawUsernames = String(customer.tiktokUsername || '').split(/[\s,]+/).map(h => h.replace(/^@+/, '').trim()).filter(Boolean);
                const handles = rawUsernames.map(u => `@${u}`);
                const displayName = getDisplayName(customer.displayName || '', rawUsernames[0] || '');

                const row = document.createElement('tr');
                row.className = 'border-b hover:bg-gray-50 dark:hover:bg-zinc-800/40';
                row.style.cursor = 'pointer';
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.customer-action-btn') || e.target.closest('.customer-select-checkbox')) return;
                    showCustomerDetail(customer);
                });

                // Select Cell
                const selectCell = document.createElement('td');
                selectCell.className = 'p-3 text-center customer-table-select';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'customer-select-checkbox w-4 h-4 rounded border-gray-300 cursor-pointer text-purple-600 focus:ring-purple-500';
                checkbox.dataset.id = customer.id;
                checkbox.checked = isChecked;
                checkbox.addEventListener('click', (e) => e.stopPropagation());
                checkbox.addEventListener('change', (e) => {
                    window.toggleCustomerSelect(customer.id, e.target.checked);
                });
                selectCell.appendChild(checkbox);

                const usernameCell = document.createElement('td');
                usernameCell.className = 'p-3 font-bold customer-table-username';
                if (handles.length <= 1) {
                    usernameCell.textContent = handles[0] || '—';
                } else {
                    usernameCell.innerHTML = handles.map(h => `<span class="inline-block bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 text-[11px] px-2 py-0.5 rounded font-bold mr-1 mb-0.5 border border-purple-200 dark:border-purple-700">${escapeHtml(h)}</span>`).join('');
                }

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
                    missing.className = 'badge-missing badge-missing-phone';
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
                    missing.className = 'badge-missing badge-missing-address';
                    missing.textContent = 'Thiếu địa chỉ';
                    addressCell.appendChild(missing);
                }

                const actionsCell = document.createElement('td');
                actionsCell.className = 'p-3 text-right customer-table-actions';
                
                const mergeBtn = document.createElement('button');
                mergeBtn.type = 'button';
                mergeBtn.className = 'customer-action-btn bg-purple-50 text-purple-600 hover:bg-purple-100 font-bold mr-1';
                mergeBtn.textContent = 'Gộp';
                mergeBtn.title = 'Gộp khách hàng này';
                mergeBtn.addEventListener('click', () => window.openMergeCustomerWithOthers(customer.id));

                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'customer-action-btn bg-blue-50 text-blue-600 mr-1';
                editBtn.textContent = 'Sửa';
                editBtn.addEventListener('click', () => editCustomer(customer.id));

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'customer-action-btn bg-red-50 text-red-600';
                removeBtn.textContent = 'Xóa';
                removeBtn.addEventListener('click', () => removeCustomer(customer.id));

                actionsCell.append(mergeBtn, editBtn, removeBtn);

                row.append(selectCell, usernameCell, nameCell, phoneCell, addressCell, actionsCell);
                customersTableBody.appendChild(row);
            });
            updateCustomerSelectState();
        }

        async function saveCustomerForm(event) {
            event.preventDefault();
            const customerId = document.getElementById('customer-id').value;
            const payload = getCustomerFormData();
            const status = document.getElementById('customer-form-status');
            if (!payload.displayName) {
                status.textContent = 'Tên người nhận là bắt buộc.';
                status.className = 'text-xs text-red-500 mt-1 font-bold';
                return;
            }
            if (payload.phone) {
                if (payload.phone.length < 9 || payload.phone.length > 13 || /[^\d\+]/.test(payload.phone)) {
                    status.textContent = 'Số điện thoại không hợp lệ (phải có từ 9 đến 13 số).';
                    status.className = 'text-xs text-red-500 mt-1 font-bold';
                    return;
                }
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
                if (data.warnings && data.warnings.length) {
                    status.textContent = '✅ Đã lưu khách hàng. Cảnh báo: ' + data.warnings.join(', ');
                    status.className = 'text-xs text-amber-600 mt-1 font-bold';
                } else {
                    status.textContent = '✅ Đã lưu khách hàng thành công.';
                    status.className = 'text-xs text-green-600 mt-1 font-bold';
                }
                await loadCustomers();
            } catch (error) {
                status.textContent = '❌ Lỗi: ' + error.message;
                status.className = 'text-xs text-red-500 mt-1 font-bold';
            }
        }

        window.resetCustomerForm = (clearStatus = true) => {
            setCustomerFormData({});
            const autoInput = document.getElementById('customer-auto-input');
            if (autoInput) autoInput.value = '';
            if (clearStatus) {
                document.getElementById('customer-form-status').textContent = '';
            }
            closeCustomerDetail();
        };

        function parseVietnameseAddress(raw) {
            let text = raw.trim();
            
            // 1. Trích xuất Số điện thoại chuẩn xác bằng Regex ranh giới từ \b
            let phone = '';
            const phoneMatch = text.match(/\b(?:\+84|84|0)(?:\d[\s.-]?){8,10}\b/);
            if (phoneMatch) {
                phone = phoneMatch[0].replace(/[\s.-]/g, '');
                text = text.replace(phoneMatch[0], '');
            }
            
            // 2. Làm sạch các từ khoá tiền tố nhiễu thường gặp khi copy paste
            text = text.replace(/(?:sđt|sdt|đt|dt|phone|tel|địa chỉ|dc|d\/c|khách hàng|tên|giao hàng)[:\-\s]*/gi, '');
            
            let parts = text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
            parts = parts.map(p => p.replace(/^[!:\-\s.]+|[!:\-\s.]+$/g, '')).filter(Boolean);
            
            if (parts.length === 0) return { phone, province: '', district: '', ward: '', addressDetail: '' };
            
            let province = '';
            let district = '';
            let ward = '';
            
            const provinces = [
                'hà nội', 'ha noi', 'hồ chí minh', 'ho chi minh', 'hcm', 'tphcm', 'sài gòn', 'sai gon',
                'hải phòng', 'hai phong', 'đà nẵng', 'da nang', 'cần thơ', 'can tho',
                'an giang', 'bà rịa - vũng tàu', 'ba ria vung tau', 'vũng tàu', 'vung tau', 'bắc giang', 'bac giang', 'bắc kạn', 'bac kan', 'bạc liêu', 'bac lieu', 'bắc ninh', 'bac ninh', 'bến tre', 'ben tre', 'bình định', 'binh dinh', 'bình dương', 'binh duong', 'bình phước', 'binh phuoc', 'bình thuận', 'binh thuan', 'cà mau', 'ca mau', 'cao bằng', 'cao bang', 'đắk lắk', 'dak lak', 'đắk nông', 'dak nong', 'điện biên', 'dien bien', 'đồng nai', 'dong nai', 'đồng tháp', 'dong thap', 'gia lai', 'hà giang', 'ha giang', 'hà nam', 'ha nam', 'hà tĩnh', 'ha tinh', 'hải dương', 'hai duong', 'hậu giang', 'hau giang', 'hòa bình', 'hoa binh', 'hưng yên', 'hung yen', 'khánh hòa', 'khanh hoa', 'nha trang', 'kiên giang', 'kien giang', 'kon tum', 'lai châu', 'lai chau', 'lâm đồng', 'lam dong', 'đà lạt', 'da lat', 'lạng sơn', 'lang son', 'lào cai', 'lao cai', 'long an', 'nam định', 'nam dinh', 'nghệ an', 'nghe an', 'ninh bình', 'ninh binh', 'ninh thuận', 'ninh thuan', 'phú thọ', 'phu tho', 'phú yên', 'phu yen', 'quảng bình', 'quang binh', 'quảng nam', 'quang nam', 'quảng ngãi', 'quang ngai', 'quảng ninh', 'quang ninh', 'quảng trị', 'quang tri', 'sóc trăng', 'soc trang', 'sơn la', 'son la', 'tây ninh', 'tay ninh', 'thái bình', 'thai binh', 'thái nguyên', 'thai nguyen', 'thanh hóa', 'thanh hoa', 'thừa thiên huế', 'thừa thiên - huế', 'huế', 'hue', 'tiền giang', 'tien giang', 'trà vinh', 'tra vinh', 'tuyên quang', 'tuyen quang', 'vĩnh long', 'vinh long', 'vĩnh phúc', 'vinh phuc', 'yên bái', 'yen bai'
            ];
            
            const normalize = s => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
            
            function isWard(s) {
                const norm = normalize(s);
                return /(?:^|\s)(phường|phuong|xã|xa|thị trấn|thi tran)(?:\s|$)/i.test(norm) || /^(p|x|tt)\.?\s/i.test(norm);
            }
            
            function isDistrict(s) {
                const norm = normalize(s);
                return /(?:^|\s)(quận|quan|huyện|huyen|thị xã|thi xa)(?:\s|$)/i.test(norm) || /^(q|h|tx)\.?\s/i.test(norm);
            }
            
            // Tìm kiếm ngược từ dưới lên
            if (parts.length > 0) {
                const lastPart = parts[parts.length - 1];
                const normalizedLast = normalize(lastPart);
                
                // Kiểm tra xem phần tử cuối cùng có chứa tỉnh thành nào không
                const matchedProvince = provinces.find(p => normalizedLast === p || normalizedLast.endsWith(' ' + p) || normalizedLast.startsWith(p + ' '));
                if (matchedProvince) {
                    province = lastPart;
                    parts.pop();
                } else {
                    const provinceKeywords = ['tỉnh', 'tp', 'thành phố', 'city', 'tinh', 'thanh pho', 'hà nội', 'hồ chí minh', 'đà nẵng', 'hải phòng', 'cần thơ', 'ha noi', 'ho chi minh', 'hcm', 'da nang', 'hai phong', 'can tho', 'bình dương', 'đồng nai', 'long an'];
                    if (provinceKeywords.some(k => normalizedLast.includes(k))) {
                        province = lastPart;
                        parts.pop();
                    }
                }
            }
            
            // Duyệt ngược các phần tử còn lại (chừa lại index 0 cho addressDetail)
            while (parts.length > 1) {
                const currentPart = parts[parts.length - 1];
                
                if (isWard(currentPart)) {
                    if (!ward) {
                        ward = currentPart;
                        parts.pop();
                        continue;
                    }
                }
                
                if (isDistrict(currentPart)) {
                    if (!district) {
                        district = currentPart;
                        parts.pop();
                        continue;
                    }
                }
                
                // Nếu không có keyword rõ ràng
                if (!district && !ward) {
                    district = currentPart;
                    parts.pop();
                } else if (district && !ward) {
                    ward = currentPart;
                    parts.pop();
                } else {
                    break;
                }
            }
            
            const addressDetail = parts.join(', ');
            return { phone, province, district, ward, addressDetail };
        }

        window.autoFillCustomerForm = async () => {
            const raw = (document.getElementById('customer-auto-input')?.value || '').trim();
            if (!raw) {
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) document.getElementById('customer-auto-input').value = text.trim();
                } catch (_) {}
                return;
            }

            const { phone, province, district, ward, addressDetail } = parseVietnameseAddress(raw);

            if (phone) document.getElementById('customer-phone').value = phone;
            if (province) document.getElementById('customer-province').value = province;
            if (district) document.getElementById('customer-district').value = district;
            if (ward) document.getElementById('customer-ward').value = ward;
            if (addressDetail) document.getElementById('customer-address-detail').value = addressDetail;

            const status = document.getElementById('customer-form-status');
            if (status) {
                const filled = [phone && 'SĐT', province && 'Tỉnh', district && 'Huyện', ward && 'Xã/Phường', addressDetail && 'Địa chỉ'].filter(Boolean);
                status.textContent = filled.length ? `✅ Đã điền: ${filled.join(', ')}` : '⚠️ Không nhận ra định dạng. Hãy nhập thêm dữ liệu.';
                status.className = filled.length ? 'text-xs text-green-600 mt-1' : 'text-xs text-amber-600 mt-1';
            }
        };



        window.setCustomerFilter = (filterValue) => {
            currentCustomerFilter = filterValue;
            const buttons = document.querySelectorAll('.customer-filter-btn');
            buttons.forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-filter') === filterValue);
            });
            renderCustomersTable();
        };

        window.showCustomerDetail = (customer) => {
            const detailPanel = document.getElementById('customer-detail-panel');
            const formPanel = document.getElementById('customer-form');
            if (!detailPanel || !formPanel) return;

            const initial = (customer.displayName || customer.tiktokUsername || 'K').trim().charAt(0).toUpperCase();
            document.getElementById('detail-avatar').textContent = initial;
            document.getElementById('detail-display-name').textContent = customer.displayName || 'Chưa đặt tên';
            document.getElementById('detail-tiktok').textContent = customer.tiktokUsername ? `@${customer.tiktokUsername}` : 'Không có TikTok';
            
            document.getElementById('detail-phone').textContent = customer.phone || 'Chưa có SĐT';
            
            const address = [customer.addressDetail, customer.ward, customer.district, customer.province].filter(Boolean).join(', ');
            document.getElementById('detail-address').textContent = address || 'Chưa có địa chỉ';
            
            document.getElementById('detail-note').textContent = customer.addressNote || 'Không có ghi chú';
            document.getElementById('detail-code').textContent = customer.customerCode || 'Chưa có mã';

            document.getElementById('detail-edit-btn').onclick = () => editCustomer(customer.id);
            document.getElementById('detail-delete-btn').onclick = () => removeCustomer(customer.id);

            formPanel.classList.add('hidden');
            detailPanel.classList.remove('hidden');
        };

        window.closeCustomerDetail = () => {
            const detailPanel = document.getElementById('customer-detail-panel');
            const formPanel = document.getElementById('customer-form');
            if (detailPanel) detailPanel.classList.add('hidden');
            if (formPanel) formPanel.classList.remove('hidden');
        };

        window.copyDetailField = (id) => {
            const text = document.getElementById(id)?.innerText || '';
            if (!text || text.includes('Chưa có') || text.includes('Không có')) return;
            navigator.clipboard.writeText(text).then(() => {
                alert(currentLang === 'en' ? 'Copied to clipboard' : 'Đã sao chép vào bộ nhớ tạm');
            }).catch(() => {
                alert(currentLang === 'en' ? 'Failed to copy' : 'Không thể sao chép');
            });
        };

        window.editCustomer = (customerId) => {
            const customer = customersData.find(item => item.id === customerId);
            if (!customer) return;
            setCustomerFormData(customer);
            closeCustomerDetail();
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




        // ─── Batch Actions for Orders ──────────────────────────────────────────────
        window.selectedOrderUsernames = new Set();

        window.toggleOrderSelect = (event, username) => {
            event.stopPropagation();
            const norm = normalizeTikTokUsername(username);
            const chk = event.currentTarget;
            if (chk.checked) {
                window.selectedOrderUsernames.add(norm);
            } else {
                window.selectedOrderUsernames.delete(norm);
            }
            window.updateSelectAllCheckboxState();
            window.updateBatchActionBar();
        };

        window.toggleAllOrdersSelect = (event) => {
            const chk = event.currentTarget;
            const isManual = (currentView === 'orders' || currentView === 'customers');
            const gridSelector = isManual ? '#section-current-orders [data-current-orders-grid]' : '#live-current-orders-panel [data-current-orders-grid]';
            const grid = document.querySelector(gridSelector);
            if (!grid) return;

            const cards = grid.querySelectorAll('.live-order-card');
            cards.forEach(card => {
                const username = card.getAttribute('data-username');
                if (!username) return;
                const norm = normalizeTikTokUsername(username);
                const cardChk = card.querySelector('.order-select-checkbox');
                if (cardChk) cardChk.checked = chk.checked;
                
                if (chk.checked) {
                    window.selectedOrderUsernames.add(norm);
                } else {
                    window.selectedOrderUsernames.delete(norm);
                }
            });
            window.updateBatchActionBar();
        };

        window.updateSelectAllCheckboxState = () => {
            const isManual = (currentView === 'orders' || currentView === 'customers');
            const gridSelector = isManual ? '#section-current-orders [data-current-orders-grid]' : '#live-current-orders-panel [data-current-orders-grid]';
            const grid = document.querySelector(gridSelector);
            if (!grid) return;

            const cards = grid.querySelectorAll('.live-order-card');
            const chkId = isManual ? 'manual-select-all-orders-checkbox' : 'live-select-all-orders-checkbox';
            const selectAllChk = document.getElementById(chkId);
            if (!selectAllChk) return;

            if (cards.length === 0) {
                selectAllChk.checked = false;
                return;
            }

            const allChecked = Array.from(cards).every(card => {
                const username = card.getAttribute('data-username');
                return username && window.selectedOrderUsernames.has(normalizeTikTokUsername(username));
            });
            selectAllChk.checked = allChecked;
        };

        window.updateBatchActionBar = () => {
            const bar = document.getElementById('batch-action-bar');
            const countSpan = document.getElementById('batch-action-count');
            if (!bar) return;

            const count = window.selectedOrderUsernames.size;
            if (countSpan) countSpan.textContent = `Đã chọn ${count} đơn`;

            if (count > 0) {
                bar.classList.remove('translate-y-24', 'opacity-0');
                bar.classList.add('translate-y-0', 'opacity-100');
            } else {
                bar.classList.remove('translate-y-0', 'opacity-100');
                bar.classList.add('translate-y-24', 'opacity-0');
            }
        };

        window.clearAllSelectedOrders = () => {
            window.selectedOrderUsernames.clear();
            
            // Reset all card checkboxes
            document.querySelectorAll('.order-select-checkbox').forEach(chk => chk.checked = false);
            
            // Reset select all checkboxes
            const liveAll = document.getElementById('live-select-all-orders-checkbox');
            if (liveAll) liveAll.checked = false;
            const manualAll = document.getElementById('manual-select-all-orders-checkbox');
            if (manualAll) manualAll.checked = false;

            window.updateBatchActionBar();
        };

        window.batchPrintSelectedOrders = () => {
            const count = window.selectedOrderUsernames.size;
            if (count === 0) return;
            const isManual = (currentView === 'orders' || currentView === 'customers');

            window.selectedOrderUsernames.forEach(username => {
                socket.emit('reprint-total', { username, isManual });
            });

            showLiveToast(currentLang === 'en' ? `Printing ${count} order summaries...` : `Đang gửi lệnh in ${count} đơn...`, 'success');
            window.clearAllSelectedOrders();
        };

        window.batchDeleteSelectedOrders = () => {
            const count = window.selectedOrderUsernames.size;
            if (count === 0) return;
            const isManual = (currentView === 'orders' || currentView === 'customers');

            const msg = currentLang === 'en' 
                ? `Are you sure you want to delete all ${count} selected orders?` 
                : `Bạn có chắc chắn muốn xóa toàn bộ ${count} đơn đã chọn?`;

            if (confirm(msg)) {
                const dataTarget = isManual ? ordersData : liveOrdersData;
                const gridSelector = isManual ? '#section-current-orders [data-current-orders-grid]' : '#live-current-orders-panel [data-current-orders-grid]';
                const grid = document.querySelector(gridSelector);

                window.selectedOrderUsernames.forEach(username => {
                    const norm = normalizeTikTokUsername(username);
                    delete dataTarget[norm];
                    if (grid) {
                        grid.querySelector(`[data-username="${CSS.escape(norm)}"]`)?.remove();
                    }
                    socket.emit('delete-customer', { username: norm, isManual });
                });

                if (grid) {
                    const panel = grid.closest('[data-current-orders-panel]');
                    if (panel) {
                        const empty = panel.querySelector('[data-current-orders-empty]');
                        const hasCards = grid.querySelector('[data-username]');
                        if (empty) {
                            empty.hidden = !!hasCards;
                            empty.classList.toggle('hidden', !!hasCards);
                        }
                    }
                }

                if (isManual) {
                    updateManualKpiCounters();
                } else {
                    updateLiveKpiCounters();
                    updateLiveOrdersToggleLabel();
                }

                showLiveToast(currentLang === 'en' ? `Deleted ${count} orders.` : `Đã xóa ${count} đơn.`, 'success');
                window.clearAllSelectedOrders();
            }
        };
        window.reprintItem = (username, itemId) => {
            const isManual = (currentView === 'orders' || currentView === 'customers');
            const norm = normalizeTikTokUsername(username);
            const dataTarget = isManual ? ordersData : liveOrdersData;
            const item = dataTarget[norm]?.items?.find(i => String(i.id) === String(itemId));

            if (item && (item.printed || item.printedAt)) {
                const msg = currentLang === 'en' 
                    ? 'This item was ALREADY printed. Do you want to print it again?' 
                    : 'Món hàng này ĐÃ IN rồi. Bạn có muốn in lại lần nữa không?';
                if (!confirm(msg)) return;
            }

            if (item) {
                item.printed = true;
                item.printedAt = new Date().toISOString();
                if (isManual) patchManualOrderCard(norm);
                else patchLiveOrderCard(norm);
            }

            socket.emit('reprint-item', { username: norm, itemId, isManual });
        };

        window.reprintTotal = (username) => {
            const isManual = (currentView === 'orders' || currentView === 'customers');
            const norm = normalizeTikTokUsername(username);
            const dataTarget = isManual ? ordersData : liveOrdersData;
            const order = dataTarget[norm];
            const hasPrinted = order?.items?.some(i => i.printed || i.printedAt);

            if (hasPrinted) {
                const msg = currentLang === 'en' 
                    ? 'Orders for this customer have ALREADY been printed. Do you want to print again?' 
                    : 'Đơn của khách này ĐÃ IN rồi. Bạn có muốn in lại lần nữa không?';
                if (!confirm(msg)) return;
            }

            if (order && Array.isArray(order.items)) {
                const nowIso = new Date().toISOString();
                order.items.forEach(i => {
                    i.printed = true;
                    i.printedAt = nowIso;
                });
                if (isManual) patchManualOrderCard(norm);
                else patchLiveOrderCard(norm);
            }

            socket.emit('reprint-total', { username: norm, isManual });
        };

        window.deleteCustomer = (username) => {
            const handle = formatTikTokUsername(username);
            const msg = currentLang === 'en' ? `Delete all orders for ${handle}?` : `Xóa toàn bộ đơn của khách ${handle}?`;
            if (confirm(msg)) {
                const norm = normalizeTikTokUsername(username);
                const isManual = (currentView === 'orders' || currentView === 'customers');
                
                // Optimistic UI update: delete local customer data and update DOM
                const dataTarget = isManual ? ordersData : liveOrdersData;
                delete dataTarget[norm];

                const gridSelector = isManual ? '#section-current-orders [data-current-orders-grid]' : '#live-current-orders-panel [data-current-orders-grid]';
                const grid = document.querySelector(gridSelector);
                if (grid) {
                    grid.querySelector(`[data-username="${CSS.escape(norm)}"]`)?.remove();
                    const panel = grid.closest('[data-current-orders-panel]');
                    if (panel) {
                        const empty = panel.querySelector('[data-current-orders-empty]');
                        const hasCards = grid.querySelector('[data-username]');
                        if (empty) {
                            empty.hidden = !!hasCards;
                            empty.classList.toggle('hidden', !!hasCards);
                        }
                    }
                }

                if (isManual) {
                    updateManualKpiCounters();
                } else {
                    updateLiveKpiCounters();
                    updateLiveOrdersToggleLabel();
                }

                socket.emit('delete-customer', { username: norm, isManual });
            }
        };

        // ─── Bước 6: deleteItem optimistic — xóa DOM ngay không chờ server ──────────
        window.deleteItem = (username, itemId) => {
            const msg = currentLang === 'en' ? 'Delete this item?' : 'Xóa món hàng này?';
            if (!confirm(msg)) return;

            const norm = normalizeTikTokUsername(username);
            const isManual = (currentView === 'orders' || currentView === 'customers');

            // Optimistic update: xóa DOM row ngay lập tức trong grid thích hợp
            const gridSelector = isManual ? '#section-current-orders [data-current-orders-grid]' : '#live-current-orders-panel [data-current-orders-grid]';
            const grid = document.querySelector(gridSelector);
            if (grid) {
                const card = grid.querySelector(`[data-username="${CSS.escape(norm)}"]`);
                if (card) {
                    const itemRow = card.querySelector(`[data-item-id="${CSS.escape(String(itemId))}"]`);
                    if (itemRow) itemRow.remove();

                    // Cập nhật local state
                    const dataTarget = isManual ? ordersData : liveOrdersData;
                    if (dataTarget[norm]) {
                        dataTarget[norm].items = (dataTarget[norm].items || []).filter(i => String(i.id) !== String(itemId));
                        dataTarget[norm].total = dataTarget[norm].items.reduce((s, i) => s + Number(i.price || 0), 0);
                        const newTotal = dataTarget[norm].total;
                        const newCount = dataTarget[norm].items.length;
                        const statsEl = card.querySelector('.live-order-card-stats');
                        if (statsEl) {
                            const spans = statsEl.querySelectorAll('strong');
                            if (spans[0]) spans[0].textContent = `${newCount} đơn`;
                            if (spans[1]) spans[1].textContent = formatMoney(newTotal);
                        }
                        const footEl = card.querySelector('.live-order-card-foot strong');
                        if (footEl) footEl.textContent = formatMoney(newTotal);
                    }
                }
            }

            if (isManual) updateManualKpiCounters(); else updateLiveKpiCounters();

            // Đồng bộ với server
            socket.emit('delete-item', { username: norm, itemId, isManual });
        };

        window.addOrderItem = (username) => {
            const normalizedUsername = normalizeTikTokUsername(username);
            const isManual = (currentView === 'orders' || currentView === 'customers');
            const dataTarget = isManual ? ordersData : liveOrdersData;
            const customer = dataTarget[normalizedUsername];
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
                price,
                isManual
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
            const dataTarget = currentView === 'live' ? liveOrdersData : ordersData;
            let html = `<div style="font-family: 'Times New Roman', Times, serif; width: 80mm; margin: 0 auto; color: black; padding: 10px;">`;
            html += `<div style="text-align:center; margin-bottom: 15px;"><h2 style="margin: 0; font-size: 18px; font-weight: bold;">TỔNG KẾT PHIÊN ĐƠN</h2><hr style="border: 1px solid black; margin-top: 5px;"></div>`;
            let totalOverall = 0;
            let index = 1;
            
            Object.values(dataTarget).forEach(o => {
                totalOverall += o.total;
                const username = normalizeTikTokUsername(o.username || o.customerUsername || '');
                const customerLabel = buildCustomerLabel(o.nickname || o.displayName || '', username);
                
                html += `<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #ccc; padding: 6px 0; font-size: 14px;">`;
                html += `<span style="font-weight: bold; flex: 1; padding-right: 10px; word-break: break-word;">${index}. ${escapeHtml(customerLabel)}</span>`;
                html += `<span style="font-weight: 900; white-space: nowrap;">${formatMoney(o.total)}</span>`;
                html += `</div>`;
                index++;
            });
            
            html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; border-top: 2px solid black; padding-top: 8px;">`;
            html += `<span style="font-size: 15px; font-weight: bold;">TỔNG CỘNG:</span>`;
            html += `<strong style="font-size: 18px; font-weight: 950; color: black;">${formatMoney(totalOverall)}</strong>`;
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

                    // --- PRE-FILL TIKTOK ID INPUT ---
                    const scopedDefaultKey = getScopedStorageKey('defaultTikTokId');
                    const scopedLastBroadcasterKey = getScopedStorageKey('lastBroadcasterId');

                    const defaultTikTokId = scopedDefaultKey ? (localStorage.getItem(scopedDefaultKey) || '').trim() : '';
                    const lastBroadcasterId = scopedLastBroadcasterKey ? (localStorage.getItem(scopedLastBroadcasterKey) || '').trim() : '';

                    const idToFill = defaultTikTokId || lastBroadcasterId || '';
                    if (idToFill && tiktokIdInput) {
                        tiktokIdInput.value = idToFill;
                        activeBroadcasterId = idToFill;
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

            // Server đã tự flush & lưu session khi stream kết thúc (flushSessionToDb)
            // Không cần client auto-save thêm để tránh tạo phiên trùng lặp
            if (Object.keys(liveOrdersData).length > 0) {
                showLiveToast('✅ Phiên live đã được lưu tự động bởi server.', 'success');
                refreshOverviewTopShops?.();
            }

            // Dọn sạch dữ liệu đơn chốt và cập nhật lại trạng thái kết nối trên UI
            liveOrdersData = {};
            document.body.classList.remove('live-connected');
            document.body.classList.add('live-disconnected');
            if (statusMsg) {
                statusMsg.innerText = currentLang === 'en' ? 'Disconnected' : 'Chưa kết nối';
                statusMsg.className = 'live-status-text text-red-600 font-semibold';
            }
            if (btnConnect) {
                btnConnect.innerHTML = '⚡ ' + (currentLang === 'en' ? 'Connect' : 'Kết nối');
                btnConnect.className = 'px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1';
            }
            const btnOpenSettings = document.getElementById('btn-open-settings');
            if (btnOpenSettings) {
                btnOpenSettings.classList.remove('hidden');
            }
            calculateKpis();
            renderEmptyCommentState();
        });

        // autoSaveCurrentSession đã bị bỏ vì server tự flush qua flushSessionToDb trước khi emit live-ended

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
            const isLive = currentView === 'live';
            const dataTarget = isLive ? liveOrdersData : ordersData;

            if (Object.keys(dataTarget).length === 0) {
                return alert(currentLang === 'en' ? 'No orders to save yet!' : 'Chưa có đơn hàng nào để lưu!');
            }
            const tiktokId = (isLive ? activeBroadcasterId : null) || (tiktokIdInput ? tiktokIdInput.value.trim().replace('@', '') : '') || '';
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
                        orders: dataTarget
                    })
                });
                const data = await res.json();
                if (data.success) {
                    alert((currentLang === 'en' ? 'Saved session successfully: ' : 'Lưu phiên live thành công: ') + liveName);
                    if (isLive) {
                        liveOrdersData = {};
                        renderLiveCurrentOrders();
                    } else {
                        ordersData = {};
                        renderManualCurrentOrders();
                    }
                    calculateKpis();
                    if (typeof refreshOverviewTopShops === 'function') refreshOverviewTopShops();
                } else {
                    alert('Lỗi lưu phiên: ' + (data.error || 'Unknown'));
                }
            } catch (e) {
                alert('Lỗi kết nối server khi lưu phiên: ' + e.message);
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
                                <p class="font-bold text-gray-800 text-sm flex items-center gap-1">
                                    <span class="session-name-text">${escapeHtml(s.liveName)}</span>
                                    ${!isLegacy ? `
                                    <button onclick="renameSession('${safeSessionId}', this)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-purple-600 transition text-xs leading-none p-0.5" title="Đổi tên phiên">
                                        ✏️
                                    </button>
                                    ` : ''}
                                </p>
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

        window.renameSession = async (sessionId, btnEl) => {
            const container = btnEl.closest('.flex.items-start');
            if (!container) return;
            const textEl = container.querySelector('.session-name-text');
            if (!textEl) return;
            const currentName = textEl.textContent.trim();
            
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentName;
            input.className = 'font-bold text-gray-800 text-sm border-b border-purple-500 outline-none bg-transparent py-0 px-1 w-full max-w-[200px]';
            
            textEl.replaceWith(input);
            btnEl.classList.add('hidden');
            input.focus();
            input.select();
            
            let isSaved = false;
            const save = async () => {
                if (isSaved) return;
                isSaved = true;
                const newName = input.value.trim();
                if (!newName || newName === currentName) {
                    input.replaceWith(textEl);
                    btnEl.classList.remove('hidden');
                    return;
                }
                try {
                    const res = await fetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/name`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ newName })
                    });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok) {
                        textEl.textContent = newName;
                        showLiveToast(currentLang === 'en' ? '✅ Renamed session' : '✅ Đã đổi tên phiên', 'success');
                        input.replaceWith(textEl);
                        btnEl.classList.remove('hidden');
                        showLiveSessions(); // Fetch updated list behind the scenes
                    } else {
                        alert(data.error || 'Error renaming session');
                        input.replaceWith(textEl);
                        btnEl.classList.remove('hidden');
                    }
                } catch (e) {
                    alert('Error: ' + e.message);
                    input.replaceWith(textEl);
                    btnEl.classList.remove('hidden');
                }
            };
            
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') {
                    isSaved = true;
                    input.replaceWith(textEl);
                    btnEl.classList.remove('hidden');
                }
            });
            input.addEventListener('blur', save);
        };

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

                // Clear selection and update merge button status
                if (typeof selectedSessionIds !== 'undefined') {
                    selectedSessionIds.clear();
                }
                if (typeof updateMergeBtn === 'function') {
                    updateMergeBtn();
                }

                // Reload list of sessions to reflect deletions immediately on the UI
                if (typeof showLiveSessions === 'function') {
                    showLiveSessions();
                }

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

        // ==================== OFFLINE CUSTOMER ADD LOGIC ====================
        let activeOfflineSuggestions = [];
        let selectedOfflineCustomer = null;

        window.openAddOfflineCustomerModal = () => {
            selectedOfflineCustomer = null;
            document.getElementById('offline-cust-tiktok').value = '';
            document.getElementById('offline-cust-name').value = '';
            document.getElementById('offline-cust-product').value = '';
            document.getElementById('offline-cust-price').value = '';
            document.getElementById('offline-cust-autocomplete-list').classList.add('hidden');
            document.getElementById('modal-add-offline-customer').classList.remove('hidden');
            setTimeout(() => document.getElementById('offline-cust-name').focus(), 80);
        };

        window.closeAddOfflineCustomerModal = () => {
            document.getElementById('modal-add-offline-customer').classList.add('hidden');
        };

        // Autocomplete logic
        let offlineAutocompleteTimeout = null;
        document.addEventListener('DOMContentLoaded', () => {
            const nameInput = document.getElementById('offline-cust-name');
            const listContainer = document.getElementById('offline-cust-autocomplete-list');
            const tiktokInput = document.getElementById('offline-cust-tiktok');

            if (nameInput && listContainer) {
                nameInput.addEventListener('input', (e) => {
                    const val = e.target.value.trim();
                    if (offlineAutocompleteTimeout) clearTimeout(offlineAutocompleteTimeout);

                    if (!val) {
                        listContainer.classList.add('hidden');
                        return;
                    }

                    offlineAutocompleteTimeout = setTimeout(async () => {
                        try {
                            const res = await fetch('/api/customers?q=' + encodeURIComponent(val));
                            if (!res.ok) return;
                            const data = await res.json();
                            const customers = Array.isArray(data?.customers) ? data.customers : [];
                            activeOfflineSuggestions = customers.slice(0, 5); // Tối đa 5 gợi ý

                            if (activeOfflineSuggestions.length === 0) {
                                listContainer.classList.add('hidden');
                                return;
                            }

                            listContainer.innerHTML = '';
                            activeOfflineSuggestions.forEach(c => {
                                const item = document.createElement('div');
                                item.className = 'p-3 hover:bg-purple-50 cursor-pointer border-b last:border-0 flex items-center gap-3 transition-colors';
                                
                                const handle = c.tiktokUsername ? `@${c.tiktokUsername}` : '';
                                const label = c.displayName || '';
                                
                                const avatar = isAvatarUrl(c.profilePictureUrl) ? c.profilePictureUrl : buildInitialAvatarDataUri(label);
                                
                                item.innerHTML = `
                                    <img src="${escapeHtml(avatar)}" class="w-6 h-6 rounded-full object-cover">
                                    <div class="flex-1 min-w-0">
                                        <p class="font-bold text-xs text-gray-800 truncate">${escapeHtml(label)}</p>
                                        ${handle ? `<p class="text-[10px] text-gray-400 font-mono">${escapeHtml(handle)}</p>` : ''}
                                    </div>
                                `;
                                item.addEventListener('click', () => {
                                    selectedOfflineCustomer = c;
                                    nameInput.value = c.displayName || '';
                                    if (tiktokInput && c.tiktokUsername) {
                                        tiktokInput.value = `@${c.tiktokUsername}`;
                                    }
                                    listContainer.classList.add('hidden');
                                    document.getElementById('offline-cust-product').focus();
                                });
                                listContainer.appendChild(item);
                            });
                            listContainer.classList.remove('hidden');
                        } catch (err) {
                            console.error('Lỗi tìm kiếm gợi ý khách hàng:', err);
                        }
                    }, 250);
                });

                // Đóng dropdown khi click ngoài
                document.addEventListener('click', (e) => {
                    if (e.target !== nameInput && !listContainer.contains(e.target)) {
                        listContainer.classList.add('hidden');
                    }
                });
            }

            // Click ngoài backdrop để đóng modal
            const modal = document.getElementById('modal-add-offline-customer');
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) closeAddOfflineCustomerModal();
                });
            }
        });

        window.submitAddOfflineCustomer = () => {
            const name = document.getElementById('offline-cust-name').value.trim();
            const tiktokRaw = document.getElementById('offline-cust-tiktok').value.trim();
            const product = document.getElementById('offline-cust-product').value.trim();
            const price = parseFloat(document.getElementById('offline-cust-price').value);

            if (!name) {
                alert(currentLang === 'en' ? 'Recipient name is required.' : 'Tên người nhận là bắt buộc.');
                return;
            }
            if (Number.isNaN(price) || price <= 0) {
                alert(currentLang === 'en' ? 'Please enter a valid price.' : 'Vui lòng nhập giá tiền hợp lệ.');
                return;
            }

            // Chuẩn hóa TikTok Username
            let username = normalizeTikTokUsername(tiktokRaw);
            if (!username) {
                // Nếu khách không có TikTok, tạo key tạm thời offline_timestamp
                username = selectedOfflineCustomer?.tiktokUsername || `offline_${Date.now()}`;
            }

            const isManual = (currentView === 'orders' || currentView === 'customers');
            socket.emit('confirm-item', {
                uniqueId: username,
                nickname: name,
                profilePictureUrl: selectedOfflineCustomer?.profilePictureUrl || '',
                comment: product || (currentLang === 'en' ? 'Offline purchase' : 'Mua ngoài live'),
                price: price,
                isManual
            });

            closeAddOfflineCustomerModal();
        };

        // ==================== DI ĐƠN / DELIVERY VIEW LOGIC ====================
        let deliverySessionsList = [];
        const selectedDeliverySessionIds = new Set();
        let deliveryShowOnlyMissing = false;
        let deliveryCachedPreviewGroups = [];
        let selectedDeliveryCustomerKeys = new Set();

        window.switchDeliveryTab = (tab) => {
            const btnProcess = document.getElementById('delivery-tab-btn-process');
            const btnSettings = document.getElementById('delivery-tab-btn-settings');
            const contentProcess = document.getElementById('delivery-tab-content-process');
            const contentSettings = document.getElementById('delivery-tab-content-settings');

            if (tab === 'settings') {
                btnProcess.className = 'pb-3 font-bold border-b-2 border-transparent text-gray-400 hover:text-gray-600 px-1 transition-all';
                btnSettings.className = 'pb-3 font-bold border-b-2 border-red-500 text-red-600 px-1 transition-all';
                contentProcess.classList.add('hidden');
                contentSettings.classList.remove('hidden');
                loadDeliveryDefaults();
            } else {
                btnProcess.className = 'pb-3 font-bold border-b-2 border-red-500 text-red-600 px-1 transition-all';
                btnSettings.className = 'pb-3 font-bold border-b-2 border-transparent text-gray-400 hover:text-gray-600 px-1 transition-all';
                contentProcess.classList.remove('hidden');
                contentSettings.classList.add('hidden');
            }
        };

        window.toggleRejectionFeeDisplay = (val) => {
            const wrapper = document.getElementById('delivery-def-rejection-amount-wrapper');
            if (wrapper) {
                if (val === 'Y') {
                    wrapper.classList.remove('hidden');
                } else {
                    wrapper.classList.add('hidden');
                }
            }
        };

        function getDeliveryDefaults() {
            const key = `delivery_defaults_${currentUserUid || 'global'}`;
            const saved = localStorage.getItem(key);
            const standard = {
                weight: 0.5,
                ship: 0,
                length: 20,
                width: 10,
                height: 10,
                allowTry: 'N',
                viewOnly: 'Y',
                partial: 'N',
                payment: 'Người gửi trả',
                rejectionEnabled: 'N',
                rejectionAmount: 0,
                deliveryNote: '',
                addressSystem: 'new'
            };
            if (!saved) return standard;
            try {
                return { ...standard, ...JSON.parse(saved) };
            } catch (e) {
                return standard;
            }
        }

        window.loadDeliveryDefaults = () => {
            const defaults = getDeliveryDefaults();
            
            document.getElementById('delivery-def-weight').value = defaults.weight;
            document.getElementById('delivery-def-ship').value = defaults.ship;
            document.getElementById('delivery-def-length').value = defaults.length;
            document.getElementById('delivery-def-width').value = defaults.width;
            document.getElementById('delivery-def-height').value = defaults.height;
            document.getElementById('delivery-def-allow-try').value = defaults.allowTry;
            document.getElementById('delivery-def-view-only').value = defaults.viewOnly;
            document.getElementById('delivery-def-partial').value = defaults.partial;
            document.getElementById('delivery-def-payment').value = defaults.payment;
            document.getElementById('delivery-def-rejection-enabled').value = defaults.rejectionEnabled;
            document.getElementById('delivery-def-rejection-amount').value = defaults.rejectionAmount;
            document.getElementById('delivery-def-delivery-note').value = defaults.deliveryNote;
            
            const defAddressSystem = document.getElementById('delivery-def-address-system');
            if (defAddressSystem) defAddressSystem.value = defaults.addressSystem || 'new';

            toggleRejectionFeeDisplay(defaults.rejectionEnabled);

            // Populate Step 2 overrides
            const optShip = document.getElementById('delivery-opt-ship');
            const optWeight = document.getElementById('delivery-opt-weight');
            const optLength = document.getElementById('delivery-opt-length');
            const optWidth = document.getElementById('delivery-opt-width');
            const optHeight = document.getElementById('delivery-opt-height');
            const optPayment = document.getElementById('delivery-opt-payment');
            const optAddressSystem = document.getElementById('delivery-opt-address-system');

            if (optShip) optShip.value = defaults.ship;
            if (optWeight) optWeight.value = defaults.weight;
            if (optLength) optLength.value = defaults.length;
            if (optWidth) optWidth.value = defaults.width;
            if (optHeight) optHeight.value = defaults.height;
            if (optPayment) optPayment.value = defaults.payment;
            if (optAddressSystem) optAddressSystem.value = defaults.addressSystem || 'new';
        };

        window.saveDeliveryDefaultsForm = (event) => {
            event.preventDefault();
            const defaults = {
                weight: parseFloat(document.getElementById('delivery-def-weight').value) || 0.5,
                ship: parseFloat(document.getElementById('delivery-def-ship').value) || 0,
                length: parseInt(document.getElementById('delivery-def-length').value) || 20,
                width: parseInt(document.getElementById('delivery-def-width').value) || 10,
                height: parseInt(document.getElementById('delivery-def-height').value) || 10,
                allowTry: document.getElementById('delivery-def-allow-try').value || 'N',
                viewOnly: document.getElementById('delivery-def-view-only').value || 'Y',
                partial: document.getElementById('delivery-def-partial').value || 'N',
                payment: document.getElementById('delivery-def-payment').value || 'Người gửi trả',
                rejectionEnabled: document.getElementById('delivery-def-rejection-enabled').value || 'N',
                rejectionAmount: parseFloat(document.getElementById('delivery-def-rejection-amount').value) || 0,
                deliveryNote: document.getElementById('delivery-def-delivery-note').value.trim(),
                addressSystem: document.getElementById('delivery-def-address-system').value || 'new'
            };

            const key = `delivery_defaults_${currentUserUid || 'global'}`;
            localStorage.setItem(key, JSON.stringify(defaults));
            alert('Đã lưu cấu hình mặc định đi đơn thành công!');
            loadDeliveryDefaults();
        };

        window.resetDeliveryDefaultsForm = () => {
            if (confirm('Đặt lại tất cả thiết lập về mặc định của hệ thống?')) {
                const key = `delivery_defaults_${currentUserUid || 'global'}`;
                localStorage.removeItem(key);
                loadDeliveryDefaults();
            }
        };

        window.loadDeliverySessions = async () => {
            selectedDeliverySessionIds.clear();
            switchDeliveryTab('process');

            const searchInput = document.getElementById('delivery-sessions-search');
            if (searchInput) searchInput.value = '';
            
            const listBody = document.getElementById('delivery-sessions-list-body');
            if (listBody) {
                listBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-400">Đang tải lịch sử phiên live...</td></tr>`;
            }
            
            const selectAllCb = document.getElementById('delivery-select-all-sessions');
            if (selectAllCb) selectAllCb.checked = false;

            updateDeliveryPreviewButton();
            loadDeliveryDefaults();

            try {
                const res = await fetch('/api/live-sessions');
                if (!res.ok) throw new Error('Không thể tải lịch sử phiên live');
                const data = await res.json();
                deliverySessionsList = Array.isArray(data.sessions) ? data.sessions : [];
                renderDeliverySessionsTable(deliverySessionsList);
            } catch (err) {
                if (listBody) {
                    listBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
                }
            }
        };

        function renderDeliverySessionsTable(sessions) {
            const listBody = document.getElementById('delivery-sessions-list-body');
            if (!listBody) return;

            if (sessions.length === 0) {
                listBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-400">Không tìm thấy phiên live nào.</td></tr>`;
                return;
            }

            listBody.innerHTML = '';
            sessions.forEach(s => {
                const tr = document.createElement('tr');
                tr.className = 'border-b hover:bg-slate-50 transition-colors';
                
                const dateStr = s.createdAt || s.startedAt ? new Date(s.createdAt || s.startedAt).toLocaleString('vi-VN') : 'Không rõ';
                const totalCust = s.summary?.totalCustomers || 0;
                const totalRev = formatMoney(s.summary?.totalRevenue || 0);
                const liveName = s.liveName || 'Phiên livestream';
                const isChecked = selectedDeliverySessionIds.has(s.id) ? 'checked' : '';

                tr.innerHTML = `
                    <td class="p-3 text-center"><input type="checkbox" id="del-cb-${s.id}" ${isChecked} onchange="toggleDeliverySessionSelect('${s.id}')"></td>
                     <td class="p-3 font-semibold text-gray-800">${escapeHtml(liveName)}</td>
                     <td class="p-3 text-gray-500 font-mono text-xs">${escapeHtml(dateStr)}</td>
                     <td class="p-3 text-center text-gray-600 font-bold">${totalCust}</td>
                     <td class="p-3 text-right text-red-600 font-bold">${totalRev}</td>
                `;
                listBody.appendChild(tr);
            });
        }

        window.filterDeliverySessions = (query) => {
            const q = (query || '').trim().toLowerCase();
            if (!q) {
                renderDeliverySessionsTable(deliverySessionsList);
                return;
            }
            const filtered = deliverySessionsList.filter(s => {
                const name = (s.liveName || '').toLowerCase();
                const date = s.createdAt || s.startedAt ? new Date(s.createdAt || s.startedAt).toLocaleString('vi-VN').toLowerCase() : '';
                return name.includes(q) || date.includes(q);
            });
            renderDeliverySessionsTable(filtered);
        };

        window.toggleSelectAllDeliverySessions = (checked) => {
            const checkboxes = document.querySelectorAll('#delivery-sessions-list-body input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = checked;
                const sessionId = cb.id.replace('del-cb-', '');
                if (checked) {
                    selectedDeliverySessionIds.add(sessionId);
                } else {
                    selectedDeliverySessionIds.delete(sessionId);
                }
            });
            updateDeliveryPreviewButton();
        };

        window.toggleDeliverySessionSelect = (sessionId) => {
            const cb = document.getElementById(`del-cb-${sessionId}`);
            if (cb) {
                if (cb.checked) {
                    selectedDeliverySessionIds.add(sessionId);
                } else {
                    selectedDeliverySessionIds.delete(sessionId);
                }
            }
            
            // Check if all are selected
            const checkboxes = Array.from(document.querySelectorAll('#delivery-sessions-list-body input[type="checkbox"]'));
            const selectAllCb = document.getElementById('delivery-select-all-sessions');
            if (selectAllCb) {
                selectAllCb.checked = checkboxes.length > 0 && checkboxes.every(c => c.checked);
            }

            updateDeliveryPreviewButton();
        };

        function updateDeliveryPreviewButton() {
            const btn = document.getElementById('btn-delivery-preview');
            if (btn) {
                btn.disabled = selectedDeliverySessionIds.size === 0;
            }
        }

        window.goToDeliveryStep1 = () => {
            document.getElementById('delivery-step-2').classList.add('hidden');
            document.getElementById('delivery-step-1').classList.remove('hidden');
        };

        window.goToDeliveryStep2 = async () => {
            if (selectedDeliverySessionIds.size === 0) return;

            const previewTableBody = document.getElementById('delivery-preview-table-body');
            if (previewTableBody) {
                previewTableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-gray-400">Đang tổng hợp đơn hàng & kiểm tra địa chỉ khách...</td></tr>`;
            }
            
            document.getElementById('delivery-step-1').classList.add('hidden');
            document.getElementById('delivery-step-2').classList.remove('hidden');

            // Load customer data silently to get latest changes
            await loadCustomersDataSilently();
            loadDeliveryDefaults(); // Refresh fields to use latest saved defaults

            try {
                const fetchPromises = Array.from(selectedDeliverySessionIds).map(id => 
                    fetch(`/api/live-sessions/${encodeURIComponent(id)}`).then(r => {
                        if (!r.ok) throw new Error('Không thể tải chi tiết phiên live ' + id);
                        return r.json();
                    })
                );

                const results = await Promise.all(fetchPromises);
                
                // Gom và nhóm đơn hàng
                const orders = [];
                results.forEach(res => {
                    if (Array.isArray(res.orders)) {
                        orders.push(...res.orders);
                    }
                });

                const groups = {};
                orders.forEach(o => {
                    const username = (o.customerUsername || o.tiktokUsername || '').trim().replace(/^@+/, '').toLowerCase();
                    const name = (o.customerName || o.nickname || o.displayName || 'Khách hàng').trim();
                    const key = username || name.toLowerCase() || `offline_${Date.now()}`;
                    
                    if (!groups[key]) {
                        groups[key] = {
                            key: key,
                            customerUsername: username,
                            customerName: name,
                            orders: [],
                            total: 0
                        };
                    }
                    const qty = Number(o.quantity || 1);
                    const price = Number(o.price || 0);
                    const total = Number(o.total || (price * qty));
                    groups[key].orders.push(o);
                    groups[key].total += total;
                });

                deliveryCachedPreviewGroups = Object.values(groups);
                selectedDeliveryCustomerKeys = new Set(deliveryCachedPreviewGroups.map(g => g.key));
                const selectAllChk = document.getElementById('delivery-select-all-checkbox');
                if (selectAllChk) selectAllChk.checked = true;
                deliveryCachedPreviewGroups.forEach(group => {
                    let matched = null;
                    if (group.customerUsername && !group.customerUsername.startsWith('offline_')) {
                        matched = customersData.find(c => c.tiktokUsername && c.tiktokUsername.toLowerCase() === group.customerUsername);
                    }
                    if (!matched && group.customerName) {
                        matched = customersData.find(c => String(c.displayName || '').trim().toLowerCase() === group.customerName.toLowerCase());
                    }
                    group.customer = matched;
                });

                // Reset filter show only missing button
                const filterBtn = document.getElementById('delivery-filter-missing-btn');
                if (filterBtn) {
                    deliveryShowOnlyMissing = false;
                    filterBtn.classList.remove('bg-amber-500', 'text-white');
                    filterBtn.classList.add('border-amber-500', 'text-amber-700', 'hover:bg-amber-50');
                }

                renderDeliveryPreviewTable();

            } catch (err) {
                if (previewTableBody) {
                    previewTableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-red-500">Lỗi tổng hợp dữ liệu: ${escapeHtml(err.message)}</td></tr>`;
                }
            }
        };

        async function loadCustomersDataSilently() {
            try {
                const res = await fetch('/api/customers');
                if (res.ok) {
                    const data = await res.json();
                    customersData = data.customers || [];
                }
            } catch (e) {
                console.error('Lỗi tải danh sách khách hàng:', e);
            }
        }

        function isCustomerMissingInfo(c) {
            if (!c) return true;
            const addressSystem = document.getElementById('delivery-opt-address-system')?.value || 'new';
            const required = addressSystem === 'new'
                ? ['phone', 'province', 'ward', 'addressDetail']
                : ['phone', 'province', 'district', 'ward', 'addressDetail'];
            return required.some(field => !String(c[field] || '').trim());
        }

        function renderDeliveryPreviewTable() {
            const previewTableBody = document.getElementById('delivery-preview-table-body');
            if (!previewTableBody) return;

            let filteredGroups = deliveryCachedPreviewGroups;
            if (deliveryShowOnlyMissing) {
                filteredGroups = deliveryCachedPreviewGroups.filter(g => isCustomerMissingInfo(g.customer));
            }

            if (filteredGroups.length === 0) {
                previewTableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-400">Không có đơn hàng nào khớp với bộ lọc.</td></tr>`;
                return;
            }

            previewTableBody.innerHTML = '';
            
            let selectedRevenue = 0;
            let selectedCount = 0;
            let missingCount = 0;

            deliveryCachedPreviewGroups.forEach(g => {
                if (selectedDeliveryCustomerKeys.has(g.key)) {
                    selectedRevenue += g.total;
                    selectedCount++;
                    if (isCustomerMissingInfo(g.customer)) {
                        missingCount++;
                    }
                }
            });

            // Update summary badge
            const summaryPill = document.getElementById('delivery-preview-summary-pill');
            if (summaryPill) {
                summaryPill.textContent = `${selectedCount}/${deliveryCachedPreviewGroups.length} khách - ${formatMoney(selectedRevenue)}`;
            }

            // Show warning banner if any selected are missing
            const warningBanner = document.getElementById('delivery-warning-banner');
            if (warningBanner) {
                if (missingCount > 0) {
                    warningBanner.classList.remove('hidden');
                    warningBanner.querySelector('.font-bold').textContent = `Phát hiện ${missingCount} khách hàng đang chọn thiếu thông tin vận chuyển.`;
                } else {
                    warningBanner.classList.add('hidden');
                }
            }

            filteredGroups.forEach(g => {
                const tr = document.createElement('tr');
                
                const hasMissing = isCustomerMissingInfo(g.customer);
                tr.className = `border-b transition-colors cursor-pointer ${hasMissing ? 'bg-amber-50/60 dark:bg-amber-950/5 hover:bg-amber-100/50' : 'hover:bg-slate-50'}`;
                
                const displayTikTok = g.customerUsername ? `@${g.customerUsername}` : '<span class="text-gray-400 italic">offline</span>';
                const phone = g.customer?.phone || '<span class="text-red-500 font-bold">Chưa có</span>';
                
                let addressStr = '<span class="text-red-500 font-bold">Chưa có địa chỉ</span>';
                if (g.customer) {
                    const addressSystem = document.getElementById('delivery-opt-address-system')?.value || 'new';
                    const parts = addressSystem === 'new'
                        ? [g.customer.addressDetail, g.customer.ward, g.customer.province].filter(Boolean)
                        : [g.customer.addressDetail, g.customer.ward, g.customer.district, g.customer.province].filter(Boolean);
                    const minParts = addressSystem === 'new' ? 3 : 4;
                    if (parts.length > 0) {
                        addressStr = escapeHtml(parts.join(', '));
                        if (parts.length < minParts) {
                            addressStr += ' <span class="text-amber-500 font-bold">(Thiếu chi tiết)</span>';
                        }
                    }
                }

                const statusBadge = hasMissing
                    ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">⚠️ Thiếu thông tin</span>'
                    : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">✅ Đủ điều kiện</span>';

                const isChecked = selectedDeliveryCustomerKeys.has(g.key) ? 'checked' : '';

                tr.innerHTML = `
                    <td class="p-3 text-center" onclick="event.stopPropagation()">
                        <input type="checkbox" data-key="${escapeHtml(g.key)}" class="delivery-row-checkbox rounded border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-purple-600 focus:ring-purple-500 cursor-pointer" ${isChecked}>
                    </td>
                    <td class="p-3 font-bold text-gray-800">${escapeHtml(g.customerName)}</td>
                    <td class="p-3 font-mono text-xs text-gray-500">${displayTikTok}</td>
                    <td class="p-3 font-mono text-xs">${phone}</td>
                    <td class="p-3 text-xs text-gray-600 max-w-xs truncate" title="${addressStr.replace(/<[^>]*>/g, '')}">${addressStr}</td>
                    <td class="p-3 text-right font-bold text-slate-800">${formatMoney(g.total)}</td>
                    <td class="p-3 text-center">${statusBadge}</td>
                `;

                // Handle checkbox toggle
                const chk = tr.querySelector('.delivery-row-checkbox');
                chk.addEventListener('change', () => {
                    if (chk.checked) {
                        selectedDeliveryCustomerKeys.add(g.key);
                    } else {
                        selectedDeliveryCustomerKeys.delete(g.key);
                    }
                    updateDeliverySummaryBadgeAndWarning();
                    updateSelectAllState();
                });

                // Click row to edit inline
                tr.addEventListener('click', () => {
                    openDeliveryInlineEdit(g.customerName, g.customerUsername, g.customer?.id);
                });

                previewTableBody.appendChild(tr);
            });

            // Set up select-all checkbox event listener
            const selectAllChk = document.getElementById('delivery-select-all-checkbox');
            if (selectAllChk) {
                // Remove any old listener first
                const newSelectAllChk = selectAllChk.cloneNode(true);
                selectAllChk.parentNode.replaceChild(newSelectAllChk, selectAllChk);
                
                newSelectAllChk.addEventListener('change', () => {
                    const rowCheckboxes = previewTableBody.querySelectorAll('.delivery-row-checkbox');
                    rowCheckboxes.forEach(rowChk => {
                        const key = rowChk.getAttribute('data-key');
                        rowChk.checked = newSelectAllChk.checked;
                        if (newSelectAllChk.checked) {
                            selectedDeliveryCustomerKeys.add(key);
                        } else {
                            selectedDeliveryCustomerKeys.delete(key);
                        }
                    });
                    updateDeliverySummaryBadgeAndWarning();
                });
                
                updateSelectAllState();
            }
        }

        function updateSelectAllState() {
            const selectAllChk = document.getElementById('delivery-select-all-checkbox');
            if (!selectAllChk) return;
            const previewTableBody = document.getElementById('delivery-preview-table-body');
            if (!previewTableBody) return;
            const rowCheckboxes = previewTableBody.querySelectorAll('.delivery-row-checkbox');
            if (rowCheckboxes.length === 0) {
                selectAllChk.checked = false;
                return;
            }
            const allChecked = Array.from(rowCheckboxes).every(rowChk => rowChk.checked);
            selectAllChk.checked = allChecked;
        }

        function updateDeliverySummaryBadgeAndWarning() {
            let selectedRevenue = 0;
            let selectedCount = 0;
            let missingCount = 0;

            deliveryCachedPreviewGroups.forEach(g => {
                if (selectedDeliveryCustomerKeys.has(g.key)) {
                    selectedRevenue += g.total;
                    selectedCount++;
                    if (isCustomerMissingInfo(g.customer)) {
                        missingCount++;
                    }
                }
            });

            const summaryPill = document.getElementById('delivery-preview-summary-pill');
            if (summaryPill) {
                summaryPill.textContent = `${selectedCount}/${deliveryCachedPreviewGroups.length} khách - ${formatMoney(selectedRevenue)}`;
            }

            const warningBanner = document.getElementById('delivery-warning-banner');
            if (warningBanner) {
                if (missingCount > 0) {
                    warningBanner.classList.remove('hidden');
                    warningBanner.querySelector('.font-bold').textContent = `Phát hiện ${missingCount} khách hàng đang chọn thiếu thông tin vận chuyển.`;
                } else {
                    warningBanner.classList.add('hidden');
                }
            }
        }

        window.toggleFilterMissingDelivery = (btn) => {
            deliveryShowOnlyMissing = !deliveryShowOnlyMissing;
            if (deliveryShowOnlyMissing) {
                btn.classList.remove('border-amber-500', 'text-amber-700', 'hover:bg-amber-50');
                btn.classList.add('bg-amber-500', 'text-white');
            } else {
                btn.classList.remove('bg-amber-500', 'text-white');
                btn.classList.add('border-amber-500', 'text-amber-700', 'hover:bg-amber-50');
            }
            renderDeliveryPreviewTable();
        };

        window.openDeliveryInlineEdit = (name, username, customerId) => {
            // Show backdrop and sliding panel
            document.getElementById('delivery-customer-backdrop').classList.remove('hidden');
            const panel = document.getElementById('delivery-customer-edit-panel');
            panel.classList.remove('translate-x-full');
            panel.classList.add('translate-x-0');

            // Reset inline form fields
            document.getElementById('delivery-cust-auto-input').value = '';
            document.getElementById('delivery-edit-cust-id').value = customerId || '';
            document.getElementById('delivery-edit-cust-name').value = name || '';
            document.getElementById('delivery-edit-cust-tiktok').value = username && !username.startsWith('offline_') ? username : '';
            document.getElementById('delivery-edit-cust-phone').value = '';
            document.getElementById('delivery-edit-cust-province').value = '';
            document.getElementById('delivery-edit-cust-district').value = '';
            document.getElementById('delivery-edit-cust-ward').value = '';
            document.getElementById('delivery-edit-cust-address').value = '';
            document.getElementById('delivery-edit-cust-code').value = '';
            document.getElementById('delivery-edit-cust-delivery-note').value = '';
            document.getElementById('delivery-edit-cust-weight').value = '';
            document.getElementById('delivery-edit-cust-allow-try').value = '';
            document.getElementById('delivery-edit-cust-view-only').value = '';
            document.getElementById('delivery-edit-cust-partial').value = '';

            const status = document.getElementById('delivery-edit-cust-status');
            if (customerId) {
                status.textContent = 'Chỉnh sửa khách hàng đã có trong danh mục';
                status.className = 'text-xs text-gray-500';
                
                // Find details
                const c = customersData.find(item => item.id === customerId);
                if (c) {
                    document.getElementById('delivery-edit-cust-phone').value = c.phone || '';
                    document.getElementById('delivery-edit-cust-province').value = c.province || '';
                    document.getElementById('delivery-edit-cust-district').value = c.district || '';
                    document.getElementById('delivery-edit-cust-ward').value = c.ward || '';
                    document.getElementById('delivery-edit-cust-address').value = c.addressDetail || '';
                    document.getElementById('delivery-edit-cust-code').value = c.customerCode || '';
                    document.getElementById('delivery-edit-cust-delivery-note').value = c.deliveryNote || '';
                    document.getElementById('delivery-edit-cust-weight').value = c.defaultWeightKg || '';
                    document.getElementById('delivery-edit-cust-allow-try').value = c.allowTryOn || '';
                    document.getElementById('delivery-edit-cust-view-only').value = c.viewOnlyNoTry || '';
                    document.getElementById('delivery-edit-cust-partial').value = c.partialDelivery || '';
                }
            } else {
                status.textContent = 'Tạo mới hồ sơ khách hàng ngoài live';
                status.className = 'text-xs text-gray-500';
            }
        };

        window.closeDeliveryInlineEdit = () => {
            document.getElementById('delivery-customer-backdrop').classList.add('hidden');
            const panel = document.getElementById('delivery-customer-edit-panel');
            panel.classList.remove('translate-x-0');
            panel.classList.add('translate-x-full');
        };

        window.autoFillDeliveryInlineForm = async () => {
            const raw = (document.getElementById('delivery-cust-auto-input')?.value || '').trim();
            if (!raw) {
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) document.getElementById('delivery-cust-auto-input').value = text.trim();
                } catch (_) {}
                return;
            }

            const { phone, province, district, ward, addressDetail } = parseVietnameseAddress(raw);

            if (phone) document.getElementById('delivery-edit-cust-phone').value = phone;
            if (province) document.getElementById('delivery-edit-cust-province').value = province;
            if (district) document.getElementById('delivery-edit-cust-district').value = district;
            if (ward) document.getElementById('delivery-edit-cust-ward').value = ward;
            if (addressDetail) document.getElementById('delivery-edit-cust-address').value = addressDetail;

            const status = document.getElementById('delivery-edit-cust-status');
            if (status) {
                const filled = [phone && 'SĐT', province && 'Tỉnh', district && 'Huyện', ward && 'Xã/Phường', addressDetail && 'Địa chỉ'].filter(Boolean);
                status.textContent = filled.length ? `✅ Đã tự động nhận diện thông tin` : '⚠️ Định dạng không nhận ra.';
                status.className = filled.length ? 'text-xs text-green-600 mt-1 font-semibold' : 'text-xs text-amber-600 mt-1';
            }
        };

        window.saveDeliveryInlineCustomer = async (event) => {
            event.preventDefault();
            const id = document.getElementById('delivery-edit-cust-id').value;
            const payload = {
                displayName: document.getElementById('delivery-edit-cust-name').value.trim(),
                tiktokUsername: normalizeTikTokUsername(document.getElementById('delivery-edit-cust-tiktok').value),
                phone: normalizePhone(document.getElementById('delivery-edit-cust-phone').value),
                province: normalizeDisplayText(document.getElementById('delivery-edit-cust-province').value),
                district: normalizeDisplayText(document.getElementById('delivery-edit-cust-district').value),
                ward: normalizeDisplayText(document.getElementById('delivery-edit-cust-ward').value),
                addressDetail: normalizeDisplayText(document.getElementById('delivery-edit-cust-address').value),
                customerCode: normalizeDisplayText(document.getElementById('delivery-edit-cust-code').value),
                deliveryNote: normalizeDisplayText(document.getElementById('delivery-edit-cust-delivery-note').value),
                defaultWeightKg: document.getElementById('delivery-edit-cust-weight').value.trim() ? parseFloat(document.getElementById('delivery-edit-cust-weight').value) : null,
                allowTryOn: document.getElementById('delivery-edit-cust-allow-try').value || null,
                viewOnlyNoTry: document.getElementById('delivery-edit-cust-view-only').value || null,
                partialDelivery: document.getElementById('delivery-edit-cust-partial').value || null
            };

            const statusEl = document.getElementById('delivery-edit-cust-status');
            statusEl.textContent = 'Đang lưu khách hàng...';
            statusEl.className = 'text-xs text-blue-500 font-semibold';

            try {
                let res;
                if (id) {
                    res = await fetch('/api/customers/' + encodeURIComponent(id), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch('/api/customers', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Lỗi khi cập nhật khách hàng');

                const savedCustomer = data.customer;

                // Sync details back into client-side cache
                const index = customersData.findIndex(c => c.id === savedCustomer.id);
                if (index !== -1) {
                    customersData[index] = savedCustomer;
                } else {
                    customersData.push(savedCustomer);
                }

                // Update matched references in preview cached items
                deliveryCachedPreviewGroups.forEach(g => {
                    const isMatchedTikTok = g.customerUsername && !g.customerUsername.startsWith('offline_') && savedCustomer.tiktokUsername && savedCustomer.tiktokUsername.toLowerCase() === g.customerUsername;
                    const isMatchedName = g.customerName && savedCustomer.displayName && savedCustomer.displayName.toLowerCase() === g.customerName.toLowerCase();
                    if (isMatchedTikTok || isMatchedName) {
                        g.customer = savedCustomer;
                    }
                });

                // Update preview list table UI immediately
                renderDeliveryPreviewTable();
                
                // Success and close panel
                closeDeliveryInlineEdit();

            } catch (err) {
                statusEl.textContent = 'Lỗi: ' + err.message;
                statusEl.className = 'text-xs text-red-500 font-bold';
            }
        };

        window.openDeliveryCustomerEdit = (name, username, customerId) => {
            openDeliveryInlineEdit(name, username, customerId);
        };

        window.triggerDeliveryExport = async () => {
            const selectedGroups = deliveryCachedPreviewGroups.filter(g => selectedDeliveryCustomerKeys.has(g.key));
            if (selectedGroups.length === 0) {
                alert('Vui lòng chọn ít nhất 1 khách hàng để xuất đơn.');
                return;
            }

            const selectedOrders = selectedGroups.flatMap(g => g.orders);

            const shippingFee = parseFloat(document.getElementById('delivery-opt-ship').value) || 0;
            const defaultWeightKg = parseFloat(document.getElementById('delivery-opt-weight').value) || 0.5;
            const defaultLengthCm = parseInt(document.getElementById('delivery-opt-length').value) || 20;
            const defaultWidthCm = parseInt(document.getElementById('delivery-opt-width').value) || 10;
            const defaultHeightCm = parseInt(document.getElementById('delivery-opt-height').value) || 10;
            const paymentMethod = document.getElementById('delivery-opt-payment').value || 'Người gửi trả';
            const addressSystem = document.getElementById('delivery-opt-address-system')?.value || 'new';

            const defaults = getDeliveryDefaults();

            try {
                const response = await fetch('/api/orders/export-delivery-excel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionIds: [],
                        orders: selectedOrders,
                        options: {
                            shippingFee,
                            defaultWeightKg,
                            defaultLengthCm,
                            defaultWidthCm,
                            defaultHeightCm,
                            paymentMethod,
                            addressSystem,
                            // Pass persistent defaults to exporter
                            allowTryOn: defaults.allowTry,
                            viewOnlyNoTry: defaults.viewOnly,
                            partialDelivery: defaults.partial,
                            rejectionFeeEnabled: defaults.rejectionEnabled,
                            rejectionFeeAmount: defaults.rejectionAmount,
                            defaultDeliveryNote: defaults.deliveryNote
                        }
                    })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Lỗi xuất excel');
                }

                const missingCount = parseInt(response.headers.get('X-Missing-Customers-Count') || '0');
                const exportedCount = parseInt(response.headers.get('X-Exported-Customers-Count') || '0');

                const blob = await response.blob();
                
                const disposition = response.headers.get('Content-Disposition');
                let filename = 'delivery-orders.xlsx';
                if (disposition && disposition.indexOf('attachment') !== -1) {
                    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                    const matches = filenameRegex.exec(disposition);
                    if (matches != null && matches[1]) {
                        filename = matches[1].replace(/['"]/g, '');
                    }
                }

                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);

                if (missingCount > 0) {
                    alert(`Xuất file thành công!\nCó ${exportedCount} khách hàng được tạo đơn.\n⚠️ Tuy nhiên có ${missingCount} khách hàng thiếu địa chỉ hoặc SĐT (được đánh dấu trong danh sách). Bạn cần bổ sung địa chỉ cho họ rồi xuất lại file để đi đơn được.`);
                } else {
                    alert(`Xuất file thành công!\nĐã xuất ${exportedCount} khách hàng đủ điều kiện sang file Excel.`);
                }

            } catch (err) {
                alert('Lỗi khi xuất file Excel đi đơn: ' + err.message);
            }
        };
