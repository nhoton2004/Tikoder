# Plan chốt v2 — phục hồi live sau sự cố

Trạng thái: bàn giao cho AI coding, **chưa triển khai**. Ngày: 04/11/2026.

Cập nhật theo yêu cầu triển khai tiếp theo: code đã được thực hiện trong working tree; xem [báo cáo triển khai và giới hạn kiểm chứng](2026-11-04-live-crash-recovery-v2-implementation.md). Phần bên dưới giữ nguyên nội dung kế hoạch đã chốt.

Tài liệu này chốt yêu cầu phục hồi sau sự cố. Không thực thi migration, sửa dữ liệu thật, chạy server hay triển khai trong lượt bàn giao. Giữ nguyên các thay đổi có sẵn trong working tree. Khi có mâu thuẫn về crash recovery với `plan_live_session.md`, áp dụng yêu cầu v2 này; giữ nghiệp vụ lượt live/lịch sử cộng dồn đã thống nhất ở các phần khác.

## 1. Bằng chứng trong code hiện tại

Các tên hàm dưới đây là mốc tìm kiếm, không phụ thuộc số dòng:

| Vị trí | Hiện trạng cần xử lý |
| --- | --- |
| `utils/liveSessionStore.js`: `atomicWrite()` | Ghi đồng bộ, dùng chung hậu tố `.tmp`, rename đồng bộ; chưa fsync, retry hay phục hồi JSON hỏng. |
| `writeUserSessions()` | Ghi nguồn rồi gọi trực tiếp `writeHistoryIndexes()` và `archiveOldIndexes()`. Lỗi index có thể bị báo như lỗi lưu dù nguồn đã thay đổi. |
| `writeHistoryIndexes()` | Duyệt toàn bộ phiên/đơn, ghi manifest và các file index theo ngày; có xóa file ngày không còn dữ liệu. Chưa có revision để kiểm tra tính hoàn chỉnh. |
| `startLiveSession()` | Nhánh resume thêm segment rỗng và trả `currentSegmentOrders: []`; không dùng nguyên trạng cho phục hồi segment đang mở. |
| `updateLiveSession()` | Chọn segment cuối bằng `.at(-1)`; recovery phải xác định segment đang mở hợp lệ thay vì mặc định lấy phần tử cuối. |
| `server.js`: `getLiveRuntime()`, `sendLiveState()` | Runtime mới rỗng; gửi trạng thái RAM chưa phục hồi nguồn sau restart. |
| `confirm-item`, `onOrderMutation`, `saveSessionDataForUser()` | Đổi RAM trước ghi rồi rollback khi lỗi. Cần chuyển sang trạng thái ứng viên, hàng đợi đọc–sửa–ghi và await commit. |
| `liveSessionOverviewRows()` | Có indexed rows là ưu tiên dùng index; nếu chỉ tách ghi index ra nền sẽ đọc dữ liệu cũ. |
| Các API tạo/xóa/sửa lịch sử, đặc biệt đường gọi `writeUserSessions()` trong `server.js` | Cũng là writer cùng nguồn; phải tham gia cùng hàng đợi, không chỉ sửa Socket.IO. |
| `shutdown()` | Có deadline 25 giây và đóng kết nối; chưa có cơ chế drain hàng đợi commit mới. |
| `public/js/dashboard.js`: `ask-resume-session`, `manualConfirm`, thao tác tạo đơn thủ công | Đang hỏi dùng lại lịch sử gần nhất; retry bình luận giữ requestId trên nút. Cần kiểm tra mọi đường retry, cả tạo đơn thủ công và sửa/xóa. |

Đã xác nhận có ghi lại hàng loạt index. **Chưa có benchmark** chứng minh block 100–300 ms hoặc gây rớt socket; không dùng các kết luận đó trong báo cáo triển khai.

## 2. Ghi nguồn trước ACK

Nguồn chuẩn duy nhất: `data/live-sessions/<userId>.json`.

