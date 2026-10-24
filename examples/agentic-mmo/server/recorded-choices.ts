import { knowledgeOperationEventMatches } from '../core/knowledge-validation.ts';
import { isHistoricalEventSelection } from '../core/historical-selection-validation.ts';
import { isActionPlanItems, isGameAction } from '../core/planning.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { parseUtcTimestamp } from '../core/simulation/clock.ts';
import type { GameAction, GameEvent, WorldState } from '../core/types.ts';
import { isDirectorEvent, isGameEvent } from '../core/validation.ts';
import { isPublicProvenance, RECORDED_CHOICES_FORMAT, type RecordedChoiceDetail, type RecordedChronicleEntry, type RecordedChroniclePage, type RecordedTownConsequences } from './public-protocol.ts';
import type { D1Database } from './repository.ts';
import { decodeHistorySnapshot } from './snapshot-codec.ts';
import { boundedInteger, canonical, isRecord, parseJson, RequestFailure } from './validation.ts';

export const RECORDED_CHOICE_LIMITS = { rows: 200, rowBytes: 512 * 1024, pageBytes: 1024 * 1024, snapshotBytes: 8 * 1024 * 1024 } as const;
const encoder = new TextEncoder();
const eventFields = new Set<string>(['border', 'id', 'round', 'type', 'title', 'detail', 'actor', 'target', 'tileId', 'cause', 'effects', 'importance', 'publicProjectResult', 'coastalFounding', 'strategicExtraction', 'strategicShipment', 'wonderCompletion', 'wonderLoss', 'researchBoost', 'populationGrowth', 'territoryAcquisition', 'railCompletion', 'industrialFoundry', 'steamDelivery', 'localPower', 'marsDeparture', 'marsArrival', 'marsUpkeep', 'marsHabitat', 'reliefResult', 'regionalEvent', 'knowledgeCompact', 'knowledgeStudy', 'knowledgeResult']);

function corrupt(): never { throw new RequestFailure(503, 'corrupt_history'); }
function integer(value: unknown, minimum = 0): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
function nonblank(value: unknown, maximum: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum; }
function scalarEnum(value: unknown, allowed: readonly string[]): value is string { return typeof value === 'string' && allowed.includes(value); }
function strictAction(value: unknown): value is GameAction { return isGameAction(value) && (value.type !== 'expedition' || scalarEnum(value.mission, ['settle', 'resupply'])); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && parseUtcTimestamp(value) !== null; }
function keys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): boolean { return Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)); }
function bytes(value: unknown): number { return encoder.encode(JSON.stringify(value)).length; }

export function parseRecordedChoiceQuery(query: URLSearchParams, kind: 'page' | 'detail'): Record<string, unknown> {
  const allowed = kind === 'page' ? ['format', 'after', 'through', 'limit'] : ['format', 'endRevision', 'civilizationId', 'cityId'];
  const input: Record<string, unknown> = {};
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key);
    if (!allowed.includes(key) || values.length !== 1) throw new RequestFailure(400, 'invalid_recorded_choice_query');
    const value = values[0];
    if (key === 'format' || key === 'cityId') input[key] = value;
    else {
      if (value === undefined || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new RequestFailure(400, 'invalid_recorded_choice_query');
      input[key] = Number(value);
    }
  }
  if (input.format !== RECORDED_CHOICES_FORMAT) throw new RequestFailure(400, 'invalid_recorded_choice_format');
  return input;
}

function strictEvents(value: unknown, start?: number, end?: number): GameEvent[] {
  if (!Array.isArray(value)) return corrupt();
  const ids = new Set<string>();
  const result: GameEvent[] = [];
  for (const event of value) {
    if (!isRecord(event) || Object.keys(event).some(key => !eventFields.has(key))) return corrupt();
    if (event.marsDeparture !== undefined && (!isRecord(event.marsDeparture) || !scalarEnum(event.marsDeparture.mission, ['settle', 'resupply']))) return corrupt();
    if (!isGameEvent(event) || ids.has(event.id)) return corrupt();
    if (start !== undefined && end !== undefined) {
      const match = /^([1-9]\d*):(0|[1-9]\d*)$/.exec(event.id);
      if (!match || !integer(Number(match[1]), start + 1) || Number(match[1]) > end || !integer(Number(match[2]))) return corrupt();
    }
    ids.add(event.id);
    result.push(event);
  }
  return result;
}

