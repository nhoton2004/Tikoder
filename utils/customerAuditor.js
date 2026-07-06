/**
 * Customer Auditor Utility
 * Thực hiện logic audit dữ liệu khách hàng: phát hiện trùng lặp, dữ liệu bẩn, thiếu thông tin,
 * chấm điểm hoàn thiện và đưa ra đề xuất merge/xử lý an toàn.
 */

const { getDb } = require('./db');
const { normalizeTikTokUsername, normalizePhone } = require('./customerStore');

/**
 * Tính điểm hoàn thiện (completenessScore) từ 0 đến 100 điểm
 * @param {Object} c - Bản ghi khách hàng
 * @returns {number} Điểm hoàn thiện
 */
function calculateCompletenessScore(c) {
    let score = 0;

    // 1. Tên người nhận (displayName) - max 20 điểm
    if (c.displayName && c.displayName.trim()) {
        score += 20;
    }

    // 2. TikTok Username - max 25 điểm
    if (c.tiktokUsername && c.tiktokUsername.trim()) {
        score += 25;
    }

    // 3. Số điện thoại (phone) - max 25 điểm
    if (c.phone && c.phone.trim()) {
        const normPhone = normalizePhone(c.phone);
        // Nếu phone sau normalize hợp lệ (độ dài từ 9 đến 13 ký tự số)
        const phoneDigits = normPhone ? normPhone.replace(/^\+/, '') : '';
        if (phoneDigits && phoneDigits.length >= 9 && phoneDigits.length <= 13 && /^\d+$/.test(phoneDigits)) {
            score += 25;
        } else if (normPhone) {
            score += 10; // Có nhập nhưng sai định dạng
        }
    }

    // 4. Địa chỉ đầy đủ - max 20 điểm (mỗi trường 5 điểm)
    if (c.province && c.province.trim()) score += 5;
    if (c.district && c.district.trim()) score += 5;
    if (c.ward && c.ward.trim()) score += 5;
    if (c.addressDetail && c.addressDetail.trim()) score += 5;

    // 5. Mã khách hàng (customerCode) - max 10 điểm
    if (c.customerCode && c.customerCode.trim()) {
        score += 10;
    }

    return score;
}

/**
 * Kiểm tra các lỗi bẩn/thiếu/sai format của một khách hàng
 * @param {Object} c - Bản ghi khách hàng
 * @returns {Array} Danh sách các vấn đề phát hiện được
 */
