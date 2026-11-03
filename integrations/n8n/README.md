# Thông báo n8n cho Tikoder

Phần gửi sự kiện trong Tikoder mặc định tắt. Khi `NOTIFY_ENABLED=true`, mỗi báo giá mới tạo phát sinh sự kiện `quote.pending_approval`, lưu cùng file hàng chờ báo giá. Ứng dụng thử lại tối đa 5 lần khi kết nối lỗi, HTTP 408, 429 hoặc 5xx; HTTP 4xx khác được xem là lỗi cuối. Sự kiện hoàn tất được giữ tối đa 7 ngày và dọn khi hàng đợi tiếp tục xử lý. Một lần nhận lại cùng `eventId` là có thể xảy ra nếu phản hồi bị mất; workflow nhận phải chống trùng trước khi gửi thông báo.

Thiết lập các biến trong `.env` của Tikoder theo `.env.example`, khởi động lại Tikoder, và chỉ bật `NOTIFY_ENABLED` sau khi có workflow nhận đã cấu hình đầy đủ. Với n8n ở cùng máy, URL webhook sản xuất có thể là `http://127.0.0.1:5678/webhook/tikoder/event`. Nếu ứng dụng chạy trong Docker, `127.0.0.1` trỏ vào container, không phải máy chủ; cần cấu hình kết nối phù hợp và HTTPS. Không lưu bí mật trong workflow xuất ra repo.

Webhook nhận phải kiểm tra header `X-Tikoder-Token` bằng Header Auth, kiểm tra `X-Tikoder-Timestamp` lệch không quá 5 phút, xác thực `X-Tikoder-Signature` bằng HMAC-SHA256 trên chuỗi `timestamp + '.' + rawBody` với `N8N_NOTIFY_SECRET`, so sánh an toàn, và chống phát lại bằng `eventId`. Hai bí mật `N8N_HEADER_TOKEN` và `N8N_NOTIFY_SECRET` phải khác nhau, đủ mạnh và được lưu trong credential hoặc cấu hình an toàn của n8n. Chỉ trả 2xx sau khi xác thực thành công. Sự kiện chỉ chứa mã shop băm, số lượng và URL ứng dụng; không có nội dung báo giá hoặc thông tin khách.

Workflow n8n **Tikoder - Zalo thu nghiem qua n8n** đã được publish tại `POST /webhook/tikoder/event` và chuyển sự kiện đã ký về Tikoder. Webhook production đã được kiểm tra; payload kiểm tra không hợp lệ bị Tikoder từ chối như mong đợi. Workflow chưa cấu hình kênh thông báo chủ shop, vì vậy tiếp tục để `NOTIFY_ENABLED=false`. Luồng gửi Zalo thử và điều kiện vận hành được mô tả trong [ZALO_WEB_PLAN.md](ZALO_WEB_PLAN.md). Các worker hiện thiết kế cho một tiến trình Tikoder duy nhất; không chạy nhiều bản cùng ghi chung thư mục dữ liệu.

## Cập nhật workflow ngày 24/10/2026

Workflow hiện có ID `jzJwwSTD9yUgEgPr`, được cập nhật trực tiếp qua API n8n và publish lại, không tạo webhook trùng.

- Webhook giữ Header Auth và Raw Body, chuyển sang phản hồi bằng node Respond to Webhook.
- HTTP Request chuyển nguyên body và các header HMAC về Tikoder, lấy cả HTTP status/body, không ném lỗi với phản hồi HTTP 4xx/5xx, không theo redirect, timeout 8 giây và không tự retry trong n8n.
- Nhánh phản hồi HTTP đi đến **Respond - Tikoder**, trả nguyên status và JSON body của Tikoder. `202 accepted` chỉ xác nhận đã nhận xử lý, không xác nhận Zalo gửi thành công.
- Nhánh lỗi kết nối/timeout đi đến **Respond - Connection Error**, trả `503` và cảnh báo kết quả gửi chưa rõ. Không tự suy luận rằng chưa gửi hoặc tự gửi lại.
- Execution của n8n có thể được đánh dấu thành công dù trả 4xx/5xx vì workflow đã xử lý lỗi có chủ đích. Kiểm tra `statusCode` của HTTP Request và nhánh Respond, không chỉ màu trạng thái execution.
- Worker Zalo quyết định thử điều phối lại dựa trên trạng thái delivery còn `queued`, không dựa vào HTTP status. Sau claim, tiếp tục giữ cơ chế `sending`/`needs_check` và không tự gửi lại.

Đã kiểm tra webhook production bằng chữ ký HMAC cố ý sai: nhận `401` với nội dung `Xác thực thất bại` từ Tikoder. Không gửi event hợp lệ và không gửi tin Zalo thật trong lượt kiểm tra này. Chưa kiểm tra thực tế nhánh mất kết nối/timeout; không dừng Tikoder đang chạy để mô phỏng lỗi.

Script `configure-workflow.js` lưu bản sao cấu hình cũ trong thư mục tạm của hệ điều hành (không chứa pinData), cập nhật/publish workflow và kiểm tra phản hồi từ chối. Script đọc API key tạm từ stdin; không ghi key vào file. Phần kiểm tra webhook dùng header xác thực từ dữ liệu thử đã ghim nếu có; nếu không, script bỏ qua phần kiểm tra đó. Không chia sẻ pinData hoặc execution chứa header xác thực. Thu hồi API key đã chia sẻ sau khi cấu hình xong. Tiếp tục giữ `NOTIFY_ENABLED=false`; chưa thêm kênh cảnh báo ngoài n8n.
