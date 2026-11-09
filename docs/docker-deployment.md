# Chạy Tikoder bằng Docker

## Phạm vi

- Một tiến trình Tikoder; không scale nhiều replica cùng ghi `data/` và `history/`.
- Node 24, `npm ci --omit=dev`, chạy bằng UID/GID 1000 (`node`).
- Session SQLite nằm tại `data/sessions.sqlite`, sống qua việc tạo lại container.
- `/healthz` kiểm tra tiến trình HTTP; không xác nhận Firebase/TikTok/máy in/n8n đang kết nối.
- Zalo Web/Edge thử nghiệm bị tắt trong container. Zalo personal là service tùy chọn độc lập.
- Local chỉ bind loopback. Production thêm Caddy HTTPS. DebtTracker chưa có lớp xác thực nên chỉ bind loopback.

## Chuẩn bị

1. Cài Docker Engine hoặc Docker Desktop chạy Linux containers, có Docker Compose v2.
2. Chạy từ thư mục gốc repo. Chuẩn bị `.env` từ `.env.example` nếu chưa có; không ghi đè `.env` đang dùng.
3. Đặt Firebase service-account JSON hợp lệ tại `firebase-service-account.json`. Ba biến `FIREBASE_PROJECT_ID/PRIVATE_KEY/CLIENT_EMAIL` không thay thế file này trong mã hiện tại.
4. Có sẵn `data/`, `history/`, `config.json`. Máy mới có thể tạo hai thư mục trống và `config.json` chứa `{}`; khi di chuyển, chép dữ liệu hiện có thay vì tạo mới.
5. Tạo `SESSION_SECRET` ngẫu nhiên ít nhất 32 ký tự; giữ nguyên secret qua các lần deploy để giữ phiên đăng nhập. Không dùng chuỗi mẫu.
6. Trên Linux, cấp UID 1000 quyền ghi `data/`, `history/`, `config.json`, và quyền đọc Firebase JSON. Ví dụ với các đường dẫn đã kiểm tra:

```sh
sudo chown -R 1000:1000 data history
sudo chown 1000:1000 config.json firebase-service-account.json
chmod 600 config.json firebase-service-account.json
```

Không chạy Tikoder trên host và trong container đồng thời với cùng dữ liệu. Backup rồi dừng tiến trình cũ trước khi chuyển sang Docker.

## Chạy local

Giữ `DOCKER_NODE_ENV=development`, `NOTIFY_ENABLED=false`. Compose luôn đặt `VITE_DEV_SKIP_AUTH=false`; đăng nhập Firebase vẫn cần thiết.

```sh
docker compose config --quiet
docker compose build --pull tiktok-app
docker compose up -d --wait tiktok-app
docker compose ps
docker compose logs --tail 100 tiktok-app
```

Mở `http://localhost:3000`. Có thể đổi `APP_PORT` nếu cổng đang dùng, đồng thời cập nhật `CORS_ORIGIN` và `PUBLIC_APP_URL`. Không dùng `docker compose config` không có `--quiet` khi chia sẻ log vì cấu hình render có thể chứa secret.

Healthcheck chuyển unhealthy không tự làm Docker restart; `restart: unless-stopped` áp dụng khi tiến trình thoát. Cần giám sát nếu vận hành dài hạn.

## Production HTTPS

Đặt `APP_DOMAIN=shop.example.com` trong `.env`, trỏ DNS đến máy chủ và mở cổng 80/443. Thêm domain vào Firebase Authentication Authorized domains. Không đặt URL có scheme/path vào APP_DOMAIN.

```sh
docker compose -f docker-compose.yml -f compose.production.yml config --quiet
docker compose -f docker-compose.yml -f compose.production.yml up -d --build --wait
```

Caddy cấp TLS và chuyển tiếp WebSocket. Backend chỉ tin proxy `172.30.87.2/32`; nếu subnet xung đột, sửa đồng bộ IP/CIDR trong `compose.production.yml`. Không bật `trust proxy=true` chung chung. Cổng backend trên host vẫn chỉ truy cập loopback để chẩn đoán; production dùng URL HTTPS để cookie đăng nhập hoạt động.

Production từ chối khởi động khi Firebase credential không hợp lệ hoặc session secret quá ngắn/chuỗi mẫu. Chỉ có một proxy Caddy được cấu hình; nếu thêm CDN/load balancer, phải xem lại chuỗi proxy tin cậy.

## n8n và Zalo personal (tùy chọn)

```sh
docker compose -f docker-compose.yml -f compose.integrations.yml --profile automation up -d n8n
```

n8n UI: `http://localhost:5678`. Nếu n8n host đang dùng cổng này, đổi `N8N_PORT` trước. Đây là instance mới: volume `n8n_data` giữ database và khóa mã hóa tự sinh; không tự di chuyển instance/workflow/credentials cũ. Sao lưu cả volume, đặc biệt khóa mã hóa; khi di chuyển n8n cũ phải giữ khóa cũ. Pin `N8N_IMAGE` vào phiên bản/digest đã thử trước khi dùng production; mặc định `stable` có thể thay đổi.

Import workflow trong `integrations/n8n/` và thiết lập credentials theo README của tích hợp. Profile này cho phép Code node đọc env và dùng `crypto` để workflow hiện có ký HMAC; chỉ dùng với người quản trị/workflow đáng tin cậy. Xác minh khả năng Code node/task runner của phiên bản n8n đã chọn trước khi publish. Không công khai n8n HTTP ra internet; cấu hình HTTPS riêng trước khi cần truy cập từ xa.

