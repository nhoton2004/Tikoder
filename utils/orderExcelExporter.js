const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const customerStore = require('./customerStore');
const { normalizeDisplayName, normalizeDisplayText } = require('./displayName');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const TEMPLATE_FILE = path.join(TEMPLATE_DIR, 'collect_fee_partial_delivery_mass_order_creation_template_vn.xlsx');
const ORDER_SHEET_NAME = 'Tạo đơn (địa chỉ cũ)';
const REQUIRED_ADDRESS_FIELDS = ['phone', 'province', 'district', 'ward', 'addressDetail'];

const SPX_PROVINCES = [
    "AN GIANG","BÀ RỊA - VŨNG TÀU","BẮC GIANG","BẮC KẠN","BẠC LIÊU","BẮC NINH","BẾN TRE","BÌNH ĐỊNH","BÌNH DƯƠNG","BÌNH PHƯỚC","BÌNH THUẬN","CÀ MAU","CẦN THƠ","CAO BẰNG","ĐÀ NẴNG","ĐẮK LẮK","ĐẮK NÔNG","ĐIỆN BIÊN","ĐỒNG NAI","ĐỒNG THÁP","GIA LAI","HÀ GIANG","HÀ NAM","HÀ NỘI","HÀ TĨNH","HẢI DƯƠNG","HẢI PHÒNG","HẬU GIANG","HÒA BÌNH","HƯNG YÊN","KHÁNH HÒA","KIÊN GIANG","KON TUM","LAI CHÂU","LÂM ĐỒNG","LẠNG SƠN","LÀO CAI","LONG AN","NAM ĐỊNH","NGHỆ AN","NINH BÌNH","NINH THUẬN","PHÚ THỌ","PHÚ YÊN","QUẢNG BÌNH","QUẢNG NAM","QUẢNG NGÃI","QUẢNG NINH","QUẢNG TRỊ","SÓC TRĂNG","SƠN LA","TÂY NINH","THÁI BÌNH","THÁI NGUYÊN","THANH HÓA","THỪA THIÊN HUẾ","TIỀN GIANG","TP. HỒ CHÍ MINH","TRÀ VINH","TUYÊN QUANG","VĨNH LONG","VĨNH PHÚC","YÊN BÁI"
];

function removeVietnameseTones(str) {
    if (!str) return "";
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỹ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return str;
}

function cleanProvince(province) {
    if (!province) return "";
    let clean = province.trim().toLowerCase()
        .replace(/^(tỉnh|thành phố|tp\.?|city)\s+/gi, "")
        .replace(/\s+(tỉnh|thành phố|tp\.?|city)$/gi, "");
    
    const unaccented = removeVietnameseTones(clean).replace(/\s+/g, "");
    if (["tphcm", "hcm", "saigon", "saigong", "hochiminh"].includes(unaccented)) {
        return "TP. HỒ CHÍ MINH";
    }
    if (["hn", "hanoi"].includes(unaccented)) {
        return "HÀ NỘI";
    }
    if (["dn", "danang"].includes(unaccented)) {
        return "ĐÀ NẴNG";
    }
    if (["hp", "haiphong"].includes(unaccented)) {
        return "HẢI PHÒNG";
    }
    if (["ct", "cantho"].includes(unaccented)) {
        return "CẦN THƠ";
    }
    if (["vungtau", "bariavungtau"].includes(unaccented)) {
        return "BÀ RỊA - VŨNG TÀU";
    }

    // So khớp trong danh sách tỉnh thành chuẩn
    for (const p of SPX_PROVINCES) {
        const normP = removeVietnameseTones(p.toLowerCase()).replace(/\s+/g, "");
        if (unaccented.includes(normP) || normP.includes(unaccented)) {
            return p;
        }
    }
    return province;
}