function checkCustomerIssues(c) {
    const issues = [];

    // 1. Tên người nhận (displayName)
    if (!c.displayName || !c.displayName.trim()) {
        issues.push({
            severity: 'high',
            type: 'blank_display_name',
            message: 'Tên người nhận trống hoặc chỉ chứa khoảng trắng'
        });
    }

    // 2. TikTok Username
    if (c.tiktokUsername && c.tiktokUsername.trim()) {
        const normalized = normalizeTikTokUsername(c.tiktokUsername);
        const hasUpper = /[A-Z]/.test(c.tiktokUsername);
        const hasAt = c.tiktokUsername.includes('@');
        const hasSpace = /\s/.test(c.tiktokUsername);
        if (hasUpper || hasAt || hasSpace) {
            const reasons = [];
            if (hasAt) reasons.push('chứa ký tự @');
            if (hasUpper) reasons.push('chứa chữ in hoa');
            if (hasSpace) reasons.push('chứa khoảng trắng');
            issues.push({
                severity: 'low',
                type: 'dirty_username',
                message: `TikTok username chưa sạch (${reasons.join(', ')})`,
                normalizedValue: normalized
            });
        }
    } else {
        issues.push({
            severity: 'low',
            type: 'missing_username',
            message: 'Thiếu TikTok username'
        });
    }

    // 3. Số điện thoại (phone)
    if (c.phone && c.phone.trim()) {
        const normalized = normalizePhone(c.phone);
        // Bỏ dấu + đầu số (cho phép số quốc tế) rồi kiểm tra
        const digitsOnly = normalized.replace(/^\+/, '');
        const isInvalidFormat = !/^\d+$/.test(digitsOnly) || digitsOnly.length < 9 || digitsOnly.length > 13;

        // So sánh giá trị thô đã trim với giá trị đã normalize
        const rawCleaned = String(c.phone).trim();
        if (rawCleaned !== normalized) {
            issues.push({
                severity: 'low',
                type: 'dirty_phone',
                message: 'Số điện thoại chứa ký tự rác (khoảng trắng, dấu chấm, gạch, ngoặc) hoặc sai đầu số (+84/84)',
                normalizedValue: normalized
            });
        }

        if (isInvalidFormat) {
            issues.push({
                severity: 'medium',
                type: 'invalid_phone_format',
                message: `Số điện thoại không hợp lệ (sau chuẩn hóa dài ${digitsOnly.length} chữ số, yêu cầu 9-13 chữ số)`,
                normalizedValue: normalized
            });
        }
    } else {
        issues.push({
            severity: 'low',
            type: 'missing_phone',
            message: 'Thiếu số điện thoại'
        });
    }

    // 4. Mã khách hàng (customerCode)
    if (c.customerCode && c.customerCode.trim()) {
        if (c.customerCode !== c.customerCode.trim()) {
            issues.push({
                severity: 'low',
                type: 'dirty_customer_code',
                message: 'Mã khách hàng chứa khoảng trắng thừa ở đầu/cuối',
                normalizedValue: c.customerCode.trim()
            });
        }
    }

    // 5. Địa chỉ (address)
    const missingAddrFields = [];
    if (!c.province || !c.province.trim()) missingAddrFields.push('Tỉnh/Thành');
    if (!c.district || !c.district.trim()) missingAddrFields.push('Quận/Huyện');
    if (!c.ward || !c.ward.trim()) missingAddrFields.push('Phường/Xã');
    if (!c.addressDetail || !c.addressDetail.trim()) missingAddrFields.push('Địa chỉ chi tiết');

    if (missingAddrFields.length > 0) {
        if (missingAddrFields.length === 4) {
            issues.push({
                severity: 'low',
                type: 'missing_address',
                message: 'Thiếu toàn bộ thông tin địa chỉ'
            });
        } else {
            issues.push({
                severity: 'low',
                type: 'incomplete_address',
                message: `Địa chỉ chưa đầy đủ (thiếu ${missingAddrFields.join(', ')})`
            });
        }
    }

    // 6. Thiếu nghiêm trọng (Thiếu đồng thời phone, username, addressDetail)
    const hasPhone = c.phone && c.phone.trim();
    const hasUsername = c.tiktokUsername && c.tiktokUsername.trim();
    const hasDetailAddress = c.addressDetail && c.addressDetail.trim();
    if (!hasPhone && !hasUsername && !hasDetailAddress) {
        issues.push({
            severity: 'high',
            type: 'critical_missing',
            message: 'Khách hàng thiếu cả 3 thông tin liên lạc quan trọng (SĐT, TikTok Username, Địa chỉ chi tiết)'
        });
    }

    return issues;
}

/**
 * So sánh 2 record trùng lặp để đề xuất merge / review và phát hiện conflict
 */
