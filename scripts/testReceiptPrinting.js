'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function dashboardReceiptFixture() {
    const source = fs.readFileSync(path.join(root, 'public', 'js', 'dashboard.js'), 'utf8');
    const helpers = source.slice(source.indexOf('function formatMoney('), source.indexOf('function escapeJsString('));
    const names = source.slice(source.indexOf('const DISPLAY_NAME_FALLBACK'), source.indexOf('function setText('));
    const context = { Intl, Date, window: {} };
    vm.createContext(context);
    vm.runInContext(`${helpers}\n${names}`, context);
    return context.window.renderReceiptHtml;
}

function thermalReceiptFixture(shopName = '') {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const receiptSource = source.slice(source.indexOf('function removeVietnameseTones('), source.indexOf('function parsePrice('));
    const lines = [];
    const printer = {
        clear() {}, alignCenter() {}, alignLeft() {}, alignRight() {},
        setTextNormal() {}, setTextDoubleHeight() {}, setTextDoubleWidth() {}, setTextQuadArea() {},
        bold() {}, println(value = '') { lines.push(String(value)); }, cut() {}, async execute() {}
    };
    const context = {
        Intl, Date, printer, shopName,
        normalizeDisplayText: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
        normalizeOrderCustomerName: (name, username) => String(name || `@${username}`),
        customerStore: { normalizeTikTokUsername: value => String(value || '').replace(/^@+/, '').toLowerCase() },
        liveSessionStore: { getLiveSessionById() { return null; } },
        emitToUser() {}, console: { log() {}, error() {} }
    };
    vm.createContext(context);
    vm.runInContext(receiptSource, context);
    return { printDetailedBill: context.printDetailedBill, lines };
}

test('browser receipt escapes fixture data, separates customer identity and totals selected rows', () => {
    const renderReceiptHtml = dashboardReceiptFixture();
    const html = renderReceiptHtml({
        shopName: 'Shop & <Thật>',
        sessionName: 'Live <07/11>',
        customer: { name: 'Min<script>alert(1)</script>', username: '@MinMin190486' },
        items: [
            { text: '20 & <b>đậm</b>', price: 20000, time: '23:08:20 02/11/2026<script>' },
            { text: 'Tên món rất dài '.repeat(8), price: 1234567890 }
        ],
        total: 1234587890
    });

    assert.match(html, /Shop &amp; &lt;Thật&gt;/);
    assert.match(html, /Live &lt;07\/11&gt;/);
    assert.match(html, /Min&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /class="receipt__username">@minmin190486</);
    assert.match(html, /class="receipt__item-time">23:08:20 02\/11\/2026&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>|In lúc:|đã thanh toán|LH:|0828642688/i);
    assert.match(html, /Số dòng hàng/);
    assert.match(html, />2<\/span>/);
    assert.match(html, /1\.234\.587\.890/);

    const oneItem = renderReceiptHtml({
        customer: { name: 'MinMin', username: 'minmin190486' },
        items: [{ text: '20', price: 20000 }], total: 999999
    });
    assert.doesNotMatch(oneItem, /receipt__shop/);
    assert.match(oneItem, /20\.000/);
    assert.match(oneItem, />1<\/span>/);
});

test('browser receipt handles many rows without calling them products', () => {
    const renderReceiptHtml = dashboardReceiptFixture();
    const items = Array.from({ length: 75 }, (_, index) => ({ text: `Dòng ${index + 1}`, price: 1000000 + index }));
    const total = items.reduce((sum, item) => sum + item.price, 0);
    const html = renderReceiptHtml({ customer: { name: 'Khách tên dài '.repeat(10) }, items, total });
    assert.equal((html.match(/class="receipt__item"/g) || []).length, 75);
    assert.match(html, /Số dòng hàng/);
    assert.doesNotMatch(html, /Số sản phẩm/);
    assert.match(html, new RegExp(new Intl.NumberFormat('vi-VN').format(total).replace(/\./g, '\\.')));
});

test('print CSS removes dashboard layout only in print scope and keeps receipt in normal flow', () => {
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'dashboard.css'), 'utf8');
    const printCss = css.slice(css.indexOf('@media print'));
    assert.match(printCss, /body > \.app-shell[\s\S]*display: none !important/);
    assert.match(printCss, /#print-section[\s\S]*position: static !important/);
    assert.match(printCss, /width: 72mm !important/);
    assert.doesNotMatch(printCss, /body \*\s*\{\s*visibility:\s*hidden/);
});

test('ESC/POS detailed receipt is mocked, uses computed item total and contains no payment claim', async () => {
    const { printDetailedBill, lines } = thermalReceiptFixture('SHOP THẬT');
    await printDetailedBill({
        nickname: 'Tên khách hàng rất dài để kiểm tra xuống dòng an toàn trên giấy nhiệt tám mươi',
        username: 'MinMin190486',
        total: 1,
        items: [
            { text: '20', price: 20000, time: '23:08:20 02/11/2026' },
            { text: 'Món có nội dung dài '.repeat(6), price: 1234567890 }
        ]
    }, 'fixture', { sessionName: 'Phiên live kiểm thử' });

    const output = lines.join('\n');
    assert.match(output, /SHOP THAT/);
    assert.match(output, /PHIEU TONG DON/);
    assert.doesNotMatch(output, /In luc:/i);
    assert.match(output, /@minmin190486/);
    assert.match(output, /So dong hang: 2/);
    assert.match(output, /23:08:20 02\/11\/2026/);
    assert.match(output, /1\.234\.587\.890 D/);
    assert.doesNotMatch(output, /TONG TIEN\n1 D|DA THANH TOAN|LH:|0828642688/i);
    assert.match(output, /Cam on ban da ung ho shop!/);
    assert.match(output, /Hen gap ban o live sau\./);
    assert.equal(lines.filter(line => line.includes('@minmin190486')).length, 1);
    assert.ok(lines.every(line => line.length <= 48), 'thermal-printer lines must stay within width: 48');
});