```text
Thao tác đã xác thực
→ xếp hàng theo user
→ đọc trạng thái mới nhất và kiểm tra phiên trong hàng đợi
→ tạo trạng thái ứng viên
→ commit nguồn chuẩn thành công
→ cập nhật RAM
→ ACK / phát socket
→ đánh dấu index cần cập nhật
```

- Chốt/sửa/xóa chỉ báo thành công sau commit. Lỗi trước commit giữ nguyên trạng thái cũ và trả lỗi rõ ràng.
- Serialize toàn bộ đọc–sửa–ghi theo user, kể cả kiểm tra duplicate và phiên đích. Không lấy snapshot trước khi vào hàng đợi rồi chỉ serialize lệnh ghi. Hàng đợi vẫn xử lý được yêu cầu sau một lỗi commit.
- Một tiến trình duy nhất được quyền ghi kho dữ liệu. Có cơ chế ngăn tiến trình thứ hai trở thành writer; hàng đợi trong RAM không tự bảo vệ được nhiều tiến trình. Script migration/bảo trì phải tuân thủ cùng quyền ghi hoặc chạy khi server đã dừng.
- Giữ requestId qua retry. Chứng cứ chống trùng phải nằm bền vững cùng commit, đủ để nhận biết yêu cầu đã commit sau restart và mất ACK; không chỉ tra RAM. Kiểm tra cả tình huống đơn đã bị xóa rồi yêu cầu tạo cũ được phát lại.
- Chốt thiết kế phạm vi idempotency theo user/thao tác/phiên; cùng requestId với payload khác phải báo xung đột thay vì thực thi lại. Áp dụng cho mọi mutation có retry, không chỉ chốt từ bình luận.
- Khi thực thi trong queue, xác minh user và session/segment đích còn đúng. Yêu cầu cũ tới sau thao tác đóng/tạo phiên mới không được chốt nhầm vào phiên mới.
- Không debounce dữ liệu gốc. Side effect in hóa đơn/thông báo chỉ nằm sau commit; phục hồi và trả kết quả duplicate không phát lại side effect. Không hứa bảo đảm exactly-once cho thiết bị in hoặc dịch vụ ngoài trong phạm vi này.
- Mọi caller của store chuyển sang async phải await và xử lý lỗi, bao gồm API lịch sử và công cụ index; không để response thành công đi trước Promise commit.

## 3. Ghi file an toàn trên Windows

File chính: `utils/liveSessionStore.js`.

1. Dùng I/O bất đồng bộ; tạo file tạm riêng cho mỗi lần ghi, cùng thư mục file đích.
2. Ghi hoàn chỉnh → fsync → đóng handle → rename thay thế. Phân định rõ rename thành công là điểm commit nguồn.
3. Chỉ retry lỗi rename `EPERM`/`EBUSY`, tối đa **5 lần thử tổng cộng**. Chờ bất đồng bộ tăng dần giữa các lần; ghi rõ lịch chờ trong code và test.
4. Không busy-wait, không sleep đồng bộ. Không xóa file đích để ép rename. Không bỏ fsync vì lo khóa file; đóng handle trước rename.
5. Hết lượt thử trả lỗi commit, không ACK thành công; file đích cũ vẫn đọc được. Báo được lỗi quyền kéo dài với mã lỗi, đường dẫn và số lần thử; không coi mọi EPERM là khóa tạm thời.
6. Dọn file tạm theo chính sách an toàn, đóng handle ở cả đường lỗi. Không xóa bản nguồn tốt khi cleanup thất bại.

Giữ bản dữ liệu tốt gần nhất và viết quy trình phục hồi JSON hỏng: kiểm tra JSON/schema, giữ bản hỏng để chẩn đoán, chọn backup đã xác thực; không âm thầm thay dữ liệu hỏng bằng mảng rỗng. Nêu revision đã phục hồi và khả năng backup thiếu commit mới hơn; không báo dữ liệu nguyên vẹn khi chưa đối chiếu. Cơ chế backup không được tạo một lỗi sau điểm commit rồi trả kết quả như nguồn chưa được ghi.

