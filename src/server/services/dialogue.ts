import { z } from 'zod';
import type { DialogueResult, ValidationIssue } from '../../shared/types.js';

const schema = z.object({
  roles: z.object({ A: z.string().min(1), B: z.string().min(1) }),
  dialogue: z.array(z.object({
    order: z.number().int().positive(),
    speaker: z.enum(['A', 'B']),
    text: z.string().min(1)
  })).min(2)
});

export function parseDialogue(raw: string): DialogueResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return schema.parse(JSON.parse(cleaned));
}

export function parseDialogueV442(raw: string): DialogueResult {
  const cleaned = raw.trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  const vaiTroIdx = cleaned.search(/Vai trò\s*:/i);
  const kichBanIdx = cleaned.search(/Kịch bản TTS 2 người\s*:/i);

  if (vaiTroIdx === -1 || kichBanIdx === -1 || kichBanIdx <= vaiTroIdx) {
    throw new Error('Output không đúng format V4.4.2: Thiếu heading "Vai trò:" hoặc "Kịch bản TTS 2 người:".');
  }

  const rolesText = cleaned.slice(vaiTroIdx, kichBanIdx);
  const matchA = rolesText.match(/Người A\s*:\s*(.+)/i);
  const matchB = rolesText.match(/Người B\s*:\s*(.+)/i);

  if (!matchA || !matchB) {
    throw new Error('Thiếu thông tin vai trò Người A hoặc Người B trong format V4.4.2.');
  }

  const roleA = matchA[1].trim();
  const roleB = matchB[1].trim();

  const scriptHeaderMatch = cleaned.slice(kichBanIdx).match(/Kịch bản TTS 2 người\s*:/i);
  const headerLen = scriptHeaderMatch ? scriptHeaderMatch[0].length : 'Kịch bản TTS 2 người:'.length;
  const scriptText = cleaned.slice(kichBanIdx + headerLen);
  const lines = scriptText.split(/\r?\n/);

  const dialogue: { order: number; speaker: 'A' | 'B'; text: string }[] = [];
  let currentTurn: { order: number; speaker: 'A' | 'B'; text: string } | null = null;

  for (const line of lines) {
    const prefixMatch = line.match(/^\s*(Người [AB])\s*:\s*(.*)$/i);
    if (prefixMatch) {
      const speaker = prefixMatch[1].toUpperCase().includes('A') ? 'A' : 'B';
      currentTurn = {
        order: dialogue.length + 1,
        speaker,
        text: prefixMatch[2]
      };
      dialogue.push(currentTurn);
    } else {
      if (currentTurn) {
        if (line.trim() !== '' || currentTurn.text.trim() !== '') {
          currentTurn.text += '\n' + line;
        }
      } else if (line.trim() !== '') {
        throw new Error('Nội dung kịch bản nằm ngoài lượt thoại người nói.');
      }
    }
  }

  for (const turn of dialogue) {
    turn.text = turn.text.trim();
  }

  const validTurns = dialogue.filter((t) => t.text.length > 0);
  if (validTurns.length < 2) {
    throw new Error('Kịch bản V4.4.2 phải có ít nhất 2 lượt thoại.');
  }

  for (let i = 0; i < validTurns.length; i++) {
    validTurns[i].order = i + 1;
  }

  return {
    roles: { A: roleA, B: roleB },
    dialogue: validTurns
  };
}

function normalizeForComparison(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

export function validateDialogue(correctedText: string, result: DialogueResult, maxChars = 1000): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const orders = result.dialogue.map((turn) => turn.order);
  const expected = result.dialogue.map((_, index) => index + 1);
  if (orders.some((order, index) => order !== expected[index])) {
    issues.push({ code: 'ORDER_INVALID', message: 'Thứ tự dialogue không liên tục từ 1.', severity: 'error' });
  }
  const speakers = new Set(result.dialogue.map((turn) => turn.speaker));
  if (!speakers.has('A') || !speakers.has('B')) {
    issues.push({ code: 'SPEAKER_MISSING', message: 'Cả Người A và Người B đều phải có lời thoại.', severity: 'error' });
  }
  for (const turn of result.dialogue) {
    if (turn.text.length > maxChars) {
      issues.push({ code: 'BLOCK_TOO_LONG', message: `Block ${turn.order} có ${turn.text.length}/${maxChars} ký tự.`, turn: turn.order, severity: 'error' });
    }
  }
  const joined = result.dialogue.map((turn) => turn.text).join('\n');
  if (normalizeForComparison(joined) !== normalizeForComparison(correctedText)) {
    issues.push({ code: 'CONTENT_MISMATCH', message: 'Nội dung ghép từ các block không khớp văn bản đã hiệu chỉnh.', severity: 'error' });
  }
  return issues;
}

