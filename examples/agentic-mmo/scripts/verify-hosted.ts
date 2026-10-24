import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyBuildProvenance } from './build-provenance.ts';

interface WorkerModule {
  default: { fetch(request: Request, environment: Record<string, unknown>): Promise<Response> };
}

function isWorker(value: unknown): value is WorkerModule {
  return typeof value === 'object' && value !== null && 'default' in value
    && typeof value.default === 'object' && value.default !== null && 'fetch' in value.default
    && typeof value.default.fetch === 'function';
}

verifyBuildProvenance(process.cwd());
const source = await readFile(resolve('dist/server/index.js'), 'utf8');
const module: unknown = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.ok(isWorker(module), 'Artifact must export default.fetch');
const page = await module.default.fetch(new Request('https://example.test/'), {});
assert.equal(page.status, 200);
assert.match(page.headers.get('content-type') ?? '', /text\/html/u);
const html = await page.text();
assert.match(html, /id="app"/u);
const asset = /src="(\.\/assets\/[^"]+\.js)"/u.exec(html)?.[1];
assert.ok(asset, 'Client entry asset must be embedded');
const bundle = await module.default.fetch(new Request(new URL(asset, 'https://example.test/')), {});
assert.equal(bundle.status, 200);
assert.match(bundle.headers.get('cache-control') ?? '', /immutable/u);
const version = await module.default.fetch(new Request('https://example.test/version.json'), {});
assert.equal(version.status, 200);
assert.equal(version.headers.get('cache-control'), 'no-store');
assert.deepEqual(await version.json(), JSON.parse(await readFile('public/version.json', 'utf8')));
const forbidden = await module.default.fetch(new Request('https://example.test/api/action', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
}), {});
assert.equal(forbidden.status, 401);
const metadata: unknown = JSON.parse(await readFile('dist/.openai/hosting.json', 'utf8'));
assert.ok(typeof metadata === 'object' && metadata !== null && 'd1' in metadata);
assert.ok(!('static' in metadata));
assert.equal(metadata.d1, 'DB');

const journal: unknown = JSON.parse(await readFile('dist/.openai/drizzle/meta/_journal.json', 'utf8'));
assert.ok(typeof journal === 'object' && journal !== null && 'entries' in journal && Array.isArray(journal.entries) && journal.entries.length > 0);
process.stdout.write('Hosted artifact: embedded HTML/assets, uncached version, denied anonymous writes and migration journal verified\n');
