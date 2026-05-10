const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'debts.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Không thể kết nối database:', err.message);
    } else {
        console.log('Đã kết nối SQLite database.');
        initializeDb();
    }
});

function initializeDb() {
    db.serialize(() => {
        // Tạo bảng debts
        db.run(`CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creditor TEXT NOT NULL,
            total_amount REAL NOT NULL,
            remaining_amount REAL NOT NULL,
            due_date DATE,
            status TEXT DEFAULT 'pending'
        )`);

        // Tạo bảng payments
        db.run(`CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            debt_id INTEGER,
            amount_paid REAL NOT NULL,
            payment_date DATE DEFAULT (DATE('now')),
            FOREIGN KEY (debt_id) REFERENCES debts(id)
        )`);
    });
}

module.exports = db;
