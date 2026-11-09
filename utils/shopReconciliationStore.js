'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { normalizeTikTokUsername } = require('./shopReconciliationData');

function iso(ms) { return new Date(ms).toISOString(); }
function toPublicRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        liveId: row.live_id,
        liveName: row.live_name,
        username: row.username,
        displayName: row.display_name,
        manualAmount: row.manual_amount,
        orderId: row.order_id,
        orderAmount: row.order_amount === null ? null : Number(row.order_amount),
        orderAt: row.order_at === null ? null : Number(row.order_at),
        orderSource: row.order_source,
        difference: row.difference === null ? null : Number(row.difference),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

class ShopReconciliationStore {
    constructor(dbPath, { now = Date.now, confirmationTtlMs = 5 * 60 * 1000 } = {}) {
        this.now = now;
        this.confirmationTtlMs = confirmationTtlMs;
        fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA foreign_keys = ON;');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS live_sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_shop_live ON live_sessions(active) WHERE active = 1;
            CREATE TABLE IF NOT EXISTS reconciliation_records (
                id TEXT PRIMARY KEY,
                live_id TEXT NOT NULL REFERENCES live_sessions(id),
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                manual_amount INTEGER NOT NULL CHECK (manual_amount > 0),
                order_id TEXT,
                order_amount INTEGER,
                order_at INTEGER,
                order_source TEXT,
                difference INTEGER,
                status TEXT NOT NULL CHECK (status IN ('match', 'mismatch', 'no_order')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (live_id, username)
            );
            CREATE TABLE IF NOT EXISTS record_revisions (
                id INTEGER PRIMARY KEY,
                record_id TEXT NOT NULL REFERENCES reconciliation_records(id),
                old_amount INTEGER NOT NULL,
                new_amount INTEGER NOT NULL,
                old_snapshot TEXT,
                new_snapshot TEXT,
                changed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pending_confirmations (
                confirmation_id TEXT PRIMARY KEY,
                live_id TEXT NOT NULL REFERENCES live_sessions(id),
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                manual_amount INTEGER NOT NULL CHECK (manual_amount > 0),
                snapshot TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                consumed_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS pending_expiry ON pending_confirmations(expires_at);
            CREATE INDEX IF NOT EXISTS reconciliation_live_user ON reconciliation_records(live_id, username);
        `);
    }

    transaction(fn) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const value = fn();
            this.db.exec('COMMIT');
            return value;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    setActiveLive(name) {
        const liveName = String(name || '').trim();
        if (!liveName || liveName.length > 120) throw new Error('Tên đợt live phải có 1–120 ký tự.');
        return this.transaction(() => {
            const now = iso(this.now());
            let live = this.db.prepare('SELECT id FROM live_sessions WHERE name = ?').get(liveName);
            if (!live) {
                const id = crypto.randomUUID();
                this.db.prepare('INSERT INTO live_sessions(id,name,active,created_at,updated_at) VALUES(?,?,0,?,?)')
                    .run(id, liveName, now, now);
                live = { id };
            }
            this.db.prepare('UPDATE live_sessions SET active=0, updated_at=? WHERE active=1').run(now);
            this.db.prepare('UPDATE live_sessions SET active=1, updated_at=? WHERE id=?').run(now, live.id);
            return this.getLiveById(live.id);
        });
    }

    getLiveByName(name) {
        const row = this.db.prepare('SELECT * FROM live_sessions WHERE name=?').get(String(name || '').trim());
        return row ? { id: row.id, name: row.name, isActive: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at } : null;
    }

    getActiveLive() {
        const row = this.db.prepare('SELECT * FROM live_sessions WHERE active=1').get();
        return row ? { id: row.id, name: row.name, isActive: true, createdAt: row.created_at, updatedAt: row.updated_at } : null;
    }

    getLiveById(id) {
        const row = this.db.prepare('SELECT * FROM live_sessions WHERE id=?').get(String(id));
        return row ? { id: row.id, name: row.name, isActive: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at } : null;
    }

    prepareRecord({ username, amount, snapshot = null } = {}) {
        const normalized = normalizeTikTokUsername(username);
        const manualAmount = Number(amount);
        if (!normalized || normalized.length > 64) throw new Error('TikTok username không hợp lệ.');
        if (!Number.isSafeInteger(manualAmount) || manualAmount <= 0) throw new Error('Số tiền phải là số VND nguyên dương.');
        const live = this.getActiveLive();
        if (!live) throw new Error('Chưa chọn đợt live. Hãy chọn/tạo đợt live trước.');
        const safeSnapshot = snapshot ? {
            displayName: String(snapshot.displayName || '').trim().slice(0, 120),
            orderId: String(snapshot.orderId || '').trim().slice(0, 160),
            amount: Number.isSafeInteger(Number(snapshot.amount)) && Number(snapshot.amount) > 0 ? Number(snapshot.amount) : null,
            orderedAt: Number.isFinite(Number(snapshot.orderedAt)) ? Number(snapshot.orderedAt) : null,
            source: String(snapshot.source || '').slice(0, 40)
        } : null;
        if (safeSnapshot && (!safeSnapshot.orderId || safeSnapshot.amount === null)) {
            throw new Error('Ảnh chụp đơn gần nhất không hợp lệ; không thể tạo xác nhận.');
        }
        const displayName = safeSnapshot?.displayName || `@${normalized}`;
        const now = this.now();
        const confirmationId = crypto.randomUUID();
        this.db.prepare(`INSERT INTO pending_confirmations
            (confirmation_id,live_id,username,display_name,manual_amount,snapshot,created_at,expires_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(
            confirmationId, live.id, normalized, displayName, manualAmount,
            safeSnapshot ? JSON.stringify(safeSnapshot) : null,
            now, now + this.confirmationTtlMs
        );
        return {
            confirmationId,
            expiresAt: iso(now + this.confirmationTtlMs),
            live: { id: live.id, name: live.name },
            username: normalized,
            displayName,
            manualAmount,
            snapshot: safeSnapshot,
            difference: safeSnapshot ? manualAmount - safeSnapshot.amount : null
        };
    }

    confirmRecord(confirmationId) {
        const id = String(confirmationId || '');
        return this.transaction(() => {
            const pending = this.db.prepare('SELECT * FROM pending_confirmations WHERE confirmation_id=?').get(id);
            const now = this.now();
            if (!pending || pending.consumed_at !== null || pending.expires_at <= now) {
                throw new Error('Xác nhận không hợp lệ, đã dùng hoặc hết hạn. Hãy lập yêu cầu ghi mới.');
            }
            const claimed = this.db.prepare('UPDATE pending_confirmations SET consumed_at=? WHERE confirmation_id=? AND consumed_at IS NULL AND expires_at>?')
                .run(now, id, now);
            if (Number(claimed.changes) !== 1) throw new Error('Yêu cầu xác nhận đã được xử lý hoặc hết hạn.');
            const snapshot = pending.snapshot ? JSON.parse(pending.snapshot) : null;
            const manualAmount = Number(pending.manual_amount);
            const orderAmount = snapshot?.amount ?? null;
            const difference = orderAmount === null ? null : manualAmount - orderAmount;
            const status = difference === null ? 'no_order' : difference === 0 ? 'match' : 'mismatch';
            const nowIso = iso(now);
            const existing = this.db.prepare('SELECT * FROM reconciliation_records WHERE live_id=? AND username=?')
                .get(pending.live_id, pending.username);
            let recordId;
            if (!existing) {
                recordId = crypto.randomUUID();
                this.db.prepare(`INSERT INTO reconciliation_records
                    (id,live_id,username,display_name,manual_amount,order_id,order_amount,order_at,order_source,difference,status,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                    recordId, pending.live_id, pending.username, pending.display_name, manualAmount,
                    snapshot?.orderId ?? null, orderAmount, snapshot?.orderedAt ?? null, snapshot?.source ?? null,
                    difference, status, nowIso, nowIso
                );
            } else {
                recordId = existing.id;
                const oldSnapshot = JSON.stringify({ orderId: existing.order_id, amount: existing.order_amount, orderedAt: existing.order_at, source: existing.order_source });
                const newSnapshot = JSON.stringify(snapshot);
                if (Number(existing.manual_amount) !== manualAmount || oldSnapshot !== newSnapshot) {
                    this.db.prepare(`INSERT INTO record_revisions(record_id,old_amount,new_amount,old_snapshot,new_snapshot,changed_at)
                        VALUES(?,?,?,?,?,?)`).run(recordId, existing.manual_amount, manualAmount, oldSnapshot, newSnapshot, nowIso);
                }
                this.db.prepare(`UPDATE reconciliation_records SET display_name=?,manual_amount=?,order_id=?,order_amount=?,order_at=?,order_source=?,difference=?,status=?,updated_at=? WHERE id=?`)
                    .run(pending.display_name, manualAmount, snapshot?.orderId ?? null, orderAmount, snapshot?.orderedAt ?? null, snapshot?.source ?? null, difference, status, nowIso, recordId);
            }
            return this.getRecord(recordId);
        });
    }

    getRecord(id) {
        const row = this.db.prepare(`SELECT r.*, l.name AS live_name FROM reconciliation_records r
            JOIN live_sessions l ON l.id=r.live_id WHERE r.id=?`).get(String(id));
        return toPublicRecord(row);
    }

    listRecords(liveId) {
        const rows = liveId
            ? this.db.prepare(`SELECT r.*, l.name AS live_name FROM reconciliation_records r JOIN live_sessions l ON l.id=r.live_id
                WHERE r.live_id=? ORDER BY r.username`).all(String(liveId))
            : this.db.prepare(`SELECT r.*, l.name AS live_name FROM reconciliation_records r JOIN live_sessions l ON l.id=r.live_id
                ORDER BY l.created_at DESC, r.username`).all();
        return rows.map(toPublicRecord);
    }

    listLiveSessions() {
        return this.db.prepare(`SELECT l.id,l.name,l.active,l.created_at,l.updated_at,
                COUNT(r.id) AS record_count,
                COALESCE(SUM(CASE WHEN r.status='mismatch' THEN 1 ELSE 0 END),0) AS mismatch_count
            FROM live_sessions l LEFT JOIN reconciliation_records r ON r.live_id=l.id
            GROUP BY l.id ORDER BY l.active DESC,l.updated_at DESC,l.created_at DESC`)
            .all().map(row => ({
                id: row.id,
                name: row.name,
                isActive: Boolean(row.active),
                recordCount: Number(row.record_count),
                mismatchCount: Number(row.mismatch_count),
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }));
    }

    getRevisions(recordId) {
        return this.db.prepare('SELECT old_amount,new_amount,old_snapshot,new_snapshot,changed_at FROM record_revisions WHERE record_id=? ORDER BY id')
            .all(String(recordId)).map(row => ({
                oldAmount: Number(row.old_amount), newAmount: Number(row.new_amount),
                oldSnapshot: row.old_snapshot ? JSON.parse(row.old_snapshot) : null,
                newSnapshot: row.new_snapshot ? JSON.parse(row.new_snapshot) : null,
                changedAt: row.changed_at
            }));
    }

    close() { this.db.close(); }
}

module.exports = { ShopReconciliationStore };
