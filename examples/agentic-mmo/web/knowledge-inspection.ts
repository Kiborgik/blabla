import { RESOURCE_IDS } from '../core/content.ts';
import { KNOWLEDGE_TECHNOLOGY_IDS } from '../core/knowledge-content.ts';
import { isKnowledgeCompact, isKnowledgeResult, validKnowledgeEvent } from '../core/knowledge-validation.ts';
import type { KnowledgeCompact, KnowledgeInstitutionProof, KnowledgeResult, KnowledgeStudyAttempt, KnowledgeTerms } from '../core/knowledge-types.ts';
import type { GameEvent, Resources, Route, WorldState } from '../core/types.ts';
import { ICON_PATHS, METRIC_LABELS } from '../visuals/visual-language.ts';
import type { VisualIcon } from '../visuals/visual-language.ts';
import { exactNumber } from './number-format.ts';

export interface KnowledgeRouteRecord {
  key: string;
  kind: 'active' | 'historical';
  compact: KnowledgeCompact;
  result: KnowledgeResult | null;
  title: string;
  status: string;
}

const outcomeLabels = { completed: 'Completed', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired', failed: 'Failed' } as const;

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  const first = left as Record<string, unknown>; const second = right as Record<string, unknown>;
  return Object.keys(first).length === Object.keys(second).length && Object.keys(first).every(key => Object.hasOwn(second, key) && equal(first[key], second[key]));
}

export function knowledgeRouteMatches(state: Pick<WorldState, 'cities'>, route: Route, terms: Pick<KnowledgeTerms, 'routeId' | 'agreementOfferId' | 'agreementAcceptedRound' | 'owner' | 'partner' | 'fromCityId' | 'toCityId' | 'fromTileId' | 'toTileId' | 'tradeTerms'>): boolean {
  return route.id === terms.routeId && route.agreement?.offerId === terms.agreementOfferId && route.agreement.acceptedRound === terms.agreementAcceptedRound
    && route.owner === terms.owner && route.partner === terms.partner && route.from === terms.fromCityId && route.to === terms.toCityId
    && state.cities.some(city => city.id === terms.fromCityId && city.civId === terms.owner && city.tileId === terms.fromTileId)
    && state.cities.some(city => city.id === terms.toCityId && city.civId === terms.partner && city.tileId === terms.toTileId)
    && equal(route.agreement.terms, terms.tradeTerms);
}

function projected(compact: KnowledgeCompact, result: KnowledgeResult | null): KnowledgeRouteRecord {
  const names = compact.terms.names;
  return {
    key: `knowledge:${compact.id}:${compact.proposedRevision}`,
    kind: result ? 'historical' : 'active', compact: structuredClone(compact), result: result ? structuredClone(result) : null,
    title: `${names.teacher} teaching ${names.technology} to ${names.learner}`,
    status: result ? result.outcome === 'completed' ? `Completed · Added ${exactNumber(result.amount)} research work toward ${names.technology}`
      : `${outcomeLabels[result.outcome]} · ${result.detail}`
      : compact.status === 'proposed' ? 'Offered · Learner consent not recorded'
        : `Agreed · ${compact.studies.length} of ${compact.terms.requiredStudies} supported study seasons recorded`,
  };
}

export function knowledgeRouteRecords(state: WorldState, routeId: string): KnowledgeRouteRecord[] {
  const layer = state.knowledge; const route = state.routes.find(item => item.id === routeId);
  if (!layer || layer.ruleVersion !== 2 || !route?.agreement) return [];
  const results = new Map<string, KnowledgeResult>(); const conflicts = new Set<string>();
  const candidates = [...layer.lastResults, ...layer.grants.flatMap(slots => KNOWLEDGE_TECHNOLOGY_IDS.map(id => slots[id]))];
  for (const result of candidates) {
    if (!isKnowledgeResult(result) || !knowledgeRouteMatches(state, route, result.compact.terms)) continue;
    const previous = results.get(result.compact.id);
    if (previous && !equal(previous, result)) conflicts.add(result.compact.id);
    else results.set(result.compact.id, result);
  }
  const active = layer.active.filter(compact => isKnowledgeCompact(compact) && knowledgeRouteMatches(state, route, compact.terms)
    && !results.has(compact.id) && (compact.status === 'proposed' || compact.studies.length < compact.terms.requiredStudies));
  return [
    ...active.toSorted((left, right) => left.proposedRevision - right.proposedRevision || left.id.localeCompare(right.id)).map(compact => projected(compact, null)),
    ...[...results.values()].filter(result => !conflicts.has(result.compact.id))
      .toSorted((left, right) => right.resolvedRound - left.resolvedRound || right.resolvedRevision - left.resolvedRevision || left.compact.id.localeCompare(right.compact.id))
      .map(result => projected(result.compact, result)),
  ];
}

