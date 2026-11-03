'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');

// Shared by store instances in this process; the lock also excludes other processes.
const owners = new Map();
const acquiring = new Map();
const queues = new Map();
const context = new AsyncLocalStorage();
let stopping = false;

async function atomicWrite(target, value, io = fs.promises) {
    await io.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let handle;
    try {
        handle = await io.open(temporary, 'wx');
        await handle.writeFile(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value), 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        for (let attempt = 0; ; attempt += 1) {
            try { await io.rename(temporary, target); break; }
            catch (error) {
                if (!['EPERM', 'EBUSY'].includes(error.code) || attempt === 4) {
                    error.message = `Commit ${target}: ${error.code || error.message} (rename attempt ${attempt + 1})`;
                    throw error;
                }
                await delay(20 * (2 ** attempt));
            }
        }
    } finally {
        if (handle) await handle.close().catch(() => {});
        await io.unlink(temporary).catch(error => {
            if (error.code !== 'ENOENT') console.error('[live-store] temp cleanup:', error.code);
        });
    }
}

function alive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return true; // malformed lock fails closed
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
}

async function acquireWriter(root) {
    root = path.resolve(root);
    if (owners.has(root)) return;
    if (acquiring.has(root)) return acquiring.get(root);
    const task = acquireWriterExclusive(root);
    acquiring.set(root, task);
    try { await task; } finally { acquiring.delete(root); }
}

async function acquireWriterExclusive(root) {
    await fs.promises.mkdir(root, { recursive: true });
    const lock = path.join(root, '.writer.lock');
    // A second exclusive file serializes stale-lock reclamation and acquisition.
    const guardPath = path.join(root, '.writer.guard');
    let guard;
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try { guard = await fs.promises.open(guardPath, 'wx'); break; }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            // Never automatically remove this guard: two stale-lock reclaimers
            // could otherwise unlink a newly acquired guard. A crash during this
            // short acquisition step requires operator inspection (fail closed).
            await delay(20);
        }
    }
    if (!guard) throw new Error('Kho live đang bị khóa (writer guard); cần kiểm tra tiến trình giữ khóa');
    try {
        await guard.writeFile(JSON.stringify({ pid: process.pid }));
        try {
            const owner = JSON.parse(await fs.promises.readFile(lock, 'utf8'));
            if (alive(owner.pid)) throw new Error(`Kho live đã có tiến trình ghi: ${owner.pid}`);
            await fs.promises.unlink(lock);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const token = crypto.randomUUID();
        const handle = await fs.promises.open(lock, 'wx');
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); }
        finally { await handle.close(); }
        owners.set(root, { lock, token });
    } finally {
        await guard.close();
        await fs.promises.unlink(guardPath);
    }
}

function serialize(root, userId, operation) {
    const key = `${path.resolve(root)}|${userId}`;
    const inherited = context.getStore();
    if (inherited?.key === key && inherited.active) return operation();
    if (stopping) return Promise.reject(new Error('Server đang dừng, không nhận thao tác mới'));
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
        await acquireWriter(root);
        const scope = { key, active: true };
        return context.run(scope, async () => {
            try { return await operation(); }
            finally { scope.active = false; }
        });
    });
    queues.set(key, next);
    const cleanup = () => { if (queues.get(key) === next) queues.delete(key); };
    next.then(cleanup, cleanup);
    return next;
}

async function drain() {
    stopping = true;
    await Promise.allSettled([...queues.values()]);
}

function releaseWriters() {
    for (const { lock, token } of owners.values()) {
        try {
            if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock);
        } catch (_) { /* Never remove another owner's lock. */ }
    }
    owners.clear();
}
process.once('exit', releaseWriters);

function isSerialized(root, userId) {
    const scope = context.getStore();
    return scope?.active && scope.key === `${path.resolve(root)}|${userId}`;
}
module.exports = { atomicWrite, serialize, acquireWriter, drain, releaseWriters, isSerialized };
