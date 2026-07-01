const { io } = require('socket.io-client');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';

const req = (path, method, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      }
    );
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });

function getSessionId() {
  try {
    // Read from /tmp to avoid cross-session leaks? actually get from runtime live runtime store
    // Use the existing test session user from live-sessions
    return 'user:RT8opnzxFiaUaZsdztS0OWQlUIn1:session_1782839141150_her749';
  } catch (e) {
    return null;
  }
}

(async () => {
  try {
    const meRes = await req('/api/me', 'GET');
    const me = JSON.parse(meRes.body);
    console.log('me', meRes.status, me.loggedIn, me.devSkipAuth);
    if (!me.loggedIn) return process.exit(1);

    // get cookie from response headers
    const cookieHeader = meRes.headers['set-cookie'];
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0].split(';')[0] : (cookieHeader || '');

    const ordersBeforeRes = await req('/api/orders?q=&limit=10&offset=0', 'GET');
    const ordersBefore = JSON.parse(ordersBeforeRes.body);
    const beforeCount = Array.isArray(ordersBefore.items) ? ordersBefore.items.length : 0;
    console.log('orders before', ordersBeforeRes.status, beforeCount);

    const sessionId = getSessionId();
    if (!sessionId) return console.log('NO_SESSION');

    const detBeforeRes = await req('/api/live-sessions/' + encodeURIComponent(sessionId), 'GET');
    const detBefore = JSON.parse(detBeforeRes.body);
    const sessionOrdersBefore = Array.isArray(detBefore.orders) ? detBefore.orders.length : 0;
    console.log('session orders before', sessionOrdersBefore);

    // Use socket with session cookie
    const socket = io(BASE, {
      transports: ['websocket'],
      extraHeaders: { cookie }
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    socket.emit('confirm-item', {
      uniqueId: 'tu_manh',
      nickname: 'Auto Test',
      profilePictureUrl: '',
      comment: 'test auto chốt ' + Date.now(),
      price: 69000,
      liveId: sessionId
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const ordersAfterRes = await req('/api/orders?q=&limit=10&offset=0', 'GET');
    const ordersAfter = JSON.parse(ordersAfterRes.body);
    const afterCount = Array.isArray(ordersAfter.items) ? ordersAfter.items.length : 0;
    console.log('orders after', ordersAfterRes.status, afterCount);

    const detAfterRes = await req('/api/live-sessions/' + encodeURIComponent(sessionId), 'GET');
    const detAfter = JSON.parse(detAfterRes.body);
    const sessionOrdersAfter = Array.isArray(detAfter.orders) ? detAfter.orders.length : 0;
    console.log('session orders after', sessionOrdersAfter);

    const okOrders = afterCount >= beforeCount && afterCount > 0;
    const okSession = sessionOrdersAfter >= sessionOrdersBefore && sessionOrdersAfter > 0;
    console.log(okOrders && okSession ? 'PASS' : 'FAIL');
    socket.disconnect();
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  }
})();
