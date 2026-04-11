import { resolve } from 'node:path';
import {
  exportPublicRepo,
  loadPublicRepoExportConfig,
  listTrackedFilesAtRef,
  selectPublicExportPaths,
  validatePublicExportSelection,
} from '../lib/public-repo-export.js';

type CliArgs = {
  outDir?: string;
  ref?: string;
  clean: boolean;
  check: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { clean: false, check: false, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--out') {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--ref') {
      args.ref = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === '--clean') {
      args.clean = true;
      continue;
    }

    if (arg === '--check') {
      args.check = true;
      continue;
    }

    if (arg === '--json') {
      args.json = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printUsage(): void {
  console.error('Usage: npm run export:public -- [--out PATH] [--ref REF] [--clean] [--check] [--json]');
}

function main(): void {
  let args: CliArgs;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    printUsage();
    console.error((error as Error).message);
    process.exit(1);
    return;
  }

  const config = loadPublicRepoExportConfig();
  const ref = args.ref || config.defaultRef;

  if (args.check) {
    const selectedPaths = selectPublicExportPaths(listTrackedFilesAtRef(ref), config);
    const validation = validatePublicExportSelection(selectedPaths, config);
    const payload = {
      ref,
      selectedCount: selectedPaths.length,
      missingIncludedSmokePaths: validation.missingIncludedSmokePaths,
      leakedExcludedSmokePaths: validation.leakedExcludedSmokePaths,
    };

    if (payload.missingIncludedSmokePaths.length > 0 || payload.leakedExcludedSmokePaths.length > 0) {
      if (args.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.error(`Public export check failed for ref ${ref}.`);
        if (payload.missingIncludedSmokePaths.length > 0) {
          console.error('Missing required exported paths:');
          for (const path of payload.missingIncludedSmokePaths) console.error(`- ${path}`);
        }
        if (payload.leakedExcludedSmokePaths.length > 0) {
          console.error('Excluded paths leaked into export selection:');
          for (const path of payload.leakedExcludedSmokePaths) console.error(`- ${path}`);
        }
      }
      process.exit(1);
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Public export check passed for ${ref}.`);
      console.log(`Selected ${payload.selectedCount} tracked paths.`);
    }
    return;
  }

  const result = exportPublicRepo({
    ref,
    outDir: args.outDir || config.defaultOutputDir,
    clean: args.clean,
  });

  const payload = {
    ref: result.ref,
    outDir: resolve(result.outDir),
    selectedCount: result.selectedPaths.length,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Exported ${payload.selectedCount} files from ${payload.ref}.`);
  console.log(`Output: ${payload.outDir}`);
}

main();
