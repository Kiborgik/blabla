import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const requiredFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.web.json', 'vite.config.ts', 'index.html', '.openai/hosting.json'];
const sourceRoots = ['core', 'server', 'protocol', 'web', 'visuals', 'public', 'scripts'];
const proofPath = 'dist/build-provenance.json';
const implementationUrl = new URL('../scripts/build-provenance.ts', import.meta.url).href;
const hostedVerifier = new URL('../scripts/verify-hosted.ts', import.meta.url).pathname;

interface ProvenanceApi {
  captureBuildInputs(root: string): { inputDigest: string; files: { path: string; bytes: number; sha256: string }[] };
  writeBuildProvenance(root: string, expectedInputDigest?: string): void;
  verifyBuildProvenance(root: string): void;
}

function isApi(value: unknown): value is ProvenanceApi {
  return typeof value === 'object' && value !== null
    && 'writeBuildProvenance' in value && typeof value.writeBuildProvenance === 'function'
    && 'verifyBuildProvenance' in value && typeof value.verifyBuildProvenance === 'function'
    && 'captureBuildInputs' in value && typeof value.captureBuildInputs === 'function';
}

async function api(): Promise<ProvenanceApi> {
  const value: unknown = await import(implementationUrl);
  assert.ok(isApi(value), 'New provenance API must exist; its absence is a bootstrap failure, not a stale-build counterexample');
  return value;
}

function lexical(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function put(root: string, path: string, value: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'build-provenance-'));
  for (const path of requiredFiles) put(root, path, `fixture:${path}\n`);
  put(root, 'package.json', '{"type":"module"}');
  for (const path of sourceRoots) put(root, `${path}/nested/source.txt`, `fixture:${path}\n`);
  put(root, 'dist/server/index.js', 'export default {};\n');
  put(root, 'dist/.openai/hosting.json', '{"d1":"DB"}');
  put(root, 'dist/.openai/drizzle/0000.sql', 'CREATE TABLE fixture(id INT);');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function snapshot(root: string): unknown[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' }).toSorted(lexical).map(path => {
    const full = join(root, path);
    const stat = lstatSync(full);
    return [path, stat.mode, stat.mtimeMs, stat.ctimeMs, stat.isDirectory() ? null : readFileSync(full).toString('base64')];
  });
}

