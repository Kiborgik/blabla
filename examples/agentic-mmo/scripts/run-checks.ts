import { spawnSync } from 'node:child_process';

export type CheckCommand = [string, ...string[]];

export function runChecks(commands: CheckCommand[]): number {
  let failures = 0;
  for (const [program, ...args] of commands) {
    const result = spawnSync(program, args, { stdio: 'inherit', timeout: 180000, shell: process.platform === 'win32' });
    const code = result.status ?? 1;
    process.stdout.write(`${JSON.stringify({ command: [program, ...args], exit: code })}\n`);
    if (code !== 0) failures += 1;
  }
  return failures === 0 ? 0 : 1;
}
