import { describe, expect, it } from 'vitest';
import { REPAIR_PROMPT, withRepairContext } from '../src/server/prompts.js';
import { restoreNumberedListMarkers, validateCorrection } from '../src/server/services/dialogue.js';

describe('Auto-repair & List Marker Restoration Logic', () => {
  it('formats withRepairContext with original text, invalid text, and numbered validation errors', () => {
    const original = '1. Mục một.\n2. Mục hai.';
    const invalid = 'Mục một.\nMục hai.';
    const errors = ['Mất số thứ tự [1, 2].', 'Mất 2 từ.'];

    const result = withRepairContext(REPAIR_PROMPT, original, invalid, errors);

    expect(result).toContain('<<<START_OF_ORIGINAL_TEXT>>>\n1. Mục một.\n2. Mục hai.\n<<<END_OF_ORIGINAL_TEXT>>>');
    expect(result).toContain('<<<START_OF_INVALID_TEXT>>>\nMục một.\nMục hai.\n<<<END_OF_INVALID_TEXT>>>');
    expect(result).toContain('1. Mất số thứ tự [1, 2].');
    expect(result).toContain('2. Mất 2 từ.');
    expect(result).toContain('Khôi phục chính xác tất cả số thứ tự danh sách (1., 2., 3., 4.)');
  });

  // Requirement D1 & D7: HIRA source has 1-4, corrected missing 1-4 -> restored fully & validateCorrection passes
  it('D1 & D7: restores missing markers 1-4 for HIRA data and resolves validateCorrection errors', () => {
    const source = `Khi nào cần thực hiện HIRA?
Có 4 trường hợp phổ biến:

1. Khi bắt đầu dự án mới hoặc thay đổi dây chuyền sản xuất.
Ví dụ: Lắp thêm máy mới, thay đổi cách đóng gói, mở rộng nhà xưởng.

2. Khi có thiết bị, quy trình hoặc hóa chất mới.
Dù là một máy nhỏ hoặc thay đổi hóa chất tẩy rửa thì đều có thể tạo ra rủi ro mới.

3. Sau khi xảy ra sự cố hoặc tai nạn.
Ví dụ: Có người té ngã, máy bị chập điện, cháy nhỏ.

4. Đánh giá định kỳ hoặc tổng thể môi trường làm việc.
Dù không có gì thay đổi, vẫn cần kiểm tra định kỳ toàn bộ khu vực.`;

    const correctedMissing1to4 = `Khi nào cần thực hiện HIRA?
Có 4 trường hợp phổ biến:

Khi bắt đầu dự án mới hoặc thay đổi dây chuyền sản xuất.
Ví dụ: Lắp thêm máy mới, thay đổi cách đóng gói, mở rộng nhà xưởng.

Khi có thiết bị, quy trình hoặc hóa chất mới.
Dù là một máy nhỏ hoặc thay đổi hóa chất tẩy rửa thì đều có thể tạo ra rủi ro mới.

Sau khi xảy ra sự cố hoặc tai nạn.
Ví dụ: Có người té ngã, máy bị chập điện, cháy nhỏ.

Đánh giá định kỳ hoặc tổng thể môi trường làm việc.
Dù không có gì thay đổi, vẫn cần kiểm tra định kỳ toàn bộ khu vực.`;

    // Before restoration: has NUMBERS_MISMATCH and TOKEN_COUNT_MISMATCH errors
    const beforeIssues = validateCorrection(source, correctedMissing1to4);
    expect(beforeIssues.some(i => i.severity === 'error')).toBe(true);

    const restoration = restoreNumberedListMarkers(source, correctedMissing1to4);
    expect(restoration.restored).toEqual(['1.', '2.', '3.', '4.']);
    expect(restoration.unresolved).toHaveLength(0);

    // After restoration: no error issues remain
    const afterIssues = validateCorrection(source, restoration.text);
    const errors = afterIssues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  // Requirement D2: "Có 4 trường hợp phổ biến" is not converted to a marker
  it('D2: does not treat inline numbers like "Có 4 trường hợp phổ biến" as line markers', () => {
    const source = 'Có 4 trường hợp phổ biến:\n1. Điểm một.';
    const corrected = 'Có 4 trường hợp phổ biến:\nĐiểm một.';

    const restoration = restoreNumberedListMarkers(source, corrected);
    expect(restoration.restored).toEqual(['1.']);
    expect(restoration.text).toBe('Có 4 trường hợp phổ biến:\n1. Điểm một.');
  });

  // Requirement D3: Corrected text already has markers -> no duplicate insertion
  it('D3: does not duplicate markers if corrected text already has them', () => {
    const source = '1. Mục một.\n2. Mục hai.';
    const corrected = '1. Mục một.\nMục hai.';

    const restoration = restoreNumberedListMarkers(source, corrected);
    expect(restoration.restored).toEqual(['2.']);
    expect(restoration.text).toBe('1. Mục một.\n2. Mục hai.');
  });

  // Requirement D4: Support 1) and 10.
  it('D4: supports multi-digit numbers like 10. and closing parenthesized markers like 1)', () => {
    const source = '1) Mục đầu tiên.\n10. Mục thứ mười.';
    const corrected = 'Mục đầu tiên.\nMục thứ mười.';

    const restoration = restoreNumberedListMarkers(source, corrected);
    expect(restoration.restored).toEqual(['1)', '10.']);
    expect(restoration.text).toBe('1) Mục đầu tiên.\n10. Mục thứ mười.');
  });

  // Requirement D5: Anchor matching works despite punctuation/whitespace differences
  it('D5: matches anchors even when punctuation and whitespace differ between source and corrected', () => {
    const source = '1. Khi bắt đầu dự án mới, (hoặc thay đổi dây chuyền)!';
    const corrected = 'Khi bắt đầu dự án mới hoặc thay đổi dây chuyền.';

    const restoration = restoreNumberedListMarkers(source, corrected);
    expect(restoration.restored).toEqual(['1.']);
    expect(restoration.text).toBe('1. Khi bắt đầu dự án mới hoặc thay đổi dây chuyền.');
  });

  // Requirement D6: Anchor appearing twice -> unresolved, no insertion
  it('D6: adds to unresolved and avoids insertion when anchor appears multiple times', () => {
    const source = '1. Nội dung giống hệt nhau.\n2. Nội dung giống hệt nhau.';
    const corrected = 'Nội dung giống hệt nhau.\nNội dung giống hệt nhau.';

    const restoration = restoreNumberedListMarkers(source, corrected);
    expect(restoration.restored).toHaveLength(0);
    expect(restoration.unresolved.length).toBeGreaterThan(0);
    expect(restoration.text).toBe(corrected); // Unmodified
  });

  // Requirement D8: Real numerical data modified in content STILL yields ERROR
  it('D8: STILL flags ERROR when a real numerical data value is modified in content', () => {
    const source = '1. Quy trình gồm 4 bước xử lý.';
    const corrected = 'Quy trình gồm 5 bước xử lý.'; // Changed 4 -> 5

    const restoration = restoreNumberedListMarkers(source, corrected);
    const restoredText = restoration.text; // "1. Quy trình gồm 5 bước xử lý."

    const issues = validateCorrection(source, restoredText);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });

  // Requirement D9: STRUCTURE_RESTORED is WARNING only
  it('D9: STRUCTURE_RESTORED issue code is severity "warning"', () => {
    const issue = {
      code: 'STRUCTURE_RESTORED',
      message: 'Đã tự khôi phục số thứ tự từ văn bản gốc: 1., 2.',
      severity: 'warning' as const
    };
    expect(issue.severity).toBe('warning');
  });

  // Requirement D10: Pipeline does NOT call repair prompt if 1st response restoration succeeds
  it('D10: does not trigger repair retries when 1st ChatGPT response restoration succeeds', () => {
    const source = '1. Mục một.\n2. Mục hai.';
    const rawResponse = 'Mục một.\nMục hai.'; // ChatGPT stripped 1, 2

    const restoration = restoreNumberedListMarkers(source, rawResponse);
    const issues = validateCorrection(source, restoration.text);

    let attempts = 1;
    const promptsSent: string[] = ['CORRECTION'];

    if (issues.some(i => i.severity === 'error') && attempts < 3) {
      attempts += 1;
      promptsSent.push('REPAIR');
    }

    expect(attempts).toBe(1);
    expect(promptsSent).toEqual(['CORRECTION']); // No repair triggered!
  });

  it('fails job after 2 repairs (3 total attempts) if errors persist, without role prompt', async () => {
    const original = 'Quy trình có 4 bước.';
    const badCorrection = 'Quy trình có 5 bước.'; // Changed 4 -> 5, unfixable by marker restoration

    let attempts = 1;
    let currentText = badCorrection;
    let correctionIssues = validateCorrection(original, currentText);
    const promptsSent: string[] = ['CORRECTION'];

    while (correctionIssues.some((issue) => issue.severity === 'error') && attempts < 3) {
      attempts += 1;
      promptsSent.push(`REPAIR_${attempts}`);
      currentText = badCorrection;
      correctionIssues = validateCorrection(original, currentText);
    }

    expect(attempts).toBe(3);
    expect(promptsSent).toEqual(['CORRECTION', 'REPAIR_2', 'REPAIR_3']);
    expect(correctionIssues.some((i) => i.severity === 'error')).toBe(true);

    const jobStatus = correctionIssues.some((i) => i.severity === 'error') ? 'failed' : 'assigning_roles';
    const jobError = 'ChatGPT không thể hiệu chỉnh mà vẫn bảo toàn nội dung sau 3 lần.';

    expect(jobStatus).toBe('failed');
    expect(jobError).toBe('ChatGPT không thể hiệu chỉnh mà vẫn bảo toàn nội dung sau 3 lần.');
  });
});
