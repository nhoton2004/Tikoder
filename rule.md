# RULES.md - Quy tắc Lập trình cùng AI (Tikoder / DebtTracker)

## 1. QUY TRÌNH THỰC THI (Plan-then-Code)
- **Bắt buộc**: Với mọi yêu cầu tính năng hoặc sửa bug phức tạp, AI KHÔNG ĐƯỢC tự ý sửa file ngay.
- Trải qua 3 bước:
  1. **Plan**: Liệt kê các file cần tạo/sửa + tóm tắt logic sẽ thực hiện.
  2. **Approval**: Chờ người dùng xác nhận plan.
  3. **Execute & Verify**: Tiến hành ghi file, kiểm tra diff và chạy test để đảm bảo không gãy hệ thống.

## 2. BẢN ĐỒ DỰ ÁN & VÙNG GIỚI HẠN (Red Zone)
- **Tech Stack**: Node.js, Express.js (CommonJS `require`), SQLite3 (`utils/db.js`), Socket.io, EJS / Frontend Vanilla JS.
- **Vùng Red Zone (Cần cẩn trọng đặc biệt & review kỹ)**:
  - Logic tính toán công nợ/tài chính: `routes/debts.js`, `utils/customerStore.js`.
  - Livestream socket realtime: `sockets/liveHandler.js`, `server.js`.
  - Database schema & migration: `utils/db.js`, `debts.db`.
- **Giới hạn**: Không tự ý `npm install` package mới hoặc refactor lại kiến trúc thư mục nếu chưa được yêu cầu.

## 3. CHUẨN CODE (Code Conventions)
- **Backend**: Dùng `async/await` kết hợp `try/catch`. Luôn xử lý đóng resource hoặc catch error async.
- **SQLite**: Bắt buộc dùng Parameterized Queries (`db.run("...", [val1, val2])`) để phòng chống SQL Injection.
- **Frontend / EJS**: Giữ mã JS client sạch sẽ, không để lộ secret/API key, tối ưu luồng WebSocket khi nhận comment livestream.

## 4. TỐI ƯU CONTEXT & BỘ NHỚ
- Giữ các phiên chat ngắn gọn, xong sub-task nào dứt điểm sub-task đó.
- Ưu tiên dùng tìm kiếm theo symbol/grep thay vì bắt AI đọc toàn bộ file lớn để tránh trôi ngữ cảnh (Context Drift).

## 5. TIÊU CHÍ HOÀN THÀNH (Definition of Done)
- Code chạy được không lỗi runtime (`npm start`).
- Các bài test tự động (`npm test`) vượt qua thành công.
- Diff sạch, loại bỏ console.log thừa trước khi bàn giao.