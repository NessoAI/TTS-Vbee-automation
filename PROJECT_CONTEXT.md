# Bối cảnh và Mục tiêu dự án - TTS POE Automation (TTS-Vbee-automation)

## 1. Bối cảnh hiện tại (Current Context)
Dự án **TTS POE Automation** được xây dựng nhằm mục đích tự động hóa quy trình sản xuất âm thanh (Text-to-Speech - TTS) dựa trên nội dung kịch bản văn bản. 

### Các tính năng và luồng xử lý hiện tại (Workflow):
- **Đầu vào (Input):** Đọc nội dung từ một liên kết Google Docs được người dùng cung cấp.
- **Xử lý kịch bản:** Tích hợp với AI (thông qua adapter ChatGPT) để trích xuất hoặc định hình lại nội dung thành một kịch bản hội thoại nhiều vai (ví dụ: Nhân vật A và Nhân vật B).
- **Tương tác nền tảng TTS:** 
  - Sử dụng thư viện **Playwright** để điều khiển trình duyệt chạy ngầm (hoặc hiển thị), tự động đăng nhập vào **VBee Studio** (`studio.vbee.vn`).
  - Tự động tạo dự án mới (với tên được lấy từ tiêu đề tài liệu Google Doc).
  - Tự động chia tách và tạo từng khối (block) tương ứng với từng câu hội thoại, đồng thời chọn đúng giọng đọc yêu thích cho nhân vật (ví dụ chọn Giọng A hoặc Giọng B).
- **Xuất bản và Tải về:** Tự động kích hoạt tính năng chuyển đổi âm thanh hàng loạt (Generate All) của VBee và chờ tải về các file `.rar` / `.zip` thành phẩm vào thư mục `downloads` nội bộ.
- **Kiến trúc công nghệ (Tech Stack):** 
  - Backend: Node.js, Express, Playwright.
  - Frontend: React, Vite (chạy trên cổng 4173).
  - Quản lý trạng thái: Lưu trữ dữ liệu công việc (jobs) dưới dạng các tệp JSON trong thư mục `data/jobs/`.

### Tình trạng phát triển:
- Hiện tại, hệ thống đã hoàn thiện được luồng cơ bản (end-to-end) nhưng vẫn đang được tiếp tục tinh chỉnh để xử lý các hạn chế, thay đổi trên UI của VBee Studio (như VBee sử dụng Virtual DOM khiến các element bị ẩn, lỗi đồng bộ trạng thái lưu/đổi tên dự án, quản lý timeout khi tải xuống file).

---

## 2. Mục tiêu đích đến (Target Goals)

### 2.1. Tự động hóa hoàn toàn (Zero-Touch Automation)
- Giải phóng 100% thao tác thủ công của người vận hành.
- Người dùng chỉ cần nhập một hoặc nhiều URL Google Docs, hệ thống sẽ tự động đưa vào hàng đợi, xử lý lần lượt và trả về ngay file âm thanh chất lượng cao.

### 2.2. Tính ổn định và khả năng phục hồi (Reliability & Fault Tolerance)
- Chịu lỗi tốt: Trình duyệt có thể bắt lỗi nếu VBee Studio quá tải hoặc phản hồi chậm. 
- Hệ thống cần tự động thử lại (retry) hoặc lưu lại các "Diagnostic Artifacts" (ảnh chụp màn hình, HTML lỗi) để nhà phát triển dễ dàng sửa chữa khi UI của VBee cập nhật.

### 2.3. Tăng năng suất sản xuất nội dung
- Phục vụ cho việc sản xuất hàng loạt các bài giảng, slide (như tài liệu An toàn lao động HSE), video ngắn, podcast... một cách nhanh chóng và đồng bộ.
- Tùy chỉnh chi tiết về tốc độ đọc (speed), ngắt nghỉ mà không cần tự tay tinh chỉnh hàng trăm khối block trên nền tảng.

### 2.4. Trải nghiệm người dùng (UX) trên bảng điều khiển (Dashboard)
- Giao diện Frontend giúp người quản lý dễ dàng xem được trạng thái của từng Job (`pending`, `pasting_vbee_blocks`, `downloading`, `completed`, `failed`).
- Cho phép xem lại log lỗi một cách chi tiết để quản lý chất lượng công việc sinh âm thanh.
