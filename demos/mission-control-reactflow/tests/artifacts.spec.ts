import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from '@playwright/test';

const artifacts = path.resolve('artifacts');

test('capture dark, light, and interaction recording', async ({ browser }) => {
  await mkdir(artifacts, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    colorScheme: 'dark',
    recordVideo: { dir: artifacts, size: { width: 1600, height: 1050 } },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4179/');
  await page.waitForSelector('[data-testid="mission-node-node-0"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(artifacts, 'mission-control-dark.png'), fullPage: true });
  await page.waitForTimeout(900);
  await page.getByTestId('mission-node-node-1').click();
  await page.waitForTimeout(1_100);
  await page.getByTestId('evidence-ev-1-receipt').click();
  await page.waitForTimeout(1_300);
  await page.locator('[aria-label="Close evidence"]').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Interrupt' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.waitForTimeout(1_400);
  await page.getByRole('button', { name: 'Resolve decision' }).click();
  await page.waitForTimeout(900);
  await page.locator('.event-tick').nth(6).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.waitForTimeout(800);
  await page.getByTestId('theme-toggle').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(artifacts, 'mission-control-light.png'), fullPage: true });
  const video = page.video();
  await context.close();
  if (video) await copyFile(await video.path(), path.join(artifacts, 'mission-control-interaction.webm'));
});
