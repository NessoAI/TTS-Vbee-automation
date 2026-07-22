import { describe, expect, it } from 'vitest';
import { parseDialogue, validateCorrection, validateDialogue } from '../src/server/services/dialogue.js';

describe('dialogue parser and validator', () => {
  it('parses JSON even when ChatGPT wraps it in a code fence', () => {
    const result = parseDialogue('```json\n{"roles":{"A":"Trainer","B":"Learner"},"dialogue":[{"order":1,"speaker":"A","text":"Một."},{"order":2,"speaker":"B","text":"Hai."}]}\n```');
    expect(result.dialogue).toHaveLength(2);
  });

  it('accepts preserved content', () => {
    const result = {
      roles: { A: 'Trainer', B: 'Learner' },
      dialogue: [
        { order: 1, speaker: 'A' as const, text: 'Một.' },
        { order: 2, speaker: 'B' as const, text: 'Hai.' }
      ]
    };
    expect(validateDialogue('Một.\n\nHai.', result)).toEqual([]);
  });

  it('blocks content mismatch and long blocks', () => {
    const result = {
      roles: { A: 'Trainer', B: 'Learner' },
      dialogue: [
        { order: 1, speaker: 'A' as const, text: 'x'.repeat(1001) },
        { order: 2, speaker: 'B' as const, text: 'Khác.' }
      ]
    };
    const codes = validateDialogue('Nội dung gốc.', result).map((issue) => issue.code);
    expect(codes).toContain('BLOCK_TOO_LONG');
    expect(codes).toContain('CONTENT_MISMATCH');
  });
});

describe('sourceText -> correctedText correction validator', () => {
  it('flags added word "Edit" as ERROR', () => {
    const source = 'Bây giờ chúng ta học an toàn.';
    const corrected = 'Edit Bây giờ chúng ta học an toàn.';
    const issues = validateCorrection(source, corrected);
    expect(issues.some(i => i.severity === 'error')).toBe(true);
  });

  it('flags removal of list numbers 1-4 as ERROR', () => {
    const source = '1. Mục một. 2. Mục hai. 3. Mục ba. 4. Mục bốn.';
    const corrected = 'Mục một. Mục hai. Mục ba. Mục bốn.';
    const issues = validateCorrection(source, corrected);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(issues.map(i => i.code)).toContain('NUMBERS_MISMATCH');
  });

  it('passes when only punctuation and whitespace change', () => {
    const source = 'Bây giờ, chúng ta sẽ học HIRA! (rất quan trọng)';
    const corrected = 'Bây giờ chúng ta sẽ học HIRA, rất quan trọng.';
    const issues = validateCorrection(source, corrected);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('flags small typo fix in a single token as WARNING, not ERROR', () => {
    const source = 'Bây giờ ngiệp vụ an toàn.';
    const corrected = 'Bây giờ nghiệp vụ an toàn.';
    const issues = validateCorrection(source, corrected);
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    expect(errors).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].code).toBe('TYPO_CORRECTED');
  });

  it('flags modified numbers/numerical data as ERROR', () => {
    const source = 'Quy trình gồm 4 bước và tốc độ 1.05x.';
    const corrected = 'Quy trình gồm 5 bước và tốc độ 1.00x.';
    const issues = validateCorrection(source, corrected);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });
});
