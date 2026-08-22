const records = Array.from({ length: 3_500 }, (_, index) =>
    event({
      kind: 'start',
      run: `large-debug-${index}`,
      session: `codex:${index}`,
      at: 1_000 + index,
      workspace: join(nestedWorkspace, String(index)),
    }),
  );