'use strict';

const express = require('express');
const net = require('node:net');
const { isLocal } = require('../utils/zaloAutoReplyService');
function isPrivateLan(address) {
    const value = address?.startsWith('::ffff:') ? address.slice(7) : address;
    if (net.isIP(value) !== 4) return false;
    const [first, second] = value.split('.').map(Number);
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
function errorResponse(res, error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({ error: status === 500 ? 'Không thể xử lý Zalo tự động; kiểm tra kết nối và hàng đợi' : error.message });
}
function createIntegrationRouter(service) {
    const router = express.Router();
    router.use(express.raw({ type: 'application/json', limit: '64kb' }));
    router.get('/data', (req, res) => {
        try {
            const uid = service.verifyDataAccess(req.headers, req.socket.remoteAddress);
            res.set('Cache-Control', 'no-store').json(service.integrationData(uid));
        } catch (error) { errorResponse(res, error); }
    });
    router.get('/data/qr', (req, res) => {
        try {
            const uid = service.verifyDataAccess(req.headers, req.socket.remoteAddress);
            const image = service.image(uid);
            res.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').type(image.mime).sendFile(image.filename);
        } catch (error) { errorResponse(res, error); }
    });
    for (const action of ['inspect', 'send']) router.post('/' + action, (req, res) => {
        try {
            const event = service.verify(req.body, req.headers, req.socket.remoteAddress);
            const result = action === 'inspect' ? service.inspect(event) : service.enqueue(event);
            res.set('Cache-Control', 'no-store').status(result.status === 'accepted' ? 202 : 200).json(result);
        } catch (error) { errorResponse(res, error); }
    });
    return router;
}
function createUiRouter(service, requireAuth) {
    const router = express.Router();
    router.use(requireAuth, (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        const local = isLocal(req.socket.remoteAddress);
        const lanImageAccess = isPrivateLan(req.socket.remoteAddress) && (
            (req.method === 'GET' && (req.path === '/' || req.path === '/image')) ||
            (req.method === 'POST' && req.path === '/image')
        );
        if (!local && !lanImageAccess) return res.status(403).json({ error: 'Zalo tự động thử nghiệm chỉ dùng trên máy cục bộ; qua LAN chỉ được xem trạng thái và tải ảnh QR' });
        if (req.method !== 'GET' && req.get('origin') !== req.protocol + '://' + req.get('host')) return res.status(403).json({ error: 'Origin không hợp lệ' });
        next();
    });
    const handle = fn => async (req, res) => {
        try { const value = await fn(req, res); if (!res.headersSent) res.json(value); }
        catch (error) { errorResponse(res, error); }
    };
    const uid = req => req.session.user.uid;
    router.get('/', handle(req => service.state(uid(req))));
    router.put('/settings', handle(req => service.save(uid(req), req.body)));
    router.post('/connect', handle(req => service.connect(uid(req))));
    router.post('/pause', handle(req => service.pause(uid(req))));
    router.get('/diagnostics', handle(req => service.diagnostics(uid(req))));
    router.post('/image', handle(req => service.upload(uid(req), req.body)));
    router.get('/image', (req, res, next) => {
        try {
            const image = service.image(uid(req));
            res.set('X-Content-Type-Options', 'nosniff').type(image.mime).sendFile(image.filename, error => {
                if (error) {
                    if (res.headersSent) return next(error);
                    errorResponse(res, error);
                }
            });
        } catch (error) { errorResponse(res, error); }
    });
    router.post('/messages/:id/resolve', handle(req => service.resolve(uid(req), req.params.id, req.body?.action)));
    return router;
}
module.exports = { createIntegrationRouter, createUiRouter };
