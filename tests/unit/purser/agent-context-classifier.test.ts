test.each([
  ['NaN', [NaN, 0.5]],
  ['Infinity', [Infinity, -0.5]],
  ['-Infinity', [-Infinity, 0.5]],
  ['empty', []],
  ['zero vector', [0, 0]],
])('rejects %s vector before any classification is emitted', async (_, vector) => {
  const classifier = createAgentContextClassifier({
    clock: () => 0,
    embedder: {
      modelId: 'test-minilm',
      async embed() { return [vector]; },
    },
  });
  await expect(classifier.classify(validInput())).rejects.toBeInstanceOf(AgentContextClassifierOutputError);
  await expect(classifier.classify(validInput())).rejects.toThrow(/non-finite|empty|zero magnitude/);
});