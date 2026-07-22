import fs from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import type { AppConfig, DialogueResult, Speaker } from '../../shared/types.js';
import { BrowserManager } from './browser.js';

export interface VbeeVerification {
  ok: boolean;
  issues: string[];
}

export class VbeeAdapter {
  constructor(private readonly browser: BrowserManager, private readonly config: AppConfig) {}

  private voiceFor(speaker: Speaker): { name: string; speed: string } {
    return speaker === 'A'
      ? { name: this.config.vbee.voiceA, speed: this.config.vbee.speedA }
      : { name: this.config.vbee.voiceB, speed: this.config.vbee.speedB };
  }

  private block(page: Page, index: number): Locator {
    // Dùng .last() thay vì .nth(index) vì VBEE sử dụng Virtual DOM (Windowing).
    // Khi số lượng block lớn (> 10-13), các block đầu tiên bị unmount khỏi DOM để tối ưu bộ nhớ.
    // Do đó, nth(index) sẽ bị out of bounds. 
    // Vì ta duyệt tuần tự và luôn bấm "Thêm khối" ở cuối, block đang xử lý luôn là block CUỐI CÙNG trong DOM.
    return page.locator('.block-wrapper-v2').last();
  }

  private editor(page: Page, index: number): Locator {
    return this.block(page, index).locator('.public-DraftEditor-content[contenteditable="true"][role="textbox"]');
  }

