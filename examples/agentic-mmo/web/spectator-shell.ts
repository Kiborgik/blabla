import { TECHNOLOGIES } from '../core/content.ts';
import type { WorldState } from '../core/types.ts';
import { exactNumber } from './number-format.ts';
import { civilizationSummary, constructionCommitment } from './spectator-hud.ts';
import { visualIcon } from './world-cues.ts';

export interface CivilizationRibbonSummary {
  summary: string;
  research: { name: string; done: number; required: number } | null;
  construction: { towns: number; done: number; required: number } | null;
}

export function civilizationRibbonSummary(state: Pick<WorldState, 'cities' | 'civilizations' | 'border'>, id: number): CivilizationRibbonSummary {
  const civilization = state.civilizations.find(candidate => candidate.id === id);
  const research = TECHNOLOGIES.find(candidate => candidate.id === civilization?.researchTarget && !civilization.technologies.includes(candidate.id));
  const work = state.cities.filter(city => city.civId === id && city.construction?.active?.cityId === city.id).flatMap(city => {
    const commitment = constructionCommitment(city);
    return commitment ? [commitment] : [];
  });
  return {
    summary: civilizationSummary(state, id),
    research: research && civilization ? { name: research.name, done: civilization.researchProgress, required: research.cost } : null,
    construction: work.length ? { towns: work.length, done: work.reduce((sum, order) => sum + order.done, 0), required: work.reduce((sum, order) => sum + order.required, 0) } : null,
  };
}

export function renderCivilizationRibbonContent(host: HTMLElement, summary: CivilizationRibbonSummary): void {
  const facts = document.createElement('small'); facts.className = 'civ-ribbon-facts'; facts.textContent = summary.summary;
  const work = document.createElement('span'); work.className = 'civ-ribbon-work';
  for (const kind of ['research', 'construction'] as const) {
    const current = summary[kind];
    const row = document.createElement('span'); row.className = `civ-ribbon-progress civ-ribbon-${kind}`;
    const label = document.createElement('span'); label.className = 'civ-ribbon-work-name';
    label.textContent = current ? 'name' in current ? current.name : `${current.towns} ${current.towns === 1 ? 'town' : 'towns'} building` : kind === 'research' ? 'No active research' : 'No construction';
    row.append(visualIcon(kind === 'research' ? 'science' : 'materials'), label);
    if (current && current.required > 0) {
      const amount = `${exactNumber(current.done)} / ${exactNumber(current.required)} ${kind === 'research' ? 'Science work' : 'work'}`;
      const explanation = `${kind === 'research' ? 'Research' : 'Unfinished construction across'}: ${label.textContent}. ${amount}.`;
      row.title = explanation;
      const meter = document.createElement('progress'); meter.max = current.required; meter.value = Math.max(0, current.done); meter.setAttribute('aria-label', explanation);
      const value = document.createElement('span'); value.className = 'civ-ribbon-percent'; value.textContent = `${Math.min(100, Math.max(0, Math.floor(current.done / current.required * 100)))}%`; value.setAttribute('aria-hidden', 'true');
      row.append(meter, value);
    }
    work.append(row);
  }
  host.append(facts, work);
}

export function organizeSpectatorInspection(panel: HTMLElement): void {
  const overview = panel.querySelector<HTMLElement>('.town-overview');
  const resources = panel.querySelector<HTMLElement>('.resources');
  if (!overview || !resources) return;
  let summary = panel.querySelector<HTMLElement>('.town-at-a-glance');
  if (!summary) {
    summary = document.createElement('section'); summary.className = 'town-at-a-glance'; summary.dataset['inspectionSection'] = 'overview';
    for (const child of Array.from(overview.children)) if (child.matches('.town-heading, .settlement-facts, .town-picker-label')) summary.append(child);
  }
  const commitments = panel.querySelector<HTMLElement>('.ongoing-commitments');
  const stockpile = panel.querySelector<HTMLElement>('.stockpile-caption') ?? resources;
  panel.insertBefore(summary, commitments ?? stockpile);
  if (commitments) panel.insertBefore(commitments, stockpile);
}
