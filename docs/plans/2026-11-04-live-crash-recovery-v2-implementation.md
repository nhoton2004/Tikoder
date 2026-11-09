# Bàn giao triển khai recovery v2

Ngày 04/11/2026. Đã triển khai trong working tree theo yêu cầu tiếp theo của người dùng; chưa commit Git, chưa deploy hoặc chạy migration trên dữ liệu thật.

## Thay đổi

- `utils/livePersistence.js`: ghi temp riêng → fsync → đóng handle → rename, chỉ retry rename EPERM/EBUSY tối đa 5 lần tổng cộng (chờ 20/40/80/160 ms); lỗi giữ file đích. Queue bao trọn đọc–sửa–ghi theo user, hỗ trợ caller lồng nhau và vô hiệu hóa context sau khi thao tác kết thúc để callback TikTok/timer không vượt queue. Khóa single writer theo tiến trình cho toàn kho.
- `utils/liveSessionStore.js`: mutation bất đồng bộ, revision/commitId và request receipts được commit cùng dữ liệu; backup bản nguồn tốt trước lần ghi kế tiếp. Có công cụ phục hồi backup rõ ràng, không âm thầm thay nguồn JSON hỏng bằng dữ liệu rỗng.
- `utils/liveSessionProjection.js`: các phép tính/tạo projection tách khỏi I/O; bảo toàn ID và provenance sự kiện khi phục hồi rồi ghi thêm.
- `server.js`: chốt/sửa/xóa dùng bản ứng viên, await commit trước cập nhật RAM/ACK/socket/in. API sửa lịch sử tham gia cùng queue và hỗ trợ receipt chống retry trùng. Lỗi socket/in/index sau commit không được trả kết quả như commit thất bại. Request chốt/sửa/xóa mang sessionId và segmentStartedAt để chặn yêu cầu phiên cũ.
- Recovery chỉ nạp dữ liệu đúng user/segment, trạng thái disconnected; reconnect tiếp tục cùng segment. Phiên stale/nhiều phiên mở yêu cầu lựa chọn rõ ràng. Đóng sau sự cố ghi thời điểm quyết định hiện tại và lý do `recovery-user-closed`; không suy diễn giờ kết thúc từ đơn cuối.
- `public/js/dashboard.js`: dialog chọn phiên/đóng các phiên được liệt kê/tạm hoãn; không hiểu hủy dialog là tạo mới. Pending mutation được giữ trong sessionStorage theo user, bảo toàn toàn bộ payload và requestId qua timeout/reconnect/refresh; mọi đường tạo đơn thủ công, chốt bình luận, sửa/xóa đều nhận kết quả commit.
- Shutdown ngừng nhận thao tác mới, drain queue trước đóng kết nối với deadline 25 giây hiện có; restart không kết thúc live. Uncaught exception chỉ log rồi thoát.

## Schema và index

Nguồn chuẩn vẫn là `data/live-sessions/<userId>.json`, envelope bổ sung `schemaVersion: 2`, `revision`, `commitId`, `receipts`. File cũ chỉ có `sessions` đọc được như revision 0. Chưa rút gọn receipts: chúng cần tồn tại để retry cũ sau xóa không làm đơn hồi sinh.

Index v2 dùng một snapshot nguyên tử `data/live-history/<userId>/projection.json` chứa revision, sourceVersion, checksum và rows cho mọi ngày. Đây là lựa chọn thực thi thay cho công bố đồng thời nhiều file ngày: không có cửa sổ manifest mới trỏ tới bộ file dựng dở. Job nền gộp 250 ms; kết thúc live yêu cầu chạy ngay. Mỗi user chỉ có một lần dựng index đang thực thi, cả khi có yêu cầu migration. Job lỗi retry với backoff tối đa 30 giây, không làm đơn đã commit bị báo lỗi lưu.

Đường đọc xác minh revision/sourceVersion/checksum; thiếu/cũ/hỏng thì dùng projection nguồn cùng phạm vi, kể cả khi kết quả rỗng. Không nối thêm nguồn vào index. Startup lập lại các job từ dữ liệu bền vững. File index ngày/archive cũ không tham gia đường đọc v2 nên không làm đơn đã xóa hồi sinh; việc archive file ngày cũ trên 90 ngày được thực hiện bằng I/O/gzip bất đồng bộ trong job nền.

`lastActivityAt` cập nhật khi tạo phiên, người dùng tiếp tục phiên, commit đơn/sửa/xóa hoặc chỉnh lịch sử. Đọc/refresh recovery không làm mới timestamp. Mặc định stale 12 giờ; cấu hình `LIVE_RECOVERY_STALE_HOURS` phải là số dương. Nhận bình luận đơn thuần không ghi heartbeat riêng vào nguồn. Dữ liệu legacy fallback timestamp đơn/segment hợp lệ; segment mơ hồ không được tự chọn.

Lịch sử đã kết thúc nhưng thiếu endedAt riêng ở segment được đánh dấu `closedBySessionAt` khi dùng lại, dựa trên endedAt đã có của phiên bao ngoài; không gán thời điểm ngắt giả cho segment.

## Kiểm chứng

