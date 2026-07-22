import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launchPersistentContext(path.resolve('data/browser-profile'), {
    headless: false,
    channel: 'chrome'
  });
  const page = await browser.newPage();
  await page.goto('https://studio.vbee.vn/projects/6a6076a85a7967dd381d5fb1', { waitUntil: 'domcontentloaded' });
  
  console.log('Clicking Tải xuống...');
  const downloadBtn = page.locator('button', { hasText: 'Tải xuống' }).first();
  await downloadBtn.waitFor({ state: 'visible', timeout: 15000 });
  await downloadBtn.click();
  
  console.log('Waiting for modal...');
  await page.waitForTimeout(2000);
  
  const dropdown = page.locator('.MuiPopover-root, .MuiDialog-root').locator('div[role="button"]').first();
  if (await dropdown.isVisible()) {
    console.log('Clicking dropdown...');
    await dropdown.click();
    await page.waitForTimeout(1000);
    
    await page.screenshot({ path: 'scratch/dropdown_options.png', fullPage: true });
    console.log('Screenshot saved to scratch/dropdown_options.png');
  } else {
    console.log('Dropdown not found');
  }
  
  await browser.close();
})();
