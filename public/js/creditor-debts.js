/**
 * Nợ phải trả (Debt Tracker) — money the shop owes externally.
 *
 * Follows the app's existing dashboard patterns:
 * - switchView('creditor-debts') triggers CreditorDebtsPage.refresh()
 * - API: /api/creditor-debts (auth via session, scoped per user uid)
 */
(function () {
    'use strict';

    const API = '/api/creditor-debts';

    const els = {
        tableBody: document.getElementById('creditors-table-body'),
        form: document.getElementById('creditor-form'),
        idInput: document.getElementById('creditor-id'),
        nameInput: document.getElementById('creditor-name'),
        amountInput: document.getElementById('creditor-amount'),
        dueDateInput: document.getElementById('creditor-due-date'),
        formTitle: document.getElementById('creditor-form-title'),
        submitBtn: document.getElementById('creditor-submit-btn'),
        cancelBtn: document.getElementById('creditor-cancel-btn'),
        statTotal: document.getElementById('cred-total-debt'),
        statOverdue: document.getElementById('cred-overdue-count'),
        statDueSoon: document.getElementById('cred-due-soon-count'),
        statCount: document.getElementById('cred-total-count'),
        payModal: document.getElementById('creditor-pay-modal'),
        payCreditor: document.getElementById('creditor-pay-creditor'),
        payAmount: document.getElementById('creditor-pay-amount')
    };

    let allDebts = [];
    let payingDebtId = null;

    // ---------------------------------------------------------------------
    // Helpers (self-contained; dashboard.js's formatMoney/t are module-scoped)
    // ---------------------------------------------------------------------
    function formatMoney(amount) {
        return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(amount || 0)) + 'đ';
    }

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return iso;
        return d.toLocaleDateString('vi-VN');
    }

    let toastContainer = null;
    function toast(message, type = 'info') {
        if (!toastContainer || !document.body.contains(toastContainer)) {
            toastContainer = document.createElement('div');
            toastContainer.style.cssText =
                'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
            document.body.appendChild(toastContainer);
        }
        const colors = {
            info: '#0f172a',
            success: '#16a34a',
            error: '#dc2626'
        };
        const el = document.createElement('div');
        el.textContent = message;
        el.style.cssText =
            'background:' + (colors[type] || colors.info) + ';color:#fff;padding:10px 16px;' +
            'border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.18);' +
            'max-width:320px;animation:credToastIn .18s ease-out;';
        toastContainer.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .25s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 260);
        }, 3200);
    }

    // ---------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------
    async function api(path, options = {}) {
        const res = await fetch(API + path, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        let data = {};
        try { data = await res.json(); } catch (_) { /* no body */ }
        if (!res.ok) {
            throw new Error(data.error || 'Yêu cầu thất bại (' + res.status + ')');
        }
        return data;
    }

    async function loadDebts() {
        try {
            const data = await api('');
            allDebts = data.debts || [];
            renderSummary(data.summary || {});
            renderTable();
        } catch (err) {
            toast(err.message, 'error');
            allDebts = [];
            renderTable();
        }
    }

    function renderSummary(s) {
        if (els.statTotal) els.statTotal.textContent = formatMoney(s.totalRemaining);
        if (els.statOverdue) els.statOverdue.textContent = s.overdueCount || 0;
        if (els.statDueSoon) els.statDueSoon.textContent = s.dueSoonCount || 0;
        if (els.statCount) els.statCount.textContent = s.totalDebts || 0;
    }

    function warningCell(debt) {
        if (debt.status === 'paid') {
            return '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Đã xong</span>';
        }
        const days = Math.ceil(debt.daysLeft || 0);
        if (days < 0) {
            return '<span class="text-red-600 font-bold text-xs">QUÁ HẠN ' + Math.abs(days) + ' NGÀY!</span>';
        }
        if (days <= 3) {
            return '<span class="text-amber-600 font-bold text-xs">Còn ' + days + ' ngày!</span>';
        }
        return '<span class="text-gray-500 text-xs">Còn ' + days + ' ngày</span>';
    }

    function renderTable() {
        if (!els.tableBody) return;
        if (allDebts.length === 0) {
            els.tableBody.innerHTML =
                '<tr><td colspan="6" class="p-6 text-center text-sm text-gray-400">' +
                'Chưa có khoản nợ nào. Thêm khoản đầu tiên từ form bên phải.</td></tr>';
            return;
        }
        els.tableBody.innerHTML = allDebts.map(d => {
            const isPaid = d.status === 'paid';
            return (
                '<tr class="border-b border-gray-100 hover:bg-gray-50 ' + (isPaid ? 'opacity-60' : '') + '">' +
                '<td class="p-3 font-bold">' + esc(d.creditor) + '</td>' +
                '<td class="p-3 text-right">' + formatMoney(d.totalAmount) + '</td>' +
                '<td class="p-3 text-right font-black text-red-600">' + formatMoney(d.remainingAmount) + '</td>' +
                '<td class="p-3">' + esc(fmtDate(d.dueDate)) + '</td>' +
                '<td class="p-3">' + warningCell(d) + '</td>' +
                '<td class="p-3 text-right whitespace-nowrap">' +
                (!isPaid
                    ? '<button type="button" onclick="CreditorDebtsPage.openPayModal(\'' + d.id + '\')" ' +
                    'class="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white mr-1">Trả</button>'
                    : '') +
                '<button type="button" onclick="CreditorDebtsPage.edit(\'' + d.id + '\')" ' +
                'class="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white mr-1">Sửa</button>' +
                '<button type="button" onclick="CreditorDebtsPage.remove(\'' + d.id + '\')" ' +
                'class="px-2.5 py-1 text-xs font-bold rounded-lg bg-red-500 hover:bg-red-600 text-white">Xóa</button>' +
                '</td></tr>'
            );
        }).join('');
    }

    // ---------------------------------------------------------------------
    // Form (create + edit)
    // ---------------------------------------------------------------------
    window.resetCreditorDebtForm = function () {
        if (!els.form) return;
        els.form.reset();
        els.idInput.value = '';
        els.formTitle.textContent = 'Thêm khoản nợ';
        els.submitBtn.textContent = 'Thêm nợ';
        els.cancelBtn.classList.add('hidden');
    };

    window.saveCreditorDebtForm = async function (event) {
        event.preventDefault();
        const payload = {
            creditor: els.nameInput.value.trim(),
            totalAmount: Number(els.amountInput.value),
            dueDate: els.dueDateInput.value || ''
        };
        if (!payload.creditor || !payload.totalAmount || payload.totalAmount <= 0) {
            toast('Vui lòng nhập đủ thông tin (chủ nợ + số tiền).', 'error');
            return;
        }
        const isEdit = Boolean(els.idInput.value);
        try {
            if (isEdit) {
                await api('/' + els.idInput.value, { method: 'PUT', body: JSON.stringify(payload) });
                toast('Đã cập nhật thông tin khoản nợ.', 'success');
            } else {
                await api('', { method: 'POST', body: JSON.stringify(payload) });
                toast('Đã thêm khoản nợ mới.', 'success');
            }
            window.resetCreditorDebtForm();
            await loadDebts();
        } catch (err) {
            toast(err.message, 'error');
        }
    };

    // ---------------------------------------------------------------------
    // Pay modal
    // ---------------------------------------------------------------------
    window.openCreditorPayModal = function (debtId) {
        payingDebtId = debtId;
        const debt = allDebts.find(d => d.id === debtId);
        if (!debt) return;
        els.payCreditor.textContent = debt.creditor + ' — còn lại ' + formatMoney(debt.remainingAmount);
        els.payAmount.value = '';
        els.payModal.classList.remove('hidden');
        els.payModal.classList.add('flex');
        els.payAmount.focus();
    };

    window.closeCreditorPayModal = function () {
        payingDebtId = null;
        els.payModal.classList.add('hidden');
        els.payModal.classList.remove('flex');
    };

    window.submitCreditorDebtPayment = async function () {
        const amount = Number(els.payAmount.value);
        if (!Number.isFinite(amount) || amount <= 0) {
            toast('Số tiền trả không hợp lệ.', 'error');
            return;
        }
        try {
            const data = await api('/' + payingDebtId + '/pay', {
                method: 'POST',
                body: JSON.stringify({ amountPaid: amount })
            });
            window.closeCreditorPayModal();
            toast('Đã ghi nhận thanh toán. Còn lại: ' + formatMoney(data.debt?.remainingAmount), 'success');
            await loadDebts();
        } catch (err) {
            toast(err.message, 'error');
        }
    };

    // ---------------------------------------------------------------------
    // Edit / delete
    // ---------------------------------------------------------------------
    window.editCreditorDebt = function (debtId) {
        const debt = allDebts.find(d => d.id === debtId);
        if (!debt) return;
        els.idInput.value = debt.id;
        els.nameInput.value = debt.creditor;
        els.amountInput.value = debt.totalAmount;
        els.dueDateInput.value = debt.dueDate || '';
        els.formTitle.textContent = 'Sửa khoản nợ';
        els.submitBtn.textContent = 'Lưu thay đổi';
        els.cancelBtn.classList.remove('hidden');
        els.nameInput.focus();
        if (window.matchMedia && window.matchMedia('(max-width: 980px)').matches) {
            els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    window.removeCreditorDebt = async function (debtId) {
        const debt = allDebts.find(d => d.id === debtId);
        if (!debt) return;
        const ok = window.confirm(
            'Xóa khoản nợ "' + debt.creditor + '" cùng toàn bộ lịch sử thanh toán?\nThao tác này không thể hoàn tác.'
        );
        if (!ok) return;
        try {
            await api('/' + debtId, { method: 'DELETE' });
            if (els.idInput.value === debtId) window.resetCreditorDebtForm();
            toast('Đã xóa khoản nợ.', 'success');
            await loadDebts();
        } catch (err) {
            toast(err.message, 'error');
        }
    };

    // ---------------------------------------------------------------------
    // Public entry point — called by switchView('creditor-debts')
    // ---------------------------------------------------------------------
    window.CreditorDebtsPage = {
        refresh: loadDebts,
        openPayModal: window.openCreditorPayModal,
        edit: window.editCreditorDebt,
        remove: window.removeCreditorDebt
    };

    // Keyboard: Escape closes the pay modal
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !els.payModal.classList.contains('hidden')) {
            window.closeCreditorPayModal();
        }
    });

    // Enter inside the pay amount submits
    els.payAmount?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            window.submitCreditorDebtPayment();
        }
    });
})();
