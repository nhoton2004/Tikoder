'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const legacy = (id, price) => ({ buyer: { username: 'buyer', nickname: 'Synthetic buyer', items: [{ id, text: id, price, time: '12:00:00' }] } });

test('real legacy reader handles empty, retained/expired and shared rows without changing retention policy', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-legacy-reader-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const own = path.join(directory, 'a'); fs.mkdirSync(own);
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const context = vm.createContext({ fs, path, Date, console, HISTORY_ROOT_DIR: directory, getUserHistoryDir: () => own,
        dateKeyFromTimestamp: dateKey, safeLegacyHistoryFileName: n => /^\d{4}-\d{2}-\d{2}_.+\.json$/.test(n),
        customerStore: { normalizeTikTokUsername: s => s }, normalizeDisplayText: s => s, normalizeOrderCustomerName: (n,u) => n || u });
    vm.runInContext(source.slice(source.indexOf('function readLegacyHistoryRows('), source.indexOf('function parseLegacySessionRef(')), context);
    assert.equal(context.readLegacyHistoryRows('a').rows.length, 0);
    fs.writeFileSync(path.join(own, dateKey(Date.now() - 10 * 86400000) + '_recent.json'), JSON.stringify(legacy('recent', 100)));
    fs.writeFileSync(path.join(own, dateKey(Date.now() - 120 * 86400000) + '_expired.json'), JSON.stringify(legacy('expired', 999)));
    fs.writeFileSync(path.join(own, '_undated.json'), JSON.stringify(legacy('undated', 200)));
    fs.writeFileSync(path.join(directory, '2020-01-01_shared.json'), JSON.stringify(legacy('shared-policy-unchanged', 300)));
    const ownRows = context.readLegacyHistoryRows('a');
    assert.deepEqual(Array.from(ownRows.rows, r => r.orderId).sort(), ['recent', 'undated']);
    assert.equal(ownRows.rows.reduce((n,r) => n + r.total, 0), 300);
    const combined = context.readLegacyHistoryRows('a', { includeSharedLegacy: true });
    assert.deepEqual(Array.from(combined.rows, r => r.orderId).sort(), ['recent', 'shared-policy-unchanged', 'undated']);
    assert.equal(combined.files, 4);
});

test('authenticated real HTTP Overview reads empty and populated legacy source and returns exact totals', { timeout: 20000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-legacy-http-'));
    let child;
    try {
        for (const name of ['server.js', 'utils', 'routes', 'public', 'templates']) fs.cpSync(path.join(root,name),path.join(directory,name),{recursive:true});
        fs.writeFileSync(path.join(directory,'config.json'),'{}');
        fs.writeFileSync(path.join(directory,'launch.js'),"process.on('message', () => process.emit('SIGTERM')); require('./server');");
        const listener = net.createServer(); listener.listen(0,'127.0.0.1'); await once(listener,'listening');
        const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
        child = fork(path.join(directory,'launch.js'),[],{ cwd:directory,silent:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,NODE_PATH:path.join(root,'node_modules'),NODE_ENV:'development',SESSION_SECRET:'synthetic-legacy-http-test',SESSION_STORE:'sqlite',PORT:String(port),NOTIFY_ENABLED:'false',ZALO_WEB_EXPERIMENTAL:'false',VITE_DEV_SKIP_AUTH:'true'} });
        let stderr = ''; child.stderr.on('data',b=>{stderr+=b;});
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout: '+stderr)),10000);child.once('exit',c=>{clearTimeout(timer);reject(Error('Server exit '+c+': '+stderr));});child.stdout.on('data',b=>{if(b.toString().includes('Server running')){clearTimeout(timer);resolve();}});});
        const origin='http://127.0.0.1:'+port;
        const auth=await fetch(origin+'/api/me');const cookie=auth.headers.get('set-cookie').split(';')[0];assert.equal((await auth.json()).user.uid,'dev-user');
        const today=dateKey(Date.now()), endpoint=origin+'/api/overview?start='+today+'&end='+today;
        const request=async()=>{const response=await fetch(endpoint,{headers:{Cookie:cookie}});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
        const empty=await request();assert.equal(empty.summary.orders,0);assert.equal(empty.summary.revenue,0);
        const history=path.join(directory,'history');const own=path.join(history,'dev-user');fs.mkdirSync(own,{recursive:true});
        fs.writeFileSync(path.join(own,today+'_shop.json'),JSON.stringify(legacy('own-test-order',15000)));
        fs.writeFileSync(path.join(history,today+'_shared.json'),JSON.stringify(legacy('shared-test-order',20000)));
        const data=await request();assert.equal(data.summary.orders,2);assert.equal(data.summary.revenue,35000);assert.equal(data.meta.rows,2);
    } finally {
        if(child && child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.send('shutdown');await exited;}
        fs.rmSync(directory,{recursive:true,force:true});
    }
});