function regionalReceiptLink(selection: unknown, family: unknown, civilization: unknown, revision: number, events: GameEvent[]): void {
  const receipts = events.flatMap(event => event.regionalEvent ? [event.regionalEvent] : []);
  if (selection === undefined) {
    if (receipts.length !== 0) return corrupt();
    return;
  }
  const receipt = receipts[0];
  if (!isHistoricalEventSelection(selection) || receipts.length !== 1 || !receipt || receipt.eventKind !== family
    || receipt.civId !== civilization || receipt.revision !== revision || canonical(receipt.selection) !== canonical(selection)) return corrupt();
}

function knowledgeReceiptLink(kind: string, action: GameAction | undefined, seat: unknown, events: GameEvent[]): void {
  const compactEvents = events.filter(event => event.knowledgeCompact);
  const receipts = events.flatMap(event => event.knowledgeResult ? [event.knowledgeResult] : []);
  if (new Set(receipts.map(result => result.compact.id)).size !== receipts.length || compactEvents.length > 1) return corrupt();
  for (const event of compactEvents) {
    const compact = event.knowledgeCompact!; const terms = compact.terms;
    if (kind !== 'action' || !action || event.actor !== seat) return corrupt();
    if (event.type === 'knowledge-proposed') {
      if (action.type !== 'propose-knowledge' || terms.teacherId !== seat || action.routeId !== terms.routeId
        || action.teacherCityId !== terms.teacherCityId || action.learnerCityId !== terms.learnerCityId || action.technologyId !== terms.technologyId
        || action.teacherInstitutionId !== terms.teacherInstitutionId || action.learnerInstitutionId !== terms.learnerInstitutionId) return corrupt();
    } else if (action.type !== 'respond-knowledge' || !action.accept || action.compactId !== compact.id || terms.learnerId !== seat) return corrupt();
  }
  for (const event of events) if (event.knowledgeStudy) {
    if (kind !== 'strategy-catchup') return corrupt();
    const attempt = event.knowledgeStudy.attempt;
    for (const proof of [attempt.teacher, attempt.learner]) if (proof && events.filter(operation => knowledgeOperationEventMatches(operation, proof)).length !== 1) return corrupt();
  }
  for (const result of receipts) {
    if (result.outcome === 'declined' || result.outcome === 'withdrawn') {
      if (kind !== 'action' || result.actor !== seat || !action || !('compactId' in action) || action.compactId !== result.compact.id
        || (result.outcome === 'declined' ? action.type !== 'respond-knowledge' || action.accept : action.type !== 'withdraw-knowledge')) return corrupt();
    } else if (kind !== 'strategy-catchup') return corrupt();
    if (result.researchCompletionEventId !== null && !events.some(event => event.id === result.researchCompletionEventId && event.type === 'research-completed'
      && event.round === result.resolvedRound && event.actor === result.compact.terms.learnerId && event.target === result.compact.terms.learnerId
      && event.effects.includes(`Technology ${result.compact.terms.technologyId} unlocked`))) return corrupt();
  }
  if (kind === 'action') {
    const knowledgeAction = action && ['propose-knowledge', 'respond-knowledge', 'withdraw-knowledge'].includes(action.type);
    if (compactEvents.length + receipts.length !== (knowledgeAction ? 1 : 0)) return corrupt();
  }
}