Không tuyên bố chống mất điện tuyệt đối: độ bền còn phụ thuộc filesystem và thiết bị lưu trữ.

## 4. Index nền và đường đọc nhất quán

- Không gọi `writeHistoryIndexes()` hoặc archive trực tiếp trong mỗi lần chốt/sửa/xóa.
- Job nền gộp yêu cầu theo user, chỉ một job ghi index cho user tại một thời điểm. Kết thúc live yêu cầu cập nhật ngay, không chờ cửa sổ gộp thông thường.
- Job lỗi được log/retry riêng; không biến đơn đã commit thành “chưa lưu”. Sau commit không rollback RAM hoặc báo lỗi commit vì index hay side effect thất bại.
- Lưu revision nguồn bền vững trong envelope file nguồn; tăng cùng commit mutation. Lưu revision index đã hoàn tất bền vững; restart đối chiếu và dựng lại index thiếu/cũ/hỏng, không chỉ dựa dirty flag trong RAM.
- Job dựng từ snapshot revision R chỉ được công bố index cho R sau khi hoàn tất. Với index nhiều file, cần cơ chế generation/manifest hoặc tương đương để phát hiện một lần dựng bị dở; không công bố revision mới trên bộ file trộn hoặc thiếu.
- Nếu nguồn đổi trong lúc dựng R, job không được xóa mất yêu cầu cập nhật tiếp theo. Không đánh dấu index bằng revision mới nhất khi thực tế chỉ dựng snapshot R.
- `liveSessionOverviewRows()` và các đường đọc liên quan kiểm tra độ mới/toàn vẹn index. Index chưa theo kịp thì dùng projection từ nguồn chuẩn cho phạm vi tương ứng. Không nối toàn bộ nguồn vào index vì sẽ nhân đôi đơn.
- Index rỗng vẫn có thể hợp lệ, ví dụ sau xóa hết đơn; `rows.length` không phải kiểm tra độ mới. File ngày/manifest cũ và archive không được làm đơn đã xóa hồi sinh.
- Fallback phải giữ cùng ngữ nghĩa lọc ngày, doanh thu và phạm vi phiên/segment; không nạp lại lịch sử legacy như một nguồn chuẩn thứ hai gây trùng.

Giới hạn còn lại: nguồn chứa toàn bộ phiên của user nên mỗi commit vẫn serialize lịch sử. Async filesystem không làm `JSON.stringify()` trở thành bất đồng bộ. Đo với fixture lớn; nếu không đạt yêu cầu thì chuyển nguồn chuẩn sang SQLite transaction, không dùng debounce đơn để che vấn đề.

## 5. Recovery và chặn nối nhầm phiên

Files chính: `server.js`, `public/js/dashboard.js`, `utils/liveSessionStore.js`.

