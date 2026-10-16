import { spawnSync } from 'node:child_process';

const scaffold = process.argv[2] === 'scaffold';
const commands: Array<[string, ...string[]]> = scaffold
  ? [['npm', 'run', 'typecheck:web'], ['npx', '--no-install', 'vp', 'lint', 'web', 'tests/web.test.ts', 'scripts/verify.ts', 'vite.config.ts'], ['node', '--test', 'tests/web.test.ts'], ['npm', 'run', 'build']]
  : [['npm', 'run', 'typecheck'], ['npm', 'run', 'lint'], ['npm', 'test'], ['npm', 'run', 'build']];
let failures = 0;
for (const [program, ...args] of commands) {
  const result = spawnSync(program, args, { stdio: 'inherit', timeout: 180000, shell: process.platform === 'win32' });
  const code = result.status ?? 1;
  process.stdout.write(`${JSON.stringify({ command: [program, ...args], exit: code })}\n`);
  if (code !== 0) failures += 1;
}
process.exitCode = failures === 0 ? 0 : 1;
