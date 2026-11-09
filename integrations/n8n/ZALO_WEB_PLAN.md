# Kế hoạch gửi báo giá qua n8n và Zalo Web (thử nghiệm)

## Luồng

1. Chủ shop đăng nhập Tikoder, mở **Kết nối tài khoản Zalo thử** và tự đăng nhập tài khoản Zalo phụ trong cửa sổ trình duyệt riêng của shop.
2. Chủ shop xác nhận khách đã đồng ý nhận báo giá, kiểm tra số thử, nội dung và chọn **Duyệt và gửi thử qua n8n**. Nhập đúng tên hiển thị Zalo để đối chiếu.
3. Tikoder ghi báo giá và yêu cầu gửi vào cùng file của shop; chỉ cho phép số trong `ZALO_TEST_PHONES`. Worker gửi webhook n8n, ký HMAC và Header Auth. Payload chỉ chứa mã sự kiện, mã shop băm và mã lần gửi; không có số điện thoại, tên, hoặc nội dung.
4. Workflow Webhook → HTTP Request trong n8n chuyển nguyên nội dung và header về `/api/integrations/n8n/verify`. Tikoder kiểm tra HMAC và thời gian, tìm bản ghi theo shop và mã sự kiện, rồi chuyển `queued` → `sending` trước khi mở hội thoại. Lần nhận lặp chỉ trả trạng thái hiện tại, không thao tác gửi lần nữa.
5. Adapter tìm số chính xác và đối chiếu tên trong kết quả lẫn cửa sổ chat, kiểm tra lại sự đồng ý ngay trước khi bấm gửi. Sau thao tác hoặc khi có lỗi không rõ kết quả, trạng thái là `needs_check`; chủ shop kiểm tra Zalo rồi bấm **Đã gửi** hoặc **Bỏ qua**.

## An toàn và vận hành

- Chỉ thử cục bộ, một tiến trình Tikoder, một tài khoản Zalo phụ và các số đã cho phép. Thử trên tài khoản không được phép hoặc thiếu đồng ý sẽ bị chặn.
- Trình duyệt thử dùng thư mục riêng trong `data/zalo-profiles`; thư mục này chứa phiên đăng nhập nhạy cảm, cần bảo vệ như mật khẩu và không chia sẻ hoặc commit.
- Đóng cửa sổ Zalo khi không thử. Tắt `ZALO_WEB_EXPERIMENTAL` và khởi động lại Tikoder để dừng. Dừng n8n không làm mất hàng chờ; các yêu cầu chưa được nhận thử lại tối đa năm lần, sau đó báo lỗi điều phối.
- Nếu Tikoder ngừng giữa lúc `sending`, khi khởi động lại mục đó chuyển sang `needs_check`; không tự gửi lại. Hủy hoặc sửa yêu cầu `queued` sẽ ngăn claim; không sửa/hủy khi kết quả đang mơ hồ.
- Zalo Web là giao diện không chính thức; bố cục hoặc cách gửi có thể thay đổi. Kết quả được giữ ở `needs_check`, không tự khẳng định thành công hoặc tự thử lại khi chưa kiểm tra. Không dùng cho khách thật cho đến khi kiểm thử phù hợp và được quyết định triển khai riêng.

## Cấu hình và kiểm thử

`N8N_WEBHOOK_URL`, `N8N_HEADER_TOKEN`, `N8N_NOTIFY_SECRET`, `ZALO_WEB_EXPERIMENTAL`, `ZALO_TEST_PHONES` được cấu hình trong `.env`; tùy chọn `ZALO_BROWSER_PATH` chỉ tới trình duyệt tương thích. Workflow **Tikoder - Zalo thu nghiem qua n8n** đã được publish tại `POST /webhook/tikoder/event`; nó dùng Header Auth, Raw Body và chuyển yêu cầu đã ký về Tikoder. Lượt thử với payload không hợp lệ xác nhận production webhook đến được Tikoder và bị từ chối ở bước kiểm tra nội dung. Phần thông báo chủ shop `NOTIFY_ENABLED` không cần bật.

Kiểm thử tự động bao gồm chữ ký, chống gửi lặp, cách ly shop, đồng ý và payload tối thiểu. Kiểm tra webhook production đã qua n8n và đến Tikoder; lượt kiểm tra cố ý dùng event không hợp lệ nên không gửi tin. Kiểm thử gửi đầu cuối còn cần đăng nhập Tikoder, mở phiên Zalo phụ trong cửa sổ do Tikoder quản lý và duyệt một báo giá thử tới số trong allowlist. Kiểm tra trạng thái và tin thực tế trên Zalo; không đánh dấu thành công chỉ vì webhook phản hồi 2xx.