- Khi user đã xác thực truy cập, tìm phiên mở thuộc đúng user trong nguồn chuẩn. Khởi tạo recovery và gửi live-state phải phối hợp với queue để hai socket không phục hồi/ghi đè runtime đồng thời.
- Một phiên mở hợp lệ, chưa stale: phục hồi trạng thái dữ liệu của **đúng segment đang mở**, giữ nguyên session ID, segment ID nếu có, thời gian, order/request/message/event ID và provenance. Không cấp ID/thời gian mới cho các sự kiện đã có.
- `session.orders` là lịch sử cộng dồn; `runtime.confirmedOrders` phục hồi từ segment đang mở, không từ toàn bộ lịch sử.
- TikTok vẫn **disconnected**. Người dùng xác nhận kết nối lại cùng phiên; không tạo segment mới rỗng. Phân biệt rõ recovery segment mở với nghiệp vụ dùng lại lịch sử đã kết thúc để bắt đầu lượt mới.
- Ngưỡng stale cấu hình được, mặc định **12 giờ**, tính từ `lastActivityAt` lưu bền vững. Với dữ liệu cũ, fallback thời gian đơn/segment hợp lệ gần nhất; không dùng giờ restart hoặc giá trị timestamp không hợp lệ để làm phiên có vẻ mới.
- Coding phải ghi rõ hoạt động nào cập nhật `lastActivityAt`; refresh trang/đọc recovery không được âm thầm làm mới độ tuổi phiên. Thiếu thời gian đáng tin cậy hoặc segment mở mơ hồ phải yêu cầu chọn, không đoán là phiên mới.
- Với phiên stale hoặc nhiều phiên mở, bắt buộc hiển thị lựa chọn rõ ràng: **Tiếp tục phiên cũ** hoặc **Đóng phiên cũ, tạo phiên mới**. Chỉ rõ session/segment được chọn; không lấy phần tử đầu/cuối để tự nối. Nếu còn phiên mở khác, không âm thầm đóng hoặc nối chúng.
- Hủy/đóng hộp thoại giữ trạng thái chưa kết nối, không được hiểu thành đồng ý tạo phiên mới.
- Đóng phiên sau sự cố ghi thời điểm người dùng đóng và lý do recovery. **Không tự gán `endedAt = lastOrderTime`**; không giả đây là thời điểm ngắt thực tế.
- Thao tác đóng cũ/tạo mới đi qua queue và commit nguồn, chỉ cập nhật UI thành công sau commit. Yêu cầu phục hồi/chọn phiên phải được kiểm tra lại quyền sở hữu và trạng thái tại thời điểm thực thi.
- Phục hồi chỉ nạp dữ liệu; không tự in hóa đơn, phát lại thông báo hoặc replay event chốt đơn như đơn mới.

## 6. Shutdown là lớp hỗ trợ

- SIGINT/SIGTERM: ngừng nhận mutation mới; drain queue commit trong thời hạn hữu hạn rồi đóng kết nối. Tích hợp với deadline hiện có, có log khi hết hạn.
- Không tự kết thúc phiên vì server restart. Callback đóng kết nối trong shutdown cũng không được vô tình ghi endedAt.
- `uncaughtException`: log và thoát; không cố ghi đè nguồn từ RAM có thể không nhất quán.
- Kill cưỡng bức/mất điện không phụ thuộc shutdown hook. Tính đúng của commit phải đứng độc lập với graceful shutdown.

## 7. Thứ tự thực hiện dành cho AI coding

1. Lập danh sách đầy đủ writer/caller, đường mutation và ACK, retry, in/thông báo. Chốt schema revision, idempotency, lastActivityAt, recovery và quyền ghi một tiến trình; đọc tương thích file cũ, không tự sửa dữ liệu thật để thử.
2. Sửa fixture cho nguồn/index/archive/backup/temp đều nằm trong thư mục test. Fixture lifecycle hiện chỉ thay `DATA_DIR`, nên cần cô lập cả các đường dẫn còn lại trước khi chạy test có ghi index.
3. Triển khai primitive commit Windows và queue transaction theo user; kiểm thử fault injection và concurrent mutations. Chuyển mọi caller sang await, trạng thái ứng viên và ACK sau commit.
4. Tách job index, revision/generation và fallback đọc nguồn trong cùng đợt thay đổi. Kiểm thử crash giữa job và nguồn thay đổi trong lúc job chạy.
5. Thêm phục hồi dữ liệu, lựa chọn stale/nhiều phiên, reconnect giữ segment và UI lỗi/pending; kiểm thử quyền sở hữu và không lặp side effect.
6. Tích hợp shutdown; chạy crash/restart qua child process, test hồi quy, benchmark và kiểm tra thực tế toàn chu trình.

## 8. Checklist nghiệm thu

