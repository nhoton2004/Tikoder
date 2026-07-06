/**
 * Script kiểm thử logic customerAuditor.js với dữ liệu giả lập.
 */

const { auditUserCustomers } = require('/home/nho/TikTokOrderApp/utils/customerAuditor');

const testCustomers = [
    // 1. Bản ghi hoàn hảo làm chuẩn (completenessScore = 100)
    {
        id: 'cust_perfect_1',
        userId: 'dev-user',
        tiktokUsername: 'perfect.shop',
        displayName: 'Nguyễn Văn Hoàn Hảo',
        phone: '0987654321',
        province: 'Hà Nội',
        district: 'Cầu Giấy',
        ward: 'Dịch Vọng',
        addressDetail: 'Số 1 Duy Tân',
        customerCode: 'KH001',
        createdAt: '2026-07-01T00:00:00.000Z'
    },
    // 2. Bản ghi trùng username với 1, nhưng ít thông tin hơn và có thêm trường mới không xung đột (sẽ đề xuất merge)
    {
        id: 'cust_dup_uname_1',
        userId: 'dev-user',
        tiktokUsername: 'perfect.shop',
        displayName: 'Nguyễn Văn Hoàn Hảo',
        phone: '0987654321', 
        province: '',
        district: '',
        ward: '',
        addressDetail: '', 
        customerCode: '',
        deliveryNote: 'Giao giờ hành chính', // trường bổ sung không xung đột
        createdAt: '2026-07-02T00:00:00.000Z'
    },
    // 3. Bản ghi trùng username với 1, nhưng bị conflict số điện thoại và địa chỉ (sẽ đề xuất review)
    {
        id: 'cust_conflict_uname_1',
        userId: 'dev-user',
        tiktokUsername: 'PERFECT.SHOP', // bẩn username
        displayName: 'Hảo Nguyễn',
        phone: '0912345678', // conflict phone
        province: 'Hà Nội',
        district: 'Cầu Giấy',
        ward: 'Dịch Vọng',
        addressDetail: 'Số 2 Duy Tân', // conflict địa chỉ chi tiết
        customerCode: 'KH001-conflict',
        createdAt: '2026-07-03T00:00:00.000Z'
    },
    // 4. Bản ghi bẩn phone & customerCode có khoảng trắng thừa
    {
        id: 'cust_dirty_phone',
        userId: 'dev-user',
        tiktokUsername: 'dirty.phone',
        displayName: 'Trần Văn Phone Bẩn',
        phone: '+84 987.654.321 ', // bẩn phone
        province: 'Đà Nẵng',
        district: 'Hải Châu',
        ward: 'Thạch Thang',
        addressDetail: '123 Lê Lợi',
        customerCode: '  KH002  ', // bẩn customerCode
        createdAt: '2026-07-01T00:00:00.000Z'
    },
    // 5. Bản ghi sai định dạng phone (dưới 9 số)
    {
        id: 'cust_invalid_phone',
        userId: 'dev-user',
        tiktokUsername: 'invalid.phone',
        displayName: 'Lê Hoàng Phone Lỗi',
        phone: '123456', // sai độ dài
        province: 'Đà Nẵng',
        district: 'Hải Châu',
        ward: 'Thạch Thang',
        addressDetail: '123 Lê Lợi',
        customerCode: 'KH003',
        createdAt: '2026-07-01T00:00:00.000Z'
    },
    // 6. Bản ghi thiếu display name (blank)
    {
        id: 'cust_blank_name',
        userId: 'dev-user',
        tiktokUsername: 'no.name',
        displayName: '   ', // trống
        phone: '0909090909',
        createdAt: '2026-07-01T00:00:00.000Z'
    },
    // 7. Bản ghi thiếu nghiêm trọng (thiếu cả username, phone, addressDetail)
    {
        id: 'cust_critical_missing',
        userId: 'dev-user',
        tiktokUsername: '',
        displayName: 'Khách Ẩn Danh',
        phone: '',
        addressDetail: '',
        createdAt: '2026-07-01T00:00:00.000Z'
    }
];

console.log('🧪 Đang kiểm thử logic audit khách hàng với dữ liệu giả lập...');

const report = auditUserCustomers('dev-user', testCustomers);

console.log('\n--- BÁO CÁO TỔNG QUAN (SUMMARY) ---');
console.log(JSON.stringify(report.summary, null, 2));

console.log('\n--- KIỂM TRA PHÁT HIỆN TRÙNG LẶP ---');
console.log(`Số nhóm trùng TikTok Username phát hiện: ${report.details.duplicateUsernames.length}`);
if (report.details.duplicateUsernames.length > 0) {
    const group = report.details.duplicateUsernames[0];
    console.log(`\nNhóm trùng cho username: "${group.normalizedValue}"`);
    console.log(`- Bản ghi giữ lại (keep): ${group.keepRecord.id} (${group.keepRecord.displayName}) - Score: ${group.keepRecord.completenessScore}`);
    
    group.duplicates.forEach(dup => {
        console.log(`- Bản ghi trùng: ${dup.id} (${dup.displayName}) - Score: ${dup.completenessScore}`);
        console.log(`  * Đề xuất xử lý: ${dup.suggestedAction}`);
        if (dup.mergeFields.length > 0) {
            console.log(`  * Các trường có thể merge: ${dup.mergeFields.join(', ')}`);
        }
        if (dup.conflicts.length > 0) {
            console.log(`  * Xung đột phát hiện:`, dup.conflicts);
        }
    });
}

console.log('\n--- KIỂM TRA PHÁT HIỆN LỖI ĐỊNH DẠNG & THIẾU DỮ LIỆU ---');
console.log(`- Số điện thoại sai định dạng: ${report.details.invalidPhoneFormats.length}`);
report.details.invalidPhoneFormats.forEach(r => console.log(`  * ${r.id} (${r.displayName}): ${r.phone} -> ${r.issueType}`));

console.log(`- TikTok username chưa dọn sạch: ${report.details.dirtyUsernames.length}`);
report.details.dirtyUsernames.forEach(r => console.log(`  * ${r.id} (${r.displayName}): ${r.tiktokUsername} -> ${r.issueType}`));

console.log(`- Tên hiển thị trống: ${report.details.blankDisplayNames.length}`);
report.details.blankDisplayNames.forEach(r => console.log(`  * ${r.id}: "${r.displayName}"`));

console.log(`- Thiếu dữ liệu quan trọng: ${report.details.recordsMissingKeyData.length}`);
report.details.recordsMissingKeyData.forEach(r => console.log(`  * ${r.id} (${r.displayName}): ${r.issueType}`));

console.log('\n✅ Kết thúc kiểm thử!');