function amounts(values: Partial<Resources>): string {
  return RESOURCE_IDS.filter(resource => (values[resource] ?? 0) > 0).map(resource => `${exactNumber(values[resource]!)} ${METRIC_LABELS[resource]}`).join(', ') || 'None';
}

export function knowledgeStory(event: GameEvent): { title: string; cause: string; consequence: string } | null {
  if (!event || typeof event.type !== 'string' || !event.type.startsWith('knowledge-') || !validKnowledgeEvent(event)) return null;
  const result = event.knowledgeResult;
  if (result) {
    const names = result.compact.terms.names;
    if (result.outcome !== 'completed') return {
      title: `${names.teacher} → ${names.learner} · ${names.technology} teaching ${result.outcome}`,
      cause: result.detail,
      consequence: 'No teaching payment or research work. Earlier ordinary trade and institution costs remain unchanged.',
    };
    return {
      title: `${names.learner} gained ${exactNumber(result.amount)} research work toward ${names.technology}`,
      cause: result.detail,
      consequence: `${names.learner} paid ${amounts(result.learnerPaid)}; ${names.teacher} paid ${amounts(result.teacherPaid)}. ${amounts(result.transferred)} transferred to ${names.teacher}; ${amounts(result.consumed)} consumed. The one-time assistance for this learner and discovery was used.${result.researchCompletionEventId ? ` Separate discovery completion receipt: ${result.researchCompletionEventId}.` : ''}`,
    };
  }
  const compact = event.knowledgeCompact;
  if (compact) {
    const names = compact.terms.names;
    return compact.status === 'proposed' ? {
      title: `${names.teacher} offered to teach ${names.technology} to ${names.learner}`,
      cause: `An offer on the agreed route between ${names.teacherCity} and ${names.learnerCity}.`,
      consequence: `Learner consent is still needed. No teaching payment or research work. Consent window ends at round ${compact.expiresRound}.`,
    } : {
      title: `${names.learner} agreed to learn ${names.technology} from ${names.teacher}`,
      cause: `Both participants agreed to the teaching terms on route ${compact.terms.routeId}.`,
      consequence: `0 of 2 supported study seasons recorded. Both named institutions must pay their normal operation costs in two new seasons. Ordinary shipments keep their own schedule. No teaching payment yet. Study deadline: round ${compact.deadlineRound}, inclusive.`,
    };
  }
  const study = event.knowledgeStudy;
  if (!study) return null;
  return {
    title: study.attempt.blockers.length ? 'A supported study season did not qualify' : `Supported study season recorded · ${study.studyCount} of 2`,
    cause: study.attempt.blockers.length ? study.attempt.blockers.map(blocker => `${blocker.party === 'teacher' ? 'Teacher' : blocker.party === 'learner' ? 'Learner' : 'Route'}: ${blocker.reason}`).join('; ')
      : 'Both exact institutions operated with paid normal inputs, allocated residents and positive Science in this season on the live consenting corridor.',
    consequence: `Season ${study.attempt.season.round}; operation events ${study.attempt.teacher?.operationEventId ?? 'absent'} and ${study.attempt.learner?.operationEventId ?? 'absent'}. ${study.studyCount} of 2 supported study seasons recorded.${study.studyCount === 2 ? ' The second study triggered an immediate settlement attempt; its separate result records payment and work.' : ' No teaching payment yet.'} Ordinary institution costs remain paid. This study is not extra cargo or a Science stock transfer.`,
  };
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.textContent = value; element.className = className; return element;
}

function icon(kind: VisualIcon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'visual-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICON_PATHS[kind]); svg.append(path); return svg;
}