function analyzeDuplicatePair(keepRec, dupRec) {
    const mergeFields = [];
    const conflicts = [];

    const fieldsToCompare = [
        'tiktokUsername', 'displayName', 'phone', 'province', 'district', 'ward',
        'addressDetail', 'addressNote', 'postalCode', 'customerCode', 'deliveryNote',
        'defaultWeightKg', 'allowTryOn', 'viewOnlyNoTry', 'partialDelivery'
    ];

    for (const f of fieldsToCompare) {
        const valK = keepRec[f];
        const valR = dupRec[f];

        const hasK = valK !== undefined && valK !== null && String(valK).trim() !== '';
        const hasR = valR !== undefined && valR !== null && String(valR).trim() !== '';

        if (!hasK && hasR) {
            // Trường ở keep trống, ở duplicate có -> có thể đắp sang
            mergeFields.push({
                field: f,
                value: valR
            });
        } else if (hasK && hasR) {
            // Cả hai cùng có giá trị, kiểm tra xem có khác nhau không
            let isDifferent = false;
            if (f === 'tiktokUsername') {
                isDifferent = normalizeTikTokUsername(valK) !== normalizeTikTokUsername(valR);
            } else if (f === 'phone') {
                isDifferent = normalizePhone(valK) !== normalizePhone(valR);
            } else if (f === 'customerCode') {
                isDifferent = String(valK).trim().toLowerCase() !== String(valR).trim().toLowerCase();
            } else {
                isDifferent = String(valK).trim().toLowerCase() !== String(valR).trim().toLowerCase();
            }

            if (isDifferent) {
                conflicts.push({
                    field: f,
                    keepValue: valK,
                    dupValue: valR
                });
            }
        }
    }

    // Nếu có bất kỳ conflict nào, yêu cầu review thủ công. Nếu không có conflict, đề xuất merge an toàn.
    const suggestedAction = conflicts.length > 0 ? 'review' : 'merge';

    return {
        id: dupRec.id,
        displayName: dupRec.displayName,
        tiktokUsername: dupRec.tiktokUsername,
        phone: dupRec.phone,
        customerCode: dupRec.customerCode,
        createdAt: dupRec.createdAt,
        completenessScore: dupRec.completenessScore,
        suggestedAction,
        mergeFields: mergeFields.map(m => m.field),
        mergeDetails: mergeFields.reduce((acc, curr) => {
            acc[curr.field] = curr.value;
            return acc;
        }, {}),
        conflicts
    };
}

/**
 * Đọc và convert row SQLite sang Customer Object tương tự customerStore.rowToCustomer
 */
