/**
 * Customer Store - per-user JSON storage.
 * Each user has one file: data/customers/{userId}.json
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'customers');

const CUSTOMER_FIELDS = [
    'tiktokUsername',
    'displayName',
    'phone',
    'province',
    'district',
    'ward',
    'addressDetail',
    'addressNote',
    'postalCode',
    'customerCode',
    'deliveryNote',
    'defaultWeightKg',
    'allowTryOn',
    'viewOnlyNoTry',
    'partialDelivery'
];

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function safeUserId(userId) {
    return String(userId || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function normalizeTikTokUsername(username) {
    return String(username || '').trim().replace(/^@+/, '').toLowerCase();
}

function getUserCustomerFile(userId) {
    ensureDir();
    return path.join(DATA_DIR, `${safeUserId(userId)}.json`);
}

function readUserCustomers(userId) {
    const filePath = getUserCustomerFile(userId);
    if (!fs.existsSync(filePath)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const customers = Array.isArray(data?.customers) ? data.customers : [];
        return customers.filter(customer => customer.userId === userId);
    } catch (error) {
        console.error(`Lỗi đọc file customers của user ${userId}:`, error.message);
        return [];
    }
}

function writeUserCustomers(userId, customers) {
    ensureDir();
    const normalized = Array.isArray(customers)
        ? customers.map(customer => ({ ...customer, userId }))
        : [];
    fs.writeFileSync(getUserCustomerFile(userId), JSON.stringify({ customers: normalized }, null, 2), 'utf-8');
}

function listCustomers(userId, query = '') {
    const q = String(query || '').trim().toLowerCase();
    const customers = readUserCustomers(userId);
    if (!q) return customers;
    return customers.filter(customer => {
        return [
            customer.displayName,
            customer.tiktokUsername,
            customer.phone
        ].some(value => String(value || '').toLowerCase().includes(q));
    });
}

function getCustomerById(userId, customerId) {
    return readUserCustomers(userId).find(customer => customer.id === customerId && customer.userId === userId) || null;
}

function findCustomerByTikTok(userId, tiktokUsername) {
    const normalized = normalizeTikTokUsername(tiktokUsername);
    if (!normalized) return null;
    return readUserCustomers(userId).find(customer => normalizeTikTokUsername(customer.tiktokUsername) === normalized) || null;
}

function pickCustomerFields(data) {
    return CUSTOMER_FIELDS.reduce((result, field) => {
        if (Object.prototype.hasOwnProperty.call(data || {}, field)) {
            result[field] = data[field];
        }
        return result;
    }, {});
}

function createCustomer(userId, data = {}) {
    const customers = readUserCustomers(userId);
    const now = new Date().toISOString();
    const customer = {
        id: `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        tiktokUsername: '',
        displayName: '',
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
        ...pickCustomerFields(data),
        createdAt: now,
        updatedAt: now
    };

    customer.tiktokUsername = normalizeTikTokUsername(customer.tiktokUsername);
    customers.unshift(customer);
    writeUserCustomers(userId, customers);
    return customer;
}

function updateCustomer(userId, customerId, patch = {}) {
    const customers = readUserCustomers(userId);
    const index = customers.findIndex(customer => customer.id === customerId && customer.userId === userId);
    if (index === -1) return null;

    const next = {
        ...customers[index],
        ...pickCustomerFields(patch),
        userId,
        id: customers[index].id,
        createdAt: customers[index].createdAt,
        updatedAt: new Date().toISOString()
    };
    next.tiktokUsername = normalizeTikTokUsername(next.tiktokUsername);
    customers[index] = next;
    writeUserCustomers(userId, customers);
    return next;
}

function deleteCustomer(userId, customerId) {
    const customers = readUserCustomers(userId);
    const next = customers.filter(customer => !(customer.id === customerId && customer.userId === userId));
    if (next.length === customers.length) return false;
    writeUserCustomers(userId, next);
    return true;
}

module.exports = {
    readUserCustomers,
    writeUserCustomers,
    listCustomers,
    getCustomerById,
    findCustomerByTikTok,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    normalizeTikTokUsername,
    getUserCustomerFile
};
