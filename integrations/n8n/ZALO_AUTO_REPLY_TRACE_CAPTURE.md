# Thu bằng chứng trước khi sửa tiếp auto-reply

## Trạng thái lần triển khai này

Đã bổ sung ghi vết chẩn đoán, chưa thay đổi quyết định đủ điều kiện hoặc nới guard gửi. Workspace hiện tại có thư mục data trống và phiên agent không có công cụ terminal. Không có bằng chứng để xác nhận server đang chạy bản mới, n8n khả dụng hoặc Zalo gửi thành công. Không khôi phục cấu hình/mẫu/profile từ trí nhớ hoặc tự tạo cấu hình thử trên dữ liệu thật.

## Mã đã bổ sung

- Tracker lưu tối đa 24 sự kiện append/reset trong mỗi vòng đời tracker, mỗi sự kiện tối đa 8 bản tóm tắt mutation.
- Sự kiện được ghi trước lúc reset xóa ứng viên, gồm thời điểm, epoch, mã lý do, số ứng viên, số hàng trước/sau, trạng thái ở đáy và tổng số mutation.
- Mutation chỉ có loại, vai trò vùng, loại thuộc tính cố định và số node thêm/xóa. Không có giá trị thuộc tính, class tùy ý, ID, text, số điện thoại, cookie, token hoặc DOM thô.
- Runtime dựng lại từng trường qua allowlist, không serialize dữ liệu adapter tùy ý. Trace nằm tại runtime.reader.trace trong API trạng thái và file Xuất kiểm tra DOM hiện có.
- reader.implementation bằng observed-dom-mutation-trace-1 xác nhận bộ nhận có instrument. Đây chỉ là dấu hiệu mã reader, không phải health của n8n hay chứng minh gửi thành công.
- UI hiển thị bản có ghi vết và số ứng viên trước reset mới nhất. Trace không cấp quyền gửi hoặc tự phát lại tin cũ.

## Kiểm thử cần chạy trước khi triển khai

Tại đúng project đang dùng trên máy Zalo:

```sh
npm test
npm run test:zalo-dom
npm run test:zalo-ui
```

Đã thêm test cho trace append trước reset, ứng viên trước khi bị xóa, giới hạn bộ nhớ, sao chép snapshot độc lập và loại bỏ trường dữ liệu riêng tư/giá trị không hợp lệ. Chưa chạy các test này trong phiên agent hiện tại vì không có terminal. Diagnostics editor không thay thế chạy test.

## Một lượt thu bằng chứng thật

1. Xác định đúng process/cwd app và endpoint n8n trong cấu hình hiện có. Không thay credential hoặc gọi workflow báo giá jzJwwSTD9yUgEgPr.
2. Sau khi kiểm thử đạt, chọn thời điểm an toàn nạp backend mới; giữ nguyên data, mẫu, profile và allowlist. Không chạy workspace data trống như thể đó là môi trường thật.
3. Đăng nhập/kết nối qua UI có xác thực. Kiểm tra dòng Bộ nhận có ghi vết mutation trước khi gửi thử.
4. Giữ nguyên hội thoại đang theo dõi. Tài khoản phụ gửi đúng một sdt mới, ghi lại giờ gửi. Không reconnect hoặc restart trong lúc thu.
5. Ngay sau lỗi, bấm Xuất kiểm tra DOM. File này chứa runtime đã sanitize, gồm reader.trace; xuất sớm vì ring chỉ giữ 24 sự kiện. Bản thân xuất báo cáo không tìm/chọn lại liên hệ hoặc reset tracker.
6. Đối chiếu append -> reset: timestamp, reason, candidatesBefore, rowsBefore/rowsAfter, mutations.kind/region/attribute và mutationCount. mutationCount lớn hơn 8 nghĩa là batch bị cắt phần tóm tắt; không giả định đã có đủ mọi mutation.
7. Nếu không có trace append nhưng số hàng tăng, xem batch reset tương ứng. Nếu timestamp không đủ, thu cấu trúc đã ẩn dữ liệu của vùng time/date; không suy giờ từ qid hoặc giờ hiện tại.
8. Chỉ viết bản sửa tracker sau khi xác định được quy tắc và biến đổi DOM thật. Dùng chuỗi đó làm regression trước/sau sửa.

## Cổng nghiệm thu tiếp theo

Sau khi reader tạo được một queued event thật, mới kiểm tra event đi qua workflow auto-reply riêng, callback signed-command, thao tác gửi mẫu và tin thực tế. HTTP cũ, HTTP 202, trạng thái monitoring hoặc test offline không đủ làm bằng chứng hoàn thành. Nghiệm thu SĐT hai lần sau cooldown không duyệt thủ công; QR nghiệm thu riêng khi ảnh/quy tắc đã được chủ shop cấu hình.
