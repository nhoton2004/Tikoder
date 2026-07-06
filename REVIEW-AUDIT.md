# Review kỹ thuật: Tính năng Audit dữ liệu khách hàng

> Ngày review: 2026-07-06
> Reviewer: AI code review
> Phiên bản code: TikTokOrderApp

---

## A. Kết luận nhanh

- Tính năng audit đã triển khai thật ở cả 3 tầng: module cốt lõi (`customerAuditor.js`), CLI script (`audit-customers.js`), API endpoint (`GET /api/customers/audit`).
- Cả script CLI và test script đều chạy được. API trả JSON đúng cấu trúc.
- Có `test-audit.js` và `walkthrough.md` — nhưng cả hai nằm ngoài project tree (`/home/nho/Downloads/`), không được tích hợp vào cấu trúc thư mục dự án.
- Dùng được ở mức **alpha**: logic chính hoạt động, an toàn (read-only), có test thủ công, có tài liệu mô tả. Chưa đạt production-ready do thiếu assertion trong test và còn ít nhất 1 bug thực sự trong logic duplicate detection.

---

## B. Những gì đã đúng

### 1. Module `customerAuditor.js`

- Export đủ 4 hàm: `calculateCompletenessScore`, `checkCustomerIssues`, `auditUserCustomers`, `auditAllDatabaseCustomers`. Tất cả hoạt động và trả dữ liệu đúng cấu trúc.
- `completenessScore` thang 100 với trọng số hợp lý:
  - `displayName`: 20 điểm
  - `tiktokUsername`: 25 điểm
  - `phone`: 25 điểm (10 nếu sai format)
  - `province` / `district` / `ward` / `addressDetail`: mỗi trường 5 điểm (tổng 20)
  - `customerCode`: 10 điểm
- **Issue detection** phát hiện đủ các loại lỗi:
  - `blank_display_name` — severity `high`
  - `dirty_username` (chứa `@`, chữ hoa, khoảng trắng) — severity `low`
  - `missing_username` — severity `low`
  - `dirty_phone` (chứa ký tự rác) — severity `low`
  - `invalid_phone_format` (sai độ dài/ký tự không hợp lệ) — severity `medium`
  - `missing_phone` — severity `low`
  - `dirty_customer_code` (khoảng trắng thừa) — severity `low`
  - `incomplete_address` / `missing_address` — severity `low`
  - `critical_missing` (thiếu cả phone + username + addressDetail) — severity `high`
- **Severity** được gắn đúng theo mức độ nghiêm trọng.
- **Duplicate detection**: nhóm theo 3 kênh (`tiktokUsername` normalized, `phone` normalized, `customerCode` trimmed).
- **`analyzeDuplicatePair`** so sánh từng field (có normalize riêng cho từng kiểu dữ liệu), phát hiện conflict và đề xuất:
  - `merge`: các field ở record phụ có thể bổ sung cho record keep mà không xung đột.
  - `review`: có ít nhất 1 field khác nhau giữa 2 records.
- **Rule chọn record keep**: completenessScore cao nhất → createdAt cũ nhất. Hợp lý, có ghi chú rõ trong code.
- **An toàn**: 0 lệnh `UPDATE` / `DELETE` / `INSERT` / `.run()`.

### 2. Script `scripts/audit-customers.js`

- Đọc dữ liệu thật từ SQLite qua `auditAllDatabaseCustomers()`.
- Audit tất cả user/shop.
- In bảng console với các chỉ số tổng quan.
- Xuất JSON report:
  - `data/reports/customer-audit-report-[timestamp].json`
  - `data/reports/customer-audit-report.json` (fixed-name alias)
- Xuất CSV duplicates:
  - `data/reports/customer-duplicates-[timestamp].csv`
  - `data/reports/customer-duplicates.csv` (fixed-name alias)
- CSV có BOM (`\uFEFF`) cho Excel, header 12 cột đúng spec.
- Zero write operations vào database — chỉ `fs.writeFileSync` cho file report.

### 3. API `GET /api/customers/audit` (server.js:665)

- Route tồn tại, được bảo vệ bởi middleware `requireApiAuth`.
- Scope theo `req.session.user.uid` — chỉ audit dữ liệu của user hiện tại, không lộ dữ liệu user khác.
- Trả JSON đúng cấu trúc: `{ summary: { ... }, details: { ... } }`.
- Error handling: 401 nếu chưa login, 500 + message nếu lỗi server.

### 4. `walkthrough.md` (`/home/nho/Downloads/walkthrough.md`)

- Mô tả chính xác 3 thành phần: module cốt lõi, CLI script, API endpoint.
- Table kết quả audit (227 customers, 3 shops, 100% username hợp lệ, 1.3% phone hợp lệ, 0 duplicate groups) — **khớp hoàn toàn** với output runtime đã chạy.
- Mô tả `keep`/`merge`/`review` và rule chọn record giữ lại khớp code.
- Ghi nhận đúng rằng tính năng chỉ đọc, không tự sửa DB.

