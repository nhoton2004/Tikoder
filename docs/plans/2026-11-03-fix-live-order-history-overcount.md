# Fix Live Order History Overcount Implementation Plan

**Goal:** Giữ đơn cũ trong lịch sử nhưng không cộng vào số tiền của lượt Live hiện tại; đối soát và sửa phiên 02/11/2026 mà không xóa nhầm đơn.

**Architecture:** Tách rõ `session.orders` (toàn bộ lịch sử cộng dồn) và `segment.orders` (đơn của từng lượt), chỉ đọc/chọn theo phạm vi khi hiển thị. Di chuyển dữ liệu lịch sử nhầm phạm vi bằng migration có báo cáo, backup, dry-run và xác nhận thủ công; không sửa dữ liệu thật khi chưa duyệt.

**Tech Stack:** Node.js, JSON live-session store, Socket.IO, HTML/JS thuần, node:test.

---

## Bằng chứng và ranh giới

- Ảnh: 159 đơn, 8.352.001đ. Đối chiếu JSON `data/live-sessions/RT8opnzxFiaUaZsdztS0OWQlUIn1.json` (chỉ đọc): tổng từ 159 dòng đúng 8.352.001đ, bằng `summary.totalRevenue`.
- Theo `createdAt`: 21/10/2026 có 9 dòng / 430.001đ; 22/10/2026 có 88 dòng / 4.447.000đ; 02/11/2026 có 62 dòng / 3.475.000đ. Tổng 97 dòng tháng 10 / 4.877.001đ đang nằm trong cùng phiên có tên bắt đầu 02/11. 97 dòng cũ có ID tiền tố `legacy_`, không có `requestId` hay `sourceMessageId`. Một dòng giá 1đ cần đối chiếu thủ công.
- Hai cặp cùng khách + sản phẩm + giá + giờ có vẻ trùng (tổng phần lặp 270.000đ), nhưng không đủ bằng chứng để tự động xóa: có thể là khách mua hai món giống nhau.
- `public/js/dashboard.js:482-489` cộng `ordersData` hiện được nạp từ toàn bộ `session.orders` (`:1235-1260`, `:1343-1382`). `server.js:2415` cũng nạp lại toàn bộ đơn cũ lúc tiếp tục; `utils/liveSessionStore.js:301-339` xác định top-level là danh sách cộng dồn. Vì thế đây là lỗi phạm vi dữ liệu hiển thị/khôi phục, không phải phép cộng trong UI. **Chưa chứng minh được thao tác nào ban đầu đưa 97 đơn legacy vào phiên này.**

## Task 1 — Tái hiện và truy nguồn (chỉ đọc)

**Files:** `scripts/testLiveSessionLifecycle.js`, `server.js:2366-2425`, `utils/liveSessionStore.js:301-339`, `public/js/dashboard.js:482-503,1235-1260,1343-1382`.

1. Viết test fixture: một phiên có 97 đơn `legacy_` tháng 10 và 62 đơn tháng 11; assertion lượt 02/11 có 62 đơn / 3.475.000đ, còn lịch sử toàn bộ vẫn có 159 đơn / 8.352.001đ. Chạy `node --test scripts/testLiveSessionLifecycle.js`; test phải RED trước khi sửa.
2. Truy dấu tạo/import/tiếp tục lịch sử và segment: lúc nào 97 đơn cũ vào top-level và vì sao `segments[0].orders` đã chứa chúng. Không kết luận chỉ từ ID; đối chiếu nguồn legacy, timestamp và metadata, không in thông tin khách trong log.
3. Xác nhận quy tắc nghiệp vụ: mặc định lượt Live mới chỉ tính đơn mới; lịch sử cộng dồn được xem riêng. Nếu người dùng muốn hiển thị cộng dồn, phải gắn nhãn/phạm vi rõ.

## Task 2 — Sửa phạm vi ở nguồn và giao diện

**Files:** `utils/liveSessionStore.js`, `server.js`, `public/js/dashboard.js`, `public/app.html`, `scripts/testLiveSessionLifecycle.js`.

1. Thiết kế boundary theo `segment` thay vì đoán bằng ngày: đơn mới ghi vào lượt đang mở; resume có thể giữ lịch sử nhưng KPI/"Đơn đang chốt" mặc định chỉ hiển thị lượt hiện tại. Có cách xem toàn bộ lịch sử riêng với số đơn/tổng riêng; không đổi ngầm ý nghĩa API/export/print.
2. Thêm test RED cho create/reconnect/resume/close, kể cả phiên cũ không có `segments`, edit/delete, export, print và các màn hình cùng dùng `ordersData`; không làm mất đơn cũ hay làm lệch tổng customer. Chạy `node --test scripts/testLiveSessionLifecycle.js scripts/testHistoryQuoteEditing.js`.
3. Implement thay đổi tối thiểu sau khi truy nguyên được luồng đưa đơn legacy vào phiên; ngăn lại ở nguồn, không chỉ lọc theo ngày trong UI. Hiển thị nhãn "Lượt hiện tại" và "Toàn bộ lịch sử" cùng phạm vi ngày/phiên, tránh nhầm tổng.

## Task 3 — Đối soát và sửa dữ liệu đã lưu (có cổng xác nhận)

**Files:** tạo `scripts/auditLiveSessionOrders.js` và test tương ứng; JSON thật chỉ sửa khi chủ shop duyệt.

1. Công cụ chỉ đọc xuất báo cáo tổng, ngày, ID provenance, segment overlap, các cặp nghi trùng và giá bất thường; không công bố tên/số điện thoại. `--dry-run` liệt kê chính xác order IDs được đề xuất chuyển/tách, số lượng và chênh lệch, không ghi file.
2. Backup nguyên trạng file phiên, tạo checksum và phương án rollback. Chỉ khi xác nhận 97 đơn tháng 10 không thuộc lượt 02/11 mới áp dụng migration idempotent theo ID trên bản copy, giữ chúng trong lịch sử cũ; không tự xóa cặp giống nhau hoặc đơn 1đ.
3. Sau áp dụng, đọc lại JSON/API/UI và xác nhận 02/11 = 62 đơn / 3.475.000đ nếu phạm vi được duyệt; toàn bộ lịch sử vẫn truy xuất đủ 159 đơn / 8.352.001đ trước mọi quyết định xóa, segment summary thống nhất, restart/reconnect không tái nhiễm.

## Task 4 — Kiểm thử nghiệm thu

- Chạy `npm run test` và test mới; xác nhận không đổi dữ liệu thật trong quá trình test.
- Kiểm tra thủ công mở lịch sử, đổi phạm vi, load lại trang, bắt đầu/kết thúc/tiếp tục phiên, in/xuất file; đối chiếu tổng từ từng dòng với tổng hiển thị.
- Không commit tự động. Chỉ bàn giao sau khi người dùng tự thử và chấp thuận migration dữ liệu thật.
