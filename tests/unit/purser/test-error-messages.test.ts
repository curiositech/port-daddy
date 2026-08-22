test('skill index embedder error message names prefetch and opt-in', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'pd-egress-gate-'));
  const db = createTestDb();
  await expect(createSkillIndex(db, { cacheDir })).rejects.toThrow(/Prefetch/);
  // The error message may include environment variable name
  await expect(createSkillIndex(db, { cacheDir })).rejects.toThrow(new RegExp(ALLOW_MODEL_DOWNLOAD_ENV));
});