function resourceRow(label: string, values: Partial<Resources>): HTMLElement {
  const row = text('p', '', 'route-amounts'); row.append(text('strong', `${label}: `));
  const entries = RESOURCE_IDS.filter(resource => (values[resource] ?? 0) > 0);
  if (!entries.length) row.append(text('span', 'None'));
  for (const resource of entries) {
    const value = text('span', `${exactNumber(values[resource]!)} ${METRIC_LABELS[resource]}`); value.prepend(icon(resource)); row.append(value);
  }
  return row;
}

function disclosure(key: string, label: string, retained: ReadonlySet<string>): HTMLDetailsElement {
  const details = text('details', '', 'route-path-tiles'); details.dataset['knowledgeKey'] = key; details.open = retained.has(key);
  const summary = text('summary', label); summary.dataset['routeFocus'] = key; details.append(summary); return details;
}

function renderInstitution(host: HTMLElement, proof: KnowledgeInstitutionProof | null, terms: KnowledgeTerms, party: 'teacher' | 'learner'): void {
  const names = terms.names;
  host.append(text('h4', `${names[party]} · ${names[`${party}Institution`]} · ${names[`${party}City`]}`));
  if (!proof) { host.append(text('p', 'No qualifying operation receipt for this season.', 'inspection-note')); return; }
  host.append(text('p', `Operation ${proof.operationEventId} · Round ${proof.result.round} · ${proof.result.status} · Town ${proof.cityId} · Tile ${proof.tileId} · Institution ${proof.institutionId}`),
    resourceRow('Ordinary institution inputs paid', proof.result.paid), resourceRow('Produced', proof.result.produced));
  const residents = proof.result.residents!;
  host.append(text('p', `Residents · ${residents.allocated} allocated of ${residents.required} required; ${residents.available} available. Opening population ${residents.openingPopulation}; community reserve ${residents.communityReserve}.`, 'inspection-note'));
}

function renderAttempt(host: HTMLElement, attempt: KnowledgeStudyAttempt, terms: KnowledgeTerms, label: string): void {
  const season = attempt.season;
  host.append(text('h4', `${label} · Round ${season.round}`),
    text('p', `Supported study season · Revision ${season.revision}. Ordinary operation costs are separate from teaching payment.`, 'inspection-note'),
    text('p', `Route ${season.routeId} · Agreement ${season.agreementOfferId} accepted round ${season.agreementAcceptedRound}`, 'inspection-note'));
  renderInstitution(host, attempt.teacher, terms, 'teacher'); renderInstitution(host, attempt.learner, terms, 'learner');
  for (const blocker of attempt.blockers) host.append(text('p', `${blocker.party === 'route' ? 'Route' : terms.names[blocker.party]}: ${blocker.reason}`, 'inspection-note'));
}