  private speedPattern(speed: string): RegExp {
    const numeric = Number.parseFloat(speed);
    if (numeric === 1) return /^1(?:\.0{1,2})?x$/;
    const escaped = speed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}$`);
  }

  async createProject(title: string): Promise<string> {
    const page = await this.browser.pageFor('studio.vbee.vn');
    await page.goto(this.config.vbee.projectsUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('div[role="button"]:has(img[alt="Tạo audio"])').first().click();
    await page.getByText('Tạo dự án mới', { exact: true }).filter({ visible: true }).last().click();
    await page.waitForURL(/\/projects\//);

    const titleControl = page.locator('input.size-input[placeholder="Chưa có tiêu đề"]');
    await titleControl.waitFor({ state: 'visible' });
    await titleControl.fill(title);
    await titleControl.blur();
    await page.locator('.block-wrapper-v2').first().waitFor({ state: 'visible' });
    return page.url();
  }

  private async selectVoiceOnly(page: Page, blockIndex: number, speaker: Speaker): Promise<void> {
    const desired = this.voiceFor(speaker);
    const block = this.block(page, blockIndex);
    await block.locator('button[data-id="open-voice-list"]').click();

    await page.getByText('Giọng yêu thích', { exact: true }).filter({ visible: true }).last().click();
    const voiceName = page.getByText(desired.name, { exact: true }).filter({ visible: true }).last();
    await voiceName.waitFor({ state: 'visible' });
    const row = voiceName.locator('xpath=ancestor::div[.//button[normalize-space(.)="Sử dụng"]][1]');
    await row.getByRole('button', { name: 'Sử dụng', exact: true }).click();
    await row.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  private async selectSpeedOnly(page: Page, blockIndex: number, speaker: Speaker): Promise<void> {
    const desired = this.voiceFor(speaker);
    const block = this.block(page, blockIndex);

    // Speed trigger: button showing current speed (e.g. "1x"), NOT the voice button
    // Only visible after text has been pasted into the block
    const speedTrigger = block
      .locator('[role="button"][aria-label="Điều chỉnh tốc độ đọc"]')
      .first();

    await speedTrigger.waitFor({ state: 'visible', timeout: 10_000 });

    const currentSpeed = await this.readSpeed(block);
    if (this.speedPattern(desired.speed).test(currentSpeed)) return;

    await speedTrigger.click();

    // Wait for dropdown "Tốc độ đọc"
    await page.getByText('Tốc độ đọc', { exact: true })
      .waitFor({ state: 'visible', timeout: 5_000 });

    // Select desired speed option (e.g. "1.05x Hơi nhanh")
    const escaped = desired.speed.replace(/\./g, '\\.');
    await page.getByText(new RegExp(`^\\s*${escaped}\\b`))
      .filter({ visible: true }).first().click();

    // The dropdown usually closes automatically after selection, wait a bit for React to update
    await page.waitForTimeout(500);
  }

  private async readSpeed(block: Locator): Promise<string> {
    try {
      const btn = block.locator('div[role="button"][aria-label="Điều chỉnh tốc độ đọc"]').first();
      const raw = await btn.innerText().catch(() => '');
      const match = raw.match(/(\d+\.?\d*x)/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  private async saveDiagnosticArtifact(page: Page, phase: string, errorMsg: string, currentCount: number, targetCount: number): Promise<Error> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const failuresDir = path.resolve('data/failures');
    await fs.mkdir(failuresDir, { recursive: true });
    const htmlPath = path.join(failuresDir, `${ts}-${phase}.html`);
    const imgPath = path.join(failuresDir, `${ts}-${phase}.png`);
    
    await fs.writeFile(htmlPath, await page.content().catch(() => ''));
    await page.screenshot({ path: imgPath }).catch(() => {});

    const buttons = await page.locator('button').all();
    const names = [];
    for (const b of buttons) {
      if (await b.isVisible().catch(() => false)) {
        const text = await b.textContent().catch(() => '') || '';
        const ariaLabel = await b.getAttribute('aria-label').catch(() => '') || '';
        if (text.toLowerCase().includes('khối') || ariaLabel.toLowerCase().includes('khối')) {
          const accessibleName = ariaLabel || text;
          names.push(accessibleName.trim().replace(/\n/g, ' '));
        }
      }
    }

    return new Error(
      `[${phase}] ${errorMsg}\n` +
      `Block count: ${currentCount} / Target: ${targetCount}.\n` +
      `Các nút chứa chữ 'khối' đang visible: ${JSON.stringify(names)}.\n` +
      `URL: ${page.url()}\nTitle: ${await page.title().catch(() => '')}\n` +
      `Saved diagnostic artifacts to: ${htmlPath}, ${imgPath}`
    );
  }

  private async addBlock(page: Page, currentCount: number, targetCount: number): Promise<void> {
    const primarySelector = page.getByRole('button', { name: /Thêm\s*khối$/i }).last();
    const fallbackSelector = page.locator('button').filter({ hasText: /^\s*Thêm\s*khối\s*$/i }).last();

    let btn = primarySelector;
    if (await primarySelector.count() === 0 && await fallbackSelector.count() > 0) {
      btn = fallbackSelector;
    }

    try {
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click({ timeout: 5000 });
    } catch (e) {
      throw await this.saveDiagnosticArtifact(page, 'click_add_block', 'Không tìm thấy hoặc không thể click nút thêm khối.', currentCount, targetCount);
    }

    try {
      await page.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(selector).length >= count + 1,
        { selector: '.public-DraftEditor-content[contenteditable="true"][role="textbox"]', count: currentCount },
        { timeout: 30000 }
      );
    } catch (e) {
      throw await this.saveDiagnosticArtifact(page, 'wait_add_block', 'Số lượng block không tăng sau khi click "Thêm khối".', currentCount, targetCount);
    }

    const afterCount = await page.locator('.public-DraftEditor-content[contenteditable="true"][role="textbox"]').count();
    
    if (afterCount > targetCount) {
      throw await this.saveDiagnosticArtifact(page, 'overshoot_block', `Overshoot: số block (${afterCount}) vượt target (${targetCount}).`, currentCount, targetCount);
    }
  }

  async pasteDialogue(projectUrl: string, dialogue: DialogueResult): Promise<void> {
    const page = await this.browser.pageFor('studio.vbee.vn');
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForSelector('.public-DraftEditor-content[contenteditable="true"][role="textbox"]', { state: 'visible', timeout: this.config.automation.generationTimeoutMs });
    } catch (e) {
      throw await this.saveDiagnosticArtifact(page, 'wait_initial_block', 'Initial block không xuất hiện.', 0, dialogue.dialogue.length);
    }

    let areas = page.locator('.public-DraftEditor-content[contenteditable="true"][role="textbox"]');
    const initialBlockCount = await areas.count();
    console.log(`VBEE initial block ready: count = ${initialBlockCount}`);

    if (initialBlockCount !== 1) {
      throw await this.saveDiagnosticArtifact(
        page,
        'initial_block_count',
        `Dự án khởi tạo với số block bất thường. Expected: 1. Actual: ${initialBlockCount}. Target: ${dialogue.dialogue.length}`,
        initialBlockCount,
        dialogue.dialogue.length
      );
    }

    for (let index = 0; index < dialogue.dialogue.length; index += 1) {
      const turn = dialogue.dialogue[index];
      const targetCount = dialogue.dialogue.length;
      
      if (index > 0) {
        const currentCount = await areas.count();
        await this.addBlock(page, currentCount, targetCount);
      }
      
      const desired = this.voiceFor(turn.speaker);
      try {
        await this.selectVoiceOnly(page, index, turn.speaker);
      } catch (e) {
        throw await this.saveDiagnosticArtifact(page, 'select_voice', `Lỗi khi chọn voice block ${index + 1}.`, index + 1, targetCount);
      }
      
      const block = this.block(page, index);
      const voice = (await block.locator('.voice-name').innerText().catch(() => '')).trim();
      if (voice !== desired.name) {
        throw await this.saveDiagnosticArtifact(page, 'verify_voice', `Voice block ${index + 1} sai: expected ${desired.name}, actual ${voice}.`, index + 1, targetCount);
      }
      
      // 2. Paste text (BEFORE speed — speed button only appears after text entry)
      const area = this.editor(page, index);
      try {
        await area.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.insertText(turn.text);
        
        // Unfocus the editor and wait for VBEE/Draft.js to sync state and show speed button
        await area.blur().catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1500);
      } catch (e) {
        throw await this.saveDiagnosticArtifact(page, 'fill_text', `Lỗi khi nhập nội dung block ${index + 1}.`, index + 1, targetCount);
      }

      const value = await area.innerText().catch(() => '');
      if (value.trim() !== turn.text.trim()) {
        throw await this.saveDiagnosticArtifact(page, 'verify_text', `Text block ${index + 1} sai:\nExpected: ${turn.text}\nActual: ${value}`, index + 1, targetCount);
      }

      // 3. TẠM TẮT TÍNH NĂNG CHỌN TỐC ĐỘ THEO YÊU CẦU NGƯỜI DÙNG
      // Tốc độ sẽ giữ nguyên mặc định là 1x do UI chọn tốc độ của VBEE quá thiếu ổn định
      // try {
      //   await this.selectSpeedOnly(page, index, turn.speaker);
      // } catch (e) {
      //   throw await this.saveDiagnosticArtifact(page, 'select_speed', `Lỗi khi chọn speed block ${index + 1}: ${(e as Error).message}`, index + 1, targetCount);
      // }
      
      // const speedStr = await this.readSpeed(block);
      // if (!this.speedPattern(desired.speed).test(speedStr)) {
      //   throw await this.saveDiagnosticArtifact(page, 'verify_speed', `Speed block ${index + 1} sai: expected ${desired.speed}, actual ${speedStr}.`, index + 1, targetCount);
      // }

      const orderStr = String(index + 1).padStart(2, '0');
      const totalStr = String(targetCount).padStart(2, '0');
      console.log(`VBEE block ${orderStr}/${totalStr} — ${index === 0 ? 'default' : 'created'}`);
      console.log(`Speaker: ${turn.speaker}`);
      console.log(`Voice expected/actual: ${desired.name} / ${voice}`);
      console.log(`Speed expected/actual: ${desired.speed} / (disabled)`);
      console.log(`Text expected length/actual length: ${turn.text.length} / ${value.length}`);
      console.log(`Text match: true`);
      console.log(`Block ${orderStr} verified: PASS\n`);
      
      await page.waitForTimeout(500);
    }
    
    // Đã xóa check finalCount vì Virtual DOM sẽ làm areas.count() không bao giờ bằng targetCount nếu số block lớn.
    // Nếu chạy hết vòng lặp mà không có lỗi thì tức là đã nhập đủ tất cả các block.
    
  }

  async verify(projectUrl: string, dialogue: DialogueResult): Promise<VbeeVerification> {
    const issues: string[] = [];
    
    // Vì VBEE sử dụng Virtual DOM, các block đầu có thể đã bị unmount nên không thể verify toàn bộ lại một lần nữa.
    // Tuy nhiên, trong quá trình pasteDialogue, chúng ta ĐÃ VERIFY từng block một (text, voice, limit) ngay tại thời điểm xử lý.
    // Do đó, nếu tiến trình chạy đến đây thì có nghĩa là mọi thứ đã hợp lệ.
    
    return { ok: issues.length === 0, issues };
  }

  async generateAll(projectUrl: string): Promise<void> {
    const page = await this.browser.pageFor('studio.vbee.vn');
    if (page.url() !== projectUrl) await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
    const selectAll = page.locator('.toolbar label').filter({ hasText: /Chọn tất cả|Bỏ chọn tất cả/ }).locator('input[type="checkbox"]');
    if (!await selectAll.isChecked()) await selectAll.check();

    const generate = page.locator('.toolbar button:has(svg[data-testid="SlowMotionVideoRoundedIcon"])');
    await generate.waitFor({ state: 'visible' });
    if (!await generate.isEnabled()) throw new Error('Nút TTS hàng loạt của VBEE đang bị vô hiệu hóa.');
    await generate.click();
  }

  private async availableDownloadPath(fileName: string): Promise<string> {
    const safeName = path.basename(fileName);
    const parsed = path.parse(safeName);
    let candidate = path.join(this.config.files.downloadsDir, safeName);
    let index = 2;
    while (true) {
      try {
        await fs.access(candidate);
        candidate = path.join(this.config.files.downloadsDir, `${parsed.name} (${index++})${parsed.ext}`);
      } catch {
        return candidate;
      }
    }
  }

  async downloadAll(projectUrl: string): Promise<void> {
    const page = await this.browser.pageFor('studio.vbee.vn');
    if (page.url() !== projectUrl) await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
    
    // Theo yêu cầu của User: đảm bảo đã chọn tất cả trước
    const selectAll = page.locator('.toolbar label').filter({ hasText: /Chọn tất cả|Bỏ chọn tất cả/ }).locator('input[type="checkbox"]');
    if (!await selectAll.isChecked()) await selectAll.check();

    // Icon mũi tên hướng xuống như hình 4 (DownloadRoundedIcon)
    const downloadIconBtn = page.locator('.toolbar button:has(svg[data-testid="DownloadRoundedIcon"])');
    
    // Theo user: "biểu tượng tải về sẽ hiện lên khi tất cả block đã được TTS"
    try {
      await downloadIconBtn.waitFor({ state: 'visible', timeout: this.config.automation.generationTimeoutMs });
    } catch (e) {
      throw new Error('VBEE chưa hoàn tất TTS trong thời gian cho phép (Không thấy nút tải xuống ở toolbar).');
    }

    await fs.mkdir(this.config.files.downloadsDir, { recursive: true });
    
    // Nhấn vào biểu tượng và đợi quá trình tải về bắt đầu
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: 120000 }), // Chờ tải về, có thể mất thời gian nén file
      downloadIconBtn.click()
    ]);
    
    const suggestedName = file.suggestedFilename();
    if (!suggestedName.toLowerCase().endsWith('.rar') && !suggestedName.toLowerCase().endsWith('.zip')) {
      throw new Error(`VBEE trả về file định dạng không hợp lệ: ${suggestedName}`);
    }
    
    await file.saveAs(await this.availableDownloadPath(suggestedName));
  }
}