function cleanDistrict(district) {
    if (!district) return "";
    let clean = district.trim();
    // Sửa lỗi chính tả Bắc Từ Liêm / Nam Từ Liêm
    if (clean.toLowerCase().includes("tư liêm") || clean.toLowerCase().includes("tu liem")) {
        if (clean.toLowerCase().includes("bắc") || clean.toLowerCase().includes("bac")) {
            return "QUẬN BẮC TỪ LIÊM";
        }
        if (clean.toLowerCase().includes("nam")) {
            return "QUẬN NAM TỪ LIÊM";
        }
    }
    return district;
}

const FAMOUS_CITIES = {
    "da lat": { province: "LÂM ĐỒNG", district: "Thành phố Đà Lạt" },
    "dalat": { province: "LÂM ĐỒNG", district: "Thành phố Đà Lạt" },
    "nha trang": { province: "KHÁNH HÒA", district: "Thành phố Nha Trang" },
    "nhatrang": { province: "KHÁNH HÒA", district: "Thành phố Nha Trang" },
    "vung tau": { province: "BÀ RỊA - VŨNG TÀU", district: "Thành phố Vũng Tàu" },
    "vungtau": { province: "BÀ RỊA - VŨNG TÀU", district: "Thành phố Vũng Tàu" },
    "buon ma thuot": { province: "ĐẮK LẮK", district: "Thành phố Buôn Ma Thuột" },
    "bmt": { province: "ĐẮK LẮK", district: "Thành phố Buôn Ma Thuột" },
    "phan thiet": { province: "BÌNH THUẬN", district: "Thành phố Phan Thiết" },
    "phanthiet": { province: "BÌNH THUẬN", district: "Thành phố Phan Thiết" },
    "quy nhon": { province: "BÌNH ĐỊNH", district: "Thành phố Quy Nhơn" },
    "quynhon": { province: "BÌNH ĐỊNH", district: "Thành phố Quy Nhơn" },
    "pleiku": { province: "GIA LAI", district: "Thành phố Pleiku" },
    "my tho": { province: "TIỀN GIANG", district: "Thành phố Mỹ Tho" },
    "mytho": { province: "TIỀN GIANG", district: "Thành phố Mỹ Tho" },
    "tan an": { province: "LONG AN", district: "Thành phố Tân An" },
    "tanan": { province: "LONG AN", district: "Thành phố Tân An" },
    "bien hoa": { province: "ĐỒNG NAI", district: "Thành phố Biên Hòa" },
    "bienhoa": { province: "ĐỒNG NAI", district: "Thành phố Biên Hòa" },
    "thu dau mot": { province: "BÌNH DƯƠNG", district: "Thành phố Thủ Dầu Một" },
    "thudaumot": { province: "BÌNH DƯƠNG", district: "Thành phố Thủ Dầu Một" },
    "thuan an": { province: "BÌNH DƯƠNG", district: "Thành phố Thuận An" },
    "thuanan": { province: "BÌNH DƯƠNG", district: "Thành phố Thuận An" },
    "di an": { province: "BÌNH DƯƠNG", district: "Thành phố Dĩ An" },
    "dian": { province: "BÌNH DƯƠNG", district: "Thành phố Dĩ An" }
};

function isJunkAddressValue(s) {
    if (!s) return true;
    const clean = s.trim().toLowerCase();
    return clean === '.' || 
           clean === '-' || 
           clean === 'chưa có' || 
           clean === 'chua co' || 
           clean === 'không có' || 
           clean === 'khong co' || 
           clean === 'unknown' ||
           clean === 'trống' ||
           clean === 'trong';
}

