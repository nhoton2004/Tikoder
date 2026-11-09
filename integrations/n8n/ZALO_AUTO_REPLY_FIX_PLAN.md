---
title: Kế hoạch sửa auto-reply SĐT TikTokOrder + n8n
created: 2026-10-25
status: dang-kiem-thu
tags: [tikoder, n8n, zalo, fix, auto-reply]
---

# Mục tiêu

Khi liên hệ thử gửi tin mới như `sdt`, `cho em xin sdt`, `SĐT`, `cho em xin số điện thoại shop với ạ!` hoặc `hotline`, TikTokOrder phải nhận được sự kiện, n8n điều phối và app gửi đúng nội dung SĐT đã cấu hình. Không chạy Python, không mở rộng allowlist, không gửi khi kết quả đang mơ hồ.

## Bằng chứng trước sửa

- Cấu hình tổng bật, quy tắc SĐT bật, nội dung có sẵn, từ khóa đúng.
- Hàng đợi có 0 tin: cần sửa khâu nhận tin trước khi quy lỗi cho n8n.
- Bộ theo dõi bắt đầu một lần; nếu lúc ấy Zalo chưa đăng nhập/sẵn sàng, listener dừng và không được khôi phục.
- Đã tái hiện trên Edge: append tin mới làm nội dung cao thêm; Zalo tự cuộn tới cuối; callback scroll xóa ứng viên và dời cutoff sang phút tin mới. Tin mới không còn đủ điều kiện.

## Các hạng mục

1. **Sửa mất tin khi tự cuộn** (`utils/zaloLiveInboxDom.js`, `scripts/testZaloLiveInboxDom.js`): phân biệt tự bám đáy trong cửa sổ 1,5 giây với người dùng cuộn đi. Giữ ứng viên/mốc sau append hợp lệ; vẫn loại lịch sử, bản ghi thiếu bằng chứng và thay hội thoại. Thêm resetCounts/resetReason không chứa nội dung.
2. **Phục hồi listener** (`utils/zaloAutoReplyService.js`, `scripts/testZaloAutoReplyIntegration.js`): chỉ phục hồi các tài khoản đã chủ động kết nối, chỉ khi browser còn mở và cấu hình bật. Chờ/retry 5/10/20/30 giây, không tự mở browser. Chống nhiều lượt start chồng nhau và callback từ cấu hình cũ.
3. **Quan sát runtime** (`utils/zaloAutoReplyRuntime.js`, `utils/zaloWebExperimental.js`, `public/js/zaloAutoReply.js`, `public/app.html`): lưu snapshot nguyên tử trong `data/zalo-auto-reply-runtime`. Chỉ mã trạng thái, thời điểm, bộ đếm và mã lý do cố định; không tên/SĐT/nội dung khách, token hay error.message tùy ý. App hiển thị lần đọc cuối, số tin đọc được, đủ điều kiện, đã vào queue và HTTP n8n.
4. **Kiểm thử câu hỏi SĐT** (`scripts/testZaloPhoneAutoReply.js`, `package.json`): chạy HTTP local qua listener giả, queue thật, callback raw-body HMAC thật, bộ điều phối n8n giả và sender giả. Các câu đúng phải gọi gửi một lần; ID trùng và câu không khớp không gửi.
5. **Nghiệm thu tài khoản phụ**: cần server nạp code mới và người dùng đăng nhập cửa sổ Zalo do app quản lý. Chờ đến mốc thời gian app hiển thị, nhắn một câu mới từ liên hệ đã allowlist, đối chiếu runtime/queue/execution và tin thực tế.

## Điều kiện nghiệm thu

- Không coi 54 bài test hoặc HTTP 202 là chứng minh khách đã nhận tin.
- Test offline phải tái hiện được lỗi tự cuộn trước khi sửa và qua sau khi sửa.
- Không tự trả lời lịch sử, tin của shop, tin nhóm hoặc người nhận không khớp.
- Tạm dừng/đổi cấu hình phải ngăn callback cũ; không tự retry một lượt gửi `sending`/`needs_check`.
- Phiên thật đạt khi có tin mới vào queue, n8n nhận execution tương ứng, tin SĐT thực tế xuất hiện đúng hội thoại, không trùng.
- Nếu chưa thể kiểm tra phiên đăng nhập thật, ghi rõ còn thiếu nghiệm thu thực tế, không ghi đã xong đầu cuối.

## Trạng thái triển khai

- Đã sửa lỗi bám đáy và thêm hồi phục/runtime.
- `npm.cmd test`: 54/54 đạt, gồm sáu câu hỏi SĐT qua toàn bộ HTTP giả lập và kiểm tra replay/không khớp.
- DOM Edge: 156 fixture đạt, gồm hai ca tự cuộn tái hiện lỗi trước sửa; adapter: 22 ca đạt; hồi quy DOM/báo giá cũ đạt.
- Giao diện: 4 trường hợp sáng/tối 390/1440px và 192 kiểm tra responsive cũ đạt. App hiện có dòng số liệu reader và tự thử lại, không chỉ báo browser mở.
- Không bật QR thay chủ shop hoặc thay nội dung SĐT đã lưu. Không thay workflow báo giá.
- Đã theo dõi thư mục runtime trong 90 giây: chưa có snapshot từ phiên kết nối chạy mã mới. Tiến trình server được kiểm tra đang khởi động trước thời điểm lưu bản sửa service/adapter mới nhất. Chưa có bằng chứng gửi SĐT thực tế; cần nạp lại server, kết nối và gửi một tin mới từ tài khoản thử.
- Khi kết nối bản mới, trạng thái an toàn được ghi vào `data/zalo-auto-reply-runtime/<mã-shop-băm>.json`; có thể xác định listener chờ đăng nhập, số tin bị bỏ qua, queue hoặc lỗi HTTP n8n mà không cần thêm báo cáo DOM chứa cấu trúc.
