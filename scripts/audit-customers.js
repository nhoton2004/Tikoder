/**
 * Script chạy một lần để audit toàn bộ database khách hàng.
 * Chạy bằng lệnh: node scripts/audit-customers.js
 */

const fs = require('fs');
const path = require('path');
const { auditAllDatabaseCustomers } = require('../utils/customerAuditor');
const { closeDb } = require('../utils/db');

// Đảm bảo thư mục lưu báo cáo tồn tại
const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

console.log('⏳ Đang đọc database và thực hiện audit toàn bộ khách hàng...');

try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = auditAllDatabaseCustomers();
    const { systemSummary, users } = result;

    // 1. In báo cáo tổng quan lên Console
    console.log('\n============================================================');
    console.log('          BÁO CÁO AUDIT KHÁCH HÀNG - TOÀN HỆ THỐNG');
    console.log('============================================================');
    console.log(`• Tổng số tài khoản (Shop/User) được audit : ${systemSummary.totalUsersAudited}`);
    console.log(`• Tổng số bản ghi khách hàng trong DB      : ${systemSummary.totalCustomers}`);
    console.log(`• Số khách hàng có TikTok username hợp lệ  : ${systemSummary.validUsernameCount} (${((systemSummary.validUsernameCount / systemSummary.totalCustomers) * 100).toFixed(1)}%)`);
    console.log(`• Số khách hàng có Số điện thoại hợp lệ    : ${systemSummary.validPhoneCount} (${((systemSummary.validPhoneCount / systemSummary.totalCustomers) * 100).toFixed(1)}%)`);
    console.log(`• Số khách hàng có Địa chỉ đầy đủ          : ${systemSummary.fullAddressCount} (${((systemSummary.fullAddressCount / systemSummary.totalCustomers) * 100).toFixed(1)}%)`);
    console.log(`• Số khách hàng thiếu/chưa hoàn thiện data : ${systemSummary.missingDataCount} (${((systemSummary.missingDataCount / systemSummary.totalCustomers) * 100).toFixed(1)}%)`);
    console.log('------------------------------------------------------------');
    console.log(`• Tổng số nhóm trùng TikTok username       : ${systemSummary.totalDuplicateUsernameGroups}`);
    console.log(`• Tổng số nhóm trùng Số điện thoại         : ${systemSummary.totalDuplicatePhoneGroups}`);
    console.log(`• Tổng số nhóm trùng Mã khách hàng (Code)  : ${systemSummary.totalDuplicateCodeGroups}`);
    console.log('============================================================\n');

    if (systemSummary.totalUsersAudited > 0) {
        console.log('Chi tiết theo từng tài khoản (Shop):');
        console.table(Object.keys(users).map(uid => ({
            'User ID/Shop': uid,
            'Tổng số khách': users[uid].summary.totalCustomers,
            'Thiếu data': users[uid].summary.missingDataCount,
            'Trùng Username (Nhóm)': users[uid].summary.duplicateUsernameGroups,
            'Trùng Phone (Nhóm)': users[uid].summary.duplicatePhoneGroups,
            'Trùng Code (Nhóm)': users[uid].summary.duplicateCodeGroups
        })));
    }

    // 2. Xuất file JSON chi tiết
    const jsonFileName = `customer-audit-report-${timestamp}.json`;
    const jsonPath = path.join(REPORTS_DIR, jsonFileName);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

    // Tạo file customer-audit-report.json làm alias mới nhất
    const latestJsonPath = path.join(REPORTS_DIR, 'customer-audit-report.json');
    fs.writeFileSync(latestJsonPath, JSON.stringify(result, null, 2), 'utf-8');
    
    console.log(`\n✅ Đã ghi báo cáo JSON chi tiết tại:`);
    console.log(`   - ${jsonPath}`);
    console.log(`   - ${latestJsonPath}`);

    // 3. Tạo báo cáo trùng lặp và đề xuất merge ra CSV để xem bằng Excel
    let csvContent = '\uFEFF'; // Add BOM for Excel UTF-8 support
    csvContent += '"User/Shop ID","Loại trùng","Giá trị trùng","ID khách hàng","Tên hiển thị","TikTok Username","Số điện thoại","Mã khách hàng","Điểm hoàn thiện","Hành động đề xuất","Trường đề xuất gộp","Trường bị xung đột (cần review)"\n';

    function escapeCSV(val) {
        if (val === undefined || val === null) return '""';
        let str = String(val).trim();
        str = str.replace(/"/g, '""');
        return `"${str}"`;
    }

    Object.entries(users).forEach(([uid, userReport]) => {
        const { duplicateUsernames, duplicatePhones, duplicateCodes } = userReport.details;

        const allDups = [
            { list: duplicateUsernames, label: 'Trùng TikTok Username' },
            { list: duplicatePhones, label: 'Trùng Số điện thoại' },
            { list: duplicateCodes, label: 'Trùng Mã khách hàng' }
        ];

        allDups.forEach(({ list, label }) => {
            list.forEach(group => {
                const val = group.normalizedValue;
                const keep = group.keepRecord;

                // Dòng cho record giữ lại (keep)
                csvContent += [
                    escapeCSV(uid),
                    escapeCSV(label),
                    escapeCSV(val),
                    escapeCSV(keep.id),
                    escapeCSV(keep.displayName),
                    escapeCSV(keep.tiktokUsername),
                    escapeCSV(keep.phone),
                    escapeCSV(keep.customerCode),
                    keep.completenessScore,
                    escapeCSV('Giữ lại (keep)'),
                    '""',
                    '""'
                ].join(',') + '\n';

                // Dòng cho các record trùng lặp (duplicate)
                group.duplicates.forEach(dup => {
                    const mergeFieldsStr = dup.mergeFields.join('; ');
                    const conflictsStr = dup.conflicts.map(c => `${c.field} (Keep: ${c.keepValue} | Dup: ${c.dupValue})`).join('; ');

                    csvContent += [
                        escapeCSV(uid),
                        escapeCSV(label),
                        escapeCSV(val),
                        escapeCSV(dup.id),
                        escapeCSV(dup.displayName),
                        escapeCSV(dup.tiktokUsername),
                        escapeCSV(dup.phone),
                        escapeCSV(dup.customerCode),
                        dup.completenessScore,
                        escapeCSV(dup.suggestedAction === 'merge' ? 'Merge' : 'Review (Xung đột)'),
                        escapeCSV(mergeFieldsStr),
                        escapeCSV(conflictsStr)
                    ].join(',') + '\n';
                });
            });
        });
    });

    const csvFileName = `customer-duplicates-${timestamp}.csv`;
    const csvPath = path.join(REPORTS_DIR, csvFileName);
    fs.writeFileSync(csvPath, csvContent, 'utf-8');

    // Tạo file customer-duplicates.csv làm alias mới nhất
    const latestCsvPath = path.join(REPORTS_DIR, 'customer-duplicates.csv');
    fs.writeFileSync(latestCsvPath, csvContent, 'utf-8');

    console.log(`\n✅ Đã ghi báo cáo trùng lặp CSV tại:`);
    console.log(`   - ${csvPath}`);
    console.log(`   - ${latestCsvPath}`);
    console.log('\n💡 Bạn có thể mở file CSV bằng Excel để xem bảng kê chi tiết các bản ghi trùng lặp và các trường cần xử lý.');

} catch (error) {
    console.error('❌ Đã xảy ra lỗi trong quá trình chạy audit:', error);
} finally {
    closeDb();
}
