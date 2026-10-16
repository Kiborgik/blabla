import { hexPosition } from './atlas.ts';
import type { AtlasWorld } from './atlas.ts';
import { ICON_PATHS } from '../visuals/world-visuals.ts';
import type { VisualDelta, VisualEvent, VisualIcon } from '../visuals/world-visuals.ts';

export function visualIcon(icon: VisualIcon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'visual-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[icon]);
  svg.append(path);
  return svg;
}

export function deltaNumber(delta: VisualDelta): string {
  const value = delta.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${delta.kind !== 'total' && delta.value > 0 ? '+' : ''}${value}${delta.kind === 'rate' ? ' / season' : ''}`;
}

export function renderDeltas(host: HTMLElement, deltas: readonly VisualDelta[]): void {
  host.replaceChildren();
  for (const delta of deltas) {
    const item = document.createElement('span');
    item.className = `visual-delta ${delta.tone}`;
    item.title = `${delta.subject ? `${delta.subject}: ` : ''}${delta.label} ${deltaNumber(delta)} ${delta.qualifier}`;
    const value = document.createElement('strong');
    value.textContent = deltaNumber(delta);
    const label = document.createElement('span');
    label.textContent = `${delta.label}${delta.kind === 'rate' ? ' base' : ''}`;
    item.append(visualIcon(delta.icon), value, label);
    host.append(item);
  }
}

export function eventAnchor(world: AtlasWorld, event: VisualEvent): { x: number; z: number; height: number; key: string } | null {
  const tile = world.tiles.find((candidate) => candidate.id === event.tileId);
  if (tile) return { ...hexPosition(tile.q, tile.r), height: tile.height, key: `tile:${tile.id}` };
  const city = world.cities.find((candidate) => candidate.id === (event.target ?? event.actor));
  return city ? { ...hexPosition(city.q, city.r), height: .6, key: `city:${city.cityId ?? city.id}` } : null;
}

export function createWorldCues(container: HTMLElement, world: AtlasWorld, project: (x: number, z: number, height: number) => { x: number; y: number }): {
  show: (events: readonly VisualEvent[]) => void; update: () => void; setMotion: (moving: boolean) => void; dispose: () => void;
} {
  const layer = document.createElement('div');
  layer.className = 'world-cues';
  layer.setAttribute('aria-live', 'polite');
  layer.setAttribute('aria-label', 'Changes on the map');
  container.append(layer);
  type Cue = { element: HTMLElement; anchor: NonNullable<ReturnType<typeof eventAnchor>>; timer: ReturnType<typeof setTimeout> };
  const cues: Cue[] = [];
  const remove = (cue: Cue): void => { clearTimeout(cue.timer); cue.element.remove(); const index = cues.indexOf(cue); if (index >= 0) cues.splice(index, 1); };
  const update = (): void => {
    for (const cue of cues) {
      const point = project(cue.anchor.x, cue.anchor.z, cue.anchor.height);
      cue.element.hidden = point.x < 0 || point.x > container.clientWidth || point.y < 0 || point.y > container.clientHeight;
      cue.element.style.left = `${Math.max(86, Math.min(container.clientWidth - 86, point.x))}px`;
      cue.element.style.top = `${Math.max(24, point.y - 38)}px`;
    }
  };
  return {
    show: (events) => {
      const added = new Set<string>();
      const limit = container.clientWidth < 700 ? 1 : 3;
      for (const event of events.slice(0, limit)) {
        const anchor = eventAnchor(world, event);
        if (!anchor || added.has(anchor.key)) continue;
        added.add(anchor.key);
        for (const old of cues.filter((cue) => cue.anchor.key === anchor.key)) remove(old);
        while (cues.length >= limit) { const first = cues[0]; if (first) remove(first); }
        const element = document.createElement('div');
        element.className = `world-cue ${event.cue}`;
        element.dataset['event'] = event.eventId;
        const card = document.createElement('div');
        card.className = 'cue-card';
        const title = document.createElement('strong');
        title.className = 'cue-title';
        title.append(visualIcon(event.icon), document.createTextNode(event.label));
        const deltas = document.createElement('div');
        deltas.className = 'cue-deltas';
        renderDeltas(deltas, event.deltas.slice(0, 3));
        card.append(title, deltas);
        element.append(card);
        layer.append(element);
        const cue: Cue = { element, anchor, timer: setTimeout(() => remove(cue), event.durationMs) };
        cues.push(cue);
      }
      update();
    },
    update,
    setMotion: (moving) => { layer.classList.toggle('still', !moving); },
    dispose: () => { while (cues.length) { const cue = cues[0]; if (cue) remove(cue); } layer.remove(); },
  };
}
