function generatedTestParserPlugins(path: string): ParserPlugin[] {
  const lower = path.toLowerCase();
  const plugins: ParserPlugin[] = [];
  if (/\.(?:ts|tsx|mts|cts)$/.test(lower)) {
    plugins.push([
      'typescript',
      { disallowAmbiguousJSXLike: /\.(?:mts|cts)$/.test(lower) },
    ]);
  }
  if (/\.(?:jsx|tsx)$/.test(lower)) plugins.push('jsx');
  return plugins;
}

function generatedTestSourceType(path: string): 'module' | 'commonjs' | 'unambiguous' {
  const lower = path.toLowerCase();
  if (/\.(?:mjs|mts)$/.test(lower)) return 'module';
  if (/\.(?:cjs|cts)$/.test(lower)) return 'commonjs';
  return 'unambiguous';
}