function cleanPunctuation(text: string): string {
  return text
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
    .replace(/[:;()?!\n\r\-\"\'“”«»/\\_#*~`]/g, ' ');
}

export function tokenize(text: string): string[] {
  return cleanPunctuation(text)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function isNumericToken(token: string): boolean {
  return /^\d+(?:[.,]\d+)*$/.test(token);
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function validateCorrection(sourceText: string, correctedText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const srcTokens = tokenize(sourceText);
  const corrTokens = tokenize(correctedText);

  const srcNums = srcTokens.filter(isNumericToken);
  const corrNums = corrTokens.filter(isNumericToken);

  if (srcNums.join(',') !== corrNums.join(',')) {
    issues.push({
      code: 'NUMBERS_MISMATCH',
      message: `Số liệu/số thứ tự trong văn bản hiệu chỉnh không khớp văn bản gốc. Gốc: [${srcNums.join(', ')}], Hiệu chỉnh: [${corrNums.join(', ')}]`,
      severity: 'error'
    });
  }

  if (srcTokens.length !== corrTokens.length) {
    issues.push({
      code: 'TOKEN_COUNT_MISMATCH',
      message: `Số lượng từ trong văn bản hiệu chỉnh (${corrTokens.length}) không khớp văn bản gốc (${srcTokens.length}).`,
      severity: 'error'
    });
  } else {
    for (let i = 0; i < srcTokens.length; i++) {
      const t1 = srcTokens[i];
      const t2 = corrTokens[i];
      if (t1 !== t2) {
        if (isNumericToken(t1) || isNumericToken(t2)) {
          issues.push({
            code: 'NUMBER_MODIFIED',
            message: `Số liệu '${t1}' bị thay đổi thành '${t2}'.`,
            severity: 'error'
          });
        } else {
          const dist = levenshteinDistance(t1, t2);
          if (dist <= 2) {
            issues.push({
              code: 'TYPO_CORRECTED',
              message: `Đã hiệu chỉnh chính tả nhỏ: '${t1}' -> '${t2}'.`,
              severity: 'warning'
            });
          } else {
            issues.push({
              code: 'TOKEN_MISMATCH',
              message: `Từ '${t1}' bị thay đổi thành '${t2}'.`,
              severity: 'error'
            });
          }
        }
      }
    }
  }

  return issues;
}

export interface CharacterToken {
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface RestorationResult {
  text: string;
  restored: string[];
  unresolved: string[];
}

export function tokenizeWithIndices(text: string): CharacterToken[] {
  const tokens: CharacterToken[] = [];
  const regex = /[^\s.,:;()?!\n\r\-\"\'“”«»/\\_#*~`]+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      text: match[0].toLowerCase(),
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }
  return tokens;
}

export function restoreNumberedListMarkers(sourceText: string, correctedText: string): RestorationResult {
  const lines = sourceText.split(/\r?\n/);
  const markerRegex = /^\s*(\d+[\.\)])\s+/;

  const corrTokens = tokenizeWithIndices(correctedText);
  const insertions: { insertIndex: number; marker: string; anchorText: string }[] = [];
  const restored: string[] = [];
  const unresolved: string[] = [];

  for (const line of lines) {
    const match = line.match(markerRegex);
    if (!match) continue;

    const marker = match[1];
    const remainder = line.slice(match[0].length);
    const anchorTokens = tokenize(remainder).slice(0, 8);
    if (anchorTokens.length === 0) continue;

    const matches: CharacterToken[] = [];
    const len = anchorTokens.length;
    for (let i = 0; i <= corrTokens.length - len; i++) {
      let isMatch = true;
      for (let j = 0; j < len; j++) {
        if (corrTokens[i + j].text !== anchorTokens[j]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matches.push(corrTokens[i]);
      }
    }

    if (matches.length === 1) {
      const targetToken = matches[0];
      const prefix = correctedText.slice(Math.max(0, targetToken.startIndex - 15), targetToken.startIndex);
      const escapedMarker = marker.replace(/[\.\)]/g, '\\$&');
      const alreadyHasMarker = new RegExp(`(?:^|\\s)${escapedMarker}\\s*$`).test(prefix);

      if (!alreadyHasMarker) {
        insertions.push({
          insertIndex: targetToken.startIndex,
          marker,
          anchorText: anchorTokens.join(' ')
        });
        restored.push(marker);
      }
    } else {
      unresolved.push(`${marker} (${anchorTokens.join(' ')})`);
    }
  }

  const uniqueInsertionsMap = new Map<number, { insertIndex: number; marker: string; anchorText: string }>();
  for (const ins of insertions) {
    if (!uniqueInsertionsMap.has(ins.insertIndex)) {
      uniqueInsertionsMap.set(ins.insertIndex, ins);
    }
  }
  const sortedInsertions = Array.from(uniqueInsertionsMap.values()).sort((a, b) => b.insertIndex - a.insertIndex);

  let resultText = correctedText;
  for (const ins of sortedInsertions) {
    resultText = resultText.slice(0, ins.insertIndex) + `${ins.marker} ` + resultText.slice(ins.insertIndex);
  }

  return {
    text: resultText,
    restored,
    unresolved
  };
}
