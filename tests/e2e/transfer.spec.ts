import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const size of [0, 2 * 1024 * 1024]) {
  test(`approved transfer preserves ${size} bytes`, async ({ browser }) => {
    const senderContext = await browser.newContext();
    const receiverContext = await browser.newContext({ acceptDownloads: true });
    await receiverContext.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    });
    try {
      const sender = await senderContext.newPage();
      const receiver = await receiverContext.newPage();
      const data = Buffer.alloc(size);
      for (let i = 0; i < size; i++) data[i] = i % 251;
      await sender.goto('/');
      await sender.getByLabel('Choose a file to share').setInputFiles({ name: 'sample.bin', mimeType: 'application/octet-stream', buffer: data });
      await sender.getByRole('button', { name: 'Create private link' }).click();
      const link = sender.getByLabel('Your private link');
      await expect(link).toHaveValue(/\/s\/[^#]+#.+/);
      await receiver.goto(await link.inputValue());
      await receiver.getByRole('button', { name: 'Connect to sender' }).click();
      await expect(sender.getByRole('button', { name: 'Allow connection' })).toBeVisible();
      await expect(receiver.locator('.verification-code')).toHaveText(await sender.locator('.verification-code').innerText());
      await expect(receiver.getByRole('button', { name: 'Receive file', exact: true })).toHaveCount(0);
      await sender.getByRole('button', { name: 'Allow connection' }).click();
      await receiver.getByRole('button', { name: 'Receive file', exact: true }).click();
      await expect(receiver.getByRole('link', { name: 'Save verified file' })).toBeVisible({ timeout: 45000 });
      const downloaded = receiver.waitForEvent('download');
      await receiver.getByRole('link', { name: 'Save verified file' }).click();
      const download = await downloaded;
      const path = await download.path();
      expect(path).not.toBeNull();
      expect(await readFile(path!)).toEqual(data);
      await expect(sender.getByText('Transfer complete', { exact: true })).toBeVisible();
    } finally {
      await receiverContext.close();
      await senderContext.close();
    }
  });
}
