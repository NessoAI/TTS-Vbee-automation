import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launchPersistentContext(path.resolve('data/browser-profile'), {
    headless: false,
    channel: 'chrome'
  });
  const page = await browser.newPage();
  await page.goto('https://studio.vbee.vn/projects/6a6076a85a7967dd381d5fb1', { waitUntil: 'domcontentloaded' });
  
  console.log('Selecting all...');
  const selectAll = page.locator('.toolbar label').filter({ hasText: /Chọn tất cả|Bỏ chọn tất cả/ }).locator('input[type="checkbox"]');
  if (!await selectAll.isChecked()) await selectAll.check();
  
  console.log('Clicking toolbar download icon...');
  const downloadIconBtn = page.locator('.toolbar button:has(svg[data-testid="DownloadRoundedIcon"])');
  await downloadIconBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => console.log('Icon not visible'));
  
  if (await downloadIconBtn.isVisible()) {
      await downloadIconBtn.click();
      console.log('Clicked. Waiting 3s to see if modal appears...');
      await page.waitForTimeout(3000);
      
      const modal = page.locator('.MuiPopover-root, .MuiDialog-root').last();
      if (await modal.isVisible()) {
        console.log('Modal IS visible! HTML:');
        console.log(await modal.innerHTML());
      } else {
        console.log('No modal appeared. Did it download directly?');
      }
  }
  
  await browser.close();
})();
