/**
 * Creditor Debts API — Nợ phải trả ra ngoài (chủ nợ bên ngoài)
 *
 * Phân biệt với /api/debts (khách NỢ shop): đây là tiền shop ĐÃ NỢ người khác,
 * theo dõi hạn trả + lịch sử thanh toán từng lần.
 */

const express = require('express');
const router = express.Router();
const {
    dbCreateCreditorDebt,
    dbGetCreditorDebtById,
    dbListCreditorDebts,
    dbGetCreditorDebtSummary,
    dbUpdateCreditorDebt,
    dbPayCreditorDebt,
    dbListCreditorPayments,
    dbDeleteCreditorDebt
} = require('../utils/db');

// Middleware: require login
function requireApiAuth(req, res, next) {
    if (!req.session || !req.session.user || !req.session.user.uid) {
        return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    next();
}

function rowToDto(row) {
    if (!row) return null;
    return {
        id: row.id,
        creditor: row.creditor,
        totalAmount: row.total_amount,
        remainingAmount: row.remaining_amount,
        dueDate: row.due_date,
        status: row.status,
        daysLeft: row.days_left,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// GET /api/creditor-debts — Danh sách + tổng hợp
router.get('/', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const debts = dbListCreditorDebts(userId).map(rowToDto);
        res.json({ debts, summary: dbGetCreditorDebtSummary(userId) });
    } catch (error) {
        console.error('Lỗi lấy danh sách nợ phải trả:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/creditor-debts — Tạo khoản nợ mới
router.post('/', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const { creditor, totalAmount, dueDate } = req.body;

        if (!String(creditor || '').trim()) {
            return res.status(400).json({ error: 'Tên chủ nợ là bắt buộc' });
        }
        const total = Number(totalAmount);
        if (!Number.isFinite(total) || total <= 0) {
            return res.status(400).json({ error: 'Số tiền nợ phải là số dương hợp lệ' });
        }

        const debt = dbCreateCreditorDebt(userId, {
            creditor,
            totalAmount: total,
            dueDate: String(dueDate || '').trim()
        });
        res.status(201).json({ success: true, debt: rowToDto(debt) });
    } catch (error) {
        console.error('Lỗi tạo khoản nợ phải trả:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// GET /api/creditor-debts/:id/payments — Lịch sử thanh toán
router.get('/:id/payments', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const debt = dbGetCreditorDebtById(userId, req.params.id);
        if (!debt) {
            return res.status(404).json({ error: 'Không tìm thấy khoản nợ' });
        }
        const payments = dbListCreditorPayments(userId, req.params.id);
        res.json({ payments });
    } catch (error) {
        console.error('Lỗi lấy lịch sử thanh toán:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/creditor-debts/:id/pay — Ghi nhận một lần thanh toán
router.post('/:id/pay', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const amount = Number(req.body?.amountPaid);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Số tiền trả phải là số dương hợp lệ' });
        }
        const debt = dbPayCreditorDebt(userId, req.params.id, amount);
        if (!debt) {
            return res.status(404).json({ error: 'Không tìm thấy khoản nợ' });
        }
        res.json({ success: true, debt: rowToDto(debt) });
    } catch (error) {
        if (error.message && error.message.includes('số dương')) {
            return res.status(400).json({ error: error.message });
        }
        console.error('Lỗi ghi nhận thanh toán nợ phải trả:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// PUT /api/creditor-debts/:id — Cập nhật thông tin khoản nợ
router.put('/:id', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const { creditor, totalAmount, dueDate } = req.body;

        if (creditor !== undefined && !String(creditor).trim()) {
            return res.status(400).json({ error: 'Tên chủ nợ không được để trống' });
        }
        if (totalAmount !== undefined) {
            const total = Number(totalAmount);
            if (!Number.isFinite(total) || total < 0) {
                return res.status(400).json({ error: 'Số tiền nợ không hợp lệ' });
            }
        }

        const debt = dbUpdateCreditorDebt(userId, req.params.id, {
            ...(creditor !== undefined ? { creditor } : {}),
            ...(totalAmount !== undefined ? { totalAmount: Number(totalAmount) } : {}),
            ...(dueDate !== undefined ? { dueDate } : {})
        });
        if (!debt) {
            return res.status(404).json({ error: 'Không tìm thấy khoản nợ' });
        }
        res.json({ success: true, debt: rowToDto(debt) });
    } catch (error) {
        console.error('Lỗi cập nhật khoản nợ phải trả:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// DELETE /api/creditor-debts/:id — Xóa khoản nợ (kèm lịch sử thanh toán)
router.delete('/:id', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const deleted = dbDeleteCreditorDebt(userId, req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Không tìm thấy khoản nợ' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi xóa khoản nợ phải trả:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

module.exports = router;
