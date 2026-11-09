'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadStore(directory) {
    const filename = path.resolve(__dirname, '../../utils/liveSessionStore.js');
    let source = fs.readFileSync(filename, 'utf8');
    for (const [name, subdir] of [['DATA_DIR', 'source'], ['HISTORY_DIR', 'index'], ['ARCHIVE_DIR', 'archive']]) {
        source = source.replace(new RegExp(`const ${name} = .*;`), `const ${name} = ${JSON.stringify(path.join(directory, subdir))};`);
    }
    const module = { exports: {} };
    vm.runInNewContext(source, { module, require: createRequire(filename), process, console, setTimeout, clearTimeout, __dirname: path.dirname(filename) }, { filename });
    return module.exports;
}
module.exports = { loadStore };
