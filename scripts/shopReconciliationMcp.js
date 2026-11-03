'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { ShopReconciliationStore } = require('../utils/shopReconciliationStore');
const { findCustomerLatestOrder, normalizeTikTokUsername } = require('../utils/shopReconciliationData');

function jsonResult(value) {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(error) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: String(error?.message || 'Không thể xử lý yêu cầu.') }) }] };
}

function registerTool(server, name, config, handler) {
    server.registerTool(name, config, async args => {
        try { return jsonResult(await handler(args)); }
        catch (error) { return errorResult(error); }
    });
}

function getLive(store, liveName) {
    const live = liveName ? store.getLiveByName(liveName) : store.getActiveLive();
    if (!live) throw new Error(liveName ? 'Không tìm thấy đợt live có tên đó.' : 'Chưa chọn đợt live. Hãy chọn/tạo đợt live trước.');
    return live;
}

function createShopReconciliationServer({ store, userId, lookupCustomer, exportWorkbook } = {}) {
    if (!store) throw new Error('MCP needs a reconciliation store.');
    if (!userId) throw new Error('MCP needs a fixed Tikoder account ID.');
    const lookup = lookupCustomer || (username => findCustomerLatestOrder(userId, username));
    const exportFile = exportWorkbook || ((records, live) =>
        require('../utils/shopReconciliationExcel').exportReconciliationWorkbook(records, live));
    const server = new McpServer({ name: 'tikoder-shop-reconciliation', version: '1.0.0' });
    const usernameSchema = z.string().trim().min(1).max(80);
    const liveNameSchema = z.string().trim().min(1).max(120);

    registerTool(server, 'lookup_customer_latest_order', {
        title: 'Tra khách và đơn gần nhất',
        description: 'Chỉ đọc Tikoder theo TikTok username. Trả tên hiển thị và đơn gần nhất (một đơn, không cộng nhiều đơn); không trả số điện thoại/địa chỉ.',
        inputSchema: { username: usernameSchema }
    }, async ({ username }) => {
        const normalized = normalizeTikTokUsername(username);
        if (!normalized) throw new Error('TikTok username không hợp lệ.');
        const result = await lookup(normalized);
        if (!result) return { found: false, username: normalized, message: 'Không tìm thấy hồ sơ khách trong Tikoder.' };
        return {
            found: true,
            username: result.username,
            displayName: result.displayName,
            latestOrder: result.latestOrder ? {
                orderId: result.latestOrder.orderId,
                amount: result.latestOrder.amount,
                orderedAt: result.latestOrder.orderedAt,
                source: result.latestOrder.source
            } : null
        };
    });

    registerTool(server, 'set_active_live', {
        title: 'Chọn đợt live',
        description: 'Tạo hoặc chọn đợt live đang ghi sổ. Chỉ gọi khi người dùng nêu rõ tên đợt live; không tự đoán từ ngày.',
        inputSchema: { name: liveNameSchema }
    }, async ({ name }) => ({ live: store.setActiveLive(name) }));

    registerTool(server, 'prepare_live_amount', {
        title: 'Chuẩn bị ghi số tiền live',
        description: 'Tạo bản xem trước cho khoản ghi nhận ở đợt live đang chọn. Không lưu khoản tiền. Sau khi hiển thị username, đợt, số tiền và chênh lệch, hãy hỏi người dùng xác nhận; chỉ gọi confirm_live_amount sau xác nhận tường minh ở lượt chat tiếp theo.',
        inputSchema: {
            username: usernameSchema,
            amount: z.number().int().positive().max(2000000000)
        }
    }, async ({ username, amount }) => {
        const normalized = normalizeTikTokUsername(username);
        if (!normalized) throw new Error('TikTok username không hợp lệ.');
        const result = await lookup(normalized);
        const sourceSnapshot = result?.latestOrder || null;
        const snapshot = sourceSnapshot ? {
            displayName: result.displayName,
            orderId: sourceSnapshot.orderId,
            amount: sourceSnapshot.amount,
            orderedAt: sourceSnapshot.orderedAt,
            source: sourceSnapshot.source
        } : null;
        return { preview: store.prepareRecord({ username: normalized, amount, snapshot }) };
    });

    registerTool(server, 'confirm_live_amount', {
        title: 'Xác nhận ghi số tiền live',
        description: 'Ghi khoản tiền đã được chuẩn bị. Chỉ gọi khi người dùng đã xác nhận rõ trong tin nhắn kế tiếp; không tự xác nhận ngay sau prepare. Confirmation ID dùng một lần và hết hạn sau vài phút.',
        inputSchema: { confirmation_id: z.string().uuid() }
    }, async ({ confirmation_id }) => ({ record: store.confirmRecord(confirmation_id) }));

    registerTool(server, 'get_live_reconciliation', {
        title: 'Tra sổ đối chiếu',
        description: 'Tra số tiền đã ghi và ảnh chụp đơn Tikoder của một khách, hoặc danh sách đợt live. Mặc định dùng đợt live đang chọn.',
        inputSchema: {
            username: usernameSchema.optional(),
            live_name: liveNameSchema.optional()
        }
    }, async ({ username, live_name }) => {
        const live = getLive(store, live_name);
        const rows = store.listRecords(live.id);
        if (!username) return { live: { name: live.name }, records: rows };
        const normalized = normalizeTikTokUsername(username);
        if (!normalized) throw new Error('TikTok username không hợp lệ.');
        return { live: { name: live.name }, record: rows.find(row => row.username === normalized) || null };
    });

    registerTool(server, 'list_live_sessions', {
        title: 'Danh sách đợt live',
        description: 'Liệt kê tên các đợt live đã lưu, đợt đang chọn và số dòng/chênh lệch tổng hợp. Không trả dữ liệu từng khách; dùng tên trả về để tra cứu một đợt cũ.',
        inputSchema: {}
    }, async () => ({ lives: store.listLiveSessions() }));

    registerTool(server, 'list_live_mismatches', {
        title: 'Liệt kê chênh lệch live',
        description: 'Liệt kê khoản có chênh lệch khác 0 trong một đợt live. Phân tách khách chưa có dữ liệu đơn thay vì tính họ thành chênh lệch 0.',
        inputSchema: { live_name: liveNameSchema.optional() }
    }, async ({ live_name }) => {
        const live = getLive(store, live_name);
        const records = store.listRecords(live.id);
        return {
            live: { name: live.name },
            mismatches: records.filter(row => row.status === 'mismatch'),
            noOrder: records.filter(row => row.status === 'no_order')
        };
    });

    registerTool(server, 'export_live_reconciliation', {
        title: 'Xuất Excel đối chiếu',
        description: 'Tạo file Excel cho một đợt live; mặc định là đợt đang chọn. File chỉ gồm username, tên hiển thị, số tiền, mã đơn, chênh lệch và trạng thái; không gồm điện thoại/địa chỉ.',
        inputSchema: { live_name: liveNameSchema.optional() }
    }, async ({ live_name }) => {
        const live = getLive(store, live_name);
        const records = store.listRecords(live.id);
        return await exportFile(records, live);
    });

    return server;
}

