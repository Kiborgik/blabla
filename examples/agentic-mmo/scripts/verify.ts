import { runChecks } from './run-checks.ts';
import type { CheckCommand } from './run-checks.ts';

const scaffold = process.argv[2] === 'scaffold';
const commands: CheckCommand[] = scaffold
  ? [['npm', 'run', 'typecheck:web'], ['npx', '--no-install', 'vp', 'lint', 'web', 'tests/web.test.ts', 'scripts', 'vite.config.ts'], ['node', '--test', 'tests/web.test.ts'], ['npm', 'run', 'build:web']]
  : [['npm', 'run', 'typecheck'], ['npm', 'run', 'lint'], ['npm', 'test'], ['npm', 'run', 'build']];
process.exitCode = runChecks(commands);
