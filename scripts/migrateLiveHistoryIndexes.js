'use strict';

const fs = require('node:fs');
const path = require('node:path');
const store = require('../utils/liveSessionStore');

const requestedUser = process.argv[2];
const users = requestedUser
    ? [requestedUser]
    : (fs.existsSync(store.DATA_DIR)
        ? fs.readdirSync(store.DATA_DIR).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))
        : []);

let failed = 0;
async function main() {
await store.initialize();
for (const userId of users) {
    const audit = await store.migrateUserIndexes(userId);
    console.log(`${userId}: ${audit.match ? 'OK' : 'MISMATCH'} rows ${audit.source.count}/${audit.indexed.count} revenueCents ${audit.source.revenueCents}/${audit.indexed.revenueCents} ids ${audit.source.distinctEventIds}/${audit.indexed.distinctEventIds}`);
    if (!audit.match) failed += 1;
}
process.exitCode = failed ? 1 : 0;
await store.drain();
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