function cleanAddressFields(customer) {
    let province = (customer.province || '').trim();
    let district = (customer.district || '').trim();
    let ward = (customer.ward || '').trim();
    
    if (isJunkAddressValue(province)) province = '';
    if (isJunkAddressValue(district)) district = '';
    if (isJunkAddressValue(ward)) ward = '';

    // 1. Chuẩn hóa Tỉnh thành trước
    if (province) {
        province = cleanProvince(province);
    }
    
    // 2. Kiểm tra thành phố nổi tiếng viết nhầm vào cột tỉnh
    if (province) {
        const provUnaccented = removeVietnameseTones(province.toLowerCase()).replace(/\s+/g, " ");
        if (FAMOUS_CITIES[provUnaccented]) {
            const info = FAMOUS_CITIES[provUnaccented];
            province = info.province;
            if (!district || isJunkAddressValue(district)) {
                district = info.district;
            }
        }
    }
    
    // 3. Chuẩn hóa Quận huyện
    if (district) {
        district = cleanDistrict(district);
    }
    
    if (isJunkAddressValue(province)) province = '';
    if (isJunkAddressValue(district)) district = '';
    if (isJunkAddressValue(ward)) ward = '';
    
    return { province, district, ward };
}

function ensureTemplateDir() {
    if (!fs.existsSync(TEMPLATE_DIR)) {
        fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    }
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatDateCompact(date = new Date()) {
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function formatMinuteStamp(date = new Date()) {
    return `${formatDateCompact(date)}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeOrders(input) {
    // SECURITY & ROBUSTNESS: Comprehensive input validation
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (typeof input !== 'object') return [];

    try {
        const orders = [];
        Object.values(input).forEach(customer => {
            if (!customer || typeof customer !== 'object') return;
            
            const items = Array.isArray(customer?.items) ? customer.items : [];
            const customerUsername = customerStore.normalizeTikTokUsername(customer.username || customer.tiktokUsername || '');
            const customerName = normalizeDisplayName(customer.nickname || customer.displayName || '', customerUsername ? `@${customerUsername}` : undefined);
            
            items.forEach(item => {
                if (!item || typeof item !== 'object') return;
                
                orders.push({
                    id: item.id || '',
                    customerName,
                    customerUsername,
                    profilePictureUrl: customer.profilePictureUrl || '',
                    productName: normalizeDisplayText(item.productName || item.text || ''),
                    quantity: toNumber(item.quantity, 1) || 1,
                    price: toNumber(item.price, 0),
                    total: toNumber(item.total || item.price, 0),
                    time: item.time || '',
                    createdAt: item.createdAt || ''
                });
            });
        });
        return orders;
    } catch (error) {
        console.error('Error normalizing orders:', error.message);
        return [];
    }
}

function groupOrdersByCustomer(orders) {
    const groups = new Map();
    normalizeOrders(orders).forEach(order => {
        const customerUsername = customerStore.normalizeTikTokUsername(order.customerUsername || order.tiktokUsername || '');
        const customerName = normalizeDisplayName(order.customerName || order.nickname || '', customerUsername ? `@${customerUsername}` : undefined);
        const key = customerUsername || customerName.toLowerCase() || `unknown_${groups.size + 1}`;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                customerUsername,
                customerName,
                orders: [],
                total: 0
            });
        }
        const quantity = toNumber(order.quantity, 1) || 1;
        const price = toNumber(order.price, 0);
        const total = toNumber(order.total, price * quantity);
        const normalizedOrder = {
            ...order,
            customerUsername,
            customerName,
            productName: normalizeDisplayText(order.productName || order.text || 'Đơn hàng') || 'Đơn hàng',
            quantity,
            price,
            total
        };
        const group = groups.get(key);
        group.orders.push(normalizedOrder);
        group.total += total;
    });
    return Array.from(groups.values());
}

function getMissingFields(customer) {
    return REQUIRED_ADDRESS_FIELDS.filter(field => !String(customer?.[field] || '').trim());
}

function copyStyle(sourceRow, targetRow) {
    if (!sourceRow || !targetRow || sourceRow.number === targetRow.number) return;
    targetRow.height = sourceRow.height;
    sourceRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const targetCell = targetRow.getCell(colNumber);
        targetCell.style = JSON.parse(JSON.stringify(cell.style || {}));
        if (cell.numFmt) targetCell.numFmt = cell.numFmt;
        if (cell.alignment) targetCell.alignment = { ...cell.alignment };
        if (cell.border) targetCell.border = JSON.parse(JSON.stringify(cell.border));
        if (cell.fill) targetCell.fill = JSON.parse(JSON.stringify(cell.fill));
        if (cell.font) targetCell.font = { ...cell.font };
        if (cell.protection) targetCell.protection = { ...cell.protection };
    });
}

function clearOrderRows(sheet) {
    const lastRow = Math.max(sheet.rowCount, 2);
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        row.eachCell({ includeEmpty: true }, cell => {
            cell.value = null;
        });
        row.commit();
    }
}

function setOrderRow(row, data) {
    row.getCell(1).value = data.orderCode;
    row.getCell(2).value = data.receiverName;
    row.getCell(3).value = data.phone;
    row.getCell(4).value = data.province;
    row.getCell(5).value = data.district;
    row.getCell(6).value = data.ward;
    row.getCell(7).value = data.addressDetail;
    row.getCell(8).value = data.addressNote;
    row.getCell(9).value = data.postalCode;
    row.getCell(10).value = data.productName;
    row.getCell(11).value = data.quantity;
    row.getCell(12).value = data.price;
    row.getCell(13).value = data.weightKg;
    row.getCell(14).value = data.lengthCm;
    row.getCell(15).value = data.widthCm;
    row.getCell(16).value = data.heightCm;
    row.getCell(17).value = data.customerCode;
    row.getCell(18).value = data.orderValue;
    row.getCell(19).value = data.partialDelivery;
    row.getCell(20).value = data.allowTryOn;
    row.getCell(21).value = data.viewOnlyNoTry;
    row.getCell(22).value = data.rejectionFeeEnabled;
    row.getCell(23).value = data.rejectionFeeAmount;
    row.getCell(24).value = data.collectCod;
    row.getCell(25).value = data.codAmount;
    row.getCell(26).value = data.highValue;
    row.getCell(27).value = data.paymentMethod;
    row.getCell(28).value = data.deliveryNote;
    row.commit();
}

async function exportDeliveryExcel({ userId, orders, options = {}, now = new Date() }) {
    ensureTemplateDir();
    if (!fs.existsSync(TEMPLATE_FILE)) {
        const message = `Không tìm thấy file mẫu Excel tại ${TEMPLATE_FILE}`;
        const error = new Error(message);
        error.code = 'TEMPLATE_NOT_FOUND';
        throw error;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_FILE);
    const sheet = workbook.getWorksheet(ORDER_SHEET_NAME);
    if (!sheet) {
        throw new Error(`Không tìm thấy sheet "${ORDER_SHEET_NAME}" trong file mẫu`);
    }

    const customerGroups = groupOrdersByCustomer(orders);
    const dateKey = formatDateCompact(now);
    const styleSource = sheet.getRow(2);
    const missingCustomers = [];

    clearOrderRows(sheet);

    let rowNumber = 2;
    customerGroups.forEach((group, groupIndex) => {
        // Cố gắng tìm khách hàng theo TikTok Username
        let savedCustomer = group.customerUsername && !group.customerUsername.startsWith('offline_')
            ? customerStore.findCustomerByTikTok(userId, group.customerUsername)
            : null;

        // Nếu không tìm thấy, cố gắng tìm theo Display Name (phục vụ khách offline hoặc trùng tên)
        if (!savedCustomer && group.customerName) {
            const list = customerStore.listCustomers(userId, group.customerName);
            const match = list.find(c => String(c.displayName || '').trim().toLowerCase() === String(group.customerName).trim().toLowerCase());
            if (match) {
                savedCustomer = match;
            }
        }

        const fallbackName = normalizeDisplayName(group.customerName, group.customerUsername ? `@${group.customerUsername}` : undefined);
        const customer = {
            displayName: fallbackName,
            phone: '',
            province: '',
            district: '',
            ward: '',
            addressDetail: '',
            addressNote: '',
            postalCode: '',
            customerCode: '',
            deliveryNote: '',
            defaultWeightKg: '',
            allowTryOn: '',
            viewOnlyNoTry: '',
            partialDelivery: '',
            ...savedCustomer
        };

        const cleanedAddr = cleanAddressFields(customer);
        const customerForCheck = {
            ...customer,
            province: cleanedAddr.province,
            district: cleanedAddr.district,
            ward: cleanedAddr.ward
        };

        const missingFields = getMissingFields(customerForCheck);
        if (missingFields.length > 0) {
            missingCustomers.push({
                customerName: normalizeDisplayName(group.customerName || customer.displayName || '', group.customerUsername ? `@${group.customerUsername}` : undefined),
                customerUsername: group.customerUsername || '',
                customerId: savedCustomer?.id || '',
                missingFields
            });
        }

        // Tạo tên sản phẩm tổng hợp: "Sản phẩm A (x2), Sản phẩm B"
        const productNames = group.orders.map(o => {
            const name = o.productName || 'Sản phẩm';
            return o.quantity > 1 ? `${name} (x${o.quantity})` : name;
        }).join(', ');

        let mergedProductName = productNames || 'Đơn hàng livestream';
        if (mergedProductName.length > 100) {
            mergedProductName = mergedProductName.substring(0, 97) + '...';
        }

        // Tính tổng tiền COD & Giá trị đơn hàng (Cộng thêm phí ship nếu có)
        const shippingFee = Number(options.shippingFee || 0);
        const totalValue = group.total + shippingFee;

        // Trọng lượng
        let weight = parseFloat(customer.defaultWeightKg || options.defaultWeightKg || 0.5);
        if (Number.isNaN(weight) || weight <= 0) {
            weight = 0.5;
        }

        const orderCode = `TK-${dateKey}-${String(groupIndex + 1).padStart(3, '0')}`;
        const row = sheet.getRow(rowNumber);
        copyStyle(styleSource, row);
        
        setOrderRow(row, {
            orderCode,
            receiverName: normalizeDisplayName(customer.displayName, fallbackName),
            phone: customer.phone || '',
            province: cleanedAddr.province,
            district: cleanedAddr.district,
            ward: cleanedAddr.ward,
            addressDetail: customer.addressDetail || '',
            addressNote: customer.addressNote || '',
            postalCode: customer.postalCode || '',
            productName: mergedProductName,
            quantity: 1, // Để là 1 đơn kiện tổng hợp
            price: totalValue, // Đơn giá bằng tổng tiền COD
            weightKg: weight,
            lengthCm: Number(options.defaultLengthCm || 20),
            widthCm: Number(options.defaultWidthCm || 10),
            heightCm: Number(options.defaultHeightCm || 10),
            customerCode: customer.customerCode || '',
            orderValue: totalValue,
            partialDelivery: customer.partialDelivery || options.partialDelivery || 'N',
            allowTryOn: customer.allowTryOn || options.allowTryOn || 'N',
            viewOnlyNoTry: customer.viewOnlyNoTry || options.viewOnlyNoTry || 'Y',
            rejectionFeeEnabled: options.rejectionFeeEnabled || 'N',
            rejectionFeeAmount: options.rejectionFeeEnabled === 'Y' ? Number(options.rejectionFeeAmount || 0) : 0,
            collectCod: totalValue > 0 ? 'Y' : 'N',
            codAmount: totalValue,
            highValue: totalValue >= 3000000 ? 'Y' : 'N',
            paymentMethod: options.paymentMethod || 'Người gửi trả',
            deliveryNote: customer.deliveryNote || options.defaultDeliveryNote || ''
        });
        rowNumber += 1;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return {
        buffer,
        missingCustomers,
        totalCustomers: customerGroups.length,
        totalOrders: normalizeOrders(orders).length,
        filename: `delivery-orders-${formatMinuteStamp(now)}.xlsx`
    };
}

module.exports = {
    exportDeliveryExcel,
    groupOrdersByCustomer,
    normalizeOrders,
    TEMPLATE_FILE,
    ORDER_SHEET_NAME
};
