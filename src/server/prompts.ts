import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CORRECTION_PROMPT = `VAI TRÒ
Bạn là chuyên gia hiệu đính văn bản tiếng Việt dành cho hệ thống chuyển văn bản thành giọng nói TTS.

NHIỆM VỤ
Hiệu chỉnh văn bản đầu vào để phù hợp cho TTS, nhưng phải bảo toàn nội dung, ý nghĩa, thông tin và thứ tự của văn bản gốc.

CHỈ ĐƯỢC PHÉP
- Sửa lỗi chính tả hoặc lỗi gõ nhầm rõ ràng.
- Điều chỉnh dấu câu để đọc tự nhiên và đúng nghĩa.
- Chuẩn hóa khoảng trắng và xuống dòng.
- Xóa emoji, ký tự trang trí không có giá trị khi đọc (chỉ xóa ký tự trang trí thuần túy, KHÔNG xóa số thứ tự 1., 2., 3., 4. hay ký hiệu cấu trúc danh sách).
- Giữ nguyên ký hiệu có nghĩa, chữ viết tắt, đơn vị đo, số liệu, tên riêng, thứ tự danh sách và thuật ngữ.

TUYỆT ĐỐI KHÔNG
- Viết lại, diễn đạt lại, thay từ đồng nghĩa, rút gọn hoặc mở rộng.
- Thêm câu chuyển ý, ví dụ, nhận xét, giải thích hoặc kết luận.
- Xóa thông tin có nghĩa, số thứ tự (1., 2., 3., 4.), ký hiệu cấu trúc danh sách hoặc thay đổi thứ tự.
- Biến numbered list (danh sách có đánh số) thành đoạn văn không đánh số.
- Tự sửa từ khi không chắc đó là lỗi; khi không chắc phải giữ nguyên.

Trước khi xuất, tự kiểm tra không có câu/ý bị thêm, thiếu, viết lại hoặc đảo thứ tự.

FORMAT OUTPUT
Chỉ xuất văn bản đã hiệu chỉnh. Không mở đầu, giải thích, nhận xét, tiêu đề hay Markdown code block.

VĂN BẢN GỐC
<<<START_OF_ORIGINAL_TEXT>>>
{{TEXT}}
<<<END_OF_ORIGINAL_TEXT>>>`;

export const ROLE_PROMPT_VERSION = '4.4.2';
export const ROLE_PROMPT_SOURCE = 'config/prompts/role-v4.4.2.txt';

export interface BuiltRolePrompt {
  rendered: string;
  templateSha256: string;
  renderedSha256: string;
}

export function getRolePromptTemplateContent(): string {
  const filePath = path.resolve(process.cwd(), ROLE_PROMPT_SOURCE);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Không tìm thấy file prompt V4.4.2 tại ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function computeSha256(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function getRolePromptTemplateSha256(): string {
  return computeSha256(getRolePromptTemplateContent());
}

export function buildRolePrompt(correctedText: string): BuiltRolePrompt {
  const template = getRolePromptTemplateContent();
  const placeholder = '[ DÁN VĂN BẢN GỐC VÀO ĐÂY ]';
  const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = template.match(new RegExp(escapedPlaceholder, 'g'));

  if (!matches || matches.length !== 1) {
    throw new Error(`Template ${ROLE_PROMPT_SOURCE} phải chứa duy nhất một placeholder [ DÁN VĂN BẢN GỐC VÀO ĐÂY ]`);
  }

  const rendered = template.replace(placeholder, correctedText);
  return {
    rendered,
    templateSha256: computeSha256(template),
    renderedSha256: computeSha256(rendered)
  };
}

export function withText(template: string, text: string): string {
  return template.replace('{{TEXT}}', text);
}

export const REPAIR_PROMPT = `VĂN BẢN VỪA HIỆU CHỈNH TRƯỚC ĐÓ BỊ LỖI VÀ MẤT NỘI DUNG. HÃY SỬA LẠI NGAY TRONG PHẢN HỒI NÀY.

VĂN BẢN GỐC:
<<<START_OF_ORIGINAL_TEXT>>>
{{ORIGINAL_TEXT}}
<<<END_OF_ORIGINAL_TEXT>>>

KẾT QUẢ HIỆU CHỈNH SAI TRƯỚC ĐÓ:
<<<START_OF_INVALID_TEXT>>>
{{INVALID_TEXT}}
<<<END_OF_INVALID_TEXT>>>

DANH SÁCH LỖI PHÁT HIỆN:
{{VALIDATION_ERRORS}}

YÊU CẦU BẮT BUỘC:
- Khôi phục chính xác tất cả số thứ tự danh sách (1., 2., 3., 4.), số liệu và ký hiệu cấu trúc bị mất hoặc bị sửa.
- Bảo toàn 100% từ ngữ, số liệu và thứ tự danh sách của văn bản gốc. Không thêm/xóa từ hoặc số liệu.
- Chỉ hiệu chỉnh lỗi chính tả hoặc dấu câu nếu có, tuyệt đối không biến numbered list thành đoạn văn không đánh số.
- CHỈ xuất lại toàn bộ văn bản đã được sửa hoàn chỉnh. Không mở đầu, không giải thích, không nhận xét và không dùng Markdown code block.`;

export function withRepairContext(
  template: string,
  originalText: string,
  invalidText: string,
  validationErrors: string[]
): string {
  return template
    .replace('{{ORIGINAL_TEXT}}', originalText)
    .replace('{{INVALID_TEXT}}', invalidText)
    .replace('{{VALIDATION_ERRORS}}', validationErrors.map((err, idx) => `${idx + 1}. ${err}`).join('\n'));
}
