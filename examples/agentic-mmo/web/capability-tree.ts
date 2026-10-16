import { constructionTarget } from '../core/simulation/improvements.ts';
import { improvementLastLabel } from '../visuals/improvement-visuals.ts';
import type { CapabilityCatalogue, CapabilityProjection, CapabilityBlocker } from '../core/capabilities.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import type { DecisionBlocker, DecisionObligation, GameEvent, Resources } from '../core/types.ts';
import { resourceGuide } from './viewer-appearance.ts';
import { visualIcon } from './world-cues.ts';
import { researchProgressPresentation } from './research-progress.ts';

export function restoreCapabilityOpener(resolve: () => Pick<HTMLElement, 'isConnected' | 'focus'> | null, reveal: () => void): void {
  const opener = resolve();
  if (!opener?.isConnected) return;
  reveal();
  opener.focus({ preventScroll: true });
}

export interface CapabilityTreeInput {
  runId: string;
  civilizationName: string;
  towns: Array<{ id: string; name: string }>;
  catalogue: CapabilityCatalogue;
  projection: CapabilityProjection;
  researchEvents?: readonly GameEvent[];
}

export interface CapabilityTreeNode {
  id: string;
  name: string;
  kind: 'technology' | 'building' | 'improvement';
  level: number;
  status: 'done' | 'available' | 'locked' | 'planned' | null;
  label: string;
  requires: string[];
  leadsTo: string[];
  blockers: string[];
  description: string;
  support: string | null;
  research: string | null;
  researchExplanation: string | null;
  construction: string | null;
  facts: Array<{ label: string; value: string }>;
}

const STATUS_LABELS = { done: 'Done', available: 'Available', locked: 'Locked', planned: 'Planned' };

function number(value: number): string { return value.toLocaleString('en-US', { maximumFractionDigits: 2 }); }

function amounts(values: Partial<Resources>): string {
  return RESOURCE_IDS.flatMap(resource => values[resource] === undefined ? [] : [`${number(values[resource])} ${resourceGuide(resource).label}`]).join(' · ') || 'None';
}

function capabilityName(input: CapabilityTreeInput, id: string): string {
  const key = id.startsWith('improvement:') ? id.slice('improvement:'.length) : id;
  return [...input.catalogue.technologies, ...input.catalogue.buildings, ...input.catalogue.improvements].find(item => item.id === key)?.name ?? id;
}

function blockerText(blocker: CapabilityBlocker, input: CapabilityTreeInput): string {
  const catalogue = input.catalogue;
  const town = (id: string): string => input.towns.find(candidate => candidate.id === id)?.name ?? id;
  switch (blocker.kind) {
    case 'feature': return `Needs world capability: ${catalogue.features.find(feature => feature.id === blocker.featureId)?.name ?? blocker.featureId}`;
    case 'technology': return `Learn ${catalogue.technologies.find(technology => technology.id === blocker.technologyId)?.name ?? blocker.technologyId}`;
    case 'civilization': return `Civilization ${blocker.civilizationId} is unavailable`;
    case 'era': return `Needs ${catalogue.eras[blocker.required]?.name ?? `era ${blocker.required}`}; now ${catalogue.eras[blocker.available]?.name ?? `era ${blocker.available}`}`;
    case 'resource': return `${resourceGuide(blocker.resource).label}: needs ${number(blocker.required)}; stored ${number(blocker.available)}`;
    case 'city-selection': return 'Choose a town to inspect building requirements';
    case 'missing-city': return `Town unavailable: ${town(blocker.cityId)}`;
    case 'foreign-city': return `${town(blocker.cityId)} belongs to another civilization`;
    case 'coastal-site': return 'Needs a coastal town';
    case 'building': return `Build ${capabilityName(input, blocker.buildingId)} in ${town(blocker.cityId)}`;
    case 'improvement-site': return `${town(blocker.cityId)} needs an available site for ${capabilityName(input, `improvement:${blocker.improvementId}`)}`;
    case 'district-site': return `${town(blocker.cityId)} needs an available district site`;
    case 'district-capacity': return `${town(blocker.cityId)} needs ${number(blocker.required)} district slot; ${number(blocker.available)} available`;
    case 'missing-site': return `The site for ${town(blocker.cityId)} is unavailable`;
    case 'legacy-target': return `This world's building choice targets ${town(blocker.cityId)}`;
    case 'active-commitment': return `Finish the active commitment: ${capabilityName(input, blocker.targetId)}`;
  }
  throw new Error('Unrecognized capability requirement');
}