Để Tikoder gửi thông báo tới n8n cùng mạng, cấu hình:

```dotenv
N8N_WEBHOOK_URL=http://n8n:5678/webhook/tikoder/event
N8N_INTERNAL_HTTP_ORIGIN=http://n8n:5678
```

Chỉ bật `NOTIFY_ENABLED=true` sau khi đã cấu hình Header Auth/HMAC, chống phát lại và kiểm thử workflow. HTTP chỉ được cho phép với origin đã chỉ định chính xác. Nếu dùng n8n trên host, dùng `host.docker.internal` thay `127.0.0.1` và đặt origin tương ứng; ưu tiên HTTPS khi ra ngoài mạng Docker riêng.

Zalo cần hai secret `ZALO_PERSONAL_EVENT_SECRET`, `ZALO_PERSONAL_COMMAND_SECRET`; API dữ liệu cần `N8N_DATA_API_SECRET`, `N8N_DATA_API_TENANT`, `N8N_DATA_API_UID` ràng buộc một shop. Chuẩn bị `data/zalo-personal/` và quyền ghi UID 1000 trước khi bật:

```sh
docker compose -f docker-compose.yml -f compose.integrations.yml --profile automation --profile zalo up -d --build
```

Khi đăng nhập lần đầu, chủ động đặt `ZALO_PERSONAL_ALLOW_QR_LOGIN=true`, quét `data/zalo-personal/login-qr.png`; sau khi có credentials đổi về `false` và tạo lại adapter. Credentials và command-state không được xóa khi restart vì state ngăn gửi trùng. Adapter không publish cổng 3010 ra host. Chỉ bật sau khi workflow đã sẵn sàng; mặc định profile không chạy và không gửi tin thật.

## DebtTracker (tùy chọn)

```sh
docker compose -f docker-compose.yml -f compose.integrations.yml --profile debt up -d --build debttracker
```

Mở `http://localhost:3001`. Volume `debt_data` lưu `/app/data/debts.db`. Volume mới là database trống; nếu cần lịch sử, dừng DebtTracker cũ và mới rồi sao chép `DebtTracker/debts.db` vào volume trước khi sử dụng, giữ ownership UID 1000. Không mount nguyên thư mục ứng dụng để tránh che mã nguồn/node_modules.

## Backup, restore và rollback

Thực hiện trong cửa sổ bảo trì. Với mỗi lệnh Compose, dùng cùng các `-f` và profile như khi khởi động.

1. Dừng toàn bộ tiến trình ghi dữ liệu, kể cả tiến trình host nếu có; chạy `docker compose ... stop`.
2. Sao lưu cùng một thời điểm: `data/`, `history/`, `config.json`, `.env`, Firebase JSON. Bảo vệ backup vì có thông tin khách hàng và secret. Sao lưu toàn bộ thư mục dữ liệu, kể cả SQLite WAL/SHM nếu còn.
3. Nếu dùng integrations, sao lưu thêm named volumes `tikoder_n8n_data`, `tikoder_debt_data`; production thêm `tikoder_caddy_data`, `tikoder_caddy_config`. Tên thay đổi nếu dùng `-p`/COMPOSE_PROJECT_NAME; xác nhận bằng `docker volume ls`.
4. Khởi động lại và kiểm tra health/login. Không dùng `down -v` vì sẽ xóa named volumes.
5. Thử restore vào thư mục độc lập và Compose project khác (`-p tikoder-restore`), cổng khác, notification/Zalo tắt. Dùng bản sao credential được bảo vệ; không cho hai instance cùng ghi dữ liệu gốc. Kiểm tra số bản ghi và mở một lịch sử đã biết trước khi coi backup hợp lệ.

Trước mỗi release, gắn tag image và ghi lại image ID/digest. Đặt `TIKODER_IMAGE=tikoder:<release>` rồi build. Rollback bằng tag trước và `up -d --no-build`; nếu có migration dữ liệu không tương thích thì dừng dịch vụ và phục hồi backup tương ứng. Không rollback chỉ image khi schema đã thay đổi không tương thích.

## Kiểm chứng trước khi sử dụng dữ liệu thật

```sh
npm test
npm run test:docker
```

Test Docker runtime chạy Node trong thư mục tạm: session tồn tại sau mở lại database, hết hạn/touch/logout, giới hạn origin webhook, worker chờ công việc đang chạy, HTTP health/auth/CORS và handler SIGTERM. Trên Windows test gửi tín hiệu qua IPC để kích hoạt handler, không khẳng định hành vi signal của Linux container.

Trên máy có Docker, cần kiểm tra tiếp: build sạch trên Node 24, Compose config, health, đăng nhập Firebase qua HTTPS, Socket.IO khi livestream, xuất Excel, kết nối máy in LAN, `up -d --force-recreate` vẫn giữ dữ liệu/session, dừng khi đang xử lý và restore bản backup. Không bật workflow gửi thật để smoke test.

Máy triển khai hiện chưa tìm thấy Docker CLI, nên image/Compose và backup/restore thực tế chưa được xác minh. Các test Node cục bộ không thay thế kiểm thử container.

## Tài liệu tham chiếu

- Node releases: https://nodejs.org/en/about/previous-releases
- Compose profiles: https://docs.docker.com/compose/how-tos/profiles/
- Caddy reverse proxy/WebSocket: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- n8n Docker: https://docs.n8n.io/hosting/installation/docker/
