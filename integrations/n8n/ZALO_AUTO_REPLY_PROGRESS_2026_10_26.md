# Zalo auto-reply + n8n: cập nhật 26/10/2026

Tài liệu này thay phần hướng dẫn chờ sang phút và duyệt từng kết quả trong nhật ký 25/10. Đây là triển khai mã và kiểm thử offline, chưa phải nghiệm thu Zalo thật.

## Lần sửa tiếp sau nghiệm thu thất bại lúc 05:32

Bằng chứng runtime thật: đọc được 24 tin (22 tin khách), ingested=0, outside-history-mutation=28, baseline-mutation=4. HTTP n8n=200 là số liệu cũ, không chứng minh có gửi mới. Không quy nguyên nhân cho cooldown khi tin chưa vào queue.

Plan đã thông báo và thực thi:

1. Bỏ tìm kiếm/chọn lại liên hệ mỗi poll. Sau khi chọn đúng số/tên, giữ proof của root/editor/history và các node/ID tin. Mỗi lượt chỉ đọc và kiểm tra proof trước/sau snapshot. Mất proof thì dừng epoch; supervisor xác minh lại và tạo baseline mới, không chuyển ứng viên cũ qua người nhận cùng tên.
2. Theo dõi thay đổi row/frame đến sau lúc kết nối, kể cả hội thoại ban đầu rỗng. Pause trong lúc cấp proof sẽ dispose handle đến muộn.
3. Tái hiện offline việc nhóm tin chỉ để timestamp ở tin cuối: xóa/ẩn timestamp tin trước làm reset baseline hoặc candidate-proof. Thêm ngoại lệ hẹp cho prior-tail presentation suppression đi kèm một inbound append có đủ ID và giữ nguyên node/nội dung/chiều tin. Baseline không trở thành ứng viên.
4. Giữ nguyên timestamp đã chứng minh của ứng viên khi grouping hợp lệ; bỏ fallback dùng giờ hiện tại/lớp version hoặc giờ của hàng xóm không có bằng chứng cùng nhóm. Tin thiếu hoặc có giờ mâu thuẫn vẫn không gửi. Chưa có bằng chứng rằng mọi hình thức grouping thực tế đều được hỗ trợ.
5. Runtime/UI thêm observationStartedAt chính xác, trackerEpoch, atBottom, candidateCount, resetReason và bộ đếm baseline/untracked/duplicate/future. Dữ liệu chẩn đoán không chứa tên, SĐT, nội dung, DOM thô hoặc token.

Kiểm thử mới nhất: npm test 57/57; live inbox 271; live adapter 61; ảnh 79; UI 4 sáng/tối mobile/desktop. Adapter có một test nối DOM Edge -> queue thật -> Inspect/command ký HMAC qua n8n giả lập -> adapter gửi text thật trên fixture -> echo được xác nhận, hai lần không resolve thủ công. Các test khác chặn đổi peer cùng tên, pause/race, baseline/ID/timestamp giả và gửi trùng. Chưa có xác nhận gửi thành công trên tài khoản Zalo thật.

Server sau đó được restart theo yêu cầu, từ PID 11548 sang PID 5860 để nạp mã mới. Đóng đúng browser Zalo con do server quản lý, giữ profile/mẫu/settings; không đụng tiến trình n8n hoặc workflow báo giá. Session app và kết nối in-memory cần chủ shop đăng nhập/kết nối lại. Không tự phát lại các tin sdt đã có trước baseline.

Các mục bên dưới ghi lại đợt sửa ban đầu; số test và trạng thái restart ở trên là cập nhật mới nhất.

## Phạm vi đã sửa

- Kiểm tra tạo/xóa file và terminal trước khi sửa; Node.js v26.7.0. Sửa tiền tố `nhưng` làm package.json không hợp lệ.
- Tracker bỏ qua thay đổi class focus/hover/highlight đã nhận diện, vẫn reset khi đổi cấu trúc, ID, chiều tin hoặc nội dung không xác minh được.
- Cập nhật chữ biên nhận trên tin đi cũ chỉ được bỏ qua khi giữ nguyên giờ, node, ID và chiều tin; không làm mất ứng viên mới. Thay giờ/nội dung/markup lạ vẫn reset.
- Tin khách được nối thêm ở cuối, có ID/node mới và giờ bằng phút bắt đầu có thể đủ điều kiện ngay; không phải chờ sang phút. Tin đã có ở baseline, skeleton baseline, tin shop, giờ tương lai, ID lặp và lịch sử trước phút bắt đầu vẫn bị loại.
- Adapter gửi đúng mẫu text/QR đã lưu. Không tự đổi nội dung, bật quy tắc, đổi ảnh, mở rộng danh sách người nhận hoặc sửa credentials.
- Text từ chối bản nháp/tệp đính kèm/hộp thoại có sẵn trước khi điền và tại sự kiện Enter cuối. Không tự retry thao tác gửi.
- `sent` chỉ được ghi khi thấy một tin đi mới khớp trong hội thoại đã bảo vệ, ô soạn/preview đã trống và biên nhận rõ `Đã gửi`, `Đã nhận` hoặc `Đã xem`. QR còn yêu cầu byte ảnh local echo khớp ảnh đã lưu. Đây là bằng chứng giao diện, không phải chứng thực API hay cam kết khách đã đọc.
- Tin đang chờ gửi, lỗi, không có biên nhận rõ, QR remote-only hoặc ảnh đã bị biến đổi vẫn là `needs_check`. Không tự gửi lại event đó.
- `needs_check` cũ không khóa cả hội thoại. Tin mới có event/ID mới vẫn được xử lý; `sending` đang hoạt động chặn chồng thao tác và cooldown theo người nhận/quy tắc vẫn giữ nguyên. Không cần duyệt từng tin đã được xác nhận.
- Service nhận kết quả adapter để lưu `sent`/`needs_check`; runtime có `send_confirmed`. UI phân biệt tự xử lý và trường hợp cần kiểm tra.

