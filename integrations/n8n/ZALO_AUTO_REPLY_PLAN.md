---
title: Kế hoạch TikTokOrder kết hợp n8n tự trả lời Zalo
created: 2026-10-24
status: dang-trien-khai
tags: [tikoder, tiktokorder, n8n, zalo, auto-reply]
---

# TikTokOrder + n8n: tự trả QR và số điện thoại

## Quyết định

Chỉ chạy TikTokOrder (Node.js) và n8n trên cùng máy. Không chạy Python, không phụ thuộc app zalo-n8n-bot. Giữ workflow báo giá hiện có; tạo workflow riêng cho auto-reply. Zalo Web là thử nghiệm không chính thức, có nguy cơ mất phiên hoặc hạn chế tài khoản.

## Phân chia trách nhiệm

- TikTokOrder: giữ phiên Edge/Zalo Web riêng theo tài khoản; nhận tin, lưu hàng đợi bền vững, chống trùng, giữ mẫu SĐT/ảnh QR, kiểm tra người nhận và thao tác gửi.
- n8n: nhận sự kiện có xác thực, chọn nhánh QR/SĐT/chờ xử lý và yêu cầu app gửi đúng mẫu đã lưu.
- Payload sự kiện chỉ chứa mã shop băm, mã tin/mã sự kiện và thời điểm. Không chuyển nội dung hội thoại, số điện thoại, tên khách hoặc ảnh QR sang lịch sử n8n.
- Callback chỉ định mã tin và mã mẫu; app tự xác định lại người nhận, nội dung và trạng thái. Không cho n8n truyền tùy ý nội dung thanh toán hoặc người nhận.

## Luồng

Khách nhắn Zalo -> TikTokOrder đọc tin riêng mới -> lưu/chống trùng -> webhook n8n -> app xác thực và trả mã mẫu khớp -> Switch QR/SĐT/chờ xử lý -> callback app -> claim trước khi gửi -> gửi qua cùng khóa trình duyệt với báo giá -> ghi cần kiểm tra.

## Giao diện

Thêm mục Zalo tự động trong TikTokOrder, gồm cấu hình bật/tắt, người nhận thử (SĐT và tên Zalo chính xác), thời gian chống lặp, mẫu SĐT, từ khóa, ảnh QR/chú thích, kết nối, tạm dừng và nhật ký. Mặc định tắt; không tự bật khi tải trang. Không lấy dữ liệu thanh toán từ AI hoặc tự sao chép mẫu từ app khác.

## An toàn bắt buộc

- Bản đầu: một shop, một người nhận thử trong allowlist; chỉ theo dõi hội thoại riêng đã được đối chiếu số và tên. Không hứa đọc được mọi inbox, tin nhóm hoặc lời mời người lạ.
- Thiết lập mốc tin hiện có khi bắt đầu theo dõi; không tự trả lời lịch sử.
- Bỏ qua tin shop gửi. Chỉ nhận tin có định danh ổn định và xác định chắc chắn chiều nhận. DOM không nhận diện được thì dừng, không đoán.
- Từ khóa được chuẩn hóa dấu/hoa thường; một mẫu rõ ràng mới được tự gửi. Nhiều mẫu hoặc không khớp -> chờ xử lý.
- Giới hạn trả cùng mẫu trong cùng hội thoại; chặn nếu có lượt gửi chưa kiểm tra.
- Mọi thao tác nhận/gửi dùng chung khóa với luồng báo giá để không đổi nhầm hội thoại.
- Claim được lưu trước thao tác gửi. Timeout, lỗi hoặc restart trong lúc gửi -> cần kiểm tra, không tự gửi lại. HTTP 202 không có nghĩa gửi thành công.
- Đổi cấu hình/tắt tự động làm vô hiệu lệnh chưa claim. Sau claim vẫn kiểm tra lại trước khi thao tác gửi.
- API giao diện yêu cầu phiên đăng nhập, cùng origin và máy cục bộ. Callback n8n yêu cầu HMAC, thời gian, loại thao tác riêng và chống phát lại bằng trạng thái tin.
- Ảnh upload kiểm tra chữ ký PNG/JPEG, kích thước tối đa 5MB, lưu ngoài public; xác thực digest trước gửi.

## Các bước triển khai

1. Lưu kế hoạch vào Obsidian và repo.
2. Kho cấu hình/hàng đợi theo tài khoản, test offline.
3. Giao diện cấu hình và nhật ký.
4. Bộ nhận tin Zalo Web thận trọng, baseline/chống trùng và báo khả năng DOM chưa hỗ trợ.
5. Worker điều phối và API HMAC riêng; workflow n8n QR/SĐT/chờ xử lý.
6. Gửi SĐT và ảnh QR bằng cùng bộ kết nối trình duyệt.
7. Kiểm thử giả lập, cách ly shop, cấu hình tắt, cooldown, replay, restart và giao diện sáng/tối/mobile.
8. Publish workflow nếu API key còn hiệu lực; không bật auto-reply thật hoặc tự gửi tin cho khách trong lúc triển khai.