function borderReceiptLink(kind: string, action: GameAction | undefined, seat: unknown, events: GameEvent[]): void {
  const rows = events.filter(event => event.border);
  if (kind !== 'action') {
    if (rows.length && kind !== 'strategy-catchup' || rows.some(event => event.border?.kind === 'departure' || event.border?.kind === 'response' && event.border.actorId !== null)) return corrupt();
    return;
  }
  if (action?.type === 'dispatch-border') {
    const row = rows[0]; const payload = row?.border;
    if (rows.length !== 1 || payload?.kind !== 'departure' || payload.party.side !== 'initiator' || row?.actor !== seat
      || payload.party.departure.sourceCityId !== action.sourceCityId || payload.party.departure.tileId !== action.tileId || payload.party.departure.people !== action.people) return corrupt();
  } else if (action?.type === 'respond-border') {
    const response = rows.find(event => event.border?.kind === 'response'); const payload = response?.border;
    if (payload?.kind !== 'response' || payload.incidentId !== action.incidentId || payload.actorId !== seat || payload.response !== action.response
      || rows.length !== (action.response === 'defend' ? 2 : 1)) return corrupt();
    if (action.response === 'defend') {
      const departure = rows.find(event => event.border?.kind === 'departure'); const party = departure?.border;
      if (party?.kind !== 'departure' || party.incidentId !== action.incidentId || departure?.actor !== seat || party.party.side !== 'defender'
        || party.party.departure.sourceCityId !== action.sourceCityId || party.party.departure.people !== action.people) return corrupt();
    }
  } else if (action?.type === 'withdraw-border') {
    const row = rows[0]; const payload = row?.border;
    if (rows.length !== 1 || !payload || !('incidentId' in payload) || payload.incidentId !== action.incidentId || row?.actor !== seat
      || !(payload.kind === 'resolution' && payload.resolution.outcome === 'withdrawn' || payload.kind === 'response' && payload.response === 'yield' && payload.actorId === seat)) return corrupt();
  } else if (rows.length) return corrupt();
}

function reliefReceiptLink(kind: string, action: GameAction | undefined, seat: unknown, events: GameEvent[]): void {
  const receipts = events.flatMap(event => event.reliefResult ? [event.reliefResult] : []);
  if (new Set(receipts.map(result => result.charter.id)).size !== receipts.length) return corrupt();
  for (const result of receipts) {
    if (result.outcome === 'declined' || result.outcome === 'withdrawn') {
      if (kind !== 'action' || result.actor !== seat || !action || !('charterId' in action) || action.charterId !== result.charter.id
        || (result.outcome === 'declined' ? action.type !== 'respond-relief' || action.accept : action.type !== 'withdraw-relief')) return corrupt();
    } else if (kind !== 'strategy-catchup') return corrupt();
  }
  if (kind === 'action' && receipts.length > 1) return corrupt();
}

