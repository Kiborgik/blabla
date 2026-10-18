import { exactNumber } from './number-format.ts';
import { strategicResourceAmounts, extractionFacts, depositLabel } from '../visuals/strategic-resource-visuals.ts';
import { constructionTarget } from '../core/simulation/improvements.ts';
import { improvementLastLabel } from '../visuals/improvement-visuals.ts';
import type { CapabilityCatalogue, CapabilityProjection, CapabilityBlocker } from '../core/capabilities.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import type { DecisionBlocker, DecisionObligation, GameEvent, Resources, StrategicResources } from '../core/types.ts';
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
  kind: 'technology' | 'building' | 'improvement' | 'wonder';
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

function number(value: number): string { return exactNumber(value); }

function amounts(values: Partial<Resources>, strategic?: StrategicResources): string {
  return [...RESOURCE_IDS.flatMap(resource => values[resource] === undefined ? [] : [`${number(values[resource])} ${resourceGuide(resource).label}`]), ...strategicResourceAmounts(strategic).map(entry => `${number(entry.amount)} ${entry.label}`)].join(' · ') || 'None';
}

function capabilityName(input: CapabilityTreeInput, id: string): string {
  if (id.startsWith('rail:')) return id === 'rail:rail' ? 'Rail' : `Rail edge ${id.slice(5)}`;
  const key = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return [...input.catalogue.technologies, ...input.catalogue.buildings, ...input.catalogue.improvements, ...input.catalogue.wonders].find(item => item.id === key)?.name ?? id;
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
    case 'wonder-site': return `${town(blocker.cityId)} needs an available wonder site`;
    case 'wonder-contender': return `This civilization already has a contender for ${capabilityName(input, blocker.wonderId)}`;
    case 'wonder-completed': return `${capabilityName(input, blocker.wonderId)} has a recorded world winner: civilization ${blocker.civilizationId}`;
    case 'campus-high-ground': return `${town(blocker.cityId)} needs a Campus next to a hill or mountain`;
    case 'mountain-catchment': return `${town(blocker.cityId)} needs an adjacent mountain source`;
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
  if (reason.kind === 'civic-prerequisite') return `Complete civic: ${input.catalogue.civics.find(civic => civic.id === reason.civicId)?.name ?? reason.civicId}`;
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
  const rows = new Map([...input.projection.technologies, ...input.projection.buildings, ...(input.projection.improvements ?? []), ...(input.projection.wonders ?? [])].map(row => [row.nodeId, row]));
  const descriptors = [
    ...input.catalogue.technologies.map(definition => ({ kind: 'technology' as const, definition })),
    ...input.catalogue.buildings.map(definition => ({ kind: 'building' as const, definition })),
    ...input.catalogue.improvements.map(definition => ({ kind: 'improvement' as const, definition })),
    ...input.catalogue.wonders.map(definition => ({ kind: 'wonder' as const, definition })),
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
      : 'siteRange' in definition && !('residentsRequired' in definition) ? [
        { label: 'Build once', value: amounts(definition.cost) },
        { label: 'Construction work', value: `${number(definition.requiredWork)} work` },
        { label: 'Base after completion', value: `${amounts(definition.production)} on later productive seasons` },
      ] : 'siteRange' in definition ? [
        { label: 'Build once', value: amounts(definition.cost) },
        { label: 'Construction work', value: `${number(definition.requiredWork)} work` },
        { label: 'Local support each season', value: `${definition.residentsRequired} resident assigned; people stay in the town` },
        { label: 'Base production before productivity', value: amounts(definition.production) },
      ] : [
        { label: 'Build once', value: amounts(definition.cost) },
        ...(definition.capabilities?.includes('coastal-departure') ? [{ label: 'Enables', value: 'Coastal departure with Navigation; no operating output' }, { label: 'Site', value: 'A coastal town' }] : [
          { label: definition.localPowerInput || definition.localPowerOutput ? 'Ordinary and strategic inputs' : 'Uses each operating season', value: amounts(definition.operatingInputs ?? {}, definition.strategicInputs) },
          { label: definition.district?.adjacency?.improvement ? 'Building base before nearby Mines' : definition.district?.adjacency?.wonder ? 'Building base before nearby wonders' : definition.district ? 'Building base before nearby terrain' : 'Base production before productivity', value: amounts(definition.production) },
        ]),
      ];
    const wonder = input.projection.wonders?.find(entry => entry.nodeId === id);
    if (wonder) {
      for (const site of wonder.availableSites) facts.push({ label: `Available site ${site.tileId}`, value: amounts(site.baseProduction) });
      for (const contender of wonder.facts.contenders) facts.push({ label: `Contender · ${contender.cityId} · Tile ${contender.tileId}`, value: `${number(contender.workDone)} / ${number(contender.workRequired)} work · Paid ${amounts(contender.paid)} · Order ${contender.id}` });
      const completed = wonder.facts.completed;
      if (completed) {
        const winner = completed.completion;
        facts.push({ label: 'Recorded world winner', value: `${winner.cityId} · Tile ${winner.tileId} · Round ${winner.completedRound} · Event ${winner.eventId}` });
        for (const loss of completed.losses) facts.push({ label: `Other contender · ${loss.cityId}`, value: `Work ${number(loss.workDone)} / ${number(loss.workRequired)} · Refunded ${amounts(loss.refund)} · Event ${loss.eventId}` });
        facts.push({ label: 'Unused research boosts', value: number(wonder.facts.boost.remaining) });
        for (const boost of completed.boosts) facts.push({ label: `Applied boost · ${capabilityName(input, boost.technologyId)}`, value: `${number(boost.progressBefore)} → ${number(boost.progressAfter)} research work · Added ${number(boost.amount)} · Unused ${number(boost.unusedAmount)} · Event ${boost.eventId}` });
        if (wonder.facts.boost.quote) facts.push({ label: 'Current eligible boost', value: `${capabilityName(input, wonder.facts.boost.quote.technologyId)} · ${number(wonder.facts.boost.quote.amount)} work if chosen; not yet applied` });
        if (wonder.facts.boost.blocker) facts.push({ label: 'Current boost requirement', value: wonder.facts.boost.blocker });
      } else facts.push({ label: 'World completion', value: 'No winner recorded. Finishing work does not alone establish a winner.' });
    }
    const worked = input.projection.improvements?.find(entry => entry.nodeId === id);
    if (worked) {
      if (id === 'improvement:lumber-mill') facts.push({ label: 'Worked forest', value: 'The installed mill uses one resident when supplied. The forest remains; Materials made belong to a recorded season.' });
      for (const site of worked.availableSites) facts.push({ label: `Available site ${site.tileId}`, value: `${amounts(site.baseProduction)} base before town productivity` });
      if (worked.construction?.tileId !== undefined) facts.push({ label: 'Reserved site', value: `Tile ${worked.construction.tileId}` });
      for (const site of worked.installed) {
        facts.push({ label: `Built site ${site.tileId}`, value: site.operation.enabled ? 'On now' : 'Paused now' });
        const last = site.operation.lastResult;
        facts.push({ label: `Site ${site.tileId} last record`, value: last
          ? `Round ${last.round} · ${improvementLastLabel(last)} · Assigned ${last.residents.allocated} of ${last.residents.required} resident · Available then ${last.residents.available} · Made ${amounts(last.produced)}`
          : 'No operating record yet' });
        if (last?.extraction) facts.push({ label: `Site ${site.tileId} extraction record`, value: extractionFacts(last.extraction).join(' · ') });
      }
    }
    if (id === 'technology:animal-husbandry' || id === 'improvement:pasture') {
      const sites = input.projection.pastoral?.revealedPastoralSites;
      if (sites) facts.push({ label: 'Horse sites known to this civilization', value: sites.length ? sites.map(site => `Tile ${site.tileId}`).join(' · ') : 'None revealed' },
        { label: 'Meaning', value: 'Revealed geography. No horse stock or extraction is recorded. Pasture food requires a later staffed season.' });
    }
    if (row?.highGround) {
      const retained = row.highGround.retained;
      facts.push({ label: 'Retained high ground', value: retained ? `Campus Tile ${retained.campusTileId} · Source Tile ${retained.sourceTileId}` : 'No source retained yet' });
      if (!retained) facts.push({ label: 'Current high-ground options', value: row.highGround.available.map(site => `Campus Tile ${site.campusTileId} · Source Tile ${site.sourceTileId}`).join(' · ') || 'None' });
      facts.push({ label: 'Source meaning', value: 'The Observatory belongs to this Campus. Nearby high ground qualifies the site; it is not another occupied district.' });
    }
    if (row?.catchment) {
      facts.push({ label: 'Mountain source', value: row.catchment.retainedTileId === null ? 'No source retained yet' : `Tile ${row.catchment.retainedTileId} · Recorded for this town` });
      if (row.catchment.retainedTileId === null) facts.push({ label: 'Current source options', value: row.catchment.availableTileIds.map(tile => `Tile ${tile}`).join(' · ') || 'None' });
      facts.push({ label: 'Source meaning', value: 'A retained mountain catchment, not an occupied district or a simulated pipe route.' });
    }
    if ('housing' in definition && definition.housing) facts.push({ label: 'Housing after completion', value: `+${definition.housing} capacity. Later growth still needs food.` });
    if ('requiresBuildings' in definition && definition.requiresBuildings?.length) facts.push({ label: 'Own-town infrastructure', value: definition.requiresBuildings.map(required => capabilityName(input, required)).join(' · ') });
    if (id === 'technology:bronze-working' || id === 'technology:industrialization' || id === 'improvement:mine') {
      const strategic = input.projection.strategic;
      if (strategic?.strategicCapacity !== undefined) {
        for (const entry of strategicResourceAmounts(strategic.strategicCapacities ?? { iron: strategic.strategicCapacity })) facts.push({ label: `Civilization ${entry.label} stock`, value: `${number(strategic.strategicResources?.[entry.resource] ?? 0)} stored / ${number(entry.amount)} capacity` });
        for (const deposit of strategic.revealedDeposits ?? []) facts.push({ label: 'Revealed deposit', value: depositLabel(deposit) });
      }
    }
    if (research?.remaining) facts.push({ label: 'Remaining research work', value: research.remaining });
    if (row?.district) {
      const district = row.district;
      facts.push({ label: 'District slots', value: `${district.used} used / ${district.capacity} capacity` });
      if (district.siteId !== null) facts.push({ label: row.construction ? 'Reserved site' : 'Built site', value: `Tile ${district.siteId}` });
      if (district.siteBaseProduction) facts.push({ label: district.siteAdjacency?.source === 'improvement' ? 'Site base with nearby Mines' : district.siteAdjacency?.source === 'wonder' ? 'Site base with nearby wonders' : 'Site base with nearby terrain', value: amounts(district.siteBaseProduction) });
      if (district.siteAdjacency?.source === 'improvement') {
        const adjacency = district.siteAdjacency;
        facts.push({ label: 'Completed nearby Mines', value: adjacency.tileIds.length ? adjacency.tileIds.map(tile => `Tile ${tile}`).join(' · ') : 'None' },
          { label: 'Mine bonus before productivity', value: `${amounts({ [adjacency.resource]: adjacency.bonus })} · Maximum ${adjacency.maximum}. Paused Mines count; unfinished Mines do not.` });
      }
      if (district.siteAdjacency?.source === 'wonder') {
        const adjacency = district.siteAdjacency;
        facts.push({ label: 'Completed nearby wonders', value: adjacency.tileIds.length ? adjacency.tileIds.map(tile => `Tile ${tile}`).join(' · ') : 'None' },
          { label: 'Wonder bonus before productivity', value: `${amounts({ [adjacency.resource]: adjacency.bonus })} · Maximum ${adjacency.maximum}. Unfinished wonders do not count.` });
      }
      for (const site of district.availableSites) facts.push({ label: `Available site ${site.tileId}`, value: `${amounts(site.baseProduction)} base before town productivity${site.adjacency?.source === 'wonder' ? ` · Completed nearby wonder sites: ${site.adjacency.tileIds.join(', ') || 'None'} · Bonus ${amounts({ [site.adjacency.resource]: site.adjacency.bonus })}` : site.adjacency?.source === 'improvement' ? ` · Completed nearby Mine sites: ${site.adjacency.tileIds.join(', ') || 'None'} · Bonus ${amounts({ [site.adjacency.resource]: site.adjacency.bonus })}` : ''}` });
    }
    if (row?.operation) facts.push({ label: 'Operating now', value: row.operation.enabled ? 'On' : 'Paused' });
    if ('localPowerInput' in definition || 'localPowerOutput' in definition) {
      facts.push({ label: 'Same-town Power recipe', value: `${number(definition.localPowerInput ?? 0)} Power required · ${number(definition.localPowerOutput ?? 0)} Power generated · Unused Power expires that season` },
        { label: 'Power meaning', value: 'Power is local to one town and season. It is not stored or ordinary Energy. Construction alone does not operate the building.' },
        { label: 'Emissions per paid operation', value: `${number(definition.emissionsPerOperation ?? 0)} recorded · No climate or calendar effect` });
      const last = row?.operation?.lastResult;
      if (last?.localPower) facts.push({ label: 'Actual latest attempt', value: `Round ${last.round} · ${last.status} · Generated ${number(last.localPower.generated)} Power · Used ${number(last.localPower.consumed)} · Paid ${amounts(last.paid, last.strategicPaid)} · Made ${amounts(last.produced)} · Emissions ${last.emissionsProduced === undefined ? 'not recorded' : number(last.emissionsProduced)}` });
      else facts.push({ label: 'Actual latest attempt', value: 'No local Power operation recorded yet' });
      const retained = input.projection.localPower?.lastProductiveBeat;
      const positive = retained?.cityId === input.projection.cityId ? retained.operations.find(entry => entry.buildingId === definition.id && entry.phase === 'consumer' && entry.result.status === 'operated' && Object.values(entry.result.produced).some(amount => amount > 0)) : undefined;
      if (positive) facts.push({ label: 'Last positive powered output', value: `Round ${retained?.round} · Made ${amounts(positive.result.produced)} · Used ${number(positive.result.localPower.consumed)} Power · Event ${positive.result.operationEventId}` });
    }
    if (row?.construction) facts.push(
      { label: 'Construction work', value: `${number(row.construction.workDone)} / ${number(row.construction.workRequired)}` },
      { label: 'Already paid for this order', value: amounts(row.construction.paid) },
      { label: 'Order started', value: `Round ${row.construction.startedRound} · ${row.construction.id}` },
    );
    if ('requiresBuildings' in definition) {
      const parent = input.catalogue.buildings.find(building => building.district && definition.requiresBuildings?.includes(building.id));
      if (parent) {
        const district = rows.get(`building:${parent.id}`)?.district;
        facts.push({ label: 'Belongs to', value: district?.siteId === null || district?.siteId === undefined ? `This town’s completed ${parent.name}` : `This town’s ${parent.name} · Tile ${district.siteId}` });
      }
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


export function capabilityGraphLayout(nodes: readonly CapabilityTreeNode[]): { width: number; height: number; nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>; edges: Array<{ from: string; to: string; path: string }> } {
  const counts = new Map<number, number>();
  const positions = nodes.map(node => {
    const row = counts.get(node.level) ?? 0; counts.set(node.level, row + 1);
    return { id: node.id, x: 20 + node.level * 220, y: 20 + row * 98, width: 174, height: 74 };
  });
  const edges = nodes.flatMap(node => node.requires.flatMap(parent => {
    const from = positions.find(item => item.id === parent); const to = positions.find(item => item.id === node.id);
    if (!from || !to) return [];
    const start = from.x + from.width; const middle = (start + to.x) / 2;
    return [{ from: parent, to: node.id, path: `M ${start} ${from.y + 37} H ${middle} V ${to.y + 37} H ${to.x}` }];
  }));
  return { width: Math.max(220, ...positions.map(node => node.x + node.width + 20)), height: Math.max(110, ...positions.map(node => node.y + node.height + 20)), nodes: positions, edges };
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

export function railCapabilityPresentation(input: CapabilityTreeInput) {
  const definition = input.catalogue.rails.find(candidate => candidate.id === 'rail');
  if (!definition) return null;
  const rail = input.projection.rail;
  return {
    description: `${definition.name} is edge construction, separate from town buildings and worked tiles.`,
    requirements: definition.requires.map(id => capabilityName(input, id)),
    cost: `${amounts(definition.cost, definition.strategicCost)} · ${number(definition.workRequired)} work`,
    range: `Both endpoints need ownership and a valid site within ${definition.range} tiles of this town.`,
    blocker: rail?.blocker ?? (rail ? null : 'Rail facts are unavailable in this release.'),
    active: rail?.active ? `Rail edge ${rail.active.edgeId} · ${number(rail.active.workDone)} / ${number(rail.active.workRequired)} work · Not built yet` : null,
    completed: rail?.completed.map(record => `Tiles ${record.tileId} ↔ ${record.toTileId} · Civilization ${record.civId} · Completed round ${record.completedRound} · Event ${record.eventId}`) ?? [],
    available: rail?.available.map(edge => ({ id: edge.edgeId, label: `Tiles ${edge.tileId} ↔ ${edge.toTileId}`, facts: `Quote ${amounts(edge.paid, edge.strategicPaid)} · ${number(edge.workRequired)} work · Edge ${edge.edgeId}` })) ?? [],
  };
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
    if (!currentNodes.some(node => node.id === id)) return;
    selectedNodeId = id;
    renderSelected();
    const node = controls.get(`node:${id}`);
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
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
  let selectedNodeId: string | null = null;
  let selectedRailEdge: string | null = null;
  let currentNodes: CapabilityTreeNode[] = [];
  let detailHost: HTMLElement | null = null;
  const renderSelected = (): void => {
    const node = currentNodes.find(item => item.id === selectedNodeId);
    if (!node || !detailHost) return;
    for (const item of currentNodes) controls.get(`node:${item.id}`)?.setAttribute('aria-pressed', String(item.id === node.id));
    const heading = text('h3', node.name); heading.tabIndex = -1;
    detailHost.replaceChildren(heading, nodeStatus(node), text('p', node.description));
    if (node.research || node.construction) detailHost.append(text('strong', node.research ?? node.construction ?? ''));
    if (node.support) detailHost.append(text('p', node.support, 'capability-support'));
    for (const blocker of node.blockers) detailHost.append(text('p', blocker, 'capability-blocker'));
    detailHost.append(relations(node, currentNodes, 'requires'), relations(node, currentNodes, 'leadsTo'));
    const facts = text('dl', '', 'capability-facts');
    for (const fact of node.facts) { const row = text('div', ''); row.append(text('dt', fact.label), text('dd', fact.value)); facts.append(row); }
    detailHost.append(facts);
    if (node.id === 'technology:steam-power' && captured) {
      const rail = railCapabilityPresentation(captured);
      if (rail) {
        const section = text('section', '', 'capability-rail');
        section.append(text('h4', 'Rail edge work'), text('p', rail.description), text('p', `Requires ${rail.requirements.join(' · ')}`), text('p', `Build once · ${rail.cost}`), text('p', rail.range, 'capability-note'));
        if (rail.blocker) section.append(text('p', rail.blocker, 'capability-blocker'));
        if (rail.active) section.append(text('p', rail.active));
        section.append(text('p', `${rail.completed.length} completed edges · Exact paid records are in this town's Work inspection.`, 'capability-note'));
        const picker = control(text('select', ''), 'rail-edge'); picker.setAttribute('aria-label', 'Inspect available rail edge');
        for (const edge of rail.available) { const option = text('option', edge.label); option.value = edge.id; picker.append(option); }
        const record = text('p', '');
        const select = (): void => { selectedRailEdge = picker.value; record.textContent = rail.available.find(edge => edge.id === picker.value)?.facts ?? 'No available edge in this observation.'; };
        picker.addEventListener('change', select); picker.disabled = !rail.available.length;
        picker.value = rail.available.some(edge => edge.id === selectedRailEdge) ? selectedRailEdge ?? '' : rail.available[0]?.id ?? ''; select();
        section.append(picker, record, text('p', 'Inspection only. The agent must explicitly choose an exact edge.', 'capability-note'));
        detailHost.append(section);
      }
    }
    if (node.researchExplanation) detailHost.append(text('p', node.researchExplanation, 'capability-note'));
    detailHost.append(button('Back to selected node', 'back-to-node', () => focusNode(node.id)));
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
        const explanation = lane.targetId.startsWith('rail:')
          ? 'This exact edge is not built yet. Only completed Rail can be quoted in a new steam agreement.'
          : lane.targetId.startsWith('improvement:')
          ? 'The worked site is not finished yet. Output requires completion and local support in a later season.'
          : definition?.capabilities?.includes('coastal-departure')
          ? 'The building is not finished yet. Its capability becomes usable after completion.'
          : 'The building is not finished yet. Output starts in a later season after completion.';
        card.append(text('p', explanation, 'capability-note'));
      }
      if (lane.availableIds.length) card.append(text('p', projection.rail ? `${lane.availableIds.length} available options · Rail edges are inspected under Steam power` : `${lane.availableIds.length} options in the tree`, 'capability-note'));
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
    const completed = text('details', '', 'capability-completions'); completed.append(text('summary', 'Last completed projects'));
    if (projection.lastResearchCompletion) {
      const last = projection.lastResearchCompletion;
      completed.append(text('p', `Last research completed: ${capabilityName(input, last.technologyId)} · Round ${last.completedRound} · Event ${last.eventId}`));
    }
    if (city && projection.lastConstructionCompletion?.cityId === city.id) {
      const last = projection.lastConstructionCompletion;
      completed.append(text('p', `Last construction completed: ${capabilityName(input, constructionTarget(last))} · ${city.name} · Round ${last.completedRound} · Event ${last.eventId}`));
      if ('kind' in last) completed.append(text('p', last.kind === 'rail' ? `Exact edge · Tiles ${last.tileId} ↔ ${last.toTileId} · ${last.edgeId}` : `Exact worked site · Tile ${last.tileId}`, 'capability-note'));
      completed.append(text('p', `Paid for that completed order: ${amounts(last.paid, 'strategicPaid' in last ? last.strategicPaid : undefined)} · Work ${number(last.workRequired)}`, 'capability-note'));
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
    currentNodes = nodes;
    if (!nodes.some(node => node.id === selectedNodeId)) selectedNodeId = nodes.find(node => node.research || node.construction)?.id ?? nodes.find(node => node.status === 'available')?.id ?? nodes[0]?.id ?? null;
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
    const options = text('div', '', 'capability-options');
    const finderLabel = text('label', 'Find in tree');
    const finder = control(text('select', ''), 'finder'); finder.setAttribute('aria-label', 'Find research, building or worked site');
    for (const node of nodes.toSorted((a, b) => a.name.localeCompare(b.name))) {
      const option = text('option', `${node.name} · ${node.research ? 'Researching' : node.construction ? 'Building' : node.label}`); option.value = node.id; finder.append(option);
    }
    finder.value = selectedNodeId ?? ''; finder.addEventListener('change', () => focusNode(finder.value)); finderLabel.append(finder); options.append(finderLabel);
    const available = nodes.filter(node => node.status === 'available');
    options.append(text('span', `Options now · ${available.length} available or underway`, 'capability-note'));
    const legend = text('p', 'Lines show prerequisites · Scroll to explore every branch', 'capability-note capability-graph-hint');
    const layout = capabilityGraphLayout(nodes);
    const workspace = text('div', '', 'capability-workspace');
    const viewport = text('div', '', 'capability-viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Branching tree. Scroll to explore all branches');
    const graph = text('div', '', 'capability-graph'); graph.setAttribute('style', `width:${layout.width}px;height:${layout.height}px`);
    const connections = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); connections.setAttribute('width', String(layout.width)); connections.setAttribute('height', String(layout.height)); connections.setAttribute('aria-hidden', 'true'); connections.setAttribute('class', 'capability-connections');
    for (const edge of layout.edges) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', edge.path); path.setAttribute('data-from', edge.from); path.setAttribute('data-to', edge.to); connections.append(path); }
    graph.append(connections);
    for (const position of layout.nodes) {
      const node = nodes.find(item => item.id === position.id); if (!node) continue;
      const item = button('', `node:${node.id}`, () => { selectedNodeId = node.id; finder.value = node.id; renderSelected(); });
      item.className = 'capability-node'; item.dataset['nodeId'] = node.id; item.dataset['status'] = node.status ?? 'unknown'; item.dataset['kind'] = node.kind;
      item.setAttribute('style', `left:${position.x}px;top:${position.y}px;width:${position.width}px;height:${position.height}px`);
      const name = text('span', node.name, 'capability-name'); name.prepend(visualIcon(node.kind === 'technology' ? 'science' : node.id === 'improvement:pasture' ? 'food' : node.kind === 'improvement' ? 'materials' : 'infrastructure'));
      item.append(name, text('span', node.research ? 'Researching' : node.construction ? 'Under construction' : node.label, 'capability-node-state')); graph.append(item);
    }
    viewport.append(graph);
    detailHost = text('section', '', 'capability-selected-detail'); detailHost.setAttribute('aria-label', 'Selected capability details');
    workspace.append(viewport, detailHost); renderSelected();
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
    if (projection.industrialEvidence) {
      const proof = text('section', '', 'capability-milestone'); proof.append(text('h4', 'Recorded industrial evidence'));
      for (const receipt of projection.industrialEvidence.foundryOperations) proof.append(text('p', `Foundry · Town ${receipt.cityId} · Civilization ${receipt.civId} · Round ${receipt.round} · Paid ${amounts(receipt.paid, receipt.strategicPaid)} · Made ${amounts(receipt.produced)} · Event ${receipt.eventId}`));
      if (!projection.industrialEvidence.foundryOperations.length) proof.append(text('p', 'No qualifying Foundry operations recorded.'));
      const steam = projection.industrialEvidence.steamDelivery;
      proof.append(text('p', steam ? `Faster steam delivery · Route ${steam.routeId} · Round ${steam.round} · Proposer paid ${amounts(steam.proposerPaid, steam.proposerStrategicPaid)} · Stored interval ${steam.terms.cadenceRounds} · Event ${steam.eventId}` : 'No qualifying faster, fuel-paid steam delivery recorded.'));
      proof.append(text('p', 'Historical proof from actual operations and delivery. Construction or research alone does not supply it.', 'capability-note'));
      milestones.append(proof);
    }
    const overview = text('details', '', 'capability-overview'); overview.append(text('summary', 'Current projects & completed work'), ...decisionCards(input));
    const record = text('details', '', 'capability-record'); record.append(text('summary', `Captured revision ${projection.revision}`), stamp);
    if (projection.admission.reason) record.append(text('p', `Action timing: ${timingText(projection.admission.reason)}`, 'capability-note'));
    const toolbar = text('div', '', 'capability-toolbar'); toolbar.append(townLabel, options);
    dialog.replaceChildren(top, context, notice, toolbar, legend, workspace, overview, milestones, record);
    const selectedPosition = layout.nodes.find(node => node.id === selectedNodeId);
    if (selectedPosition) { viewport.scrollLeft = Math.max(0, selectedPosition.x - 20); viewport.scrollTop = Math.max(0, selectedPosition.y - 20); }
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
      if (!captured || contextKey(input) !== contextKey(captured)) selectedRailEdge = null;
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
      if (changedContext) { selectedRailEdge = null; captured = structuredClone(input); render(false); controls.get('heading')?.focus({ preventScroll: true }); }
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
