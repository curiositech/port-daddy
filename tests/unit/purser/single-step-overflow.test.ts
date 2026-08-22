function event(opts: { kind: string; run: string; session: string; at: number; workspace: string; }): string {
  return [
    'v1',
    opts.kind,
    opts.run,
    opts.session,
    'codex',
    'start',
    'pd-hook-pre-tool',
    String(opts.at),
    '1000',
    '-',
    '-',
    Buffer.from(opts.workspace).toString('base64'),
  ].join('\t');
}