await test('hosted artifact checks refuse missing proof and same-version stale source while preserving valid artifact checks', async () => {
  const item = fixture();
  try {
    put(item.root, 'public/version.json', '{"version":"unchanged-source-version"}');
    put(item.root, 'dist/.openai/hosting.json', '{"d1":"DB"}');
    put(item.root, 'dist/.openai/drizzle/meta/_journal.json', '{"entries":[{"idx":0}]}');
    put(item.root, 'dist/server/index.js', `export default { async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/') return new Response('<div id="app"></div><script src="./assets/client.js"></script>', { headers: { 'content-type': 'text/html' } });
      if (path === '/assets/client.js') return new Response('old-client', { headers: { 'cache-control': 'immutable' } });
      if (path === '/version.json') return Response.json({ version: 'unchanged-source-version' }, { headers: { 'cache-control': 'no-store' } });
      return new Response('denied', { status: 401 });
    } };`);
    put(item.root, 'core/nested/source.txt', 'new source with the same public version');
    const historicalVerifier = readFileSync(hostedVerifier, 'utf8').replace("import { verifyBuildProvenance } from './build-provenance.ts';\n", '').replace(/verifyBuildProvenance\(.*?\);\n/u, '');
    put(item.root, 'historical-verifier.ts', historicalVerifier);
    const historical = spawnSync(process.execPath, [join(item.root, 'historical-verifier.ts')], { cwd: item.root, encoding: 'utf8' });
    assert.equal(historical.status, 0, `The isolated artifact-only predecessor must actually accept this fixture: ${historical.stderr}`);
    const result = spawnSync(process.execPath, [hostedVerifier], { cwd: item.root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, `Artifact-only checks accepted stale source: ${result.stdout}`);
    const implementation = await api();
    implementation.writeBuildProvenance(item.root);
    const valid = spawnSync(process.execPath, [hostedVerifier], { cwd: item.root, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    put(item.root, 'core/nested/source.txt', 'another source change without a version change');
    const stale = spawnSync(process.execPath, [hostedVerifier], { cwd: item.root, encoding: 'utf8' });
    assert.notEqual(stale.status, 0, stale.stdout);
  } finally { item.cleanup(); }
});

await test('unchanged source and Worker verify deterministically without filesystem writes', async () => {
  const implementation = await api();
  const item = fixture();
  try {
    implementation.writeBuildProvenance(item.root);
    const proof = readFileSync(join(item.root, proofPath), 'utf8');
    const parsed: unknown = JSON.parse(proof);
    assert.ok(typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed);
    assert.equal(parsed.schemaVersion, 1);
    assert.match(proof, new RegExp(createHash('sha256').update(readFileSync(join(item.root, 'dist/server/index.js'))).digest('hex')));
    const before = snapshot(item.root);
    implementation.verifyBuildProvenance(item.root);
    implementation.verifyBuildProvenance(item.root);
    assert.deepEqual(snapshot(item.root), before);
    implementation.writeBuildProvenance(item.root);
    assert.equal(readFileSync(join(item.root, proofPath), 'utf8'), proof);
  } finally { item.cleanup(); }
});

await test('each explicit build input and recursive source root is bound to its bytes', async () => {
  const implementation = await api();
  for (const path of [...requiredFiles, ...sourceRoots.map(root => `${root}/nested/source.txt`), 'dist/server/index.js', 'dist/.openai/hosting.json', 'dist/.openai/drizzle/0000.sql']) {
    const item = fixture();
    try {
      implementation.writeBuildProvenance(item.root);
      put(item.root, path, 'changed bytes');
      const before = snapshot(item.root);
      assert.throws(() => implementation.verifyBuildProvenance(item.root), path);
      assert.deepEqual(snapshot(item.root), before);
    } finally { item.cleanup(); }
  }
});

await test('added and removed source and packaged output files invalidate the receipt', async () => {
  const implementation = await api();
  for (const path of ['core/nested/source.txt', 'dist/.openai/drizzle/0000.sql', 'dist/server/extra.js']) for (const action of ['add', 'remove']) {
    const item = fixture();
    try {
      put(item.root, path, 'original');
      implementation.writeBuildProvenance(item.root);
      if (action === 'add') put(item.root, `${path}.new`, 'new file');
      else rmSync(join(item.root, path));
      const before = snapshot(item.root);
      assert.throws(() => implementation.verifyBuildProvenance(item.root));
      assert.deepEqual(snapshot(item.root), before);
    } finally { item.cleanup(); }
  }
});

await test('missing required roots and files refuse both writing and verification', async () => {
  const implementation = await api();
  for (const path of [...requiredFiles, ...sourceRoots, 'dist/server/index.js']) {
    const item = fixture();
    try {
      implementation.writeBuildProvenance(item.root);
      rmSync(join(item.root, path), { recursive: true });
      assert.throws(() => implementation.verifyBuildProvenance(item.root), path);
      assert.throws(() => implementation.writeBuildProvenance(item.root), path);
    } finally { item.cleanup(); }
  }
});

await test('missing and malformed receipts cannot be silently regenerated by verification', async () => {
  const implementation = await api();
  for (const malformed of [null, '', '{', '{}', '{"schemaVersion":2}', '[]']) {
    const item = fixture();
    try {
      if (malformed !== null) put(item.root, proofPath, malformed);
      const before = snapshot(item.root);
      assert.throws(() => implementation.verifyBuildProvenance(item.root));
      assert.deepEqual(snapshot(item.root), before);
    } finally { item.cleanup(); }
  }
});

await test('README and generated files outside the explicit source allowlist do not invalidate proof', async () => {
  const implementation = await api();
  const item = fixture();
  try {
    implementation.writeBuildProvenance(item.root);
    for (const path of ['README.md', 'node_modules/package/index.js', '.blabla/site-client/index.js', 'dist/unrelated.txt', 'tests/unrelated.test.ts']) put(item.root, path, 'outside build inputs');
    const before = snapshot(item.root);
    implementation.verifyBuildProvenance(item.root);
    assert.deepEqual(snapshot(item.root), before);
  } finally { item.cleanup(); }
});

await test('symlinked source files, source directories, Worker and receipt are refused', async () => {
  const implementation = await api();
  for (const path of ['core/nested/source.txt', 'core/nested', 'core', 'package.json', '.openai', 'dist', 'dist/server/index.js', proofPath]) {
    const item = fixture();
    try {
      implementation.writeBuildProvenance(item.root);
      const destination = join(item.root, 'outside-link-target');
      const original = join(item.root, path);
      if (lstatSync(original).isDirectory()) {
        mkdirSync(destination);
        for (const name of readdirSync(original, { recursive: true, encoding: 'utf8' })) {
          const from = join(original, name);
          if (lstatSync(from).isDirectory()) mkdirSync(join(destination, name), { recursive: true });
          else put(destination, name, readFileSync(from, 'utf8'));
        }
      }
      else writeFileSync(destination, readFileSync(original));
      rmSync(original, { recursive: true });
      symlinkSync(destination, original);
      assert.throws(() => implementation.verifyBuildProvenance(item.root), path);
      assert.throws(() => implementation.writeBuildProvenance(item.root), path);
    } finally { item.cleanup(); }
  }
});

await test('source changes during compilation refuse to stamp an already-built Worker', async () => {
  const implementation = await api();
  const item = fixture();
  try {
    const captured = implementation.captureBuildInputs(item.root);
    assert.deepEqual(captured.files.map(file => file.path), captured.files.map(file => file.path).toSorted(lexical));
    for (const file of captured.files) {
      const bytes = readFileSync(join(item.root, file.path));
      assert.equal(file.bytes, bytes.length);
      assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    assert.equal(captured.inputDigest, createHash('sha256').update(JSON.stringify(captured.files)).digest('hex'));
    implementation.writeBuildProvenance(item.root, captured.inputDigest);
    put(item.root, 'web/nested/source.txt', 'changed during compilation');
    const before = snapshot(item.root);
    assert.throws(() => implementation.writeBuildProvenance(item.root, captured.inputDigest));
    assert.deepEqual(snapshot(item.root), before);
  } finally { item.cleanup(); }
});

await test('required source roots cannot become ordinary files and required files cannot become directories', async () => {
  const implementation = await api();
  for (const path of [...sourceRoots, ...requiredFiles, 'dist/server', 'dist/.openai', 'dist/server/index.js']) {
    const item = fixture();
    try {
      implementation.writeBuildProvenance(item.root);
      const target = join(item.root, path);
      const wasDirectory = lstatSync(target).isDirectory();
      rmSync(target, { recursive: true });
      if (wasDirectory) writeFileSync(target, 'wrong type');
      else mkdirSync(target);
      assert.throws(() => implementation.verifyBuildProvenance(item.root), path);
      assert.throws(() => implementation.writeBuildProvenance(item.root), path);
    } finally { item.cleanup(); }
  }
});
