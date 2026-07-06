const assert = require('node:assert');
const {
    auditUserCustomers,
    calculateCompletenessScore,
    checkCustomerIssues
} = require('../utils/customerAuditor');

function makeC(overrides) {
    return {
        id: 'test',
        userId: 'dev-user',
        tiktokUsername: '',
        displayName: '',
        phone: '',
        province: '',
        district: '',
        ward: '',
        addressDetail: '',
        customerCode: '',
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides
    };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ✗ ${name}: ${e.message}`);
    }
}

console.log('=== customer-auditor.test.js ===\n');

// ─── completenessScore ───────────────────────────────────────

test('perfect record scores 100', () => {
    const c = makeC({
        displayName: 'Nguyễn Văn A',
        tiktokUsername: 'user_a',
        phone: '0987654321',
        province: 'HN', district: 'CG', ward: 'P1', addressDetail: '123',
        customerCode: 'KH001'
    });
    assert.strictEqual(calculateCompletenessScore(c), 100);
});

test('empty record scores 0', () => {
    assert.strictEqual(calculateCompletenessScore(makeC({})), 0);
});

test('international phone with + gets full phone score', () => {
    const c = makeC({
        tiktokUsername: 'user_b',
        displayName: 'Bob',
        phone: '+14441112222'
    });
    const score = calculateCompletenessScore(c);
    // displayName 20 + tiktokUsername 25 + phone (valid intl) 25 = 70
    assert.strictEqual(score, 70);
});

test('invalid short phone gets partial score', () => {
    const c = makeC({
        tiktokUsername: 'user_c',
        displayName: 'Charlie',
        phone: '123'
    });
    const score = calculateCompletenessScore(c);
    // displayName 20 + tiktokUsername 25 + phone (invalid) 10 = 55
    assert.strictEqual(score, 55);
});

test('dirty vietnam phone +84 gets full score (normalized to 0xxx)', () => {
    const c = makeC({
        displayName: 'Dirty',
        tiktokUsername: 'd',
        phone: '+84 987.654.321'
    });
    const score = calculateCompletenessScore(c);
    // displayName 20 + tiktokUsername 25 + phone (valid after normalize) 25 = 70
    assert.strictEqual(score, 70);
});

// ─── checkCustomerIssues ─────────────────────────────────────

test('blank displayName gets severity high', () => {
    const issues = checkCustomerIssues(makeC({ displayName: '   ' }));
    const found = issues.find(i => i.type === 'blank_display_name');
    assert.ok(found, 'should detect blank display name');
    assert.strictEqual(found.severity, 'high');
});

test('dirty username with @ gets flagged', () => {
    const issues = checkCustomerIssues(makeC({ tiktokUsername: '@Alice' }));
    const found = issues.find(i => i.type === 'dirty_username');
    assert.ok(found, 'should detect dirty username');
});

test('international phone +14441112222 is NOT flagged as invalid', () => {
    const c = makeC({
        tiktokUsername: 'x',
        displayName: 'X',
        phone: '+14441112222'
    });
    const issues = checkCustomerIssues(c);
    const invalid = issues.find(i => i.type === 'invalid_phone_format');
    assert.ok(!invalid, 'international phone should not be flagged as invalid format');
    const dirty = issues.find(i => i.type === 'dirty_phone');
    assert.ok(!dirty, 'clean international phone should not be flagged as dirty');
});

test('short phone 12345 gets flagged as invalid', () => {
    const issues = checkCustomerIssues(makeC({
        tiktokUsername: 'x', displayName: 'X', phone: '12345'
    }));
    const found = issues.find(i => i.type === 'invalid_phone_format');
    assert.ok(found, 'short phone should be flagged');
});

test('dirty vietnam phone +84 987.654.321 is flagged dirty but NOT invalid', () => {
    const c = makeC({
        tiktokUsername: 'x', displayName: 'X', phone: '+84 987.654.321'
    });
    const issues = checkCustomerIssues(c);
    const dirty = issues.find(i => i.type === 'dirty_phone');
    assert.ok(dirty, 'vietnam phone with formatting should be dirty');
    const invalid = issues.find(i => i.type === 'invalid_phone_format');
    assert.ok(!invalid, 'but should NOT be invalid format');
});

test('critical missing (no phone, no username, no address) gets severity high', () => {
    const issues = checkCustomerIssues(makeC({
        displayName: 'Hidden',
        tiktokUsername: '',
        phone: '',
        addressDetail: ''
    }));
    const found = issues.find(i => i.type === 'critical_missing');
    assert.ok(found, 'should detect critical missing');
    assert.strictEqual(found.severity, 'high');
});

// ─── auditUserCustomers (duplicate detection) ────────────────

test('duplicate usernames mergeable: suggestedAction = merge', () => {
    const customers = [
        makeC({
            id: 'keep_me', displayName: 'Alice', tiktokUsername: 'alice',
            phone: '0912345678', province: 'HN', district: 'CG', ward: 'P1',
            addressDetail: '123', customerCode: 'C001', createdAt: '2026-01-01'
        }),
        makeC({
            id: 'merge_me', displayName: 'Alice', tiktokUsername: 'alice',
            phone: '0912345678', createdAt: '2026-02-01'
        })
    ];
    const report = auditUserCustomers('dev-user', customers);
    // keep gets suggestedAction from keepRecord directly
    assert.strictEqual(report.summary.duplicateUsernameGroups, 1);
    const group = report.details.duplicateUsernames[0];
    assert.strictEqual(group.duplicates[0].suggestedAction, 'merge');
});

test('duplicate usernames conflicting: suggestedAction = review', () => {
    const customers = [
        makeC({
            id: 'keep_me', displayName: 'Alice', tiktokUsername: 'alice',
            phone: '0912345678', province: 'HN', district: 'CG', ward: 'P1',
            addressDetail: '123', customerCode: 'C001', createdAt: '2026-01-01'
        }),
        makeC({
            id: 'conflict_me', displayName: 'Alice', tiktokUsername: 'alice',
            phone: '0900000000', createdAt: '2026-02-01'
        })
    ];
    const report = auditUserCustomers('dev-user', customers);
    assert.strictEqual(report.summary.duplicateUsernameGroups, 1);
    const group = report.details.duplicateUsernames[0];
    assert.strictEqual(group.duplicates[0].suggestedAction, 'review');
});

test('customerCode case-insensitive: C001 and c001 grouped together', () => {
    const customers = [
        makeC({
            id: 'a', displayName: 'A', tiktokUsername: 'a',
            phone: '0911111111', customerCode: 'C001', createdAt: '2026-01-01'
        }),
        makeC({
            id: 'b', displayName: 'B', tiktokUsername: 'b',
            phone: '0922222222', customerCode: 'c001', createdAt: '2026-02-01'
        })
    ];
    const report = auditUserCustomers('dev-user', customers);
    assert.strictEqual(
        report.summary.duplicateCodeGroups, 1,
        'C001 and c001 should be detected as the same group'
    );
});

test('non-duplicate customerCodes: no false positive', () => {
    const customers = [
        makeC({
            id: 'a', displayName: 'A', tiktokUsername: 'a',
            phone: '0911111111', customerCode: 'C001', createdAt: '2026-01-01'
        }),
        makeC({
            id: 'b', displayName: 'B', tiktokUsername: 'b',
            phone: '0922222222', customerCode: 'C002', createdAt: '2026-02-01'
        })
    ];
    const report = auditUserCustomers('dev-user', customers);
    assert.strictEqual(report.summary.duplicateCodeGroups, 0);
});

// ─── summary ────────────────────────────────────────────────

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
