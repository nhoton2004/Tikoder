const { io } = require('socket.io-client');
const http = require('http');

const BASE = 'http://localhost:3000';
const cookieHeader = 'connect.sid=s%3A24NppC6ZONqyXFniAeAa1BFU8YhjOjDL.zgQEuvLMfqJo9UOzWehaelCKDEMNNVJKONEQ2pEenz4; Path=/; HttpOnly; SameSite=Strict';
const cookie = cookieHeader.split(';')[0];

const req = (path, method, body) =>
  new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', Cookie: cookie } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });

(async () => {
  try {
    const meRes = await req('/api/me', 'GET');
    const me = JSON.parse(meRes.body);
    console.log('me', meRes.status, me.loggedIn, me.devSkipAuth);

    const ordersBeforeRes = await req('/api/orders?limit=10&offset=0', 'GET');
    const ordersBefore = JSON.parse(ordersBeforeRes.body);
    const beforeCount = Array.isArray(ordersBefore.orders) ? ordersBefore.orders.length : 0;
    const beforeSummaryTotal = Number(ordersBefore.summary?.totalOrders || 0);
    console.log('orders before count', beforeCount, 'summary.totalOrders', beforeSummaryTotal);

    const socket = io(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
    await new Promise((resolve) => setTimeout(resolve, 600));

    socket.emit('confirm-item', {
      uniqueId: 'tu_manh_final',
      nickname: 'Final Auto',
      profilePictureUrl: '',
      comment: 'final test ' + Date.now(),
      price: 111000
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

    const ordersAfterRes = await req('/api/orders?limit=10&offset=0', 'GET');
    const ordersAfter = JSON.parse(ordersAfterRes.body);
    const afterCount = Array.isArray(ordersAfter.orders) ? ordersAfter.orders.length : 0;
    const afterSummaryTotal = Number(ordersAfter.summary?.totalOrders || 0);
    console.log('orders after count', afterCount, 'summary.totalOrders', afterSummaryTotal);

    const ok = (afterCount > beforeCount || afterSummaryTotal > beforeSummaryTotal);
    console.log(ok ? 'PASS' : 'FAIL');
    socket.disconnect();
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  }
})();
