import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve, join } from 'node:path';

const PROJECT_MARKERS = ['pd-fleet.yml', '.git', 'package.json'] as const;

function looksLikeFilePath(value: string): boolean {
  const extension = extname(value);
  if (extension) return true;
  try {
    return existsSync(value) && statSync(value).isFile();
  } catch {
    return false;
  }
}

export function locateProjectDir(startPath: string): string | null {
  let current = resolve(looksLikeFilePath(startPath) ? dirname(startPath) : startPath);

  while (true) {
    if (PROJECT_MARKERS.some((marker) => existsSync(join(current, marker)))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function projectNameFromDir(projectDir: string | null | undefined): string | null {
  if (!projectDir) return null;
  const name = basename(projectDir);
  return name && name.trim() ? name.trim() : null;
}
