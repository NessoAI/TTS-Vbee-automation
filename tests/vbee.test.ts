import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { VbeeAdapter } from '../src/server/adapters/vbee.js';
import { BrowserManager } from '../src/server/adapters/browser.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('VbeeAdapter sequential block creation', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    if (page) await page.close();
  });

  const createAdapter = () => {
    const dummyBrowserManager = {
      pageFor: async () => page
    } as unknown as BrowserManager;

    const adapter = new VbeeAdapter(dummyBrowserManager, {
      vbee: { voiceA: 'Voice A', speedA: '1.05x', voiceB: 'Voice B', speedB: '1x', projectsUrl: '', maxBlockCharacters: 1000 },
      automation: { generationTimeoutMs: 1000 },
      files: { downloadsDir: 'data/downloads' }
    } as any);

    page.goto = async () => null as any;
    
    // Mock the modal actions to just succeed without doing UI interaction
    (adapter as any).selectVoiceOnly = async () => {};
    (adapter as any).selectSpeedOnly = async () => {};
    // Mock the final verify to avoid needing full UI for it
    (adapter as any).verify = async () => ({ ok: true, issues: [] });

    return adapter;
  };

  // Block HTML structure matching real VBEE DOM
  const makeBlockHtml = (voiceName: string, speed: string) => `
    <div class="block-wrapper-v2">
      <div class="block-toolbar-wrapper">
        <div class="config-toolbar">
          <button data-id="open-voice-list"><p class="voice-name">${voiceName}</p></button>
          <div role="button" aria-label="Điều chỉnh tốc độ đọc" class="speed-btn">${speed}</div>
        </div>
      </div>
      <div class="public-DraftEditor-content" contenteditable="true" role="textbox"></div>
    </div>`;

  const setupPage = async (initialHtml: string, clickDelay = 0, shouldIncrease = true, mountDelay = 0, overshoot = false) => {
    if (mountDelay > 0) {
      await page.setContent('');
      await page.evaluate(({ html, delay }) => {
        setTimeout(() => {
          document.body.innerHTML = html;
          const btn = document.querySelector('.add-btn');
          if (btn) btn.addEventListener('click', () => { (window as any).simulateAdd(); });
        }, delay);
      }, { html: initialHtml, delay: mountDelay });
    } else {
      await page.setContent(initialHtml);
      await page.evaluate(() => {
        const btn = document.querySelector('.add-btn');
        if (btn) btn.addEventListener('click', () => { (window as any).simulateAdd(); });
      });
    }

    await page.exposeFunction('simulateAdd', () => {
      setTimeout(() => {
        if (!shouldIncrease) return;
        page.evaluate((doOvershoot) => {
          const addOne = () => {
            const count = document.querySelectorAll('.block-wrapper-v2').length;
            const wrapper = document.createElement('div');
            wrapper.className = 'block-wrapper-v2';
            
            const toolbar = document.createElement('div');
            toolbar.className = 'block-toolbar-wrapper';
            const configToolbar = document.createElement('div');
            configToolbar.className = 'config-toolbar';
            
            const voiceBtn = document.createElement('button');
            voiceBtn.setAttribute('data-id', 'open-voice-list');
            const voiceP = document.createElement('p');
            voiceP.className = 'voice-name';
            voiceP.innerText = count % 2 === 0 ? 'Voice A' : 'Voice B';
            voiceBtn.appendChild(voiceP);
            configToolbar.appendChild(voiceBtn);

            const speedBtn = document.createElement('div');
            speedBtn.setAttribute('role', 'button');
            speedBtn.setAttribute('aria-label', 'Điều chỉnh tốc độ đọc');
            speedBtn.className = 'speed-btn';
            speedBtn.innerText = count % 2 === 0 ? '1.05x' : '1x';
            configToolbar.appendChild(speedBtn);

            toolbar.appendChild(configToolbar);
            wrapper.appendChild(toolbar);

            const div = document.createElement('div');
            div.className = 'public-DraftEditor-content';
            div.setAttribute('contenteditable', 'true');
            div.setAttribute('role', 'textbox');
            wrapper.appendChild(div);

            document.body.appendChild(wrapper);
          };

          addOne();
          if (doOvershoot) {
            addOne();
          }
        }, overshoot);
      }, clickDelay);
    });
  };

  const dialogue2Blocks = {
    roles: { A: 'A', B: 'B' },
    dialogue: [
      { order: 1, speaker: 'A', text: 'Text 1' },
      { order: 2, speaker: 'B', text: 'Text 2' }
    ]
  } as any;

  const validInitialHtml = `
    <button class="add-btn">Thêm khối</button>
    ${makeBlockHtml('Voice A', '1.05x')}
  `;

  it('1. Button "Thêm khối" with img alt="icon" is recognized', async () => {
    const adapter = createAdapter();
    await setupPage(`
      <button class="add-btn">
        <span><img alt="icon" src="fake.png"/></span>
        Thêm khối
      </button>
      ${makeBlockHtml('Voice A', '1.05x')}
    `);
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).resolves.toBeUndefined();
    expect(await page.locator('.public-DraftEditor-content').count()).toBe(2);
  });

  it('2. Waits for default block to mount from 0 to 1', async () => {
    const adapter = createAdapter();
    await setupPage(validInitialHtml, 0, true, 500);
    
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).resolves.toBeUndefined();
    expect(await page.locator('.public-DraftEditor-content').count()).toBe(2);
  });

  it('3. Throws diagnostic error if initial block never appears (beforeCount=0 blocked)', async () => {
    const adapter = createAdapter();
    await setupPage(`<button class="add-btn">Thêm khối</button>`);
    
    (adapter as any).config.automation.generationTimeoutMs = 500;
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).rejects.toThrow(/Initial block không xuất hiện/);
  });

  it('4. Waits for block count to increase after click', async () => {
    const adapter = createAdapter();
    await setupPage(validInitialHtml, 500);

    const start = Date.now();
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).resolves.toBeUndefined();
    const duration = Date.now() - start;
    expect(duration).toBeGreaterThanOrEqual(500); 
  });

  it('4b. Throws diagnostic if click does not increase block count', async () => {
    const adapter = createAdapter();
    await setupPage(validInitialHtml, 0, false);
    
    page.waitForFunction = async () => { throw new Error('timeout'); };
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).rejects.toThrow(/Số lượng block không tăng sau khi click "Thêm khối"/);
  });

  it('5. Overshoot is blocked and throws error', async () => {
    const adapter = createAdapter();
    await setupPage(validInitialHtml, 0, true, 0, true /* overshoot */);
    
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).rejects.toThrow(/Overshoot/);
  });

  it('6,14. Diagnostic artifacts created on errors and saved to data/failures', async () => {
    const adapter = createAdapter();
    await setupPage(`<button class="add-btn">Thêm khối</button>`);
    (adapter as any).config.automation.generationTimeoutMs = 500;

    const err = await adapter.pasteDialogue('url', dialogue2Blocks).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/data[\\/]failures/);
  });

  it.skip('7,8,9,10. Block 1 does not click add; sequential voice→paste; no block after last', async () => {
    const adapter = createAdapter();
    
    // Track the sequence of operations
    const callLog: string[] = [];
    (adapter as any).selectVoiceOnly = async (_p: any, idx: number) => { callLog.push(`voice_${idx}`); };
    // (adapter as any).selectSpeedOnly = async (_p: any, idx: number) => { callLog.push(`speed_${idx}`); };
    (adapter as any).verify = async () => ({ ok: true, issues: [] });
    
    await setupPage(validInitialHtml);
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).resolves.toBeUndefined();
    
    // Block 0: voice
    // Block 1: (add) → voice
    expect(callLog).toEqual(['voice_0', 'voice_1']);
    
    // Final count matches dialogue length (no extra blocks)
    expect(await page.locator('.public-DraftEditor-content').count()).toBe(2);
  });

  it('11. Throws error if initial count != 1 (e.g. 3 blocks)', async () => {
    const adapter = createAdapter();
    await setupPage(`
      <button class="add-btn">Thêm khối</button>
      ${makeBlockHtml('Voice A', '1.05x')}
      ${makeBlockHtml('Voice B', '1x')}
      ${makeBlockHtml('Voice A', '1.05x')}
    `);

    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).rejects.toThrow(/initial_block_count.*Expected: 1/);
  });

  it.skip('12. Correct voices (A/B) and speeds (1.05x/1x) assigned per speaker', async () => {
    const adapter = createAdapter();
    await setupPage(validInitialHtml);
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).resolves.toBeUndefined();
    
    // Block 0 (Speaker A): Voice A, 1.05x
    const voice0 = await page.locator('.block-wrapper-v2').nth(0).locator('.voice-name').innerText();
    expect(voice0.trim()).toBe('Voice A');
    const speed0 = await page.locator('.block-wrapper-v2').nth(0).locator('.speed-btn').innerText();
    expect(speed0.trim()).toBe('1.05x');
    
    // Block 1 (Speaker B): Voice B, 1x
    const voice1 = await page.locator('.block-wrapper-v2').nth(1).locator('.voice-name').innerText();
    expect(voice1.trim()).toBe('Voice B');
    const speed1 = await page.locator('.block-wrapper-v2').nth(1).locator('.speed-btn').innerText();
    expect(speed1.trim()).toBe('1x');
  });

  it('13a. Voice mismatch throws diagnostic error and stops', async () => {
    const adapter = createAdapter();
    await setupPage(`
      <button class="add-btn">Thêm khối</button>
      ${makeBlockHtml('Wrong Voice', '1.05x')}
    `);

    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).rejects.toThrow(/verify_voice.*expected Voice A, actual Wrong Voice/);
  });

  it.skip('13b. Speed mismatch throws diagnostic error and stops', async () => {
    const adapter = createAdapter();
    await setupPage(`
      <button class="add-btn">Thêm khối</button>
      ${makeBlockHtml('Voice A', '2x')}
    `);

    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).rejects.toThrow(/verify_speed.*expected 1.05x, actual 2x/);
  });

  it('13c. Text mismatch throws diagnostic error and stops', async () => {
    const adapter = createAdapter();
    await setupPage(validInitialHtml);

    // Mock editor to return wrong text after fill
    const origEditor = (adapter as any).editor.bind(adapter);
    (adapter as any).editor = (page: any, index: number) => {
      const loc = origEditor(page, index);
      return {
        click: loc.click.bind(loc),
        blur: async () => {}, // Mock blur to prevent fill_text error
        innerText: async () => 'wrong text'
      };
    };

    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).rejects.toThrow(/verify_text/);
  });

  it.skip('8. Verifies sequential flow: voice → paste', async () => {
    const adapter = createAdapter();
    await setupPage(validInitialHtml);
    await expect(adapter.pasteDialogue('url', dialogue2Blocks)).resolves.toBeUndefined();
    
    // Verify text was actually filled
    const text1 = await page.locator('.public-DraftEditor-content').nth(0).innerText();
    const text2 = await page.locator('.public-DraftEditor-content').nth(1).innerText();
    expect(text1.trim()).toBe('Text 1');
    expect(text2.trim()).toBe('Text 2');
  });
});
