describe('cache eviction resilience', () => {
  test('partial eviction does not reenable network without opt-in', async () => {
    const cacheDir = emptyCacheDir();
    const modelDir = join(cacheDir, ...DEFAULT_SEMANTIC_MODEL_ID.split('/'));
    mkdirSync(modelDir, { recursive: true });
    // create 3 files
    const files = ['config.json', 'tokenizer.json', 'model.safetensors'];
    for (const f of files) {
      writeFileSync(join(modelDir, f), '{}');
    }
    // partial eviction: delete one file
    unlinkSync(join(modelDir, files[0]));
    // Now dir still exists and has 2 files
    expect(isEmbeddingModelCached(cacheDir, DEFAULT_SEMANTIC_MODEL_ID)).toBe(true);
    const policy = resolveRemoteModelPolicy(cacheDir, DEFAULT_SEMANTIC_MODEL_ID, {});
    expect(policy).toEqual({ allowRemote: false, cached: true, mode: 'local-cache-only' });

    // test that resolver throws and no fetch
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const db = createTestDb();
    const resolver = createSemanticResolver(db, { cacheDir });
    await expect(resolver.embed('test')).rejects.toThrow(/remote model download is disabled by default/);
    expect(fetchSpy).not.toHaveBeenCalled();
    db.close();
  });

  test('opt-in enables remote even with partial eviction', () => {
    const cacheDir = emptyCacheDir();
    const modelDir = join(cacheDir, ...DEFAULT_SEMANTIC_MODEL_ID.split('/'));
    mkdirSync(modelDir, { recursive: true });
    const files = ['config.json', 'tokenizer.json', 'model.safetensors'];
    for (const f of files) {
      writeFileSync(join(modelDir, f), '{}');
    }
    unlinkSync(join(modelDir, files[0])); // partial eviction
    const policy = resolveRemoteModelPolicy(cacheDir, DEFAULT_SEMANTIC_MODEL_ID, {
      [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
    });
    expect(policy).toEqual({ allowRemote: true, cached: true, mode: 'remote-allowed' });
  });
});