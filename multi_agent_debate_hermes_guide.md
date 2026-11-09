# Hướng Dẫn Toàn Diện: Tranh Luận Đa Tác Tử (Multi-Agent Debate) & Hermes Agent

---

## 1. Khái Niệm Cốt Lõi

Khi nhiều mô hình AI (như GPT, Claude, Gemini...) cùng tham gia vào một "phòng chat", tự trao đổi, phản biện và tìm ra giải pháp tối ưu nhất, kỹ thuật này được biết đến dưới các tên gọi:

* **Multi-Agent Debate / LLM Debate:** Cơ chế các AI độc lập đưa ra lập luận, sau đó phản biện và bóc tách lỗ hổng logic của nhau để đạt đến sự đồng thuận.
* **Mixture of Agents (MoA):** Kiến trúc xếp chồng nhiều mô hình nền tảng khác nhau qua các tầng (layers); tầng sau đọc, chấm điểm và tổng hợp kết quả của tầng trước.
* **AI Council / AI Roundtable:** Mô phỏng một "Hội đồng AI" hoặc "Bàn tròn tác chiến" nơi các AI đóng vai trò như các chuyên gia khác nhau để giải quyết một bài toán.
* **AutoGen GroupChat (Microsoft) & CAMEL-AI:** Các framework mã nguồn mở tiên phong thiết lập cơ chế gom các agent vào chung một phòng chat (`GroupChat`) và quản lý lượt nói thông qua `GroupChatManager`.

---

## 2. Nền Tảng Hermes Agent & Tính Năng Bot Mode

**Hermes Agent** (phát triển bởi *Nous Research*) tích hợp sẵn tính năng **Bot Mode**, cho phép biến các hồ sơ agent độc lập thành một đội ngũ AI chuyên biệt trong cùng một phòng chat nhóm.

* **Bản chất của Bot:** Mỗi bot thực chất là một profile độc lập lưu tại `~/.hermes/profiles/<tên_bot>/` với API key, tệp tính cách (`SOUL.md`), bộ nhớ lưu trữ và kỹ năng (skills) riêng biệt.
* **Group Chat:** Cho phép các bot cùng theo dõi chung một luồng lịch sử trò chuyện, tự động lên tiếng hoặc phản biện khi được gọi tên theo ngữ cảnh.

---

## 3. Hướng Dẫn Cài Đặt

