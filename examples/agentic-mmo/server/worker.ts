import { DIRECTOR_EVENTS, TURN_RULES } from '../core/content.ts';
import { observe } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';
import { CHOICE_PAGE_FORMAT, ChoicePageError, createChoicePage, parseChoicePageRequest } from '../protocol/choice-pages.ts';
import { type D1Database, WorldRepository } from './repository.ts';
import { parseRecordedChoiceQuery } from './recorded-choices.ts';
import type { PublicProvenance, PublicWorldRead } from './public-protocol.ts';
import { boundedInteger, record, RequestFailure } from './validation.ts';

export interface WorkerEnvironment { DB?: D1Database; AGENT_WRITER_USER_IDS?: string; WORLD_ID?: string }
export type AssetResponder = (request: Request) => Response | null | Promise<Response | null>;
export interface WorkerOptions { now?: () => Date }

const objectSchema = { type: 'object', additionalProperties: false };
const revisionField = { type: 'integer', minimum: 0 };
const stringField = { type: 'string', minLength: 1, maxLength: 200 };
const planField = { type: 'array', maxItems: TURN_RULES.maximumPlanItems, items: { ...objectSchema, properties: { action: { type: 'object' }, reason: { type: 'string', minLength: 1, maxLength: 280 } }, required: ['action', 'reason'] } };
const tools = [
  { name: 'whoami', description: 'Return this authenticated caller’s Site-scoped identity for explicit operator enrollment.', inputSchema: { ...objectSchema, properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'simulation_status', description: 'Read whether this world has explicitly activated procedural policies, their durable decision counts and the last actual wake. Enabled does not establish an installed schedule. This read never advances the world.', inputSchema: { ...objectSchema, properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'activate_simulation', description: 'Explicitly enable or pause server-owned deterministic civilization and Director policies for this existing world. Preserve its history and release. Requires enrolled operator authority; does not install a schedule or immediately take actions. Stable commandId and exact observed world revision are required.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, enabled: { type: 'boolean' }, commandId: stringField }, required: ['expectedRevision', 'enabled', 'commandId'] } },
  { name: 'run_simulation', description: 'Wake explicitly activated procedural policies once at server time. The server chooses all exact legal actions; callers supply no actions, targets, models or timestamps. Atomically persist bounded upkeep, at most one decision for each of six actors per current ten-second window, policy memory and exact receipts. No missed tactical allowances accumulate. Inspect simulation.remainingStrategyTicks and simulation.remainingClockTicks; positive backlog means no actor decisions were taken. Retry an uncertain wake only with its original commandId. Requires enrolled operator authority. This tool does not install a scheduler.', inputSchema: { ...objectSchema, properties: { commandId: stringField }, required: ['commandId'] } },
  { name: 'action_receipt', description: 'Read this enrolled caller’s accepted action command ID and its original committed revision without changing the world. not_found means no matching receipt in the reported revision snapshot; it does not diagnose denial or authorize a retry. Preserve the original request and permission boundary.', inputSchema: { ...objectSchema, properties: { commandId: stringField }, required: ['commandId'] }, annotations: { readOnlyHint: true } },
  { name: 'observe_world', description: 'Read the persistent world, action-plan readiness and admission times for one seat. Overdue strategy can make legalActions empty because ordinary admission is blocked; this does not establish structural impossibility. An enrolled caller with an exact supported typed intention may use play_action strategy-action for atomic upkeep and candidate-state validation, or explicit upkeep-only then observe afresh. Empty choices do not authorize invented identifiers. Optional compact-trade-v1 returns every indexed choice. compact-trade-pages-v1 returns 20 complete choices and first-page context; choiceCursor continues that revision and observation time. Stale cursors require a fresh first page. Reads and paging never reserve or execute actions.', inputSchema: { ...objectSchema, properties: { seat: { type: 'integer', minimum: 0, maximum: 5 }, observationFormat: { enum: ['compact-trade-v1', CHOICE_PAGE_FORMAT] }, choiceCursor: { type: 'string', minLength: 1, maxLength: 2048 } } }, annotations: { readOnlyHint: true } },
  { name: 'initialize_world', description: 'Initialize a clearly named new online world once; never replace an existing world.', inputSchema: { ...objectSchema, properties: { seed: { type: 'integer' }, clockEpoch: stringField, registeredRulesId: stringField, commandId: stringField }, required: ['seed', 'clockEpoch', 'commandId'] } },
  { name: 'play_action', description: 'Submit one model-chosen action. Explicit action {type: strategy-action, action: <exact typed game action>} atomically realizes at most 60 due strategy beats and validates that exact action at one server timestamp. The original expectedRevision is strict: this envelope never rebases after another commit. Any action, plan, admission or persistence refusal leaves upkeep and action unchanged. No numeric choice, alternate target or automatic successor is allowed. Build uses {type: build, project: <building ID>, cityId: <exact owned town ID>}; examples are shapes, not authorization or proof of current legality. Preserve all chosen town, offer, route and recipe identifiers. For a larger backlog, use action {type: strategy-catchup, timestamp: <observed UTC>} as explicit upkeep-only, inspect remainingTicks and observe afresh. The dedicated catchup_strategy tool also supports explicit bounded upkeep-only with the same enrolled authority. Both envelopes require the existing enrolled authority and stable commandId. Ordinary unwrapped exact actions may use bounded same-intent CAS revalidation; numeric choices remain strict. Ordinary overdue actions retain zero-effect strategy_catchup_required refusal. An optional released plan has at most two reasoned items and its head must match the exact inner action. Server time enforces the actor budget.', inputSchema: { ...objectSchema, properties: { seat: { type: 'integer', minimum: 0, maximum: 5 }, expectedRevision: { ...revisionField, description: 'strategy-action requires the strict original observed expectedRevision and never rebases.' }, choice: { type: 'integer', minimum: 0 }, action: { type: 'object', examples: [{ type: 'strategy-action', action: { type: 'build', project: 'kiln', cityId: 'city-0' } }, { type: 'strategy-catchup', timestamp: '2026-10-16T00:00:00.000Z' }] }, plan: planField, model: stringField, commandId: stringField }, required: ['seat', 'expectedRevision', 'model', 'commandId'] } },
  { name: 'director_tick', description: 'Submit an idempotent Director event, review or exact clock interval.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, kind: { enum: ['event', 'review', 'clock'] }, intervalId: stringField, timestamp: stringField, event: { enum: DIRECTOR_EVENTS.map((event) => event.id) }, regional: { type: 'object', description: 'Exact regional selector returned by observation; never replace local IDs or reuse a different event instance.' }, target: { type: 'integer', minimum: 0, maximum: 4 }, model: stringField }, required: ['expectedRevision', 'kind', 'intervalId', 'timestamp'] } },
  { name: 'catchup_clock', description: 'Realize due six-minute clock intervals through an explicit timestamp. Process at most240 due ticks and inspect remainingTicks. A late scheduler realizes due ticks late.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, timestamp: stringField, commandId: stringField, model: stringField }, required: ['expectedRevision', 'timestamp', 'commandId'] } },
  { name: 'catchup_strategy', description: 'Any enrolled agent can preflight its own action by realizing up to 60 due economy beats through an explicit UTC timestamp. Read remainingTicks, continue bounded batches with fresh revision and unique command IDs until zero, then observe and choose a real action. No other actor or scheduler wake is required; idle worlds may realize beats late.', inputSchema: { ...objectSchema, properties: { expectedRevision: revisionField, timestamp: stringField, commandId: stringField, model: stringField }, required: ['expectedRevision', 'timestamp', 'commandId'] } },
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
  return { kind: value.kind, model: value.model, seat: value.seat, commandId: value.commandId, recordedAt: value.recordedAt, ...(value.policy ? { policy: { ...value.policy } } : {}) };
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

async function observation(store: WorldRepository, timestamp: string, input: Record<string, unknown>, scope: string): Promise<unknown> {
  const { observationFormat, ...controls } = input;
  if (observationFormat !== undefined && observationFormat !== 'compact-trade-v1' && observationFormat !== CHOICE_PAGE_FORMAT) throw new RequestFailure(400, 'invalid_observation_format');
  if (observationFormat !== CHOICE_PAGE_FORMAT && input.choiceCursor !== undefined) throw new RequestFailure(400, 'invalid_choice_cursor');
  try {
    const pageRequest = observationFormat === CHOICE_PAGE_FORMAT ? parseChoicePageRequest(controls, 'host', timestamp) : null;
    const current = await store.read();
    if (!current) throw new RequestFailure(503, 'world_not_initialized');
    if (pageRequest) return await createChoicePage({ ...current, scope }, pageRequest);
    const selected = input.seat === undefined ? current.state.phase : boundedInteger(input.seat, 0, 5, 'seat');
    const view = observationFormat === undefined ? observe(current.state, selected, timestamp) : observeCompactTrade(current.state, selected, timestamp);
    const hosted = { ...view, serverTimestamp: timestamp, releaseId: current.state.releaseId, unlockedFeatures: current.state.unlockedFeatures, calendarMilestones: current.state.calendarMilestones, clockEpoch: current.state.clockEpoch, clockTicks: current.state.clockTicks };
    const indexed = view.legalActions.map((option, choice) => ({ choice, ...option }));
    return observationFormat === undefined ? { ...hosted, choices: indexed } : { ...hosted, legalActions: indexed };
  } catch (failure) {
    if (failure instanceof ChoicePageError) throw new RequestFailure(failure.status, failure.code, failure.details);
    throw failure;
  }
}

async function callTool(name: string, args: Record<string, unknown>, request: Request, environment: WorkerEnvironment, timestamp: string): Promise<unknown> {
  if (name === 'whoami') return { userId: identity(request), identityScope: 'site', writerEnrolled: (environment.AGENT_WRITER_USER_IDS ?? '').split(',').map((value) => value.trim()).includes(identity(request)) };
  if (name === 'simulation_status') return repository(environment).simulation();
  if (name === 'observe_world') return observation(repository(environment), timestamp, args, environment.WORLD_ID ?? 'main');
  const actor = authorize(request, environment);
  const store = repository(environment);
  switch (name) {
    case 'activate_simulation': return store.configureSimulation(args, actor, timestamp);
    case 'run_simulation': return store.runSimulation(args, actor, timestamp);
    case 'action_receipt': return store.actionReceipt(args, actor);
    case 'initialize_world': return store.initialize(args, actor, timestamp);
    case 'play_action': return store.mutate('action', args, actor, timestamp);
    case 'director_tick': return store.mutate('director-tick', args, actor, timestamp);
    case 'catchup_strategy': return store.mutate('strategy-catchup', args, actor, timestamp);
    case 'catchup_clock': return store.mutate('clock-catchup', args, actor, timestamp);
    case 'apply_release': throw new RequestFailure(409, 'pre_release_migration_disabled');
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
              case '/api/simulation': return response({ ok: true, ...await store.simulation() });
              case '/api/observe': {
                const formats = url.searchParams.getAll('observationFormat');
                const input: Record<string, unknown> = { ...Object.fromEntries(url.searchParams), seat: url.searchParams.has('seat') ? Number(url.searchParams.get('seat')) : undefined, observationFormat: formats.length > 1 ? formats : formats[0] };
                if (input.observationFormat === CHOICE_PAGE_FORMAT) {
                  for (const key of new Set(url.searchParams.keys())) {
                    const values = url.searchParams.getAll(key);
                    if (values.length > 1) input[key] = values;
                  }
                }
                return response(await observation(store, timestamp, input, environment.WORLD_ID ?? 'main'));
              }
              case '/api/history': {
                const history = await store.history(Number(url.searchParams.get('after') ?? '0'), Number(url.searchParams.get('limit') ?? '50'));
                return response({ ...history, entries: history.entries.map((entry) => ({ ...entry, provenance: publicProvenance(entry.provenance) })) });
              }
              case '/api/recorded-choice': return response(await store.recordedChoiceDetail(parseRecordedChoiceQuery(url.searchParams, 'detail')));
              case '/api/chronicle': {
                if (url.searchParams.has('format')) return response(await store.boundedChronicle(parseRecordedChoiceQuery(url.searchParams, 'page')));
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
            case '/api/simulation/activate': return response(await store.configureSimulation(input, actor, timestamp));
            case '/api/simulation/run': return response(await store.runSimulation(input, actor, timestamp));
            case '/api/init': return response(await store.initialize(input, actor, timestamp));
            case '/api/action': return response(await store.mutate('action', input, actor, timestamp));
            case '/api/tick': return response(await store.mutate('director-tick', input, actor, timestamp));
            case '/api/strategy-catchup': return response(await store.mutate('strategy-catchup', input, actor, timestamp));
            case '/api/catchup': return response(await store.mutate('clock-catchup', input, actor, timestamp));
            case '/api/release-apply': throw new RequestFailure(409, 'pre_release_migration_disabled');
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