function mapRowToCustomer(row) {
    if (!row) return null;
    const c = {
        id: row.id,
        userId: row.user_id,
        tiktokUsername: row.tiktok_username || '',
        displayName: row.display_name || '',
        phone: row.phone || '',
        province: row.province || '',
        district: row.district || '',
        ward: row.ward || '',
        addressDetail: row.address_detail || '',
        addressNote: row.address_note || '',
        postalCode: row.postal_code || '',
        customerCode: row.customer_code || '',
        deliveryNote: row.delivery_note || '',
        defaultWeightKg: row.default_weight_kg || '',
        allowTryOn: row.allow_try_on || '',
        viewOnlyNoTry: row.view_only_no_try || '',
        partialDelivery: row.partial_delivery || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    return c;
}

/**
 * Thực hiện audit danh sách khách hàng của một user
 * @param {string} userId - ID của user cần audit
 * @param {Array} rawCustomers - Danh sách khách hàng thô (nếu có sẵn, nếu không sẽ tự query DB)
 * @returns {Object} Báo cáo audit chi tiết của user này
 */
function auditUserCustomers(userId, rawCustomers = null) {
    let customers = rawCustomers;
    if (!customers) {
        const rows = getDb().prepare('SELECT * FROM customers WHERE user_id = ?').all(userId);
        customers = rows.map(mapRowToCustomer);
    }

    // Gán completeness score & check issues cho từng khách hàng
    customers.forEach(c => {
        c.completenessScore = calculateCompletenessScore(c);
        c.issues = checkCustomerIssues(c);
    });

    const totalCustomers = customers.length;

    // Các bộ đếm tổng quan
    let validUsernameCount = 0;
    let validPhoneCount = 0;
    let fullAddressCount = 0;
    let missingDataCount = 0;

    const invalidPhoneFormats = [];
    const dirtyUsernames = [];
    const blankDisplayNames = [];
    const recordsMissingKeyData = [];

    customers.forEach(c => {
        const isBlankDisplay = !c.displayName || !c.displayName.trim();
        const normUsername = normalizeTikTokUsername(c.tiktokUsername);
        const normPhone = normalizePhone(c.phone);

        const hasValidUsername = normUsername !== '' && !c.issues.some(i => i.type === 'dirty_username');
        const hasValidPhone = normPhone !== '' && !c.issues.some(i => i.type === 'invalid_phone_format');
        const hasFullAddress = c.province && c.district && c.ward && c.addressDetail;

        if (hasValidUsername) validUsernameCount++;
        if (hasValidPhone) validPhoneCount++;
        if (hasFullAddress) fullAddressCount++;

        // Xác định xem có thiếu dữ liệu hay không (thiếu phone, thiếu username hoặc thiếu địa chỉ)
        const isMissingData = c.issues.some(i => i.type.startsWith('missing_') || i.type === 'incomplete_address' || i.type === 'critical_missing');
        if (isMissingData) missingDataCount++;

        // Gom vào các nhóm lỗi chi tiết
        if (c.issues.some(i => i.type === 'invalid_phone_format')) {
            invalidPhoneFormats.push(formatRecordForReport(c, 'Số điện thoại sai định dạng'));
        }
        if (c.issues.some(i => i.type === 'dirty_username')) {
            dirtyUsernames.push(formatRecordForReport(c, 'TikTok username chưa dọn sạch'));
        }
        if (isBlankDisplay) {
            blankDisplayNames.push(formatRecordForReport(c, 'Tên người nhận trống'));
        }
        if (isMissingData) {
            const missingTypes = c.issues
                .filter(i => i.type.startsWith('missing_') || i.type === 'incomplete_address' || i.type === 'critical_missing')
                .map(i => i.message);
            recordsMissingKeyData.push(formatRecordForReport(c, missingTypes.join('; ')));
        }
    });

    // Phát hiện trùng lặp
    const usernameGroups = new Map();
    const phoneGroups = new Map();
    const codeGroups = new Map();

    customers.forEach(c => {
        const normU = normalizeTikTokUsername(c.tiktokUsername);
        const normP = normalizePhone(c.phone);
        const normC = c.customerCode ? c.customerCode.trim().toLowerCase() : '';

        if (normU) {
            if (!usernameGroups.has(normU)) usernameGroups.set(normU, []);
            usernameGroups.get(normU).push(c);
        }

        if (normP) {
            if (!phoneGroups.has(normP)) phoneGroups.set(normP, []);
            phoneGroups.get(normP).push(c);
        }

        if (normC) {
            if (!codeGroups.has(normC)) codeGroups.set(normC, []);
            codeGroups.get(normC).push(c);
        }
    });

    // Helper tạo nhóm trùng lặp chi tiết kèm đề xuất keep/merge/review
    function buildDuplicateReport(groupsMap, typeLabel) {
        const resultGroups = [];
        groupsMap.forEach((recs, key) => {
            if (recs.length < 2) return;

            // Sắp xếp các bản ghi để chọn bản ghi giữ lại
            // Điểm cao nhất trước. Nếu bằng nhau, bản ghi cũ nhất trước (createdAt cũ nhất)
            recs.sort((a, b) => {
                if (b.completenessScore !== a.completenessScore) {
                    return b.completenessScore - a.completenessScore;
                }
                const timeA = new Date(a.createdAt || 0).getTime();
                const timeB = new Date(b.createdAt || 0).getTime();
                return timeA - timeB; // ascending (oldest first)
            });

            const keepRecord = recs[0];
            const duplicateDetails = recs.slice(1).map(dup => analyzeDuplicatePair(keepRecord, dup));

            resultGroups.push({
                normalizedValue: key,
                totalRecords: recs.length,
                keepRecord: {
                    id: keepRecord.id,
                    displayName: keepRecord.displayName,
                    tiktokUsername: keepRecord.tiktokUsername,
                    phone: keepRecord.phone,
                    customerCode: keepRecord.customerCode,
                    createdAt: keepRecord.createdAt,
                    completenessScore: keepRecord.completenessScore,
                    suggestedAction: 'keep',
                    issues: keepRecord.issues.map(i => i.message)
                },
                duplicates: duplicateDetails
            });
        });
        return resultGroups;
    }

    const duplicateUsernames = buildDuplicateReport(usernameGroups, 'username');
    const duplicatePhones = buildDuplicateReport(phoneGroups, 'phone');
    const duplicateCodes = buildDuplicateReport(codeGroups, 'code');

    return {
        summary: {
            totalCustomers,
            validUsernameCount,
            validPhoneCount,
            fullAddressCount,
            missingDataCount,
            duplicateUsernameGroups: duplicateUsernames.length,
            duplicatePhoneGroups: duplicatePhones.length,
            duplicateCodeGroups: duplicateCodes.length
        },
        details: {
            duplicateUsernames,
            duplicatePhones,
            duplicateCodes,
            invalidPhoneFormats,
            dirtyUsernames,
            blankDisplayNames,
            recordsMissingKeyData
        }
    };
}

/**
 * Helper format record cho phần chi tiết báo cáo
 */
function formatRecordForReport(c, problemLabel) {
    return {
        id: c.id,
        displayName: c.displayName || '',
        tiktokUsername: c.tiktokUsername || '',
        phone: c.phone || '',
        customerCode: c.customerCode || '',
        createdAt: c.createdAt,
        completenessScore: c.completenessScore,
        issueType: problemLabel,
        normalizedValues: {
            tiktokUsername: normalizeTikTokUsername(c.tiktokUsername),
            phone: normalizePhone(c.phone),
            customerCode: c.customerCode ? c.customerCode.trim() : ''
        }
    };
}

/**
 * Thực hiện audit toàn bộ database cho tất cả các user_id
 * @returns {Object} Báo cáo audit toàn hệ thống, gom nhóm theo user_id
 */
function auditAllDatabaseCustomers() {
    const db = getDb();
    
    // Lấy tất cả user_id duy nhất đang có trong bảng customers
    const userRows = db.prepare('SELECT DISTINCT user_id FROM customers').all();
    const userIds = userRows.map(r => r.user_id);

    const reportPerUser = {};
    const systemSummary = {
        totalUsersAudited: userIds.length,
        totalCustomers: 0,
        validUsernameCount: 0,
        validPhoneCount: 0,
        fullAddressCount: 0,
        missingDataCount: 0,
        totalDuplicateUsernameGroups: 0,
        totalDuplicatePhoneGroups: 0,
        totalDuplicateCodeGroups: 0
    };

    for (const uid of userIds) {
        const userReport = auditUserCustomers(uid);
        reportPerUser[uid] = userReport;

        // Cộng dồn vào summary hệ thống
        systemSummary.totalCustomers += userReport.summary.totalCustomers;
        systemSummary.validUsernameCount += userReport.summary.validUsernameCount;
        systemSummary.validPhoneCount += userReport.summary.validPhoneCount;
        systemSummary.fullAddressCount += userReport.summary.fullAddressCount;
        systemSummary.missingDataCount += userReport.summary.missingDataCount;
        systemSummary.totalDuplicateUsernameGroups += userReport.summary.duplicateUsernameGroups;
        systemSummary.totalDuplicatePhoneGroups += userReport.summary.duplicatePhoneGroups;
        systemSummary.totalDuplicateCodeGroups += userReport.summary.duplicateCodeGroups;
    }

    return {
        systemSummary,
        users: reportPerUser
    };
}

module.exports = {
    calculateCompletenessScore,
    checkCustomerIssues,
    auditUserCustomers,
    auditAllDatabaseCustomers
};
