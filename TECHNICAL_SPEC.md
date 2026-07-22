# Technical Specification — MVP 0.1

## State machine

```text
created
  → extracting_document
  → correcting_text
  → assigning_roles
  → awaiting_script_review             [review_twice]
  → creating_vbee_project
  → pasting_vbee_blocks
  → awaiting_vbee_review               [review_twice]
  → generating_audio
  → downloading
  → completed
```

Mọi trạng thái có thể chuyển sang `failed` hoặc `cancelled`. Job được lưu thành JSON sau mỗi bước để không mất tiến độ nếu đóng ứng dụng.

## Safety gates

1. GPT dialogue phải là JSON hợp lệ.
2. `order` phải liên tục từ 1.
3. Cả A và B phải có nội dung.
4. Mỗi block tối đa 1.000 ký tự.
5. Nối tất cả block phải khớp văn bản hiệu chỉnh sau khi chuẩn hóa khoảng trắng.
6. Nội dung đọc lại từ VBEE phải khớp block đã duyệt.
7. File RAR chỉ bị xóa khỏi Downloads sau khi bản sao ở ổ D: có cùng dung lượng và khác 0 byte.
8. File đích hiện hữu không bị ghi đè.

## Browser strategy

- Playwright persistent context với Chrome profile riêng.
- Trusted keyboard input để copy nội dung Google Docs mà không dùng API.
- Một chat mới trong đúng ChatGPT Project cho mỗi tài liệu.
- Các adapter độc lập để selector có thể hiệu chỉnh mà không ảnh hưởng pipeline.

## Known integration boundary

Selector cuối cùng cho Google Docs tab tree, ChatGPT Project navigation và biểu tượng bulk TTS của VBEE phải được xác nhận bằng probe trên tài khoản thật. Real mode không nên bật trước bước này.
