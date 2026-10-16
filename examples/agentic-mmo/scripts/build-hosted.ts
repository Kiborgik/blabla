import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'vite-plus';

const root = process.cwd();
const client = resolve(root, '.blabla/site-client');
const server = resolve(root, 'dist/server');
const metadata = resolve(root, 'dist/.openai');
const manifestText = await readFile(resolve(root, '.openai/hosting.json'), 'utf8');
const manifest: unknown = JSON.parse(manifestText);
if (typeof manifest !== 'object' || manifest === null || 'static' in manifest)
  throw new Error('Hosted build requires a Worker manifest without static configuration');

await build({ build: { outDir: client, emptyOutDir: true } });

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const assets: Record<string, { body: string; type: string; etag: string; cache: string }> = {};
for (const name of (await readdir(client, { recursive: true })).toSorted()) {
  if (!extname(name)) continue;
  const bytes = await readFile(resolve(client, name));
  const path = `/${name.replaceAll('\\', '/')}`;
  assets[path] = {
    body: bytes.toString('base64'),
    type: mime[extname(name)] ?? 'application/octet-stream',
    etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
    cache: path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
  };
}

const entry = resolve(root, '.blabla/host-entry.js');
const workerPath = resolve(root, 'server/worker.ts');
const source = `import { createWorker } from ${JSON.stringify(workerPath)};
const assets = ${JSON.stringify(assets)};
const decoded = new Map();
export default createWorker((request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = new URL(request.url).pathname;
  const asset = assets[path === '/' ? '/index.html' : path];
  if (!asset) return null;
  const headers = { 'content-type': asset.type, 'cache-control': asset.cache, etag: asset.etag, 'x-content-type-options': 'nosniff' };
  if (asset.cache !== 'no-store' && request.headers.get('if-none-match') === asset.etag) return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') return new Response(null, { headers });
  if (!decoded.has(path)) decoded.set(path, Uint8Array.from(atob(asset.body), (character) => character.charCodeAt(0)));
  return new Response(decoded.get(path), { headers });
});`;

await writeFile(entry, source);
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await build({
  configFile: false,
  publicDir: false,
  ssr: { target: 'webworker', noExternal: true },
  build: {
    ssr: entry,
    outDir: server,
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    rolldownOptions: { output: { entryFileNames: 'index.js' } },
  },
});
await mkdir(metadata, { recursive: true });
await writeFile(resolve(metadata, 'hosting.json'), manifestText);
await cp(resolve(root, 'server/migrations'), resolve(metadata, 'drizzle'), { recursive: true });
process.stdout.write(`${JSON.stringify({ entrypoint: 'dist/server/index.js', embeddedAssets: Object.keys(assets).length })}\n`);