function projectEntry(value: unknown): RecordedChronicleEntry {
  if (!isRecord(value) || !integer(value.start_revision) || !integer(value.end_revision, value.start_revision + 1)
    || typeof value.transition_json !== 'string' || typeof value.provenance_json !== 'string' || typeof value.events_json !== 'string') return corrupt();
  if (encoder.encode(value.transition_json).length + encoder.encode(value.provenance_json).length + encoder.encode(value.events_json).length > RECORDED_CHOICE_LIMITS.rowBytes) throw new RequestFailure(503, 'recorded_choice_row_limit');
  const transition = parseJson(value.transition_json);
  const provenance = parseJson(value.provenance_json);
  const events = strictEvents(parseJson(value.events_json), value.start_revision, value.end_revision);
  if (!isRecord(transition) || !isPublicProvenance(provenance)) return corrupt();
  const base = {
    startRevision: value.start_revision, endRevision: value.end_revision, events,
    recordedReason: provenance.kind === 'procedural-policy' ? provenance.policy?.reason ?? null : null,
    provenance: { kind: provenance.kind, model: provenance.model, seat: provenance.seat, recordedAt: provenance.recordedAt, policy: provenance.policy ? { version: provenance.policy.version, profileId: provenance.policy.profileId, phase: provenance.policy.phase, decision: provenance.policy.decision, seed: provenance.policy.seed } : null },
  };
  const kind = transition.kind;
  if (kind === 'clock-catchup' || kind === 'strategy-catchup') {
    if (!keys(transition, ['kind', 'expectedRevision', 'timestamp']) || transition.expectedRevision !== value.start_revision || !timestamp(transition.timestamp)) return corrupt();
    regionalReceiptLink(undefined, undefined, undefined, value.end_revision, events);
    reliefReceiptLink(kind, undefined, undefined, events);
    knowledgeReceiptLink(kind, undefined, undefined, events);
    borderReceiptLink(kind, undefined, undefined, events);
    return { ...base, kind, action: null };
  }
  if (!keys(transition, ['kind', 'command']) || !isRecord(transition.command) || transition.command.expectedRevision !== value.start_revision) return corrupt();
  const command = transition.command;
  if (kind === 'action') {
    if (!keys(command, ['seat', 'expectedRevision', 'action', 'timestamp', 'plan', 'observedRevision'], ['seat', 'expectedRevision', 'action'])
      || provenance.kind === 'clock-service' || !integer(command.seat) || command.seat > 5 || command.seat !== provenance.seat || !strictAction(command.action)
      || command.timestamp !== undefined && !timestamp(command.timestamp)
      || command.observedRevision !== undefined && (!integer(command.observedRevision) || command.observedRevision > value.start_revision)
      || command.plan !== undefined && (!isActionPlanItems(command.plan) || command.plan.some(item => !strictAction(item.action))) || value.end_revision !== value.start_revision + 1) return corrupt();
    const plan = isActionPlanItems(command.plan) ? command.plan : [];
    const head = plan[0];
    if (head && !sameAction(head.action, command.action)) return corrupt();
    const action = command.action;
    regionalReceiptLink(action.type === 'event' ? action.regional : undefined, action.type === 'event' ? action.event : undefined, action.type === 'event' ? action.target : undefined, value.end_revision, events);
    reliefReceiptLink(kind, action, command.seat, events);
    knowledgeReceiptLink(kind, action, command.seat, events);
    borderReceiptLink(kind, action, command.seat, events);
    const recordedReason = provenance.kind === 'procedural-policy' ? provenance.policy?.reason ?? null : head?.reason ?? null;
    return { ...base, kind, action: structuredClone(command.action), recordedReason };
  }
  if (!timestamp(command.timestamp)) return corrupt();
  if (kind === 'director-tick') {
    if (!keys(command, ['expectedRevision', 'kind', 'intervalId', 'timestamp', 'event', 'target', 'regional'], ['expectedRevision', 'kind', 'intervalId', 'timestamp', 'event', 'target']) || Object.hasOwn(command, 'regional') && (!isHistoricalEventSelection(command.regional) || command.regional.local.kind !== command.event || command.kind === 'clock') || !scalarEnum(command.kind, ['clock', 'event', 'review'])
      || !nonblank(command.intervalId, 200) || !isDirectorEvent(command.event) || !integer(command.target) || command.target > 4) return corrupt();
    regionalReceiptLink(command.regional, command.event, command.target, value.end_revision, events);
  } else if (kind === 'history-advance') {
    if (!keys(command, ['expectedRevision', 'cause', 'reason', 'deltaYears', 'timestamp']) || !isRecord(command.cause) || !keys(command.cause, ['kind', 'id'])
      || !scalarEnum(command.cause.kind, ['feature', 'event']) || !nonblank(command.cause.id, 128) || !nonblank(command.reason, 1000) || !integer(command.deltaYears)) return corrupt();
  } else return corrupt();
  if (kind !== 'director-tick') regionalReceiptLink(undefined, undefined, undefined, value.end_revision, events);
  reliefReceiptLink(kind, undefined, undefined, events);
  knowledgeReceiptLink(kind, undefined, undefined, events);
  borderReceiptLink(kind, undefined, undefined, events);
  return { ...base, kind, action: null };
}

async function currentRevision(database: D1Database, worldId: string): Promise<number> {
  const result = await database.prepare('SELECT revision FROM world_state WHERE world_id = ?').bind(worldId).all();
  if (result.results.length === 0) throw new RequestFailure(503, 'world_not_initialized');
  const row = result.results[0];
  if (result.results.length !== 1 || !isRecord(row) || !integer(row.revision)) throw new RequestFailure(503, 'corrupt_world_revision');
  return row.revision;
}

