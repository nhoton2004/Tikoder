'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { exportReconciliationWorkbook } = require('../utils/shopReconciliationExcel');

const records = [
    {
        username: 'buyer.one', displayName: 'Buyer One', manualAmount: 200000,
        orderId: 'ORD-42', orderAmount: 150000, orderAt: 1700000000000,
        orderSource: 'live_session', difference: 50000, status: 'mismatch'
    },
    {
        username: 'buyer.two', displayName: 'Buyer Two', manualAmount: 80000,
        orderId: null, orderAmount: null, orderAt: null,
        orderSource: null, difference: null, status: 'no_order'
    }
];

test('exports an xlsx with correct rows, mismatch values, and empty unknowns', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-shop-xlsx-'));
    try {
        const result = await exportReconciliationWorkbook(records, { id: 'live-id', name: 'Live 29 Oct' }, { baseDir: root });
        assert.equal(result.rowCount, 2);
        assert.equal(path.dirname(result.path), path.join(root, 'data', 'exports'));
        assert.ok(fs.statSync(result.path).size > 1000);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(result.path);
        const sheet = workbook.getWorksheet('Đối chiếu');
        assert.ok(sheet);
        assert.equal(sheet.rowCount, 3);
        assert.equal(sheet.getCell('A2').value, 'buyer.one');
        assert.equal(sheet.getCell('C2').value, 200000);
        assert.equal(sheet.getCell('E2').value, 150000);
        assert.equal(sheet.getCell('F2').value, 50000);
        assert.equal(sheet.getCell('G2').value, 'Lệch');
        assert.equal(sheet.getCell('A3').value, 'buyer.two');
        assert.equal(sheet.getCell('E3').value, null);
        assert.equal(sheet.getCell('F3').value, null);
        assert.equal(sheet.getCell('G3').value, 'Chưa có đơn Tikoder');
        assert.equal(sheet.autoFilter, 'A1:I3');
        assert.equal(sheet.views[0].state, 'frozen');
        assert.ok(String(sheet.getCell('C2').numFmt).includes('#,##0'));
        assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String);
        const exportedValues = [];
        sheet.eachRow(row => row.eachCell(cell => exportedValues.push(cell.value)));
        assert.doesNotMatch(JSON.stringify(exportedValues), /private|phone|address/i);
        for (const row of sheet._rows) {
            for (const cell of row?.cells || []) assert.notEqual(cell.type, ExcelJS.ValueType.Formula);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('sanitizes live name into a file name under the fixed export directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-shop-xlsx-name-'));
    try {
        const result = await exportReconciliationWorkbook([], { id: 'id', name: '../../secrets\\drop' }, { baseDir: root, now: () => 1700000000000 });
        assert.equal(path.dirname(result.path), path.join(root, 'data', 'exports'));
        assert.doesNotMatch(path.basename(result.path), /[/\\]/);
        assert.match(path.basename(result.path), /^shop-reconciliation-secrets-drop-/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
