'use strict';
const express = require('express');
const { createAdapter } = require('./zaloPersonalAdapter');

function createAdapterServer({ adapter, secret, host = '127.0.0.1', port = 3010, now = Date.now } = {}) {
    if (!adapter || typeof adapter.executeCommand !== 'function' || !secret) throw new Error('Adapter and command secret are required');
    const app = express();
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.post('/command', express.raw({ type: 'application/json', limit: '8mb' }), async (req, res) => {
        try {
            if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid JSON body' });
            const body = JSON.parse(req.body.toString('utf8'));
            const result = await adapter.executeCommand(body, req.headers, secret, now());
            res.set('Cache-Control', 'no-store').status(result.status === 'sent' ? 200 : 202).json(result);
        } catch (error) {
            const status = Number.isInteger(error.status) ? error.status : 502;
            res.status(status).json({ error: status === 500 ? 'Adapter error' : error.message });
        }
    });
    return { app, listen: () => new Promise((resolve, reject) => { const server = app.listen(port, host, () => resolve(server)); server.once('error', reject); }) };
}
module.exports = { createAdapterServer };