export async function readBoundedChronicle(database: D1Database, worldId: string, input: Record<string, unknown>): Promise<RecordedChroniclePage> {
  if (!keys(input, ['format', 'after', 'through', 'limit'], ['format']) || input.format !== RECORDED_CHOICES_FORMAT) throw new RequestFailure(400, 'invalid_recorded_choice_query');
  const after = boundedInteger(input.after === undefined ? 0 : input.after, 0, Number.MAX_SAFE_INTEGER, 'after');
  const limit = boundedInteger(input.limit === undefined ? 50 : input.limit, 1, RECORDED_CHOICE_LIMITS.rows, 'limit');
  const requestedThrough = input.through === undefined ? undefined : boundedInteger(input.through, 0, Number.MAX_SAFE_INTEGER, 'through');
  const revision = await currentRevision(database, worldId);
  const through = requestedThrough ?? revision;
  if (through > revision || after > through) throw new RequestFailure(400, 'invalid_recorded_choice_range');
  const metadata = await database.prepare('SELECT end_revision, length(CAST(transition_json AS BLOB)) + length(CAST(provenance_json AS BLOB)) + length(CAST(events_json AS BLOB)) AS detail_bytes FROM world_transitions WHERE world_id = ? AND end_revision > ? AND end_revision <= ? ORDER BY end_revision ASC LIMIT ?').bind(worldId, after, through, limit + 1).all();
  if (metadata.results.length > limit + 1) return corrupt();
  const revisions: number[] = [];
  let previous = after;
  let used = 0;
  for (const row of metadata.results) {
    if (!isRecord(row) || !integer(row.end_revision, previous + 1) || row.end_revision > through || !integer(row.detail_bytes)) return corrupt();
    previous = row.end_revision;
    if (revisions.length === limit) break;
    if (row.detail_bytes > RECORDED_CHOICE_LIMITS.rowBytes) {
      if (revisions.length > 0) break;
      throw new RequestFailure(503, 'recorded_choice_row_limit');
    }
    if (revisions.length > 0 && used + row.detail_bytes > RECORDED_CHOICE_LIMITS.pageBytes) break;
    used += row.detail_bytes;
    revisions.push(row.end_revision);
  }
  const page: RecordedChroniclePage = { format: RECORDED_CHOICES_FORMAT, after, through, entries: [], hasMore: false, nextRevision: null };
  const last = revisions.at(-1);
  if (last === undefined) return page;
  const selected = await database.prepare('SELECT start_revision, end_revision, transition_json, provenance_json, events_json FROM world_transitions WHERE world_id = ? AND end_revision > ? AND end_revision <= ? ORDER BY end_revision ASC LIMIT ?').bind(worldId, after, last, revisions.length).all();
  if (selected.results.length !== revisions.length || selected.results.some((row, index) => !isRecord(row) || row.end_revision !== revisions[index])) return corrupt();
  let outputBytes = bytes({ ...page, hasMore: true, nextRevision: Number.MAX_SAFE_INTEGER });
  for (const row of selected.results) {
    const entry = projectEntry(row);
    const charge = bytes(entry) + (page.entries.length > 0 ? 1 : 0);
    if (outputBytes + charge > RECORDED_CHOICE_LIMITS.pageBytes) {
      if (page.entries.length === 0) throw new RequestFailure(503, 'recorded_choice_output_limit');
      break;
    }
    page.entries.push(entry);
    outputBytes += charge;
  }
  page.hasMore = metadata.results.length > page.entries.length;
  page.nextRevision = page.hasMore ? page.entries.at(-1)?.endRevision ?? null : null;
  return page;
}

function unavailableTown(cityId: string, reason: NonNullable<RecordedTownConsequences['unavailableReason']>): RecordedTownConsequences {
  return { status: 'unavailable', unavailableReason: reason, cityId, name: null, construction: { active: null, started: null, completed: null, lastCompleted: null }, operations: [], improvements: [] };
}

function projectTown(state: WorldState, entry: RecordedChronicleEntry, civilizationId: number, cityId: string): RecordedTownConsequences {
  if (!state.civilizations.some(civilization => civilization.id === civilizationId)) return unavailableTown(cityId, 'civilization_not_found');
  const city = state.cities.find(city => city.id === cityId);
  if (!city) return unavailableTown(cityId, 'town_not_found');
  if (city.civId !== civilizationId) return unavailableTown(cityId, 'town_not_owned');
  const active = city.construction?.active ?? null;
  const completed = city.construction?.lastCompleted ?? null;
  return structuredClone({
    status: 'available', unavailableReason: null, cityId, name: city.name,
    construction: {
      active,
      started: active && entry.events.some(event => event.type === 'construction-started' && event.detail === active.id && event.actor === civilizationId) ? active : null,
      completed: completed && entry.events.some(event => event.id === completed.eventId && event.actor === civilizationId) ? completed : null,
      lastCompleted: completed,
    },
    operations: Object.entries(city.buildingOperations ?? {}).map(([buildingId, operation]) => ({ buildingId, enabled: operation.enabled, result: operation.lastResult })),
    improvements: Object.values(city.improvements ?? {}).map(improvement => ({ improvementId: improvement.improvementId, tileId: improvement.tileId, enabled: improvement.operation.enabled, result: improvement.operation.lastResult })),
  });
}