### 5. `test-audit.js` (`/home/nho/Downloads/test-audit.js`)

- Chạy được thật (require + gọi `auditUserCustomers`).
- 7 test cases bao phủ tốt:
  1. Perfect record (completenessScore = 100)
  2. Duplicate username, mergeable (không conflict)
  3. Duplicate username, conflicting (conflict phone + address)
  4. Dirty phone (+84 format, khoảng trắng, dấu chấm) + dirty customerCode
  5. Invalid phone (ngắn hơn 9 số)
  6. Blank displayName
  7. Critical missing (thiếu phone + username + addressDetail)
- Dữ liệu giả lập có chất lượng, phủ hầu hết edge cases quan trọng.

### 6. Normalization

**Phone normalization** (`customerStore.js:41-49`):
```
✓ '0912345678'     -> '0912345678'
✓ '+84912345678'   -> '0912345678'
✓ '84912345678'    -> '0912345678'
✓ '09 1234 5678'   -> '0912345678'
✓ '09.1234.5678'   -> '0912345678'
✓ '(09)1234-5678'  -> '0912345678'
✓ '+84 912 345 678' -> '0912345678'
```

**Username normalization** (`customerStore.js:37-39`):
```
✓ '@alice'     -> 'alice'
✓ 'Alice'      -> 'alice'
✓ '  @Alice  ' -> 'alice'
✓ 'ALICE'      -> 'alice'
✓ 'alice_123'  -> 'alice_123'
```

---

## C. Những điểm chưa chắc / cần sửa

### Bug 1 (trung bình): `customerCode` duplicate detection case-sensitive

- **File**: `customerAuditor.js:353`
- **Vấn đề**: Key grouping chỉ trim, không lowercase → `C001` và `c001` không được gộp chung.
- **Hậu quả**: False negative — duplicate bị bỏ sót.
- **Đã verified bằng code**: Test với 2 records `C001` / `c001` → `duplicateCodeGroups = 0` (phải là 1).
- **Fix**: Dùng `.trim().toLowerCase()` làm key.

### Bug 2 (thấp): International phone numbers bị false positive `invalid_phone_format`

- **File**: `customerAuditor.js:99`
- **Vấn đề**: `normalizePhone` giữ `+` cho số không phải `+84` (vd: `+14441112222`). Regex `/[^\d]/.test(normalized)` bắt được `+` → flag là `invalid_phone_format`.
- **Hậu quả**: Số quốc tế hợp lệ bị đánh giá sai, mất 15 điểm completeness (chỉ được 10/25).
- **Đã verified**: `+14441112222` → flagged invalid, phone score = 10/25.
- **Fix**: Thêm bước loại bỏ `+` trước khi kiểm tra `hasNonNumeric`; trong `calculateCompletenessScore` cũng cần handle tương tự.

### Bug 3 (thấp): `dirty_phone` flag cho số `+84` chuẩn quốc tế

- **File**: `customerAuditor.js:103-104`
- **Vấn đề**: So sánh `rawCleaned` (chỉ trim) với `normalized` (đã chuyển `+84` → `0`). Số `+84912345678` bị flag là dirty phone dù format này hoàn toàn chấp nhận được.
- **Mức ảnh hưởng**: Gây nhiễu report, không ảnh hưởng logic merge.

### Thiếu hụt 1 (trung bình): `test-audit.js` không có assertion

- **File**: `/home/nho/Downloads/test-audit.js` (139 dòng)
- **Vấn đề**: Toàn bộ là `console.log` — không một dòng `if/throw`/`assert` nào kiểm tra kết quả. Người chạy phải tự đọc output và đánh giá bằng mắt.
- Đây là **manual test script**, không phải automated test. Dễ bỏ sót regression khi code thay đổi.
- **Cần bổ sung**: `assert.strictEqual` hoặc chuyển sang Jest để có fail/pass rõ ràng.

### Thiếu hụt 2 (thấp): File test và walkthrough nằm ngoài project tree

- Cả hai file đều ở `/home/nho/Downloads/`, không trong thư mục dự án.
- Walkthrough reference test script ở path Gemini scratch (`/home/nho/.gemini/.../test-audit.js`), không khớp với vị trí thực tế.
- Không có `npm test` script, không tích hợp vào CI.

### Thiếu hụt 3 (thấp): `mapRowToCustomer` duplicate code

- `customerAuditor.js:252-276` có logic gần giống `customerStore.js:26-35` (`rowToCustomer`).
- Rủi ro lệch pha khi schema thay đổi — nếu sửa một trong hai mà quên sửa cái kia.
- Nên tái sử dụng `customerStore.rowToCustomer` với option `{ raw: true }` nếu cần lấy dữ liệu gốc.

---

## D. Mức độ tin cậy

### 1. Logic audit — đáng tin cậy có giới hạn

