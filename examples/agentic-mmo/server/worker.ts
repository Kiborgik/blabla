import { DIRECTOR_EVENTS } from '../core/content.ts';
import { observe } from '../core/engine.ts';
import { type D1Database, WorldRepository } from './repository.ts';
import type { PublicProvenance, PublicWorldRead } from './public-protocol.ts';
import { boundedInteger, record, RequestFailure } from './validation.ts';

export interface WorkerEnvironment { DB?: D1Database; AGENT_WRITER_USER_IDS?: string; WORLD_ID?: string }
export type AssetResponder = (request: Request) => Response | null | Promise<Response | null>;
export interface WorkerOptions { now?: () => Date }

const objectSchema = { type: 'object', additionalProperties: false };
const revisionField = { type: 'integer', minimum: 0 };
const stringField = { type: 'string', minLength: 1, maxLength: 200 };
const tools = [
  { name: 'whoami', description: 'Return this authenticated caller’s Site-scoped identity for explicit operator enrollment.', inputSchema: { ...objectSchema, properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'observe_world', description: 'Read the persistent world and available actions for one seat.', inputSchema: { ...objectSchema, properties: { seat: { type: 'integer', minimum: 0, maximum: 5 } } }, annotations: { readOnlyHint: true } },
  { name: 'initialize_world', description: 'Initialize a clearly named new online world once; never replace an existing world.', inputSchema: { ...objectSchema, properties: { seed: { type: 'integer' }, clockEpoch: stringField, commandId: stringField }, required: ['seed', 'clockEpoch', 'commandId'] } },
  { name: 'play_action', description: 'Submit an exact model-chosen action. Independent releases revalidate exact actions after unrelated commits; choice indexes require the observed revision. Server time enforces the actor budget.', inputSchema: { ...objectSchema, properties: { seat: { type: 'integer', minimum: 0, maximum: 5 }, expectedRevision: revisionField, choice: { type: 'integer', minimum: 0 }, action: { type: 'object' }, model: stringField, commandId: stringField }, required: ['seat', 'expectedRevision', 'model', 'commandId'] } },
  { name: 'director_tick', description: 'Submit an idempotent Director event, review or exact clock interval.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, kind: { enum: ['event', 'review', 'clock'] }, intervalId: stringField, timestamp: stringField, event: { enum: DIRECTOR_EVENTS.map((event) => event.id) }, target: { type: 'integer', minimum: 0, maximum: 4 }, model: stringField }, required: ['expectedRevision', 'kind', 'intervalId', 'timestamp'] } },
  { name: 'catchup_clock', description: 'Realize due six-minute clock intervals through an explicit timestamp. Process at most240 due ticks and inspect remainingTicks. A late scheduler realizes due ticks late.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, timestamp: stringField, commandId: stringField, model: stringField }, required: ['expectedRevision', 'timestamp', 'commandId'] } },
  { name: 'catchup_strategy', description: 'Realize up to 60 due economy beats through an explicit UTC timestamp, independent of actor participation. Inspect remainingTicks; late wakes realize beats late.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, timestamp: stringField, commandId: stringField, model: stringField }, required: ['expectedRevision', 'timestamp', 'commandId'] } },
  { name: 'apply_release', description: 'Explicitly apply one registered compatible release to this run. Preserve its clock, turns and history; never select a mutable current release.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, expectedFromReleaseId: stringField, targetReleaseId: stringField, commandId: stringField, model: stringField }, required: ['expectedRevision', 'expectedFromReleaseId', 'targetReleaseId', 'commandId', 'model'] } },
  { name: 'advance_history', description: 'Intentionally add calendar years once for a delivered feature or actual recorded event, preserving normal clock intervals and tactical turns.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, cause: { ...objectSchema, properties: { kind: { enum: ['feature', 'event'] }, id: { ...stringField, maxLength: 128 } }, required: ['kind', 'id'] }, reason: { ...stringField, maxLength: 1000 }, deltaYears: { type: 'integer', minimum: 0 }, timestamp: stringField, commandId: stringField, model: stringField }, required: ['expectedRevision', 'cause', 'reason', 'deltaYears', 'timestamp', 'commandId', 'model'] } },
];

function response(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}

function matchesEtag(value: string | null, etag: string): boolean {
  if (value === null) return false;
  let remaining = value.trim();
  if (remaining === '*') return true;
  let matched = false;
  let emptyElements = 0;
  for (;;) {
    const tag = /^(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*")/.exec(remaining);
    if (tag) {
      if (tag[1] === etag.replace(/^W\//, '')) matched = true;
      remaining = remaining.slice(tag[0].length).trimStart();
    } else if (remaining.length === 0 || remaining.startsWith(',')) {
      emptyElements += 1;
      if (emptyElements > 32) return false;
    } else return false;
    if (remaining.length === 0) return matched;
    if (!remaining.startsWith(',')) return false;
    remaining = remaining.slice(1).trimStart();
  }
}

function publicProvenance(value: PublicProvenance): PublicProvenance {
  return { kind: value.kind, model: value.model, seat: value.seat, commandId: value.commandId, recordedAt: value.recordedAt };
}

function identity(request: Request): string {
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) throw new RequestFailure(401, 'authenticated_identity_required');
  return userId;
}

function authorize(request: Request, environment: WorkerEnvironment): string {
  const userId = identity(request);
  const allowed = (environment.AGENT_WRITER_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(userId)) throw new RequestFailure(403, 'writer_not_enrolled');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new RequestFailure(403, 'cross_origin_write');
  return userId;
}

async function payload(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RequestFailure(415, 'json_content_type_required');
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 65536) throw new RequestFailure(413, 'request_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestFailure(400, 'empty_body');
  const decoder = new TextDecoder();
  let bytes = 0;
  let contents = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65536) { await reader.cancel(); throw new RequestFailure(413, 'request_too_large'); }
      contents += decoder.decode(chunk.value, { stream: true });
    }
    contents += decoder.decode();
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new RequestFailure(400, 'invalid_json'); }
  return record(value);
}

function repository(environment: WorkerEnvironment): WorldRepository {
  if (!environment.DB) throw new RequestFailure(503, 'database_unavailable');
  return new WorldRepository(environment.DB, environment.WORLD_ID ?? 'main');
}

async function observation(store: WorldRepository, timestamp: string, seat?: unknown): Promise<unknown> {
  const current = await store.read();
  if (!current) throw new RequestFailure(503, 'world_not_initialized');
  const selected = seat === undefined ? current.state.phase : boundedInteger(seat, 0, 5, 'seat');
  const view = observe(current.state, selected, timestamp);
  return { ...view, serverTimestamp: timestamp, releaseId: current.state.releaseId, unlockedFeatures: current.state.unlockedFeatures, calendarMilestones: current.state.calendarMilestones, clockEpoch: current.state.clockEpoch, clockTicks: current.state.clockTicks, choices: view.legalActions.map((option, choice) => ({ choice, ...option })) };
}

async function callTool(name: string, args: Record<string, unknown>, request: Request, environment: WorkerEnvironment, timestamp: string): Promise<unknown> {
  if (name === 'whoami') return { userId: identity(request), identityScope: 'site', writerEnrolled: (environment.AGENT_WRITER_USER_IDS ?? '').split(',').map((value) => value.trim()).includes(identity(request)) };
  if (name === 'observe_world') return observation(repository(environment), timestamp, args.seat);
  const actor = authorize(request, environment);
  const store = repository(environment);
  switch (name) {
    case 'initialize_world': return store.initialize(args, actor, timestamp);
    case 'play_action': return store.mutate('action', args, actor, timestamp);
    case 'director_tick': return store.mutate('director-tick', args, actor, timestamp);
    case 'catchup_strategy': return store.mutate('strategy-catchup', args, actor, timestamp);
    case 'catchup_clock': return store.mutate('clock-catchup', args, actor, timestamp);
    case 'apply_release': return store.mutate('release-apply', args, actor, timestamp);
    case 'advance_history': return store.mutate('history-advance', args, actor, timestamp);
    default: throw new RequestFailure(404, 'unknown_tool');
  }
}

async function mcp(request: Request, environment: WorkerEnvironment, timestamp: string): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new RequestFailure(403, 'cross_origin_mcp');
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  const envelope = await payload(request);
  const id = typeof envelope.id === 'string' || typeof envelope.id === 'number' || envelope.id === null ? envelope.id : null;
  try {
    const version = request.headers.get('MCP-Protocol-Version');
    if (version && version !== '2025-06-18' && envelope.method !== 'initialize') throw new RequestFailure(400, 'unsupported_protocol_version');
    if (envelope.jsonrpc !== '2.0' || typeof envelope.method !== 'string') throw new RequestFailure(400, 'invalid_rpc_request');
    if (envelope.method === 'notifications/initialized' || envelope.method === 'notifications/cancelled') return new Response(null, { status: 202 });
    let result: unknown;
    switch (envelope.method) {
      case 'initialize': result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agentic-civilizations', version: '0.1.0' } }; break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools }; break;
      case 'tools/call': {
        const params = record(envelope.params);
        if (typeof params.name !== 'string') throw new RequestFailure(400, 'tool_name_required');
        const value = await callTool(params.name, record(params.arguments ?? {}), request, environment, timestamp);
        result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
        break;
      }
      default: throw new RequestFailure(404, 'unknown_rpc_method');
    }
    return response({ jsonrpc: '2.0', id, result });
  } catch (failure) {
    if (!(failure instanceof RequestFailure)) throw failure;
    return response({ jsonrpc: '2.0', id, error: { code: failure.status === 404 ? -32601 : -32602, message: failure.code, data: failure.details } }, failure.status);
  }
}

export function createWorker(assetResponder?: AssetResponder, options: WorkerOptions = {}) {
  const now = options.now ?? (() => new Date());
  return {
    async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
      try {
        const url = new URL(request.url);
        const timestamp = now().toISOString();
        if (url.pathname === '/mcp') return await mcp(request, environment, timestamp);
        if (url.pathname.startsWith('/api/')) {
          if (request.method === 'GET') {
            const store = repository(environment);
            switch (url.pathname) {
              case '/api/world': {
                const conditional = request.headers.get('if-none-match');
                if (conditional !== null) {
                  const revision = await store.revision();
                  if (revision === null) throw new RequestFailure(503, 'world_not_initialized');
                  const etag = store.worldEtag(revision);
                  if (matchesEtag(conditional, etag)) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-store' } });
                }
                const current = await store.read();
                if (!current) throw new RequestFailure(503, 'world_not_initialized');
                const value: PublicWorldRead = { ok: true, authoritative: true, ...current };
                return response(value, 200, { etag: store.worldEtag(current.state.revision) });
              }
              case '/api/observe': return response(await observation(store, timestamp, url.searchParams.has('seat') ? Number(url.searchParams.get('seat')) : undefined));
              case '/api/history': {
                const history = await store.history(Number(url.searchParams.get('after') ?? '0'), Number(url.searchParams.get('limit') ?? '50'));
                return response({ ...history, entries: history.entries.map((entry) => ({ ...entry, provenance: publicProvenance(entry.provenance) })) });
              }
              case '/api/chronicle': {
                const chronicle = await store.chronicle(Number(url.searchParams.get('after') ?? '0'), Number(url.searchParams.get('limit') ?? '50'));
                return response({ ...chronicle, entries: chronicle.entries.map((entry) => ({ ...entry, provenance: publicProvenance(entry.provenance) })) });
              }
              default: throw new RequestFailure(404, 'not_found');
            }
          }
          if (request.method !== 'POST') throw new RequestFailure(405, 'method_not_allowed');
          const actor = authorize(request, environment);
          const input = await payload(request);
          const store = repository(environment);
          switch (url.pathname) {
            case '/api/init': return response(await store.initialize(input, actor, timestamp));
            case '/api/action': return response(await store.mutate('action', input, actor, timestamp));
            case '/api/tick': return response(await store.mutate('director-tick', input, actor, timestamp));
            case '/api/strategy-catchup': return response(await store.mutate('strategy-catchup', input, actor, timestamp));
            case '/api/catchup': return response(await store.mutate('clock-catchup', input, actor, timestamp));
            case '/api/release-apply': return response(await store.mutate('release-apply', input, actor, timestamp));
            case '/api/history-advance': return response(await store.mutate('history-advance', input, actor, timestamp));
            default: throw new RequestFailure(404, 'not_found');
          }
        }
        return await assetResponder?.(request) ?? response({ error: 'not_found' }, 404);
      } catch (failure) {
        if (failure instanceof RequestFailure) return response({ ok: false, error: failure.code, ...failure.details }, failure.status);
        return response({ ok: false, error: 'internal_error' }, 500);
      }
    },
  };
}

export default createWorker();
