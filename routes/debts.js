/**
 * Debt Tracking API — Quản lý công nợ khách hàng
 */

const express = require('express');
const router = express.Router();
const { dbListDebts, dbCreateDebt, dbUpdateDebt, dbDeleteDebt, dbGetDebtSummary } = require('../utils/db');

// Middleware: require login
function requireApiAuth(req, res, next) {
    if (!req.session || !req.session.user || !req.session.user.uid) {
        return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    next();
}

// GET /api/debs — Danh sách công nợ
router.get('/', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const customerUsername = req.query.customer || '';
        const debts = dbListDebts(userId, customerUsername || null);
        res.json({ debts });
    } catch (error) {
        console.error('Lỗi lấy danh sách nợ:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// GET /api/debts/summary/:username — Tổng nợ của 1 khách
router.get('/summary/:username', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const summary = dbGetDebtSummary(userId, req.params.username);
        res.json({ customerUsername: req.params.username, totalDebt: summary?.total_debt || 0 });
    } catch (error) {
        console.error('Lỗi lấy tổng nợ:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/debts — Tạo khoản nợ mới
router.post('/', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const { customerUsername, customerName, amount, note } = req.body;

        if (!customerUsername || !amount) {
            return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
        }

        const debt = dbCreateDebt(userId, {
            customerUsername,
            customerName: customerName || '',
            amount: Number(amount),
            note: note || '',
            status: 'unpaid'
        });

        res.status(201).json({ success: true, debt });
    } catch (error) {
        console.error('Lỗi tạo khoản nợ:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// PATCH /api/debts/:id — Cập nhật khoản nợ (thanh toán, điều chỉnh)
router.patch('/:id', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const debt = dbUpdateDebt(userId, req.params.id, req.body);
        if (!debt) {
            return res.status(404).json({ error: 'Không tìm thấy khoản nợ' });
        }
        res.json({ success: true, debt });
    } catch (error) {
        console.error('Lỗi cập nhật nợ:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// DELETE /api/debts/:id — Xóa khoản nợ
router.delete('/:id', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const deleted = dbDeleteDebt(userId, req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Không tìm thấy khoản nợ' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi xóa nợ:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

module.exports = router;
