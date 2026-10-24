import { mapContentWindow, type ScreenBox } from '../visuals/map-hierarchy.ts';
import type { ScreenPoint } from './inspection-camera.ts';

export const SPECTATOR_OBSTACLES = '.civilization-panel, .inspection, .world-heading, .chronicle, .map-tools, .layer-controls, .connection-actions, .masthead, .footer, .era-pill';

export function spectatorSafeAnchor(width: number, height: number, obstacles: readonly ScreenBox[]): ScreenPoint {
  const window = mapContentWindow(width, height, obstacles);
  return window && width > 0 && height > 0 ? { x: (window.left + window.width / 2) / width, y: (window.top + window.height / 2) / height } : { x: .5, y: .5 };
}

export function spectatorObstacles(container: HTMLElement): ScreenBox[] {
  const origin = container.getBoundingClientRect();
  const shell = container.closest('#app') ?? container.parentElement;
  return [...shell?.querySelectorAll<HTMLElement>(SPECTATOR_OBSTACLES) ?? []].flatMap(element => {
    if (element.hidden || element.closest('[hidden]')) return [];
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? [{ left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height }] : [];
  });
}

export function measuredSpectatorAnchor(container: HTMLElement): ScreenPoint {
  const box = container.getBoundingClientRect();
  return spectatorSafeAnchor(box.width, box.height, spectatorObstacles(container));
}
