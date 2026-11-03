'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('express-session');

// Single-process deployment. Keep this database on the persistent data volume.
class SqliteSessionStore extends Store {
    constructor(filename, { ttl = 86400000, now = Date.now } = {}) {
        super();
        this.ttl = ttl;
        this.now = now;
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        this.db = new DatabaseSync(filename);
        this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);');
        this.timer = setInterval(() => {
            try { this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(this.now()); }
            catch (error) { this.emit('error', error); }
        }, 600000);
        this.timer.unref();
    }
    expiry(session) {
        return session.cookie?.expires ? new Date(session.cookie.expires).getTime() : this.now() + this.ttl;
    }
    get(sid, callback) {
        let value;
        try {
            const row = this.db.prepare('SELECT value FROM sessions WHERE sid = ? AND expires > ?').get(sid, this.now());
            value = row ? JSON.parse(row.value) : null;
        } catch (error) { return callback(error); }
        callback(null, value);
    }
    set(sid, session, callback = () => {}) {
        try { this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)').run(sid, JSON.stringify(session), this.expiry(session)); }
        catch (error) { return callback(error); }
        callback(null);
    }
    touch(sid, session, callback = () => {}) {
        try { this.db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(this.expiry(session), sid); }
        catch (error) { return callback(error); }
        callback(null);
    }
    destroy(sid, callback = () => {}) {
        try { this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); }
        catch (error) { return callback(error); }
        callback(null);
    }
    close() { clearInterval(this.timer); this.db.close(); }
}
module.exports = { SqliteSessionStore };