### Cách 1: Sử dụng Hermes Desktop *(Khuyên dùng)*
1. Tải bản cài đặt **Hermes Desktop** từ repository chính thức của [Nous Research / Hermes Agent](https://github.com/NousResearch/hermes-agent).
2. Vào **Settings** $\rightarrow$ **Plugins** $\rightarrow$ kiểm tra đảm bảo **Bot Mode** đang ở trạng thái Bật (*Enabled*).
3. Cấu hình API keys tại mục **Settings** $\rightarrow$ **Providers** (OpenAI, Anthropic, Google, OpenRouter...).

### Cách 2: Cài đặt Hermes CLI qua dòng lệnh
* **Windows (PowerShell):**
  ```powershell
  irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex
  ```
* **macOS / Linux / WSL2 (Bash):**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
  ```

### Cách 3: Kết hợp Mô hình Cục bộ (Hermes 3 Local + AutoGen)
Nếu muốn chạy mô hình **Hermes 3** cục bộ bằng **Ollama** và cho phản biện với Claude/GPT:
1. Chạy model Hermes 3 local:
   ```bash
   ollama run hermes3
   ```
2. Sử dụng thư viện `pyautogen` để kết nối endpoint Ollama local với API của OpenAI/Anthropic trong cùng một `autogen.GroupChat`.

---

## 4. Thiết Kế Vai Trò Mẫu (`SOUL.md` / System Prompt)

Để tạo ra một phòng họp 3 bên chuẩn mực, cấu hình 3 Bot trong tab **Bots** như sau:

### Bot 1: Architect (Kỹ sư trưởng / Người đề xuất)
* **Model khuyến nghị:** `Claude 3.5 Sonnet` hoặc `GPT-4o`
* **Nội dung `SOUL.md`:**
  ```markdown
  Bạn là Kỹ sư trưởng (Architect) / Người đề xuất giải pháp kỹ thuật.
  Nhiệm vụ:
  1. Phân tích yêu cầu bài toán từ người dùng và đưa ra kiến trúc, kế hoạch hoặc giải pháp kỹ thuật ban đầu rõ ràng, chi tiết.
  2. Lắng nghe phản biện từ @Challenger để tiếp thu và sửa đổi phương án nếu hợp lý.
  Quy tắc:
  - Không nói lời chào hỏi, cảm ơn hay khen ngợi xã giao.
  - Đi thẳng vào giải pháp kỹ thuật.
  ```

### Bot 2: Challenger (Chuyên gia phản biện / Devil's Advocate)
* **Model khuyến nghị:** `DeepSeek-R1`, `OpenAI o1/o3-mini`, hoặc `GPT-4o`
* **Nội dung `SOUL.md`:**
  ```markdown
  Bạn là Chuyên gia phản biện (Devil's Advocate) và Kiểm thử an toàn.
  Nhiệm vụ:
  1. Soi mói, tìm kiếm lỗ hổng logic, rủi ro bảo mật, điểm nghẽn hiệu năng (bottlenecks), và các trường hợp ngoại lệ (edge cases) trong phương án của @Architect.
  2. Bắt buộc đưa ra cấu trúc phản biện:
     - [Lỗ hổng / Rủi ro lớn nhất]
     - [Kịch bản xảy ra lỗi (Edge-case)]
     - [Đề xuất hướng khắc phục cụ thể]
  Quy tắc:
  - Tuyệt đối không nhượng bộ xã giao hoặc đồng ý mù quáng.
  - Luôn giữ lập trường phản biện sắc bén và mang tính xây dựng.
  ```

### Bot 3: Arbiter (Trọng tài / Tổng hợp giải pháp)
* **Model khuyến nghị:** `Gemini 1.5 Pro/Flash` hoặc `GPT-4o`
* **Nội dung `SOUL.md`:**
  ```markdown
  Bạn là Trọng tài kỹ thuật (Arbiter) kiêm Thư ký tổng hợp.
  Nhiệm vụ:
  1. Quan sát cuộc tranh luận giữa @Architect và @Challenger.
  2. Đánh giá khách quan luận điểm của từng bên, dung hòa xung đột kỹ thuật.
  3. Khi đạt được sự thống nhất hoặc sau tối đa 2 vòng phản biện, xuất bản tài liệu tổng kết với tiêu đề:
     [KẾT LUẬN CUỐI CÙNG]
     - Phương án tối ưu được chọn:
     - Các rủi ro đã được hóa giải:
     - Kế hoạch hành động từng bước (Checklist):
  Quy tắc:
  - Không can thiệp quá sớm vào giai đoạn tranh luận ban đầu.
  - Sau khi đưa ra [KẾT LUẬN CUỐI CÙNG], tuyên bố kết thúc thảo luận.
  ```

---

## 5. Chiến Lược Tối Ưu Hóa & Thực Chiến

### 1. Quy mô nhóm vàng: 2 đến 3 Bot
* Hạn chế đưa 4–5 bot vào cùng một lúc vì sẽ gây loãng nội dung, khó kiểm soát lượt nói và làm bùng nổ chi phí token.

### 2. Triệt tiêu "Hội chứng nịnh nhau" (Yes-Man Syndrome)
* Mặc định các LLM có xu hướng khen ngợi và đồng tình với nhau. Bắt buộc phải thêm điều kiện cấm khen ngợi, cấm cảm ơn vào prompt hệ thống.

### 3. Quy tắc Tagging ngăn chặn vòng lặp vô tận
* Cấu hình để các bot chỉ trả lời khi được tag tên `@BotName` hoặc khi người dùng trực tiếp yêu cầu. Tránh việc các bot tự động bắt chuyện vô tận với nhau.

### 4. Tách biệt Planning (Trong Group) và Execution (1:1)
> [!IMPORTANT]
> **Không để bot viết code hàng loạt hay chạy tool nặng trực tiếp trong Group Chat.**
> Mỗi tin nhắn trong Group Chat sẽ gửi lại toàn bộ lịch sử trò chuyện cho tất cả các bot, khiến chi phí token tăng theo cấp số nhân ($O(N^2)$).

* **Quy trình chuẩn:**
  1. Thảo luận trong **Group Chat** để chốt: Kiến trúc, giải pháp, checklist nhiệm vụ.
  2. Mang checklist sang **phiên chat 1:1** của riêng Bot Coder để thực hiện viết code.

### 5. Thiết lập điều kiện kết thúc rõ ràng (Termination Rule)
* Giao quyền kết thúc cho Bot Trọng tài (Arbiter). Khi Arbiter đưa ra cú pháp `[KẾT LUẬN CUỐI CÙNG]`, phiên thảo luận tự động dừng lại, không tiếp tục tranh luận thêm.

---

## 6. Mẫu Lời Nhắc (Prompt) Mở Màn Trong Group Chat

Khi bắt đầu một phiên làm việc, gửi tin nhắn mở màn theo cấu trúc sau:

```text
Tôi cần giải quyết bài toán: [Mô tả chi tiết bài toán / yêu cầu của bạn]

Quy trình làm việc:
1. @Architect hãy phân tích và đề xuất kiến trúc ban đầu.
2. @Challenger hãy chỉ ra 3 điểm yếu hoặc rủi ro lớn nhất và đề xuất giải pháp thay thế.
3. @Architect phản hồi ngắn gọn về các điểm trên.
4. @Arbiter đánh giá, dung hòa và chốt [KẾT LUẬN CUỐI CÙNG] kèm checklist thực hiện.
```