| Ca kiểm thử | Kết quả bắt buộc |
| --- | --- |
| Commit → kill cưỡng bức → restart | Mọi đơn đã ACK còn nguyên; kill thực sự bỏ qua shutdown hook. |
| Commit xong, mất ACK → retry cùng ID | Một đơn duy nhất, cả sau restart; không in/thông báo lại. |
| Hai mutation cùng user đồng thời | Không lấy chung snapshot cũ gây mất cập nhật; kiểm thử cả sửa/xóa và API lịch sử. |
| Sửa/xóa → restart | Giá trị mới giữ nguyên, đơn đã xóa không hồi sinh qua index/archive hay retry cũ. |
| Rename lỗi tạm rồi thành công | Retry đúng mã lỗi, không quá 5 lần tổng, await backoff, ACK chỉ sau commit. |
| Rename lỗi kéo dài hoặc lỗi ghi/fsync | Không ACK thành công; RAM và file đích cũ giữ nguyên, lỗi rõ ràng. |
| JSON nguồn hỏng | Không thay bằng nguồn rỗng; có backup hợp lệ, báo revision/giới hạn phục hồi. |
| Hai tiến trình writer | Tiến trình thứ hai không được ghi nguồn; không tự phá khóa writer đang sống. |
| Index lỗi hoặc bị kill giữa job → restart | Phát hiện thiếu/cũ/dở, dựng lại và đối chiếu khớp nguồn. |
| Nguồn đổi khi job index đang chạy | Không mất yêu cầu dựng tiếp, không công bố sai revision. |
| Index cũ, thiếu, hỏng hoặc rỗng hợp lệ | Dashboard phản ánh nguồn đúng revision, không nhân đôi, không hồi sinh đơn. |
| Phiên nhiều segment | Phục hồi đúng segment mở, giữ ID/thời gian, không thêm segment rỗng. |
| Stale/multiple open/thiếu timestamp tin cậy | Yêu cầu lựa chọn, không tự nối nhầm hoặc tự đóng theo giờ đơn cuối. |
| Khác user/phiên đã đổi khi queue đang chờ | Không truy cập chéo user hoặc ghi vào phiên mới bằng yêu cầu cũ. |
| Shutdown và exception | Từ chối mutation mới, drain có hạn; restart không đóng phiên, exception không flush RAM. |
| Kiểm tra thực tế | Recovery → xác nhận reconnect → chốt thêm → kết thúc; đúng segment, tổng và lịch sử. |

Kiểm thử mở rộng từ `scripts/testLiveSessionLifecycle.js`, `scripts/testHistoryQuoteEditing.js`, `scripts/testOrderDateAggregation.js`; bổ sung test store/crash/index phù hợp. Sau khi fixture được cô lập và triển khai xong, chạy test mục tiêu rồi `npm test`. Không sửa test chỉ để hợp thức hóa việc mất dữ liệu hoặc đổi nghiệp vụ.

Benchmark trên fixture lớn cô lập: ghi cấu hình máy/filesystem, số phiên/đơn, kích thước JSON, tải đồng thời và hoạt động job index; báo queue wait, thời gian serialize, commit, ACK, độ trễ event loop (phân vị và max). Chốt ngưỡng chấp nhận với yêu cầu vận hành trước khi kết luận đạt/chuyển SQLite. Không đưa số đo giả hoặc quy kết rớt socket khi chưa có bằng chứng.

## 9. Bằng chứng cần bàn giao sau triển khai

- Danh sách file thay đổi và schema tương thích dữ liệu cũ.
- Kết quả test, log crash/restart và đối chiếu nguồn/index theo revision.
- Số đo hiệu năng cùng fixture/cách chạy, giới hạn còn lại và quyết định có cần SQLite.
- Hướng dẫn phục hồi backup, vận hành single writer và rollback có xét commit phát sinh mới.
- Kết quả kiểm tra thủ công phục hồi → reconnect → chốt thêm → kết thúc.

Lượt lập tài liệu này chỉ đối chiếu code và soạn kế hoạch; chưa triển khai, chưa chạy kiểm thử hoặc benchmark và chưa thay dữ liệu thật.
