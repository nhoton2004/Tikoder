'use strict';
const store = require('../utils/liveSessionStore');
async function main() {
    const userId = process.argv[2];
    if (!userId) throw new Error('Usage: node scripts/recoverLiveBackup.js <userId> (stop server first)');
    await store.initialize();
    console.log(JSON.stringify(await store.recoverBackup(userId), null, 2));
    await store.drain();
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
