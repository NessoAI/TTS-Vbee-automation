import fs from 'node:fs/promises';
import path from 'node:path';

export async function snapshotRars(directory: string): Promise<Set<string>> {
  try {
    return new Set((await fs.readdir(directory)).filter((name) => name.toLowerCase().endsWith('.rar')));
  } catch {
    return new Set();
  }
}

async function waitForStableSize(filePath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let previous = -1;
  let stableCount = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const size = (await fs.stat(filePath)).size;
      stableCount = size === previous && size > 0 ? stableCount + 1 : 0;
      previous = size;
      if (stableCount >= 2) return;
    } catch { /* file is not complete yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`File tải xuống chưa ổn định sau ${timeoutMs}ms: ${filePath}`);
}

export async function waitForNewRar(directory: string, before: Set<string>, timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const names = await fs.readdir(directory);
    const found = names.find((name) => name.toLowerCase().endsWith('.rar') && !before.has(name));
    if (found) {
      const fullPath = path.join(directory, found);
      await waitForStableSize(fullPath, timeoutMs - (Date.now() - start));
      return fullPath;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Không phát hiện file RAR mới trong thư mục Downloads.');
}

export async function moveWithoutOverwrite(source: string, destinationDir: string): Promise<string> {
  await fs.mkdir(destinationDir, { recursive: true });
  const parsed = path.parse(source);
  let target = path.join(destinationDir, parsed.base);
  let index = 2;
  while (true) {
    try {
      await fs.access(target);
      target = path.join(destinationDir, `${parsed.name} (${index++})${parsed.ext}`);
    } catch { break; }
  }
  // Downloads is on C: while the destination is on D:. rename() cannot cross
  // Windows volumes, so copy, verify, then remove the source.
  await fs.copyFile(source, target);
  const [sourceStat, targetStat] = await Promise.all([fs.stat(source), fs.stat(target)]);
  if (sourceStat.size !== targetStat.size || targetStat.size === 0) {
    throw new Error('File RAR được sao chép nhưng không vượt qua kiểm tra dung lượng.');
  }
  await fs.unlink(source);
  return target;
}
