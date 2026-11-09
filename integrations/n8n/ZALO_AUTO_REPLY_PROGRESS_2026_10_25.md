---
title: TikTokOrder + n8n - nối bộ nhận Zalo theo DOM thực tế
created: 2026-10-25
status: cho-kiem-thu-tai-khoan-phu
tags: [tikoder, n8n, zalo, auto-reply]
---

# Nhật ký tiếp tục 25/10/2026

Cập nhật mới hơn: xem `ZALO_AUTO_REPLY_PROGRESS_2026_10_26.md`. Hướng dẫn chờ sang phút và chặn cả hội thoại bởi `needs_check` dưới đây chỉ ghi lại hành vi cũ.

Ghi chú này cập nhật trạng thái mới hơn kế hoạch 24/10. Không chạy Python; tiếp tục TikTokOrder + n8n.

## Bằng chứng thực tế

Chủ ứng dụng mở Zalo bằng Kết nối / Bắt đầu trong TikTokOrder. Báo cáo DOM v2 bị cắt sâu 8 và không đủ bằng chứng. Báo cáo `tikoder-zalo-dom-diagnostics (3).json` đã là v3, thấy `article#chatView`, `#richInput`, `.message-view__scroll`, `.message-view__scroll__inner`, `.chat-item`, `.chat-message`, `.message-frame[data-qid]`, menu `--other`/`--me`, `.card-send-time`, `.message-action` và nút ảnh có icon `fa-Photo_24_Line`.

Code cũ đòi các thuộc tính chỉ có ở fixture (`data-chat-type`, `data-history-ready`, `data-live-arrival`...), không tồn tại trong báo cáo thật. Đây là nguyên nhân nhận tin không hoạt động, không phải dùng nhầm Edge.

Kiểm tra cấu hình tại thời điểm triển khai: công tắc tổng bật, nhưng quy tắc SĐT và QR đều tắt; chưa lưu ảnh QR; chưa có tin vào hàng đợi. Không ghi số hoặc nội dung mặc định vào ghi chú này. Không tự bật quy tắc hoặc thay dữ liệu của chủ ứng dụng.

## Đã sửa mã

- Thêm `utils/zaloLiveInboxDom.js`: đọc cấu trúc quan sát thực tế, yêu cầu dấu hiệu chiều tin nhất quán; qid/frame/chat ID riêng, không giả định chúng bằng nhau. Bỏ qua tệp đính kèm hoặc nội dung không xác minh là text.
- Theo dõi đúng một liên hệ thử trong allowlist. Tìm số chính xác, đối chiếu tên và trailer; xác minh lại liên hệ mỗi lượt đọc. Khóa trình duyệt dùng chung báo giá.
- Lưu mốc lịch sử; vì giờ Zalo chỉ chính xác đến phút, chỉ nhận tin có phút lớn hơn phút bắt đầu. App hiển thị giờ bắt đầu nhận; cần chờ sang phút kế tiếp rồi gửi tin mới.
- Tin có timestamp/chiều nhận/ID không chắc chắn không được gửi tự động. Không đoán thời gian từ qid. Theo dõi render nhiều bước của tin mới nhưng không biến tin lịch sử thành tin đến.
- Chống lặp bằng mã tin và mã liên hệ đã băm; tạm dừng trước giới hạn bộ nhớ thay vì quên ID rồi gửi lặp.
- Bổ sung `utils/zaloImageSend.js`: chọn nút ảnh quan sát được, kiểm tra tệp QR/digest, hỗ trợ hộp chọn tệp có điều kiện. Chọn tệp có thể tự gửi, nên không bấm gửi lần hai khi thấy tin ảnh đi mới.
- Nếu có xem trước: chỉ bấm đúng một nút Gửi nhận diện được sau khi so SHA-256 ảnh blob/data với tệp đã lưu. Không fetch ảnh remote hoặc đoán nút. Preview bị biến đổi/không xác minh được -> cần kiểm tra, không tự gửi lại.
- Tự trả text/ảnh không ghi đè bản nháp đang có. Guard cấu hình và người nhận được kiểm tra lại trước thao tác gửi.
- Giao diện cảnh báo server còn dùng bộ nhận cũ, hai quy tắc đang tắt hoặc chưa có QR. Không cho lưu bật tổng khi không có quy tắc nào được bật.
- Workflow n8n giữ nguyên luồng riêng đã publish, không đổi workflow báo giá và không thay credentials.

## Kiểm thử

- `npm.cmd test`: 37/37 đạt.
- `node scripts/testZaloLiveInboxDom.js`: 148 fixture Edge offline đạt.
- `node scripts/testZaloLiveAdapter.js`: 22 kiểm tra offline đạt.
- `node scripts/testZaloImageSend.js`: 55 kiểm tra offline đạt; sửa cả lỗi promise polling làm lọt pageerror, giữ nguyên kiểm tra không có lỗi runtime.
- `node scripts/testZaloAutoReplyUi.js`: 4 trường hợp sáng/tối và 390/1440px đạt, có chặn bật tổng mà không bật quy tắc.
- `node scripts/testZaloInboxDom.js`: hồi quy đường báo giá/guard/khóa đạt.
- `node scripts/testDashboardResponsive.js playwright-core`: 192 kiểm tra bố cục đạt.

Tất cả dùng dữ liệu giả, không gửi tin thật. Đây là triển khai dựa trên cấu trúc DOM do người dùng xuất, **chưa phải xác nhận gửi đầu cuối trên Zalo thật**. QR chỉ hỗ trợ có điều kiện ở runtime; nếu giao diện upload khác, app dừng an toàn.

## Thử thực tế tiếp theo

1. Dừng server TikTokOrder cũ (Ctrl+C), chạy lại `npm.cmd start`, tải lại app. Không tự restart lúc chủ shop có thể đang live.
2. Zalo tự động: kiểm tra đúng liên hệ thử; bật Tự trả lời số điện thoại, kiểm tra nội dung mặc định, Lưu cấu hình.
3. Kết nối / Bắt đầu, đăng nhập cửa sổ Zalo riêng. Chờ sang phút kế tiếp sau mốc hiển thị, dùng tài khoản thử gửi một tin mới `sdt`.
4. Kiểm tra nhật ký trong app và tin thực tế. Nếu `needs_check`, xác minh rồi đánh dấu đã gửi/bỏ qua; không gửi lặp bản cũ. Luồng thử chặn gửi tiếp khi còn kết quả chưa kiểm tra.
5. Muốn thử QR: tải đúng ảnh của shop, bật quy tắc QR, Lưu cấu hình; cấu hình thay đổi tạo mốc theo dõi mới nên chờ sang phút kế tiếp rồi gửi `QR`. Không nhắn dồn.
6. Nếu lỗi, gửi trạng thái/lý do của mục tin trong app. Không cần tiếp tục xuất báo cáo DOM để chỉ đổi số phiên bản. Không cung cấp cookie, mật khẩu, API key hoặc file profile.
