export function startsLikeSource(output: string): boolean {
  const firstLine = output.trimStart().split('\n', 1)[0].trim();
  return (
    firstLine.startsWith('import ') ||
    firstLine.startsWith('export ') ||
    firstLine.startsWith('const ') ||
    firstLine.startsWith('let ') ||
    firstLine.startsWith('var ') ||
    firstLine.startsWith('function ') ||
    firstLine.startsWith('class ') ||
    firstLine.startsWith('interface ') ||
    firstLine.startsWith('type ') ||
    firstLine.startsWith('enum ') ||
    firstLine.startsWith('declare ') ||
    firstLine.startsWith('//') ||
    firstLine.startsWith('/*') ||
    firstLine.startsWith('*') ||
    firstLine.startsWith('#!')
  );
}