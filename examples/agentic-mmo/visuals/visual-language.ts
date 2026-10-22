export const ICON_PATHS = {
  inspect: 'M5 19L19 5M8 5H19V16',
  food: 'M12 21V5M12 10C5 10 5 5 5 5C10 5 12 7 12 10M12 15C19 15 19 10 19 10C14 10 12 12 12 15M12 6C9 3 12 1 12 1C15 3 12 6 12 6',
  materials: 'M3 7L12 3L21 7L12 11ZM3 7V17L12 21L21 17V7M12 11V21',
  energy: 'M14 2L5 14H11L10 22L20 9H13Z',
  credits: 'M20 12A8 8 0 1 1 4 12A8 8 0 1 1 20 12M15 7H11A3 3 0 0 0 11 13H13A3 3 0 0 1 13 19H9M12 5V21',
  science: 'M9 2H15M10 2V9L4 19Q3 22 7 22H17Q21 22 20 19L14 9V2M7 16H17',
  culture: 'M4 21H20M6 18V9M12 18V9M18 18V9M3 7L12 2L21 7Z',
  population: 'M15 6A3 3 0 1 1 9 6A3 3 0 1 1 15 6M6 21V17A6 6 0 0 1 18 17V21M3 7A2 2 0 0 1 5 11M1 20V17A4 4 0 0 1 4 13',
  wellbeing: 'M12 21L3 12C-1 5 7 1 12 7C17 1 25 5 21 12Z',
  damage: 'M12 2L22 21H2ZM12 8V14M12 18V19',
  infrastructure: 'M3 22V10L12 3L21 10V22M8 22V15H16V22M3 10H21',
  legitimacy: 'M4 4H20V12Q19 19 12 22Q5 19 4 12ZM8 12L11 15L17 8',
  influence: 'M12 9A3 3 0 1 1 6 9A3 3 0 1 1 12 9M17 4L22 4L22 9M14 12L22 4M3 22V19A6 6 0 0 1 15 19V22',
  farm: 'M3 4H21V21H3ZM6 7L10 11M10 7L14 11M14 7L18 11M6 14L10 18M10 14L14 18M14 14L18 18',
  workshop: 'M3 21V10L11 4L19 10V21ZM7 21V15H14V21M17 8V2H21V21',
  irrigation: 'M3 4H13V14H3ZM5 7H11V11H5ZM13 9H18V20H14V13H13M18 17H22',
  kiln: 'M5 21V9Q5 4 12 4Q19 4 19 9V21ZM9 21V15Q12 11 15 15V21M10 4V1H14V4M5 10H19',
  academy: 'M2 9L12 3L22 9M4 9V21H20V9M7 12L12 14L17 12V19L12 21L7 19ZM12 14V21',
  monument: 'M3 20Q12 16 21 20V22H3ZM11 5H13V18H11ZM8 5V2H16V5',
  'boat-yard': 'M2 10L12 3L22 10M5 10V18M19 10V18M3 18H21M6 21H18M9 10V18M15 10V18',
  'fuel-yard': 'M2 8L12 3L22 8M4 8V21H20V8M6 13H18V17H6ZM6 17H18V21H6ZM10 13V21M14 13V21',
  repair: 'M3 20L13 10M10 6L14 2L21 9L17 13ZM3 20L5 22L15 12M3 5H7M5 3V7',
  drought: 'M12 7A4 4 0 1 1 4 7A4 4 0 1 1 12 7M8 1V0M1 7H0M15 7H16M8 14V13M3 18H19M6 21H22',
  cargo: 'M2 8H15V19H2ZM15 12H20L23 16V19H15M8 20A2 2 0 1 1 4 20A2 2 0 1 1 8 20M21 20A2 2 0 1 1 17 20A2 2 0 1 1 21 20',
  discovery: 'M8 15C1 9 5 2 12 2C19 2 23 9 16 15V19H8ZM9 22H15M9 16H15',
} as const;

export type VisualIcon = keyof typeof ICON_PATHS;
export const METRIC_LABELS = {
  food: 'Food', materials: 'Materials', energy: 'Energy', credits: 'Credits', science: 'Science',
  culture: 'Culture', population: 'People', wellbeing: 'Wellbeing', damage: 'Damage',
  infrastructure: 'Infrastructure', legitimacy: 'Trust', influence: 'Influence', cargo: 'Cargo',
} as const;
export type VisualMetric = keyof typeof METRIC_LABELS;

export const VISUAL_PALETTE = {
  plaster: '#f0d9ab', timber: '#70513a', roof: '#b86443', stone: '#b1ab91',
  canopy: '#3f714c', canopyLight: '#63884e', rock: '#8b927e', rockLight: '#c8c6a7', settled: '#b8a377',
  soil: '#765638', crop: '#8eaa53', grain: '#d7bd60', metal: '#687b7e',
  positive: '#a6c982', negative: '#efaa79', neutral: '#f5e6bc', water: '#153d54',
} as const;

export type DetailLevel = 'far' | 'mid' | 'close';
export const DETAIL_BUDGETS = {
  far: { houses: 3, fieldRows: 1, parts: 18, labels: 5, particles: 0 },
  mid: { houses: 6, fieldRows: 3, parts: 32, labels: 8, particles: 12 },
  close: { houses: 8, fieldRows: 5, parts: 42, labels: 12, particles: 24 },
} as const;

export function visualDetail(tileDiameterPixels: number, previous?: DetailLevel): DetailLevel {
  const size = Number.isFinite(tileDiameterPixels) ? Math.max(0, tileDiameterPixels) : 0;
  if (previous === 'far' && size < 26) return 'far';
  if (previous === 'close' && size >= 44) return 'close';
  if (previous === 'mid' && size >= 22 && size < 52) return 'mid';
  return size < 24 ? 'far' : size < 48 ? 'mid' : 'close';
}