export function renderKnowledgeRoute(host: HTMLElement, state: WorldState, routeId: string, retainedOpenKeys: ReadonlySet<string> = new Set()): void {
  const records = knowledgeRouteRecords(state, routeId);
  if (!records.length) return;
  const section = text('section', '', 'inspection-section'); section.setAttribute('aria-label', 'Knowledge compacts on this route');
  for (const record of records) {
    const compact = record.compact; const terms = compact.terms; const names = terms.names; const result = record.result;
    const card = text('section', '', 'route-card');
    const heading = text('h3', record.title); heading.prepend(icon('discovery'));
    card.append(text('span', record.kind === 'historical' ? 'Historical receipt' : 'Knowledge compact', 'eyebrow'), heading,
      text('strong', record.status, 'route-status'), text('p', `${names.teacherCity} ↔ ${names.learnerCity}`));
    if (result && result.outcome !== 'completed') card.append(text('p', 'No teaching payment or research work. Earlier ordinary trade and institution costs remain unchanged.', 'inspection-note'));
    if (!result && compact.status === 'accepted') card.append(text('p', 'Only supported study seasons after consent count. Both named institutions must pay their ordinary operation costs. No teaching payment is due for the first study.', 'inspection-note'));
    const stored = disclosure(`${record.key}:terms`, 'Compact terms', retainedOpenKeys);
    stored.append(text('p', `${names.teacher}: ${names.teacherInstitution} in ${names.teacherCity}. ${names.learner}: ${names.learnerInstitution} in ${names.learnerCity}.`),
      text('p', `Agreed learner research target: ${names.technology}.`),
      text('p', `Route ${terms.routeId} · Agreement ${terms.agreementOfferId} · Accepted round ${terms.agreementAcceptedRound}`, 'inspection-note'),
      text('p', `Teacher town ${terms.teacherCityId}, tile ${terms.teacherTileId} · Learner town ${terms.learnerCityId}, tile ${terms.learnerTileId}`, 'inspection-note'));
    const contributionLabel = result ? result.outcome === 'completed' ? 'Paid' : 'Agreed share, not paid' : 'Due';
    stored.append(resourceRow(`${names.learner} · ${contributionLabel}`, result?.outcome === 'completed' ? result.learnerPaid : terms.learnerContribution),
      resourceRow(`${names.teacher} · ${contributionLabel}`, result?.outcome === 'completed' ? result.teacherPaid : terms.teacherContribution),
      resourceRow(result?.outcome === 'completed' ? `Transferred to ${names.teacher}` : `Agreed transfer to ${names.teacher} on settlement`, result?.outcome === 'completed' ? result.transferred : terms.transferred),
      resourceRow(result?.outcome === 'completed' ? 'Consumed' : 'Agreed consumption on settlement', result?.outcome === 'completed' ? result.consumed : terms.consumed));
    stored.append(text('p', `One-time maximum: ${exactNumber(terms.nominalAmount)} research work, ${terms.percent}% of the recorded ${exactNumber(terms.costBasis)} cost. Actual work is capped by remaining work.`),
      text('p', 'The full agreed price is paid even for a smaller remainder. One successful contribution uses this learner’s one-time assistance for this discovery. It does not grant a free discovery.', 'inspection-note'),
      text('p', compact.status === 'proposed' ? `Offered round ${compact.proposedRound}. Consent window ends at round ${compact.expiresRound}.`
        : `Agreed round ${compact.acceptedRound}. Study deadline: round ${compact.deadlineRound}, inclusive. Two qualifying supported study seasons trigger immediate settlement or failure after ordinary research.`),
      text('p', `Recorded rules: version ${terms.ruleVersion} · Release ${terms.basisReleaseId}`, 'inspection-note'));
    const receipts = disclosure(`${record.key}:receipts`, result ? 'Recorded outcome and study receipts' : 'Recorded study receipts', retainedOpenKeys);
    if (compact.status === 'accepted') {
      for (const [index, proof] of compact.studies.entries()) renderAttempt(receipts, { ...proof, blockers: [] }, terms, `Supported study season ${index + 1} of ${terms.requiredStudies}`);
      if (compact.lastStudyAttempt?.blockers.length) renderAttempt(receipts, compact.lastStudyAttempt, terms, 'Last season did not qualify');
      if (!compact.studies.length && !compact.lastStudyAttempt) receipts.append(text('p', 'No supported study season recorded after consent.'));
    } else receipts.append(text('p', 'No teaching consent or supported study season recorded.'));
    if (result) {
      receipts.append(text('h4', `${outcomeLabels[result.outcome]} · Round ${result.resolvedRound}`), text('p', result.detail),
        text('p', `Result ${result.eventId} · Revision ${result.resolvedRevision} · Reason ${result.reason}`, 'inspection-note'));
      if (result.outcome === 'completed') receipts.append(text('p', `Added ${exactNumber(result.amount)} research work toward ${names.technology}. Progress then: ${exactNumber(result.progressBefore)} → ${exactNumber(result.progressAfter)} of ${exactNumber(terms.costBasis)}. Unused maximum: ${exactNumber(result.unusedAmount)}.`),
        text('p', result.researchCompletionEventId ? `Separate discovery completion receipt: ${result.researchCompletionEventId}.` : 'This receipt does not record discovery completion.', 'inspection-note'));
    }
    const full = disclosure(`${record.key}:proof`, 'Full stored record', retainedOpenKeys);
    const fullRecord = text('pre', JSON.stringify(result ?? compact, null, 2), 'route-tile-ids'); fullRecord.setAttribute('style', 'white-space: pre-wrap'); full.append(fullRecord);
    receipts.append(full); card.append(stored, receipts); section.append(card);
  }
  host.append(section);
}
