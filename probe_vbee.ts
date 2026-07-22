import { chromium } from 'playwright';
import fs from 'node:fs/promises';

async function run() {
  const context = await chromium.launchPersistentContext('data/browser-profile', {
    headless: false,
    channel: 'chrome'
  });
  
  const page = await context.newPage();
  
  const targetUrl = 'https://studio.vbee.vn/projects/6a60574d46a7145541a13018';
  console.log(`Navigating to ${targetUrl}`);
  
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  
  const milestones = [1000, 3000, 10000];
  let startTime = Date.now();
  
  for (const ms of milestones) {
    const timeToWait = ms - (Date.now() - startTime);
    if (timeToWait > 0) {
      await page.waitForTimeout(timeToWait);
    }
    
    console.log(`\n--- Snapshot at ${ms}ms ---`);
    const data = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const khoiButtons = buttons.map(b => {
        const text = b.textContent || '';
        const ariaLabel = b.getAttribute('aria-label') || '';
        if (text.toLowerCase().includes('khối') || ariaLabel.toLowerCase().includes('khối')) {
          return (ariaLabel || text).trim().replace(/\n/g, ' ');
        }
        return null;
      }).filter(b => b !== null);
      
      const blocks = document.querySelectorAll('.block-wrapper-v2');
      const isVirtualized = Array.from(blocks).some(b => {
        const style = window.getComputedStyle(b);
        return style.position === 'absolute' || style.position === 'fixed';
      });
      
      return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        draftEditors: document.querySelectorAll('.public-DraftEditor-content').length,
        textboxes: document.querySelectorAll('[contenteditable="true"][role="textbox"]').length,
        blockWrappers: blocks.length,
        khoiButtons,
        isVirtualized
      };
    });
    
    console.log(JSON.stringify(data, null, 2));
    
    if (ms === 10000) {
      const html = await page.content();
      await fs.writeFile('C:\\Users\\DESKTOP\\.gemini\\antigravity-ide\\brain\\d2a054fc-617e-4935-bcf0-5dcf3768be54\\scratch\\probe_10s.html', html);
      await page.screenshot({ path: 'C:\\Users\\DESKTOP\\.gemini\\antigravity-ide\\brain\\d2a054fc-617e-4935-bcf0-5dcf3768be54\\scratch\\probe_10s.png' });
    }
  }
  
  await context.close();
}

run().catch(console.error);