## Điều kiện nghiệm thu thực tế

Cần đăng nhập cửa sổ Zalo do TikTokOrder quản lý, điền SĐT/QR thật do chủ shop xác nhận, chọn đúng người nhận thử, bật theo dõi và gửi câu hỏi mới từ tài khoản thử. Xác minh đúng chiều tin, không xử lý lịch sử, đúng ảnh/nội dung và không gửi trùng. Nếu DOM thực tế chưa được xác minh thì phải ghi rõ chưa đạt live, không ghi đã hoàn tất tự động hóa đầu cuối.

## Nhật ký thực hiện 24/10/2026

### Đã triển khai

- Giao diện Zalo tự động trong TikTokOrder: lưu mẫu SĐT, từ khóa, cấu hình liên hệ thử, tải/xem ảnh QR, tạm dừng, nhật ký và xác nhận thủ công.
- Kho JSON nguyên tử theo tài khoản, mặc định tắt, allowlist, revision cấu hình, chống trùng, cooldown, claim bền vững, phục hồi `sending` thành `needs_check`. Cách ly file shop lỗi để không làm app ngừng khởi động.
- API giao diện yêu cầu login/cùng origin/local; callback riêng HMAC trên raw body. Sự kiện n8n không chứa thông tin khách. Inspect sinh lệnh có chữ ký riêng, chỉ chọn mã mẫu và mã tin.
- Worker n8n riêng và workflow **TikTokOrder - Zalo auto reply** đã publish trực tiếp. Workflow báo giá cũ vẫn active, không thay đổi. Chưa gửi event hợp lệ lên workflow mới trong lúc triển khai.
- Chia sẻ khóa trình duyệt với gửi báo giá. Giữ đường gửi báo giá cũ tương thích; không ép luồng báo giá phải đáp ứng DOM inbox mới.
- Test: `npm.cmd test` đạt 36/36; Edge offline cho giao diện mới (4 trường hợp sáng/tối, 390/1440px), bộ nhận tin giả lập, khóa thao tác, race khi tạm dừng và kiểm tra tương thích gửi báo giá; bài responsive cũ đạt 192 kiểm tra.

### Chưa hoàn tất / không được coi là chạy thật

- Bộ nhận tin chỉ mới được kiểm thử trên DOM giả lập có bằng chứng riêng tư/chiều nhận/mã tin/lịch sử đã tải xong/live timestamp. **Chưa xác minh Zalo thật có cung cấp bằng chứng này**, không tự thêm thuộc tính hoặc đoán selector để vượt kiểm tra.
- `sendImage` hiện từ chối trước mọi thao tác upload/gửi: **chưa có tự gửi QR hoạt động thực tế**. Tải ảnh trong app chỉ là lưu cấu hình, không biến thành hỗ trợ gửi ảnh.
- Chưa bật auto-reply, chưa gửi tin cho khách thật, chưa kiểm thử đầu cuối qua Zalo.
- Chưa tự dừng/khởi động lại server đang chạy để tránh mất phiên live/Zalo. Cần chủ ứng dụng khởi động lại TikTokOrder vào lúc phù hợp để nạp các route backend mới; chỉ Ctrl+F5 không nạp được code server.

### Bước tiếp theo để lấy bằng chứng DOM

1. Khởi động lại TikTokOrder, tải lại app, mở mục Zalo tự động; tiếp tục giữ tự động tắt.
2. Bấm Kết nối / Bắt đầu để mở cửa sổ Zalo riêng, đăng nhập và mở hội thoại thử.
3. Bấm **Xuất kiểm tra DOM** để tải `tikoder-zalo-dom-diagnostics.json`. Báo cáo chỉ có cấu trúc tag/class và tên thuộc tính, loại nội dung tin, giá trị thuộc tính, URL và định danh đầy đủ; không đọc cookie/storage.
4. Dùng báo cáo đã kiểm tra để đối chiếu DOM thật. Có thể vẫn cần khảo sát trực tiếp chiều tin, tải lịch sử và giao diện upload ảnh. Không gửi mật khẩu, cookie hoặc session Zalo.
5. Chỉ tiếp tục bật nhận/gửi khi xác minh được bằng chứng thực tế và kiểm thử với tài khoản phụ. Nếu DOM không đủ bằng chứng, giữ tính năng dừng thay vì hứa tự trả đầy đủ mọi inbox.

### Các file chính

`utils/zaloAutoReplyStore.js`, `utils/zaloAutoReplyService.js`, `utils/zaloWebExperimental.js`, `utils/zaloInboxDom.js`, `utils/zaloDomDiagnostics.js`, `routes/zaloAutoReply.js`, `public/js/zaloAutoReply.js`, `public/css/zalo-auto-reply.css`, `public/app.html`, `server.js`, `integrations/n8n/zalo-auto-reply.workflow.json`.

Không lưu API key n8n hoặc bí mật trong ghi chú này. Thu hồi key đã gửi trong chat sau khi hoàn tất thao tác API; workflow không cần key đó để tiếp tục chạy.