| Tiêu chí | Đánh giá |
|----------|----------|
| Phát hiện duplicate | Tốt, nhưng có 1 false negative (customerCode case-sensitive) |
| Phát hiện dirty data | Chính xác cho các trường hợp VN phổ biến |
| Phát hiện missing data | Chính xác |
| Phát hiện invalid format | Tốt cho VN số, false positive nhẹ cho số quốc tế |
| Đề xuất keep/merge/review | Hợp lý cho MVP, dùng score + createdAt |
| False positive rate | Thấp (chủ yếu international phone) |
| False negative rate | Thấp (1 bug đã xác nhận — customerCode case) |

### 2. Độ an toàn dữ liệu — an toàn

- Tất cả code audit chỉ đọc database (SELECT), không ghi (UPDATE/DELETE/INSERT).
- CLI script chỉ ghi file report ra `data/reports/`.
- API scope theo userId, có auth middleware.
- **Kết luận**: Không thể gây hỏng dữ liệu gốc.

### 3. Chất lượng test — trung bình-thấp

- **Có** test script, **có** dữ liệu giả lập bao phủ tốt (7 edge cases).
- **Không có** assertion nào → không thể phát hiện regression tự động.
- Không có test framework (Jest/Mocha/Node assert).
- Không có test cho CLI script.
- Không có integration test cho API endpoint.
- **Kết luận**: Test hữu ích cho dev verification nhưng chưa đủ tin cậy cho CI/CD.

### 4. Độ khớp giữa walkthrough và code — khớp

- Walkthrough mô tả đúng cấu trúc module, cách chạy, output format.
- Số liệu audit trong walkthrough khớp với runtime output.
- Walkthrough không claim gì vượt quá khả năng thực tế của code.
- **Lưu ý nhỏ**: Path dẫn đến test-audit.js trong walkthrough không khớp với vị trí file thực tế.

---

## E. Hành động tiếp theo

Ưu tiên theo thứ tự:

| # | Hành động | Mức độ | File ảnh hưởng |
|---|-----------|--------|-----------------|
| 1 | Fix `customerCode` case-sensitive: dùng `.trim().toLowerCase()` làm grouping key | **Cao** | `customerAuditor.js:353` |
| 2 | Fix international phone: loại bỏ `+` trước regex check trong `checkCustomerIssues` và `calculateCompletenessScore` | **Cao** | `customerAuditor.js:32, 99` |
| 3 | Chuyển `test-audit.js` vào project (vd: `tests/test-audit.js`), thêm assertion (`assert.strictEqual` hoặc Jest) | **Cao** | `tests/test-audit.js` |
| 4 | Chuyển `walkthrough.md` vào project (vd: `docs/audit-walkthrough.md`), sửa path dẫn file | **Trung bình** | `docs/audit-walkthrough.md` |
| 5 | Thêm smoke test cho CLI script: khởi tạo SQLite tạm, chạy audit, kiểm tra file output | **Trung bình** | `tests/cli-audit.test.js` |
| 6 | Thêm integration test cho API endpoint (supertest + session giả) | **Trung bình** | `tests/api-audit.test.js` |
| 7 | Refactor `mapRowToCustomer` để dùng chung `customerStore.rowToCustomer` | **Thấp** | `customerAuditor.js:252-276` |

### Chi tiết các bước sửa lỗi:

#### Bước 1: Fix customerCode case-sensitive

```js
// File: customerAuditor.js:353
// Hiện tại:
const trimmedC = c.customerCode ? c.customerCode.trim() : '';
// Sửa thành:
const trimmedC = c.customerCode ? c.customerCode.trim().toLowerCase() : '';
```

#### Bước 2: Fix international phone

Trong `checkCustomerIssues`, sửa dòng kiểm tra `hasNonNumeric`:

```js
// File: customerAuditor.js:99
// Hiện tại:
const hasNonNumeric = /[^\d]/.test(normalized);
// Sửa thành:
const digitsOnly = normalized.replace(/^\+/, '');
const hasNonNumeric = /[^\d]/.test(digitsOnly);
```

Trong `calculateCompletenessScore`, sửa regex validate phone:

```js
// File: customerAuditor.js:32
// Hiện tại:
if (normPhone && normPhone.length >= 9 && normPhone.length <= 13 && /^\d+$/.test(normPhone)) {
// Sửa thành:
const phoneDigits = normPhone ? normPhone.replace(/^\+/, '') : '';
if (phoneDigits && phoneDigits.length >= 9 && phoneDigits.length <= 13 && /^\d+$/.test(phoneDigits)) {
```

#### Bước 3: Thêm assertion vào test

```js
const assert = require('assert');
// Sau khi có report:
assert.strictEqual(report.summary.totalCustomers, 7);
assert.strictEqual(report.summary.duplicateUsernameGroups, 1);
assert.strictEqual(report.details.duplicateUsernames[0].duplicates[0].suggestedAction, 'merge');
assert.strictEqual(report.details.invalidPhoneFormats.length, 1);
assert.strictEqual(report.details.blankDisplayNames.length, 1);
assert.strictEqual(report.details.recordsMissingKeyData.length, 3);
```

---

*Hết review.*
