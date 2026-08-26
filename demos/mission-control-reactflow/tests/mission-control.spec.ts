import { expect, test, type Page } from '@playwright/test';

async function expectUsefulHeroViewport(page: Page) {
  const graph = page.getByTestId('graph-shell');
  const nodes = page.locator('[data-testid^="mission-node-"]');
  await expect(nodes).toHaveCount(18);
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await expect.poll(async () => (await page.getByTestId('mission-node-node-0').boundingBox())?.width ?? 0).toBeGreaterThan(185);

  const graphBox = await graph.boundingBox();
  const boxes = await nodes.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  }));
  expect(graphBox).not.toBeNull();
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  expect(left).toBeGreaterThanOrEqual(graphBox!.x - 1);
  expect(right).toBeLessThanOrEqual(graphBox!.x + graphBox!.width + 1);
  expect(top).toBeGreaterThanOrEqual(graphBox!.y - 1);
  expect(bottom).toBeLessThanOrEqual(graphBox!.y + graphBox!.height + 1);
  expect((right - left) / graphBox!.width).toBeGreaterThan(0.78);
  expect(Math.abs((left + right) / 2 - (graphBox!.x + graphBox!.width / 2))).toBeLessThan(36);
}

test('opens a node inspector and reaches evidence in one more click', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
  await expect(page.locator('.workspace')).toHaveClass(/inspector-closed/);
  await expectUsefulHeroViewport(page);
  await page.getByTestId('mission-node-node-1').click();
  await expect(page.getByTestId('node-inspector')).toContainText('Map objective constraints');
  await expect(page.getByTestId('node-inspector')).toContainText('Transform declared inputs');
  await expect(page.getByTestId('node-inspector')).toContainText('reactflow-expert');
  await expect(page.getByTestId('node-inspector').getByText('recorded', { exact: true })).toBeVisible();
  const graphBox = await page.getByTestId('graph-shell').boundingBox();
  const selectedBox = await page.getByTestId('mission-node-node-1').boundingBox();
  expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(graphBox!.x + graphBox!.width + 1);
  await page.getByTestId('evidence-ev-1-receipt').click();
  await expect(page.getByTestId('evidence-dialog')).toBeVisible();
  await expect(page.getByTestId('evidence-dialog')).toContainText('receipt://mission-control/42');
  await page.getByRole('button', { name: 'Close evidence' }).click();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expectUsefulHeroViewport(page);
});

test('switches deterministic fixture sizes and keeps controls operative', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load 100 node stress fixture' }).click();
  await expect(page.getByText('100-node scale probe')).toBeVisible();
  await expect(page.getByTestId('performance-readout')).toContainText('LAYOUT');
  await expect(page.locator('[data-testid^="mission-node-"]')).toHaveCount(100);
  await page.getByTestId('mission-node-node-99').click();
  await expect(page.getByTestId('node-inspector')).toContainText('node-99');
  let graphBox = await page.getByTestId('graph-shell').boundingBox();
  let selectedBox = await page.getByTestId('mission-node-node-99').boundingBox();
  expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(graphBox!.x + graphBox!.width + 1);
  await page.getByRole('button', { name: 'Load 200 node limit fixture' }).click();
  await expect(page.getByText('200-node scale probe')).toBeVisible();
  await expect(page.locator('.workspace')).toHaveClass(/inspector-closed/);
  await page.getByRole('button', { name: 'Load 18 node hero fixture' }).click();
  await expectUsefulHeroViewport(page);
  await page.getByRole('button', { name: 'Interrupt' }).click();
  await expect(page.getByText('PAUSED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByText('STREAMING', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel mission' }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('STREAMING', { exact: true })).toBeVisible();
});

test('supports light and dark themes without losing provenance labels', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  await expectUsefulHeroViewport(page);
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByText('unknown', { exact: true }).first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.getByTestId('mission-node-node-0').evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(motion)).toBeLessThanOrEqual(0.00001);
});
