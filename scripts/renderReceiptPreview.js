'use strict';

// Generates review artifacts from the real receipt renderer and print CSS.
// No app server, account data, or printer is used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');

function loadRenderer() {
    const source = fs.readFileSync(path.join(root, 'public', 'js', 'dashboard.js'), 'utf8');
    const helpers = source.slice(source.indexOf('function formatMoney('), source.indexOf('function escapeJsString('));
    const names = source.slice(source.indexOf('const DISPLAY_NAME_FALLBACK'), source.indexOf('function setText('));
    const context = { Intl, Date, window: {} };
    vm.createContext(context);
    vm.runInContext(`${helpers}\n${names}`, context);
    return context.window.renderReceiptHtml;
}

function countPdfPages(buffer) {
    return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

(async () => {
    fs.mkdirSync(artifacts, { recursive: true });
    const renderReceiptHtml = loadRenderer();
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'dashboard.css'), 'utf8');
    const shortHtml = renderReceiptHtml({
        shopName: '',
        sessionName: 'Live tối 07/11/2026',
        customer: { name: 'MinMin', username: 'minmin190486' },
        items: [
            { text: '20', price: 20000, time: '23:08:20 02/11/2026' },
            { text: '20', price: 20000, time: '05:23:55 04/11/2026' }
        ],
        total: 40000
    });
    const longItems = Array.from({ length: 80 }, (_, index) => ({
        text: `Dòng ${index + 1} — nội dung dài để kiểm tra tự xuống dòng trên giấy in`,
        price: 1000000 + index * 1000
    }));
    const longHtml = renderReceiptHtml({
        customer: { name: 'Khách hàng có tên rất dài '.repeat(4), username: 'fixture_long_customer' },
        sessionName: 'Phiên kiểm thử nhiều trang',
        items: longItems,
        total: longItems.reduce((sum, item) => sum + item.price, 0)
    });

    const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
    try {
        const page = await browser.newPage({ viewport: { width: 420, height: 1200 }, deviceScaleFactor: 2 });
        await page.setContent(`<style>${css}</style><div class="app-shell" style="height:5000px">dashboard fixture</div><div id="print-section">${shortHtml}</div>`);
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('.app-shell').evaluate(el => getComputedStyle(el).display), 'none');
        assert.equal(await page.locator('#print-section').evaluate(el => getComputedStyle(el).position), 'static');
        await page.locator('#print-section').screenshot({ path: path.join(artifacts, 'receipt-preview.png') });
        const shortPdf = await page.pdf({ path: path.join(artifacts, 'receipt-short.pdf'), printBackground: true, preferCSSPageSize: true });

        await page.locator('#print-section').evaluate(element => {
            element.innerHTML = '<div data-shared-report style="width:80mm">Báo cáo dùng chung vùng in</div>';
        });
        const sharedReportFits = await page.locator('[data-shared-report]').evaluate(element => element.scrollWidth <= element.parentElement.clientWidth);
        assert.equal(sharedReportFits, true, 'existing reports in #print-section must stay inside the printable width');

        await page.locator('#print-section').evaluate((element, html) => { element.innerHTML = html; }, longHtml);
        const longPdf = await page.pdf({ path: path.join(artifacts, 'receipt-long.pdf'), printBackground: true, preferCSSPageSize: true });
        const shortPages = countPdfPages(shortPdf);
        const longPages = countPdfPages(longPdf);
        assert.equal(shortPages, 1, 'short receipt must render to one PDF page');
        assert.ok(longPages > 1, 'long receipt must paginate instead of being forced onto one page');
        process.stdout.write(JSON.stringify({ shortPages, longPages, artifacts }, null, 2) + '\n');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
