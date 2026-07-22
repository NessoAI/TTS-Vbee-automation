import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../shared/types.js';

export function loadConfig(): AppConfig {
  const configPath = path.resolve(process.cwd(), process.env.APP_CONFIG ?? 'config/default.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;
  if (process.env.DRY_RUN) raw.automation.dryRun = process.env.DRY_RUN !== 'false';
  return raw;
}
