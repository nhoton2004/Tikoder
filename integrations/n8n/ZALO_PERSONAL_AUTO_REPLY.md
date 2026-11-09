# Zalo cá nhân → n8n → Tikoder data API

Workflow export: `zalo-personal-auto-reply.workflow.json`.

## Vai trò

- Adapter `scripts/runZaloPersonalAdapter.js` nhận event từ `zca-js` và gửi command.
- n8n xác minh HMAC trên **byte gốc** của webhook (`rawBody: true` + binary `data`), lọc private message, bỏ tin shop, chống trùng/cooldown. Code node chỉ kiểm tra, phân nhánh và ký payload; ba HTTP Request node riêng đọc config, tải QR dạng binary và gửi command cho adapter. Không gửi request từ Code node.
- Tikoder chỉ cung cấp dữ liệu qua `/api/integrations/n8n/zalo-auto-reply/data` và `/data/qr`. Nhánh không hợp lệ, disabled, không khớp hoặc khớp nhiều luật đi thẳng đến Respond, không gọi adapter. Chỉ kết quả adapter `sent` đúng event ID mới cập nhật cooldown.

## Biến môi trường n8n

```text
ZALO_PERSONAL_EVENT_SECRET
N8N_DATA_API_SECRET
N8N_DATA_API_TENANT
TIKODER_DATA_API_URL
TIKODER_DATA_API_IMAGE_URL
ZALO_PERSONAL_COMMAND_SECRET
ZALO_PERSONAL_COMMAND_URL
ZALO_PERSONAL_COOLDOWN_SECONDS
```

Code node dùng builtin `crypto` và `$env` để ký HMAC. Máy chủ n8n phải cho phép `crypto` qua `NODE_FUNCTION_ALLOW_BUILTIN=crypto` và cho phép truy cập biến môi trường trong node (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`), rồi khởi động lại n8n. Cấu hình secret trên máy chủ, không hardcode vào export hay nhập secret trong chat. HTTP Request node gửi JSON command ở chế độ **Raw** để byte gửi đi khớp chính xác chuỗi đã ký. Nên tắt lưu execution data chứa raw event/command/header nhạy cảm và hạn chế quyền xem execution.

Trên máy Windows này, cấu hình riêng của n8n được lưu ngoài repo tại `%LOCALAPPDATA%\Tikoder\n8n-zalo-env.json` (giới hạn ACL cho chủ máy, SYSTEM và Administrators). Chạy `powershell.exe -NoProfile -ExecutionPolicy Bypass -File integrations/n8n/start-local-n8n-with-zalo.ps1` để khởi động n8n với đúng biến môi trường; không khởi động thêm một instance khi cổng 5678 còn được dùng. Tikoder đọc các giá trị tương ứng từ `.env` cục bộ, không commit cả hai file bí mật. Restart n8n có thể làm gián đoạn workflow báo giá; phải báo trước. Launcher này không tự khởi động cùng Windows.

## Giới hạn cần biết

- HTTP Request lỗi được chuyển về nhánh kết quả `ignored` (không gửi tiếp); request command thất bại hoặc timeout có thể đã được adapter nhận, vì vậy không tự retry. Nếu adapter trả `sent` nhưng mất phản hồi, xác minh thủ công trước khi xử lý tiếp.
- `workflow static data` của n8n là lớp chống trùng/cooldown thực dụng cho một worker, chưa phải transaction/unique constraint khi nhiều execution song song. Không coi workflow đạt production nếu n8n chạy nhiều worker cho webhook này.
- Event đã claim trước khi gọi adapter; nếu request tới adapter mất sau khi gửi, event giữ trạng thái đã thấy và không tự gửi lại. Kiểm tra thủ công thay vì tạo duplicate.
- Import workflow chưa đủ để có kết nối Zalo; adapter phải chạy riêng và phải có credentials Zalo cá nhân.
- Không import hoặc chỉnh workflow báo giá `jzJwwSTD9yUgEgPr`.
