const orderExcelExporter = require('../utils/orderExcelExporter');
const assert = require('assert');

async function testExporter() {
    console.log('=== Running orderExcelExporter tests ===');
    
    // Mock user orders
    const mockOrders = [
        {
            customerName: 'Thanh Hằng',
            customerUsername: '_dth243',
            productName: 'Sản phẩm 1',
            quantity: 1,
            price: 100000,
            total: 100000,
            fromSession: 'Live Test'
        }
    ];

    // Test old system (3-level)
    const resOld = await orderExcelExporter.exportDeliveryExcel({
        userId: 'test_user',
        orders: mockOrders,
        options: { addressSystem: 'old' }
    });
    assert.ok(resOld.buffer);
    assert.equal(resOld.totalCustomers, 1);
    console.log('✓ Old system (3-level) export passed');

    // Test new system (2-level)
    const resNew = await orderExcelExporter.exportDeliveryExcel({
        userId: 'test_user',
        orders: mockOrders,
        options: { addressSystem: 'new' }
    });
    assert.ok(resNew.buffer);
    assert.equal(resNew.totalCustomers, 1);
    console.log('✓ New system (2-level) export passed');

    console.log('--- All exporter tests passed! ---');
}

testExporter().catch(err => {
    console.error('Exporter tests failed:', err);
    process.exit(1);
});
