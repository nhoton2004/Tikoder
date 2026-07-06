/**
 * cleanup-empty-sessions.js
 * Xóa tất cả các phiên live rỗng (0 đơn) khỏi DB.
 * Chạy: node scripts/cleanup-empty-sessions.js
 */
'use strict';

const { getDb } = require('../utils/db');

const db = getDb();

// Tìm tất cả phiên không có đơn nào
const emptySessions = db.prepare(`
    SELECT ls.id, ls.user_id, ls.live_name, ls.created_at
    FROM live_sessions ls
    LEFT JOIN orders o ON o.session_id = ls.id
    GROUP BY ls.id
    HAVING COUNT(o.id) = 0
`).all();

if (emptySessions.length === 0) {
    console.log('✅ Không có phiên rỗng nào cần xóa.');
    process.exit(0);
}

console.log(`🗑️  Tìm thấy ${emptySessions.length} phiên rỗng:`);
emptySessions.forEach(s => {
    console.log(`   - [${s.id}] "${s.live_name}" (user: ${s.user_id}, created: ${s.created_at})`);
});

// Xóa chúng
const deleteStmt = db.prepare('DELETE FROM live_sessions WHERE id = ?');
const deleteAll = db.transaction(() => {
    let count = 0;
    for (const s of emptySessions) {
        const result = deleteStmt.run(s.id);
        if (result.changes > 0) count++;
    }
    return count;
});

const deleted = deleteAll();
console.log(`\n✅ Đã xóa ${deleted}/${emptySessions.length} phiên rỗng.`);
