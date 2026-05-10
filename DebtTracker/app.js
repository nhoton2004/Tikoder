const express = require('express');
const cors = require('cors');
const db = require('./db');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// --- API Endpoints ---

// Lấy danh sách nợ
app.get('/api/debts', (req, res) => {
    const query = `
        SELECT *, 
        (julianday(due_date) - julianday('now')) as days_left 
        FROM debts 
        ORDER BY status DESC, due_date ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Thêm khoản nợ mới
app.post('/api/debts', (req, res) => {
    const { creditor, total_amount, due_date } = req.body;
    const query = `INSERT INTO debts (creditor, total_amount, remaining_amount, due_date) VALUES (?, ?, ?, ?)`;
    db.run(query, [creditor, total_amount, total_amount, due_date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// Trả tiền nợ
app.post('/api/debts/:id/pay', (req, res) => {
    const debtId = req.params.id;
    const { amount_paid } = req.body;

    db.serialize(() => {
        db.run(`INSERT INTO payments (debt_id, amount_paid) VALUES (?, ?)`, [debtId, amount_paid]);
        db.get(`SELECT remaining_amount FROM debts WHERE id = ?`, [debtId], (err, row) => {
            if (err || !row) return res.status(500).json({ error: "Không tìm thấy khoản nợ" });

            const newRemaining = row.remaining_amount - amount_paid;
            const newStatus = newRemaining <= 0 ? 'paid' : 'pending';

            db.run(`UPDATE debts SET remaining_amount = ?, status = ? WHERE id = ?`, 
                [Math.max(0, newRemaining), newStatus, debtId], 
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, remaining: Math.max(0, newRemaining) });
                }
            );
        });
    });
});

// Cập nhật thông tin nợ (Sửa)
app.put('/api/debts/:id', (req, res) => {
    const { creditor, total_amount, due_date } = req.body;
    const debtId = req.params.id;
    
    // Khi sửa tổng tiền, cần tính toán lại số tiền còn nợ dựa trên lịch sử thanh toán
    db.get(`SELECT SUM(amount_paid) as paid_sum FROM payments WHERE debt_id = ?`, [debtId], (err, row) => {
        const paid = row.paid_sum || 0;
        const remaining = total_amount - paid;
        const status = remaining <= 0 ? 'paid' : 'pending';

        const query = `UPDATE debts SET creditor = ?, total_amount = ?, remaining_amount = ?, due_date = ?, status = ? WHERE id = ?`;
        db.run(query, [creditor, total_amount, Math.max(0, remaining), due_date, status, debtId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// Xóa khoản nợ (Xóa)
app.delete('/api/debts/:id', (req, res) => {
    const debtId = req.params.id;
    db.serialize(() => {
        db.run(`DELETE FROM payments WHERE debt_id = ?`, [debtId]);
        db.run(`DELETE FROM debts WHERE id = ?`, [debtId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// --- Routes cho Giao diện ---
app.get('/', (req, res) => {
    res.render('index');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