## n8n và báo giá

Giữ nguyên workflow auto-reply hiện có: webhook riêng -> Inspect -> Allow Signed Command -> Send Signed Command. Không cần thêm node duyệt từng tin. HMAC raw body, tenant, revision, chống replay và claim bền vững vẫn do app kiểm soát. HTTP 202 chỉ nghĩa là nhận xử lý.

Không chạy installer hay API quản trị n8n trong lần sửa này. Không sửa/activate/deactivate/execute workflow báo giá `jzJwwSTD9yUgEgPr`. Hàm quote `send()` giữ nguyên. Không restart server đang chạy hoặc mở phiên Zalo thật.

## Kiểm thử

- `npm test`: 56/56 đạt, gồm hồi quy báo giá, store/service và HTTP n8n giả lập. Sáu câu SĐT được xử lý liên tiếp mà không gọi resolve thủ công.
- `npm run test:zalo-dom`: đạt cả bộ DOM cũ, 212 fixture live inbox và 56 kiểm tra adapter.
- `npm run test:zalo-image`: 79 kiểm tra Edge offline đạt.
- `npm run test:zalo-ui`: 4 kịch bản sáng/tối ở 390/1440px đạt. Lượt chạy chung image + UI ban đầu hết 120 giây sau 3 kịch bản UI; chạy lại UI riêng đã đạt đủ 4.
- `git diff --check`: đạt với file đã được Git theo dõi; nhiều file tích hợp vẫn chưa được track từ trước phiên sửa.
- Diagnostics editor: không lỗi/cảnh báo.

Mọi gửi trong test đều dùng fixture hoặc sender giả; không liên hệ n8n thật hoặc gửi Zalo thật.

## Giới hạn quan trọng: tin cùng phút

DOM hiện tại không có server watermark hay tín hiệu arrival đã xác thực. Một tin lịch sử chưa từng mount, cùng phút bắt đầu, xuất hiện dưới dạng append cuối với ID mới có thể không phân biệt được với tin vừa nhận. Kiểm tra node/ID/append chỉ chứng minh nó mới xuất hiện trong DOM, không chứng minh thời điểm server nhận tin. Không được mô tả bản sửa là bảo đảm tuyệt đối không trả lời lịch sử cùng phút.

Không dùng qid làm timestamp hoặc tự thêm thuộc tính fixture để giả bằng chứng. Cần kiểm thử tài khoản phụ khi mở lại hội thoại/tải chậm/reconnect; nếu Zalo thực tế có tín hiệu nạp lịch sử hoặc arrival đáng tin cậy, phải thu thập cấu trúc đã ẩn dữ liệu và bổ sung guard/test. Muốn bảo đảm tuyệt đối cần nguồn sự kiện có timestamp/watermark tin cậy; chỉ thay toán tử cutoff không đủ.

## Nghiệm thu thực tế tiếp theo

1. Chủ shop chọn thời điểm an toàn để restart server bằng `npm start`, tải lại app. Không chỉ refresh trang vì backend cần nạp mã mới.
2. Kiểm tra đúng liên hệ trong allowlist, mẫu SĐT, QR đã lưu và quy tắc muốn bật. Không nhập mẫu mặc định thay nội dung shop.
3. Kết nối / Bắt đầu và chờ trạng thái theo dõi. Gửi `sdt` từ tài khoản phụ ngay cùng phút, đối chiếu queue, n8n execution và đúng một tin thực tế trong đúng hội thoại.
4. Gửi `QR` với ảnh/quy tắc đã bật. Sau cooldown gửi yêu cầu SĐT mới, không bấm duyệt tin trước. Không yêu cầu gửi lại event cũ.
5. Thử mất kết nối/trạng thái đang gửi: event chưa rõ giữ `needs_check`, không retry; event mới sau cooldown không bị khóa bởi event cũ.
6. Kiểm tra tải lịch sử muộn cùng phút như giới hạn phía trên trước khi dùng với khách thật. QR remote-only/biên nhận khác cấu trúc hiện hỗ trợ cần kiểm tra riêng.

Chưa xác nhận server đang chạy đã nạp mã mới, n8n production thực thi bản này hoặc khách thật đã nhận tin.