function resolveShopUserId(baseDir, configured = process.env.TIKODER_SHOP_USER_ID) {
    const valid = value => /^[A-Za-z0-9_.-]{1,255}$/.test(value) && !value.includes('..');
    if (configured) {
        const value = String(configured).trim();
        if (!valid(value)) throw new Error('TIKODER_SHOP_USER_ID không hợp lệ.');
        return value;
    }
    const directories = [path.join(baseDir, 'data', 'customers'), path.join(baseDir, 'data', 'live-sessions')];
    const ids = new Set();
    for (const directory of directories) {
        if (!fs.existsSync(directory)) continue;
        for (const fileName of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
            const id = path.basename(fileName, '.json');
            if (valid(id)) ids.add(id);
        }
    }
    if (ids.size !== 1) throw new Error('Không thể tự xác định duy nhất shop Tikoder; cấu hình TIKODER_SHOP_USER_ID cho Hermes MCP.');
    return [...ids][0];
}

async function main() {
    const baseDir = path.resolve(__dirname, '..');
    const userId = resolveShopUserId(baseDir);
    const store = new ShopReconciliationStore(path.join(baseDir, 'data', 'shop-reconciliation.sqlite3'));
    const server = createShopReconciliationServer({ store, userId });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const close = async () => {
        try { await server.close(); } finally { store.close(); }
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Tikoder MCP startup failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { createShopReconciliationServer, resolveShopUserId };
