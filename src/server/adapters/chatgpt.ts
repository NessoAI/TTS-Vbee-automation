import type { Page } from 'playwright';
import type { AppConfig } from '../../shared/types.js';
import { BrowserManager } from './browser.js';

export interface ChatGptSession {
  page: Page;
}

export class ChatGptAdapter {
  constructor(private readonly browser: BrowserManager, private readonly config: AppConfig) {}

  async createSession(): Promise<ChatGptSession> {
    const page = await this.browser.pageFor('chatgpt.com');
    await this.openNewProjectChat(page);
    return { page };
  }

  async sendPrompt(session: ChatGptSession, prompt: string): Promise<string> {
    return this.send(session.page, prompt);
  }

  private async openNewProjectChat(page: Page): Promise<void> {
    if (this.config.chatgpt.projectUrl) {
      // Direct navigation avoids the sidebar row behavior: clicking the project
      // name only expands/collapses its chats instead of opening project home.
      await page.goto(this.config.chatgpt.projectUrl, { waitUntil: 'domcontentloaded' });
    } else {
      await page.goto(this.config.chatgpt.baseUrl, { waitUntil: 'domcontentloaded' });
      const label = page.getByText(this.config.chatgpt.projectName, { exact: true }).first();
      await label.waitFor({ state: 'visible' });
      const row = label.locator('xpath=ancestor::div[@role="button" and @data-sidebar-item="true"][1]');
      await row.hover();
      await row.getByRole('button', { name: 'Open project home', exact: true }).click();
    }
    // The project home composer itself creates a fresh chat. Do not click the
    // global sidebar "New chat" because that would leave the project.
    await page.locator(`#prompt-textarea[aria-label="New chat in ${this.config.chatgpt.projectName}"][contenteditable="true"], [role="textbox"][aria-label="New chat in ${this.config.chatgpt.projectName}"]`).waitFor({ state: 'visible' });
  }

  private async getAssistantContent(page: Page): Promise<string> {
    const assistant = page.locator('[data-message-author-role="assistant"]').last();
    const markdown = assistant.locator('.markdown').first();
    if (await markdown.isVisible().catch(() => false)) {
      return (await markdown.innerText()).trim();
    }
    const contentPart = assistant.locator('[data-message-content-part]').first();
    if (await contentPart.isVisible().catch(() => false)) {
      return (await contentPart.innerText()).trim();
    }
    throw new Error('Không tìm thấy vùng nội dung phản hồi hợp lệ từ ChatGPT (thiếu .markdown hoặc [data-message-content-part]).');
  }

  private async send(page: Page, prompt: string): Promise<string> {
    const assistants = page.locator('[data-message-author-role="assistant"]');
    const priorCount = await assistants.count();
    const composer = page.locator('#prompt-textarea, textarea[placeholder], [contenteditable="true"]').last();
    await composer.waitFor({ state: 'visible' });
    await composer.fill(prompt).catch(async () => {
      await composer.click();
      await page.keyboard.insertText(prompt);
    });
    await page.keyboard.press('Enter');

    await page.waitForFunction(
      ({ selector, prior }) => document.querySelectorAll(selector).length > prior,
      { selector: '[data-message-author-role="assistant"]', prior: priorCount }
    );

    let previous = '';
    let stable = 0;
    const deadline = Date.now() + this.config.automation.timeoutMs;
    while (Date.now() < deadline) {
      let current = '';
      try {
        current = await this.getAssistantContent(page);
      } catch {
        // Vùng nội dung chưa sẵn sàng, tiếp tục chờ
      }
      const stopVisible = await page.getByRole('button', { name: /stop|dừng/i }).isVisible().catch(() => false);
      stable = current && current === previous && !stopVisible ? stable + 1 : 0;
      if (stable >= 3) return current;
      previous = current;
      await page.waitForTimeout(1000);
    }
    throw new Error('ChatGPT không hoàn tất phản hồi trong thời gian cho phép.');
  }

  async process(correctionPrompt: string, rolePrompt: string): Promise<{ corrected: string; dialogueRaw: string }> {
    const session = await this.createSession();
    const corrected = await this.sendPrompt(session, correctionPrompt);
    const dialogueRaw = await this.sendPrompt(session, rolePrompt.replace('{{TEXT}}', corrected));
    return { corrected, dialogueRaw };
  }
}
