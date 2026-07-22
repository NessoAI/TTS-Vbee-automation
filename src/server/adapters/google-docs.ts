import type { Page } from 'playwright';
import { BrowserManager } from './browser.js';

export interface ExtractedDocument {
  title: string;
  text: string;
  tabCount: number;
}

/**
 * Google Docs renders its editor and tab tree dynamically. Extraction uses
 * trusted keyboard input so it works with the authenticated page without API.
 * The selectors are intentionally centralized for later calibration.
 */
export class GoogleDocsAdapter {
  constructor(private readonly browser: BrowserManager) {}

  private async copyCurrentTab(page: Page): Promise<string> {
    const editor = page.locator('.kix-appview-editor, [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible' });
    await editor.click({ position: { x: 300, y: 250 } });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(250);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    await page.keyboard.press('ArrowRight');
    return text.trim();
  }

  private async revealTabs(page: Page): Promise<void> {
    const candidates = [
      page.getByLabel(/Mở rộng thanh bên của thẻ và bố cục/i),
      page.getByLabel(/tabs.*outline|outline.*tabs/i),
      page.getByLabel(/thẻ.*dàn ý|dàn ý.*thẻ/i),
      page.getByRole('button', { name: /tabs|thẻ tài liệu/i })
    ];
    for (const locator of candidates) {
      if (await locator.first().isVisible().catch(() => false)) {
        await locator.first().click();
        return;
      }
    }
  }

  async extract(url: string): Promise<ExtractedDocument> {
    const page = await this.browser.pageFor('docs.google.com');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.kix-appview-editor, [contenteditable="true"]');

    const title = (await page.locator('#docs-title-input').inputValue().catch(() => ''))
      || (await page.title()).replace(/\s*-\s*Google (?:Docs|Tài liệu).*$/i, '')
      || 'Google Doc';

    await this.revealTabs(page);
    // Expand nested tab groups before counting them.
    const expanders = page.getByRole('button', { name: /Mở rộng các thẻ con|Expand child tabs/i });
    while (await expanders.count()) {
      const visible = expanders.filter({ visible: true }).first();
      if (!await visible.isVisible().catch(() => false)) break;
      await visible.click();
      await page.waitForTimeout(150);
    }
    const treeItemSelector = '.topLevelChapterContainerChaptered [role="treeitem"]:visible, [aria-label="Các thẻ trong tài liệu"] [role="treeitem"]:visible';
    const tabLocators = page.locator(treeItemSelector);
    const count = await tabLocators.count();
    const parts: string[] = [];

    if (count === 0) {
      const text = await this.copyCurrentTab(page);
      if (text) parts.push(text);
    } else {
      // Re-locate by index each time because switching tabs can re-render the tree.
      for (let index = 0; index < count; index += 1) {
        const tab = page.locator(treeItemSelector).nth(index);
        await tab.click();
        await page.waitForTimeout(500);
        const text = await this.copyCurrentTab(page);
        if (text) parts.push(text);
      }
    }

    if (!parts.length) throw new Error('Không lấy được nội dung văn bản từ Google Docs.');
    return { title: title.trim(), text: parts.join('\n\n'), tabCount: Math.max(count, 1) };
  }
}