export async function readRecordedChoiceDetail(database: D1Database, worldId: string, input: Record<string, unknown>): Promise<RecordedChoiceDetail> {
  if (!keys(input, ['format', 'endRevision', 'civilizationId', 'cityId'], ['endRevision', 'civilizationId', 'cityId']) || input.format !== undefined && input.format !== RECORDED_CHOICES_FORMAT) throw new RequestFailure(400, 'invalid_recorded_choice_query');
  const endRevision = boundedInteger(input.endRevision, 1, Number.MAX_SAFE_INTEGER, 'end_revision');
  const civilizationId = boundedInteger(input.civilizationId, 0, 4, 'civilization_id');
  if (!nonblank(input.cityId, 128) || input.cityId.trim() !== input.cityId || /[\u0000-\u001f\u007f]/.test(input.cityId)) throw new RequestFailure(400, 'invalid_city_id');
  const cityId = input.cityId;
  const detail: RecordedChoiceDetail = {
    format: RECORDED_CHOICES_FORMAT, endRevision, civilizationId, cityId, entry: null, recordedReason: null,
    consequences: { status: 'unavailable', basis: 'exact-end-revision-snapshot', revision: null, round: null, year: null, releaseId: null, town: unavailableTown(cityId, 'transition_not_found') },
  };
  const metadata = await database.prepare('SELECT end_revision, length(CAST(state_json AS BLOB)) AS snapshot_bytes, length(CAST(transition_json AS BLOB)) + length(CAST(provenance_json AS BLOB)) + length(CAST(events_json AS BLOB)) AS detail_bytes FROM world_transitions WHERE world_id = ? AND end_revision = ? LIMIT 1').bind(worldId, endRevision).all();
  if (metadata.results.length === 0) return detail;
  const meta = metadata.results[0];
  if (metadata.results.length !== 1 || !isRecord(meta) || meta.end_revision !== endRevision || !integer(meta.snapshot_bytes) || !integer(meta.detail_bytes)) return corrupt();
  if (meta.snapshot_bytes > RECORDED_CHOICE_LIMITS.snapshotBytes) throw new RequestFailure(503, 'recorded_choice_snapshot_limit');
  if (meta.detail_bytes > RECORDED_CHOICE_LIMITS.rowBytes) throw new RequestFailure(503, 'recorded_choice_row_limit');
  const selected = await database.prepare('SELECT start_revision, end_revision, transition_json, provenance_json, state_json, events_json FROM world_transitions WHERE world_id = ? AND end_revision = ? LIMIT 1').bind(worldId, endRevision).all();
  const row = selected.results[0];
  if (selected.results.length !== 1 || !isRecord(row) || row.end_revision !== endRevision || typeof row.state_json !== 'string') return corrupt();
  if (encoder.encode(row.state_json).length > RECORDED_CHOICE_LIMITS.snapshotBytes) throw new RequestFailure(503, 'recorded_choice_snapshot_limit');
  const entry = projectEntry(row);
  const state = await decodeHistorySnapshot(row.state_json);
  if (state.revision !== endRevision) return corrupt();
  strictEvents(state.events);
  if (state.actionPlans?.some(plan => plan?.items.some(item => !strictAction(item.action)))) return corrupt();
  if (entry.kind === 'action' && entry.action && entry.provenance.kind === 'development-agent' && entry.recordedReason !== null) {
    const plan = state.actionPlans?.[entry.provenance.seat];
    const head = plan?.items[0];
    if (!plan || plan.committedRevision !== endRevision || !head || head.status !== 'completed' || head.reason !== entry.recordedReason || !sameAction(head.action, entry.action)) return corrupt();
  }
  for (const event of entry.events) {
    const retained = state.events.find(candidate => candidate.id === event.id);
    if (retained && canonical(retained) !== canonical(event)) return corrupt();
  }
  detail.entry = entry;
  detail.recordedReason = entry.recordedReason;
  detail.consequences = { status: 'available', basis: 'exact-end-revision-snapshot', revision: state.revision, round: state.round, year: state.year, releaseId: state.releaseId, town: projectTown(state, entry, civilizationId, cityId) };
  if (bytes(detail) > RECORDED_CHOICE_LIMITS.pageBytes) throw new RequestFailure(503, 'recorded_choice_output_limit');
  return detail;
}
