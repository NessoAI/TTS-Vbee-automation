import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROLE_PROMPT_SOURCE,
  ROLE_PROMPT_VERSION,
  buildRolePrompt,
  computeSha256,
  getRolePromptTemplateContent,
  getRolePromptTemplateSha256
} from '../src/server/prompts.js';
import { parseDialogueV442, validateDialogue } from '../src/server/services/dialogue.js';

describe('V4.4.2 Prompt & Parser Unit Tests', () => {
  // Test 1: File template has full MỤC TIÊU, NGUYÊN TẮC TỐI CAO, BƯỚC 1 to BƯỚC 14, FORMAT OUTPUT, and LƯU Ý
  it('1. template contains all mandatory sections: MỤC TIÊU, NGUYÊN TẮC TỐI CAO, BƯỚC 1..14, FORMAT OUTPUT, LƯU Ý', () => {
    const content = getRolePromptTemplateContent();

    expect(content).toContain('MỤC TIÊU:');
    expect(content).toContain('NGUYÊN TẮC TỐI CAO:');
    expect(content).toContain('THỨ TỰ ƯU TIÊN BẮT BUỘC:');
    for (let i = 1; i <= 14; i++) {
      expect(content).toContain(`BƯỚC ${i} —`);
    }
    expect(content).toContain('FORMAT OUTPUT:');
    expect(content).toContain('LƯU Ý:');
    expect(content).toContain('[ DÁN VĂN BẢN GỐC VÀO ĐÂY ]');
  });

  // Test 2: SHA-256 of canonical file matches attached V4.4.2 file
  it('2. SHA-256 of canonical file matches attached V4.4.2 reference file after LF normalization', () => {
    const canonicalSha = getRolePromptTemplateSha256();
    const referencePath = path.resolve(process.cwd(), 'prompt  V4.4.2.txt');
    const referenceRaw = fs.readFileSync(referencePath, 'utf8');
    const referenceSha = computeSha256(referenceRaw);

    expect(canonicalSha).toBe(referenceSha);
    expect(canonicalSha).toBe('3e8236263e01b71f185fe172d78e6252099789400beda8eccc3b7305e57f20e2');
  });

  // Test 3 & 4 & 5: buildRolePrompt replaces exactly one placeholder completely without altering remainder
  it('3, 4, 5. buildRolePrompt replaces placeholder with correctedText completely without modifying remainder', () => {
    const sampleText = 'Văn bản kiểm tra HIRA an toàn lao động.';
    const result = buildRolePrompt(sampleText);

    expect(result.templateSha256).toBe(getRolePromptTemplateSha256());
    expect(result.rendered).toContain('VĂN BẢN GỐC:');
    expect(result.rendered).toContain('Văn bản kiểm tra HIRA an toàn lao động.');
    expect(result.rendered).toContain('Hãy chuyển văn bản gốc trên thành hội thoại TTS 2 người theo đúng toàn bộ nguyên tắc đã nêu.');
    expect(result.rendered).not.toContain('[ DÁN VĂN BẢN GỐC VÀO ĐÂY ]');
    expect(result.renderedSha256).toBe(computeSha256(result.rendered));
  });

  // Test 6: parseDialogueV442 parses roles and A/B turns
  it('6. parseDialogueV442 reads roles and dialogue turns correctly', () => {
    const raw = `Vai trò:
Người A: Trưởng nhóm hướng dẫn
Người B: Nhân viên vận hành

Kịch bản TTS 2 người:
Người A: Bây giờ chúng ta học HIRA.
Người B: Vâng ạ.`;

    const parsed = parseDialogueV442(raw);
    expect(parsed.roles.A).toBe('Trưởng nhóm hướng dẫn');
    expect(parsed.roles.B).toBe('Nhân viên vận hành');
    expect(parsed.dialogue).toHaveLength(2);
    expect(parsed.dialogue[0]).toEqual({ order: 1, speaker: 'A', text: 'Bây giờ chúng ta học HIRA.' });
    expect(parsed.dialogue[1]).toEqual({ order: 2, speaker: 'B', text: 'Vâng ạ.' });
  });

  // Test 7: Parser supports consecutive turns with same speaker
  it('7. parseDialogueV442 supports consecutive turns by same speaker', () => {
    const raw = `Vai trò:
Người A: Chuyên viên 1
Người B: Chuyên viên 2

Kịch bản TTS 2 người:
Người A: Lượt một của A.
Người A: Lượt hai của A tiếp theo.
Người B: Lượt của B.`;

    const parsed = parseDialogueV442(raw);
    expect(parsed.dialogue).toHaveLength(3);
    expect(parsed.dialogue[0].speaker).toBe('A');
    expect(parsed.dialogue[1].speaker).toBe('A');
    expect(parsed.dialogue[2].speaker).toBe('B');
  });

  // Test 8: Parser appends continuation lines without prefix
  it('8. parseDialogueV442 appends continuation lines to current turn', () => {
    const raw = `Vai trò:
Người A: Giảng viên
Người B: Học viên

Kịch bản TTS 2 người:
Người A: Câu thứ nhất.
Câu thứ hai của A trên dòng mới.
Người B: Trả lời của B.`;

    const parsed = parseDialogueV442(raw);
    expect(parsed.dialogue[0].text).toBe('Câu thứ nhất.\nCâu thứ hai của A trên dòng mới.');
    expect(parsed.dialogue[1].text).toBe('Trả lời của B.');
  });

  // Test 9: Colons inside turn content do not trigger false turn prefix
  it('9. colons inside content do not break parser', () => {
    const raw = `Vai trò:
Người A: Trưởng nhóm
Người B: Nhân viên

Kịch bản TTS 2 người:
Người A: Nhãn 1: Nội dung có dấu hai chấm. Ví dụ: HIRA là gì?
Người B: Trả lời: 100% an toàn.`;

    const parsed = parseDialogueV442(raw);
    expect(parsed.dialogue[0].text).toBe('Nhãn 1: Nội dung có dấu hai chấm. Ví dụ: HIRA là gì?');
    expect(parsed.dialogue[1].text).toBe('Trả lời: 100% an toàn.');
  });

  // Test 10: Missing heading or invalid format throws error
  it('10. throws clear error on missing headings or invalid format', () => {
    const badHeading = `Người A: Vai trò A
Kịch bản TTS 2 người:
Người A: Lượt 1.`;

    const badRoles = `Vai trò:
Kịch bản TTS 2 người:
Người A: Lượt 1.
Người B: Lượt 2.`;

    expect(() => parseDialogueV442(badHeading)).toThrow(/Output không đúng format V4.4.2/);
    expect(() => parseDialogueV442(badRoles)).toThrow(/Thiếu thông tin vai trò/);
  });

  // Test 11: Matching script passes validateDialogue
  it('11. dialogue script matching correctedText passes validateDialogue', () => {
    const correctedText = 'Bây giờ chúng ta học HIRA.\nVâng ạ.';
    const parsed = {
      roles: { A: 'A', B: 'B' },
      dialogue: [
        { order: 1, speaker: 'A' as const, text: 'Bây giờ chúng ta học HIRA.' },
        { order: 2, speaker: 'B' as const, text: 'Vâng ạ.' }
      ]
    };

    const issues = validateDialogue(correctedText, parsed);
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  // Test 12: Adding even one filler word yields CONTENT_MISMATCH
  it('12. dialogue script with added filler word yields CONTENT_MISMATCH error', () => {
    const correctedText = 'Bây giờ chúng ta học HIRA.';
    const parsedWithFiller = {
      roles: { A: 'A', B: 'B' },
      dialogue: [
        { order: 1, speaker: 'A' as const, text: 'Chào bạn, bây giờ chúng ta học HIRA.' },
        { order: 2, speaker: 'B' as const, text: 'Đúng rồi.' }
      ]
    };

    const issues = validateDialogue(correctedText, parsedWithFiller);
    const errors = issues.filter(i => i.code === 'CONTENT_MISMATCH');
    expect(errors.length).toBeGreaterThan(0);
  });

  // Test 13: Job metadata fields check
  it('13. metadata constants and version properties match expected values', () => {
    expect(ROLE_PROMPT_VERSION).toBe('4.4.2');
    expect(ROLE_PROMPT_SOURCE).toBe('config/prompts/role-v4.4.2.txt');
  });

  // Test 14: No runtime reference to old shortened ROLE_PROMPT
  it('14. verifies old shortened ROLE_PROMPT is not exported by prompts module', async () => {
    const promptsModule = await import('../src/server/prompts.js');
    expect((promptsModule as Record<string, unknown>).ROLE_PROMPT).toBeUndefined();
  });
});
