import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { moveWithoutOverwrite } from '../src/server/services/files.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('RAR move', () => {
  it('adds (2) instead of overwriting', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tts-poe-'));
    roots.push(root);
    const downloads = path.join(root, 'downloads');
    const destination = path.join(root, 'destination');
    await fs.mkdir(downloads); await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'Project.rar'), 'old');
    const source = path.join(downloads, 'Project.rar');
    await fs.writeFile(source, 'new');
    const target = await moveWithoutOverwrite(source, destination);
    expect(path.basename(target)).toBe('Project (2).rar');
    await expect(fs.access(source)).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('new');
  });
});
