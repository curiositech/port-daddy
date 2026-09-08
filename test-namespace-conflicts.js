it('should match dynamic contract terms', () => {
  const manifest = getManifest();
  expect(manifest.chapters).toMatch(/sealed cross-harbor relay/);
  expect(manifest.references).toBeGreaterThan(0);
  expect(manifest.sources).toMatch(/witness-log revocation/);
});