function decisionReason(reason: DecisionBlocker, input: CapabilityTreeInput): string {
  if (reason.kind === 'no-available-choice') return 'No available choice in the released pool';
  if (reason.kind === 'zero-work') return 'No work can be done with the current town condition';
  return blockerText(reason, input);
}

function timingText(reason: string): string {
  if (reason.startsWith('strategy_catchup_required:')) return 'The next world season is waiting to be recorded. The agent’s choice will be checked after it.';
  if (reason === 'Actor tactical allowance is exhausted or the action window is stale') return 'This agent has a short wait before choosing again.';
  return reason;
}

export function capabilityTreeNodes(input: CapabilityTreeInput): CapabilityTreeNode[] {
  const rows = new Map([...input.projection.technologies, ...input.projection.buildings, ...(input.projection.improvements ?? [])].map(row => [row.nodeId, row]));
  const descriptors = [
    ...input.catalogue.technologies.map(definition => ({ kind: 'technology' as const, definition })),
    ...input.catalogue.buildings.map(definition => ({ kind: 'building' as const, definition })),
    ...input.catalogue.improvements.map(definition => ({ kind: 'improvement' as const, definition })),
  ];
  const ids = new Set(descriptors.map(item => `${item.kind}:${item.definition.id}`));
  const levels = new Map<string, number>();
  const level = (id: string, visiting = new Set<string>()): number => {
    if (visiting.has(id)) return 0;
    const cached = levels.get(id);
    if (cached !== undefined) return cached;
    const parents = input.catalogue.edges.filter(edge => edge.to === id && ids.has(edge.from)).map(edge => edge.from);
    const next = new Set([...visiting, id]);
    const value = parents.length ? Math.max(...parents.map(parent => level(parent, next))) + 1 : 0;
    levels.set(id, value);
    return value;
  };
  return descriptors.map(item => {
    const id = `${item.kind}:${item.definition.id}`;
    const row = rows.get(id);
    const definition = item.definition;
    const research = 'capability' in definition ? researchProgressPresentation({
      unlockedFeatures: input.projection.unlockedFeatures, civilizationId: input.projection.civilizationId,
      project: row?.research ? { name: definition.name, ...row.research } : null,
    }) : null;
    const facts: CapabilityTreeNode['facts'] = 'capability' in definition
      ? [{ label: 'Research work', value: `${number(definition.cost)} Science` }]
      : 'siteRange' in definition ? [
        { label: 'Build once', value: amounts(definition.cost) },
        { label: 'Construction work', value: `${number(definition.requiredWork)} work` },
        { label: 'Local support each season', value: `${definition.residentsRequired} resident assigned; people stay in the town` },
        { label: 'Base production before productivity', value: amounts(definition.production) },
      ] : [
        { label: 'Build once', value: amounts(definition.cost) },
        ...(definition.capabilities?.includes('coastal-departure') ? [{ label: 'Enables', value: 'Coastal departure with Navigation; no operating output' }, { label: 'Site', value: 'A coastal town' }] : [
          { label: 'Uses each operating season', value: amounts(definition.operatingInputs ?? {}) },
          { label: definition.district ? 'Building base before nearby terrain' : 'Base production before productivity', value: amounts(definition.production) },
        ]),
      ];
    const worked = input.projection.improvements?.find(entry => entry.nodeId === id);
    if (worked) {
      for (const site of worked.availableSites) facts.push({ label: `Available site ${site.tileId}`, value: `${amounts(site.baseProduction)} base before town productivity` });
      if (worked.construction?.tileId !== undefined) facts.push({ label: 'Reserved site', value: `Tile ${worked.construction.tileId}` });
      for (const site of worked.installed) {
        facts.push({ label: `Built site ${site.tileId}`, value: site.operation.enabled ? 'On now' : 'Paused now' });
        const last = site.operation.lastResult;
        facts.push({ label: `Site ${site.tileId} last record`, value: last
          ? `Round ${last.round} · ${improvementLastLabel(last)} · Assigned ${last.residents.allocated} of ${last.residents.required} resident · Available then ${last.residents.available} · Made ${amounts(last.produced)}`
          : 'No operating record yet' });
      }
    }
    if (research?.remaining) facts.push({ label: 'Remaining research work', value: research.remaining });
    if (row?.district) {
      const district = row.district;
      facts.push({ label: 'District slots', value: `${district.used} used / ${district.capacity} capacity` });
      if (district.siteId !== null) facts.push({ label: row.construction ? 'Reserved site' : 'Built site', value: `Tile ${district.siteId}` });
      if (district.siteBaseProduction) facts.push({ label: 'Site base with nearby terrain', value: amounts(district.siteBaseProduction) });
      for (const site of district.availableSites) facts.push({ label: `Available site ${site.tileId}`, value: `${amounts(site.baseProduction)} base before town productivity` });
    }
    if (row?.operation) facts.push({ label: 'Operating now', value: row.operation.enabled ? 'On' : 'Paused' });
    if (row?.construction) facts.push(
      { label: 'Construction work', value: `${number(row.construction.workDone)} / ${number(row.construction.workRequired)}` },
      { label: 'Already paid for this order', value: amounts(row.construction.paid) },
      { label: 'Order started', value: `Round ${row.construction.startedRound} · ${row.construction.id}` },
    );
    if ('requiresBuildings' in definition && definition.requiresBuildings?.includes('campus')) {
      const campus = rows.get('building:campus')?.district;
      facts.push({ label: 'Belongs to', value: campus?.siteId === null || campus?.siteId === undefined ? 'This town’s completed Campus' : `This town’s Campus · Tile ${campus.siteId}` });
    }
    return {
      id, name: definition.name, kind: item.kind, level: level(id),
      status: row?.status ?? null, label: row ? STATUS_LABELS[row.status] : 'Facts unavailable',
      requires: input.catalogue.edges.filter(edge => edge.to === id).map(edge => edge.from).toSorted(),
      leadsTo: input.catalogue.edges.filter(edge => edge.from === id).map(edge => edge.to).toSorted(),
      blockers: row?.blockers.map(blocker => blockerText(blocker, input)) ?? ['Current facts are unavailable for this entry'],
      description: 'capability' in definition ? definition.capability : definition.description,
      support: row?.status !== 'planned' ? null : row.support === 'registered-release' ? 'Included in another release' : 'Catalogue only',
      research: row?.research ? `Researching · ${number(row.research.progress)} / ${number(row.research.cost)} science` : null,
      researchExplanation: research?.explanation ?? null,
      construction: row?.construction ? `Under construction · ${number(row.construction.workDone)} / ${number(row.construction.workRequired)} work` : null,
      facts,
    };
  }).toSorted((a, b) => a.level - b.level || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}


function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function nodeStatus(node: CapabilityTreeNode): HTMLElement {
  const badge = text('span', node.label, 'capability-status');
  badge.dataset['status'] = node.status ?? 'unknown';
  const mark = text('span', '', 'capability-status-mark');
  mark.setAttribute('aria-hidden', 'true');
  badge.prepend(mark);
  return badge;
}

export interface CapabilityTreeSheet {
  open: (input: CapabilityTreeInput, opener?: HTMLElement) => void;
  observe: (input: CapabilityTreeInput) => void;
  refresh: () => void;
  close: () => void;
  destroy: () => void;
}

export function createCapabilityTreeSheet(dialog: HTMLDialogElement, onTown: (id: string) => void, onClose: () => void = () => undefined): CapabilityTreeSheet {
  let captured: CapabilityTreeInput | null = null;
  let latest: CapabilityTreeInput | null = null;
  let opener: HTMLElement | undefined;
  let disposed = false;
  const controls = new Map<string, HTMLElement>();
  const disclosures = new Map<string, HTMLDetailsElement>();
  let refreshButton: HTMLButtonElement | null = null;
  const titleId = `${dialog.id || 'capability-tree'}-title`;
  dialog.className = 'capability-sheet';
  dialog.setAttribute('aria-labelledby', titleId);

  const control = <T extends HTMLElement>(node: T, key: string): T => {
    node.dataset['treeFocus'] = key;
    controls.set(key, node);
    return node;
  };
  const button = (label: string, key: string, action: () => void): HTMLButtonElement => {
    const node = control(text('button', label), key);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const close = (): void => { if (dialog.open) dialog.close(); };
  const closed = (): void => {
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = undefined;
    onClose();
  };
  const cancel = (event: Event): void => { event.preventDefault(); close(); };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('close', closed);

  const focusNode = (id: string): void => {
    const details = disclosures.get(id);
    if (!details) return;
    details.open = true;
    for (const [key, value] of disclosures) value.dataset['selected'] = String(key === id);
    controls.get(`node:${id}`)?.focus({ preventScroll: true });
    details.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  };
  const relations = (node: CapabilityTreeNode, nodes: readonly CapabilityTreeNode[], kind: 'requires' | 'leadsTo'): HTMLElement => {
    const line = text('div', '', 'capability-links');
    line.append(text('span', kind === 'requires' ? 'Requires' : 'Leads to', 'capability-link-label'));
    if (!node[kind].length) line.append(text('span', kind === 'requires' ? 'No earlier discovery' : 'No further catalogue link', 'capability-note'));
    for (const id of node[kind]) {
      const target = nodes.find(candidate => candidate.id === id);
      const link = button(target?.name ?? id, `${kind}:${node.id}:${id}`, () => focusNode(id));
      link.disabled = target === undefined;
      line.append(link);
    }
    if (kind === 'requires' && node.requires.length > 1) line.append(text('span', 'All are required', 'capability-note'));
    return line;
  };
  const renderNode = (node: CapabilityTreeNode, nodes: readonly CapabilityTreeNode[], expanded: Set<string>): HTMLElement => {
    const article = text('article', '', 'capability-node');
    article.dataset['nodeId'] = node.id;
    article.dataset['kind'] = node.kind;
    article.dataset['status'] = node.status ?? 'unknown';
    const details = text('details', '', 'capability-detail');
    details.open = expanded.has(node.id);
    disclosures.set(node.id, details);
    const summary = control(text('summary', ''), `node:${node.id}`);
    const heading = text('span', node.name, 'capability-name');
    heading.prepend(visualIcon(node.kind === 'technology' ? 'science' : node.kind === 'improvement' ? 'materials' : 'infrastructure'));
    summary.append(heading, text('span', node.kind === 'technology' ? 'Research' : node.kind === 'improvement' ? 'Worked site' : 'Building', 'capability-kind'), nodeStatus(node));
    if (node.research) summary.append(text('span', node.research, 'capability-research'));
    if (node.construction) summary.append(text('span', node.construction, 'capability-research'));
    if (node.status === 'planned') summary.append(text('span', 'Waiting for a world update', 'capability-note'));
    else if (node.blockers[0]) summary.append(text('span', node.blockers[0], 'capability-note'));
    details.append(summary, text('p', node.description));
    if (node.support) details.append(text('p', node.support, 'capability-support'));
    for (const blocker of node.blockers) details.append(text('p', blocker, 'capability-blocker'));
    const facts = text('dl', '', 'capability-facts');
    for (const fact of node.facts) {
      const entry = text('div', '');
      entry.append(text('dt', fact.label), text('dd', fact.value));
      facts.append(entry);
    }
    details.append(facts);
    if (node.researchExplanation) details.append(text('p', node.researchExplanation, 'capability-note'));
    else if (node.facts.some(fact => fact.label === 'Building base before nearby terrain')) details.append(text('p', 'Nearby terrain changes a site’s base production. Actual output also depends on town productivity and is recorded after completion on later seasons.', 'capability-note'));
    else if (node.facts.some(fact => fact.label === 'Base production before productivity')) details.append(text('p', 'Production here is catalogue capacity. Actual paid inputs and output are recorded in the town details.', 'capability-note'));
    details.append(relations(node, nodes, 'leadsTo'));
    article.append(details, relations(node, nodes, 'requires'));
    return article;
  };

  const decisionCards = (input: CapabilityTreeInput): HTMLElement[] => {
    const projection = input.projection;
    if (!projection.decisions) return [];
    const section = text('section', '', 'capability-decisions');
    section.setAttribute('aria-label', 'Current commitments');
    section.append(text('h3', 'Current commitments'), text('p', 'Agents choose each next project. Other civilizations and world seasons keep moving.', 'capability-note'));
    const laneCard = (lane: DecisionObligation, title: string): HTMLElement => {
      const card = text('section', '', 'capability-decision');
      card.dataset['decisionStatus'] = lane.status;
      const heading = text('h4', title);
      heading.prepend(visualIcon(lane.kind === 'research' ? 'science' : 'infrastructure'));
      const labels = { required: 'Required', active: 'Active', blocked: 'Blocked' };
      card.append(heading, text('strong', labels[lane.status], 'capability-decision-status'));
      if (lane.targetId) card.append(text('p', capabilityName(input, lane.targetId)));
      if (lane.progress) card.append(text('p', `${lane.kind === 'construction' ? 'Construction work' : 'Research work'} · ${number(lane.progress.done)} / ${number(lane.progress.required)}`));
      if (lane.kind === 'research') {
        const research = researchProgressPresentation({
          unlockedFeatures: projection.unlockedFeatures, civilizationId: projection.civilizationId,
          project: lane.targetId && lane.progress ? { name: capabilityName(input, lane.targetId), progress: lane.progress.done, cost: lane.progress.required } : null,
          ...(input.researchEvents ? { events: input.researchEvents } : {}),
        });
        if (research.remaining) card.append(text('strong', research.remaining));
        const explanation = text('details', '', 'capability-decision-reasons');
        explanation.append(control(text('summary', 'How research advances'), 'research-explanation'), text('p', research.explanation, 'capability-note'));
        if (research.lastOutput) explanation.append(text('p', research.lastOutput.label, 'capability-note'), text('p', research.outputExplanation, 'capability-note'));
        card.append(explanation);
      }
      if (lane.kind === 'construction' && lane.targetId) {
        const definition = input.catalogue.buildings.find(building => building.id === lane.targetId);
        const explanation = lane.targetId.startsWith('improvement:')
          ? 'The worked site is not finished yet. Output requires completion and local support in a later season.'
          : definition?.capabilities?.includes('coastal-departure')
          ? 'The building is not finished yet. Its capability becomes usable after completion.'
          : 'The building is not finished yet. Output starts in a later season after completion.';
        card.append(text('p', explanation, 'capability-note'));
      }
      for (const id of lane.availableIds) card.append(button(capabilityName(input, id), `decision:${lane.kind}:${lane.cityId ?? 'shared'}:${id}`, () => focusNode(id.startsWith('improvement:') ? id : `${lane.kind === 'research' ? 'technology' : 'building'}:${id}`)));
      if (lane.blockers.length) {
        const reasons = text('details', '', 'capability-decision-reasons');
        reasons.append(control(text('summary', lane.status === 'blocked' ? 'Why this is blocked' : 'Other requirements'), `decision-reasons:${lane.kind}:${lane.cityId ?? 'shared'}`));
        for (const blocker of lane.blockers) reasons.append(text('p', `${blocker.capabilityId ? `${capabilityName(input, blocker.capabilityId)}: ` : ''}${decisionReason(blocker.reason, input)}`));
        card.append(reasons);
      }
      return card;
    };
    const research = projection.decisions.research;
    section.append(laneCard(research, research.status === 'required' ? 'Choose research' : 'Research'));
    const city = input.towns.find(town => town.id === projection.cityId);
    const construction = projection.decisions.construction.find(lane => lane.cityId === projection.cityId);
    if (city && construction) section.append(laneCard(construction, `${city.name} · ${construction.status === 'required' ? 'Choose construction' : 'Construction'}`));
    else section.append(text('p', 'Current construction facts are unavailable for this town', 'capability-note'));
    const completed = text('div', '', 'capability-completions');
    if (projection.lastResearchCompletion) {
      const last = projection.lastResearchCompletion;
      completed.append(text('p', `Last research completed: ${capabilityName(input, last.technologyId)} · Round ${last.completedRound} · Event ${last.eventId}`));
    }
    if (city && projection.lastConstructionCompletion?.cityId === city.id) {
      const last = projection.lastConstructionCompletion;
      completed.append(text('p', `Last construction completed: ${capabilityName(input, constructionTarget(last))} · ${city.name} · Round ${last.completedRound} · Event ${last.eventId}`));
      if ('kind' in last) completed.append(text('p', `Exact worked site · Tile ${last.tileId}`, 'capability-note'));
      completed.append(text('p', `Paid for that completed order: ${amounts(last.paid)} · Work ${number(last.workRequired)}`, 'capability-note'));
    }
    section.append(completed);
    return [section];
  };

  const render = (preserve: boolean): void => {
    if (!captured) return;
    const active = document.activeElement;
    const key = preserve && dialog.contains(active) ? active?.getAttribute('data-tree-focus') : null;
    const scroll = preserve ? dialog.scrollTop : 0;
    const expanded = preserve ? new Set([...disclosures].filter(([, details]) => details.open).map(([id]) => id)) : new Set<string>();
    controls.clear(); disclosures.clear();
    const input = captured;
    const projection = input.projection;
    const nodes = capabilityTreeNodes(input);
    const top = text('div', '', 'capability-sheet-top');
    const title = control(text('h2', 'Research & buildings'), 'heading');
    title.id = titleId; title.tabIndex = -1;
    top.append(title, button('Close ×', 'close', close));
    const townName = input.towns.find(town => town.id === projection.cityId)?.name ?? projection.cityId ?? 'Choose a town';
    const context = text('p', `${input.civilizationName} · Research is shared · Buildings: ${townName}`, 'capability-context');
    const stamp = text('p', `Revision ${projection.revision} · ${projection.observedAt} · ${projection.releaseId}`, 'capability-note');
    const townLabel = text('label', 'Inspect town', 'capability-town');
    const picker = control(text('select', ''), 'town');
    picker.setAttribute('aria-label', 'Town for building requirements');
    if (!input.towns.some(town => town.id === projection.cityId)) {
      const placeholder = text('option', projection.cityId ? `Unavailable: ${projection.cityId}` : 'Choose a town');
      placeholder.value = ''; picker.append(placeholder);
    }
    for (const town of input.towns) { const option = text('option', town.name); option.value = town.id; picker.append(option); }
    picker.value = input.towns.some(town => town.id === projection.cityId) ? projection.cityId ?? '' : '';
    picker.disabled = input.towns.length === 0;
    picker.addEventListener('change', () => { if (input.towns.some(town => town.id === picker.value)) onTown(picker.value); });
    townLabel.append(picker);
    refreshButton = button('New facts available · Refresh', 'refresh', refresh);
    refreshButton.className = 'capability-refresh'; refreshButton.hidden = true;
    const notice = text('div', '', 'capability-live-note');
    notice.setAttribute('role', 'status'); notice.append(refreshButton);
    const options = text('section', '', 'capability-options');
    options.setAttribute('aria-label', 'Options now');
    options.append(text('h3', 'Options now'), text('p', 'Available entries and ongoing projects. Agents make their own choices.', 'capability-note'));
    const available = nodes.filter(node => node.status === 'available');
    for (const node of available) options.append(button(`${node.name}${node.research ? ' · Researching' : node.construction ? ' · Under construction' : ''}`, `option:${node.id}`, () => focusNode(node.id)));
    if (!available.length) options.append(text('p', 'No available entry in this captured view. Open a card to see its requirements.'));
    if (projection.admission.reason) options.append(text('p', `Action timing: ${timingText(projection.admission.reason)}`, 'capability-note'));
    const legend = text('p', 'Done · Available · Locked · Planned. Open any card for amounts and all requirements. Links show required discoveries, not a schedule.', 'capability-note');
    const graph = text('div', '', 'capability-graph');
    graph.setAttribute('aria-label', 'Connected research and building catalogue');
    for (const value of new Set(nodes.map(node => node.level))) {
      const group = text('div', '', 'capability-level'); group.dataset['level'] = String(value);
      for (const node of nodes.filter(candidate => candidate.level === value)) group.append(renderNode(node, nodes, expanded));
      graph.append(group);
    }
    const milestones = text('details', '', 'capability-milestones');
    milestones.open = expanded.has('milestones'); disclosures.set('milestones', milestones);
    milestones.append(control(text('summary', 'Why do buildings need a later era?'), 'milestones'), text('p', 'Eras follow world achievements. Learning one discovery or passing a calendar year does not alone reach an era.'));
    for (const definition of input.catalogue.milestones) {
      const fact = projection.milestones.find(item => item.id === definition.id);
      const state = fact ? fact.achieved ? 'Done' : fact.eligible ? 'Requirements met' : 'Not reached' : 'Facts unavailable';
      const card = text('section', '', 'capability-milestone');
      card.append(text('h4', `${definition.name} · ${state}`), text('p', `Era: ${input.catalogue.eras[definition.era]?.name ?? definition.era}`), text('p', `When reached: ${definition.explanation}`));
      if (definition.requiresMilestones.length) card.append(text('p', `Earlier achievements: ${definition.requiresMilestones.map(id => input.catalogue.milestones.find(item => item.id === id)?.name ?? id).join(' · ')}`));
      milestones.append(card);
    }
    dialog.replaceChildren(top, context, stamp, townLabel, notice, ...decisionCards(input), options, legend, graph, milestones);
    dialog.scrollTop = scroll;
    if (key) (controls.get(key === 'refresh' ? 'heading' : key) ?? controls.get('heading'))?.focus({ preventScroll: true });
  };

  function refresh(): void {
    if (disposed || !latest) return;
    captured = structuredClone(latest);
    render(true);
  }
  const contextKey = (input: CapabilityTreeInput): string => JSON.stringify([input.runId, input.projection.civilizationId, input.projection.cityId]);
  return {
    open(input, invokingElement) {
      if (disposed) return;
      latest = structuredClone(input); captured = structuredClone(input); opener = invokingElement;
      render(false);
      if (!dialog.open) dialog.showModal();
      controls.get('heading')?.focus({ preventScroll: true });
    },
    observe(input) {
      if (disposed) return;
      if (latest?.runId === input.runId && input.projection.revision < latest.projection.revision) return;
      const changedContext = captured !== null && contextKey(input) !== contextKey(captured);
      if (!changedContext && latest?.projection.revision === input.projection.revision) return;
      latest = structuredClone(input);
      if (!dialog.open) return;
      if (changedContext) { captured = structuredClone(input); render(false); controls.get('heading')?.focus({ preventScroll: true }); }
      else if (refreshButton) refreshButton.hidden = false;
    },
    refresh,
    close,
    destroy() {
      if (disposed) return;
      close(); disposed = true;
      dialog.removeEventListener('cancel', cancel); dialog.removeEventListener('close', closed);
      controls.clear(); disclosures.clear(); dialog.replaceChildren();
      captured = null; latest = null; opener = undefined;
    },
  };
}
