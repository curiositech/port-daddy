test('LaTeX palette is lockstepped with design tokens', () => {
  const res = spawnSync(process.execPath, ['website-v2/scripts/check-figure-palette.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' });
  expect(res.status).toBe(0);
  expect(res.stderr).toBe('');
});