- `npm test`: **144/144 PASS**.
- `node --test scripts/testDockerRuntime.js`: **4/4 PASS**, bao gồm server thật khởi động trên bản sao thư mục tạm, health/auth và shutdown.
- `git diff --check`: không có lỗi whitespace.
- Test child process thực sự bị SIGKILL sau commit rồi mở tiến trình mới: đơn còn nguyên, retry cùng ID trả duplicate, index dựng lại khớp nguồn; tiến trình writer thứ hai bị từ chối.
- Fault injection: rename tạm/kéo dài, fsync lỗi, index job lỗi và nguồn đổi lúc job đang dựng. File nguồn/RAM giữ đúng trạng thái theo điểm commit.
- Kiểm thử recovery → reconnect → chốt thêm → kết thúc qua Socket.IO handler với connector giả lập; giữ session/segment ID, thời gian và sự kiện; không in lại khi phục hồi/duplicate. Có test giao diện dialog và retry payload.
- Mọi fixture nguồn/index/archive/backup đều ở thư mục tạm. Không sửa dữ liệu live thật, in hóa đơn thật hoặc gọi TikTok thật trong các test này.

Chưa thực hiện kiểm tra trực tiếp với một phiên TikTok đang phát và máy in thật. Đây là giới hạn kiểm chứng cần giữ rõ khi đưa lên môi trường vận hành.

## Benchmark và giới hạn hiệu năng

Chạy riêng bằng:

```powershell
node scripts/benchmarkLiveCommit.js 1000,10000,50000 docs/plans/2026-11-04-live-commit-benchmark.json
```

Số đo đầy đủ: `2026-11-04-live-commit-benchmark.json`. Máy Windows, Node v26.7.0, Ryzen 7 5800H; fixture tổng hợp một phiên, lưu cả danh sách cộng dồn và segment, 12 mutation theo batch 4 yêu cầu đồng thời, index nền bật. Không kiểm soát cache/phần cứng ổ đĩa. Phản hồi ở đây là store hoàn tất commit, chưa gồm mạng, TikTok hoặc in.

| Đơn trong fixture | JSON nguồn | Commit p95 | Phản hồi gồm chờ queue p95 | Event loop max |
| --- | --- | --- | --- | --- |
| 1.000 | 420.621 byte | 14,85 ms | 52,13 ms | 22,74 ms |
| 10.000 | 4.180.827 byte | 167,46 ms | 391,05 ms | 73,53 ms |
| 50.000 | 21.052.829 byte | 1.159,97 ms | 4.028,72 ms | 503,05 ms |

JSON vẫn đọc/clone/serialize toàn lịch sử mỗi commit; API đọc snapshot phục vụ code hiện có vẫn đồng bộ. Tách index không giải quyết giới hạn này. Chưa có ngưỡng SLO/tải vận hành được xác nhận để kết luận đạt yêu cầu hoặc chọn mốc chuyển SQLite. Đã hỏi người dùng về ngưỡng trong lúc triển khai; hiện vẫn giữ JSON v2. Nếu yêu cầu commit p95 dưới 1 giây tại fixture 50.000 đơn thì kết quả hiện tại không đạt và cần chuyển nguồn chuẩn sang SQLite transaction. Không dùng debounce dữ liệu gốc. Không suy luận từ benchmark này rằng socket thực tế đã rớt.

## Vận hành và phục hồi

1. Chỉ chạy một server writer cho kho. `.writer.lock` ghi PID/token; process bình thường thoát sẽ nhả khóa. Sau kill, process mới chỉ thu hồi khóa nếu xác minh PID cũ đã chết. PID còn sống hoặc lock hỏng thì từ chối ghi.
2. Nếu sự cố xảy ra ngay trong bước chiếm khóa và để lại `.writer.guard`, hệ thống dừng an toàn. Dừng mọi writer, kiểm tra tiến trình/path kho trước khi xử lý guard; không tự xóa guard có thể đang được writer khác giữ.
3. Nguồn hỏng: dừng server; giữ nguyên nguồn, backup và log. Chạy `node scripts/recoverLiveBackup.js <userId>`. Công cụ giữ bản hỏng dưới tên `.corrupt-<timestamp>`, phục hồi `.bak` đã xác thực và báo revision. Backup có thể thiếu commit mới nhất đã ACK, vì vậy phải đối chiếu; không coi đây là chứng cứ phục hồi đầy đủ.
4. Dựng lại index thủ công khi server đã dừng: `npm run migrate:live-history -- <userId>`. Khi server chạy bình thường, restart/đường đọc đã tự phát hiện index cũ hoặc thiếu.
5. Temp còn lại do kill không được tự promote thành nguồn. Chỉ dọn sau khi dừng writer và đối chiếu nguồn/backup, đúng thư mục kho; không xóa file đích để chữa lỗi rename.
6. Trước rollback code hoặc dữ liệu, chụp đầy đủ nguồn và receipts mới phát sinh khi writer đã dừng. Code cũ có thể bỏ các metadata v2 ở lần ghi tiếp theo; không rollback nguồn về backup cũ mà bỏ qua đơn đã ACK mới hơn.
