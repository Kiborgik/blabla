import { runChecks } from './run-checks.ts';

const checks: Record<string, { test: string | string[]; paths: string[] }> = {
  cli: { test: 'tests/cli.test.ts', paths: ['cli', 'core/validation.ts', 'tests/cli.test.ts'] },
  core: { test: 'tests/engine.test.ts', paths: ['core/engine.ts', 'core/policies.ts', 'core/simulation', 'tests/engine.test.ts'] },
  content: { test: 'tests/content.test.ts', paths: ['core/content.ts', 'tests/content.test.ts'] },
  hosting: { test: 'tests/hosting.test.ts', paths: ['server', 'tests/hosting.test.ts'] },
  stage: { test: ['tests/engine.test.ts', 'tests/content.test.ts', 'tests/cli.test.ts'], paths: ['core', 'cli', 'tests/engine.test.ts', 'tests/content.test.ts', 'tests/cli.test.ts'] },
};
const selected = checks[process.argv[2] ?? ''];
if (!selected) throw new Error('Choose cli, core, content, hosting or stage');
const tests = typeof selected.test === 'string' ? [selected.test] : selected.test;
process.exitCode = runChecks([['node', '--test', ...tests], ['npx', '--no-install', 'vp', 'lint', ...selected.paths]]);
