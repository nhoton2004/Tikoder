'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');

const HEADERS = [
    'TikTok username', 'Tên khách', 'Số tiền đã ghi (₫)',
    'Mã đơn gần nhất', 'Số tiền Tikoder (₫)', 'Chênh lệch (₫)',
    'Trạng thái', 'Thời điểm đơn', 'Nguồn đơn'
];

function safeSlug(value) {
    return String(value || 'live').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'live';
}

function statusLabel(status) {
    if (status === 'match') return 'Khớp';
    if (status === 'mismatch') return 'Lệch';
    return 'Chưa có đơn Tikoder';
}

async function exportReconciliationWorkbook(records, live, { baseDir = path.resolve(__dirname, '..'), now = Date.now } = {}) {
    if (!Array.isArray(records)) throw new Error('Danh sách đối chiếu không hợp lệ.');
    if (!live || !String(live.name || '').trim()) throw new Error('Thiếu tên đợt live.');
    const timestamp = now();
    const stamp = new Date(timestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const suffix = crypto.randomUUID().slice(0, 8);
    const directory = path.resolve(baseDir, 'data', 'exports');
    const fileName = `shop-reconciliation-${safeSlug(live.name)}-${stamp}-${suffix}.xlsx`;
    const filePath = path.join(directory, fileName);
    fs.mkdirSync(directory, { recursive: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tikoder';
    workbook.subject = 'Sổ đối chiếu tiền live';
    workbook.title = `Đối chiếu - ${String(live.name).slice(0, 120)}`;
    workbook.created = new Date(timestamp);
    workbook.modified = new Date(timestamp);
    const sheet = workbook.addWorksheet('Đối chiếu', { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }] });
    sheet.columns = [
        { key: 'username', width: 22 }, { key: 'displayName', width: 26 }, { key: 'manualAmount', width: 22 },
        { key: 'orderId', width: 22 }, { key: 'orderAmount', width: 22 }, { key: 'difference', width: 20 },
        { key: 'status', width: 24 }, { key: 'orderAt', width: 22 }, { key: 'orderSource', width: 18 }
    ];
    sheet.addRow(HEADERS);
    const header = sheet.getRow(1);
    header.height = 28;
    header.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF26364A' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
    });
    for (const record of records) {
        const row = sheet.addRow([
            String(record.username || ''),
            String(record.displayName || ''),
            Number(record.manualAmount),
            record.orderId === null || record.orderId === undefined ? null : String(record.orderId),
            record.orderAmount === null || record.orderAmount === undefined ? null : Number(record.orderAmount),
            record.difference === null || record.difference === undefined ? null : Number(record.difference),
            statusLabel(record.status),
            record.orderAt === null || record.orderAt === undefined ? null : new Date(Number(record.orderAt)),
            record.orderSource === null || record.orderSource === undefined ? null : String(record.orderSource)
        ]);
        for (const column of [3, 5, 6]) row.getCell(column).numFmt = '#,##0" ₫"';
        row.getCell(8).numFmt = 'dd/mm/yyyy hh:mm';
        row.eachCell(cell => { cell.alignment = { vertical: 'middle' }; });
        if (record.status === 'mismatch') row.getCell(7).font = { bold: true, color: { argb: 'FFB42318' } };
        else if (record.status === 'match') row.getCell(7).font = { color: { argb: 'FF027A48' } };
        else row.getCell(7).font = { color: { argb: 'FF667085' } };
    }
    const lastRow = Math.max(1, records.length + 1);
    sheet.autoFilter = { from: 'A1', to: `I${lastRow}` };
    sheet.getColumn(3).alignment = { horizontal: 'right' };
    sheet.getColumn(5).alignment = { horizontal: 'right' };
    sheet.getColumn(6).alignment = { horizontal: 'right' };
    await workbook.xlsx.writeFile(filePath);
    return { path: filePath, fileName, rowCount: records.length, liveName: String(live.name) };
}

module.exports = { exportReconciliationWorkbook, safeSlug };
