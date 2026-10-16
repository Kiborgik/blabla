import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FileDigest { path: string; bytes: number; sha256: string }
interface InputDigest { inputDigest: string; files: FileDigest[] }

const INPUT_FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.web.json', 'vite.config.ts', 'index.html', '.openai/hosting.json'];
const INPUT_DIRECTORIES = ['core', 'server', 'protocol', 'web', 'visuals', 'public', 'scripts'];
const OUTPUT_DIRECTORIES = ['dist/server', 'dist/.openai'];

function digest(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function filesAt(root: string, path: string): FileDigest[] {
  const segments = path.split('/');
  for (let index = 1; index < segments.length; index += 1) {
    const parent = segments.slice(0, index).join('/');
    if (lstatSync(resolve(root, parent)).isSymbolicLink()) throw new Error(`Build provenance refuses symlink: ${parent}`);
  }
  const fullPath = resolve(root, path);
  const stat = lstatSync(fullPath);
  if (stat.isSymbolicLink()) throw new Error(`Build provenance refuses symlink: ${path}`);
  if (stat.isDirectory()) return readdirSync(fullPath).toSorted().flatMap(name => filesAt(root, `${path}/${name}`));
  if (!stat.isFile()) throw new Error(`Build provenance requires ordinary files: ${path}`);
  const bytes = readFileSync(fullPath);
  return [{ path, bytes: bytes.length, sha256: digest(bytes) }];
}

export function captureBuildInputs(root: string): InputDigest {
  for (const path of INPUT_FILES) if (!lstatSync(resolve(root, path)).isFile()) throw new Error(`Build input file missing or invalid: ${path}`);
  for (const path of INPUT_DIRECTORIES) if (!lstatSync(resolve(root, path)).isDirectory()) throw new Error(`Build input directory missing or invalid: ${path}`);
  const files = [...INPUT_FILES, ...INPUT_DIRECTORIES].flatMap(path => filesAt(root, path)).toSorted((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { inputDigest: digest(JSON.stringify(files)), files };
}

function provenance(root: string) {
  for (const path of OUTPUT_DIRECTORIES) if (!lstatSync(resolve(root, path)).isDirectory()) throw new Error(`Build output directory missing or invalid: ${path}`);
  if (!lstatSync(resolve(root, 'dist/server/index.js')).isFile()) throw new Error('Build Worker output missing or invalid');
  return { schemaVersion: 1, inputs: captureBuildInputs(root), outputs: OUTPUT_DIRECTORIES.flatMap(path => filesAt(root, path)) };
}

export function writeBuildProvenance(root: string, expectedInputDigest?: string): void {
  const receipt = provenance(root);
  if (expectedInputDigest !== undefined && receipt.inputs.inputDigest !== expectedInputDigest) throw new Error('Build inputs changed during compilation; rebuild the frozen source');
  const existing = lstatSync(resolve(root, 'dist/build-provenance.json'), { throwIfNoEntry: false });
  if (existing !== undefined && !existing.isFile()) throw new Error('Build provenance receipt must be an ordinary file');
  writeFileSync(resolve(root, 'dist/build-provenance.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}

export function verifyBuildProvenance(root: string): void {
  filesAt(root, 'dist/build-provenance.json');
  const recorded: unknown = JSON.parse(readFileSync(resolve(root, 'dist/build-provenance.json'), 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(provenance(root))) throw new Error('Build provenance mismatch: source or artifact changed; rebuild before packaging');
}
