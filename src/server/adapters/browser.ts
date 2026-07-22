import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { AppConfig } from '../../shared/types.js';

export class BrowserManager {
  private context?: BrowserContext;

  constructor(private readonly config: AppConfig) {}

  async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.context = await chromium.launchPersistentContext(
      path.resolve(process.cwd(), this.config.browser.profileDir),
      {
        headless: this.config.browser.headless,
        channel: this.config.browser.channel === 'chromium' ? undefined : this.config.browser.channel,
        acceptDownloads: true,
        permissions: ['clipboard-read', 'clipboard-write'],
        viewport: { width: 1440, height: 960 }
      }
    );
    this.context.setDefaultTimeout(this.config.automation.timeoutMs);
    return this.context;
  }

  async pageFor(hostname: string): Promise<Page> {
    const context = await this.getContext();
    const existing = context.pages().find((page) => {
      try { return new URL(page.url()).hostname.includes(hostname); } catch { return false; }
    });
    return existing ?? context.newPage();
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
  }
}
