// Symbole und Farben der Tourenarten – gleich wie TourTypeIcons.kt in der App (24 x 24 Einheiten).

const F = (d, extra = '') => `<path d="${d}" fill="currentColor" ${extra}/>`;
const S = (d, w = 2) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;
const CS = (cx, cy, r, w) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${w}"/>`;

const PATHS = {
  // Wanderschuh mit Profilsohle
  WANDERN:
    F('M6 2H12V10L18 12.2C20 12.9 21 14 21 15.5V17H3V14C3 13 3.6 12.3 4.5 12L6 11.5Z M8 4.5H11V5.7H8Z M8 7.5H11V8.7H8Z', 'fill-rule="evenodd"') +
    F('M2 18.2H22V20C22 21.1 21.1 22 20 22H4C2.9 22 2 21.1 2 20Z'),
  // Zwei Gipfel, der grosse mit Schneekappe
  BERGSTEIGEN: F(
    'M8.5 5L10.4 8.6L9.5 9.3L8.5 8.4L7.5 9.3L6.8 8.6Z M1 21L6.25 9.8L7.5 10.6L8.5 9.7L9.5 10.6L11.1 9.8L13 13.4L16.2 9L23 21Z',
  ),
  // Kletterer an der Wand
  KLETTERGARTEN:
    C(13.5, 3.5, 2) + S('M12.8 6.5L11 13.5 M12.5 8L16 7L17.5 3.5 M12.5 8L9 9.5L7 6.5 M11 13.5L15 15L15 19.5 M11 13.5L7.5 16.5L8.5 21'),
  // Kleiner Kletterer über einer Bergkette
  MSL_KLETTERN:
    F('M1 23L7 14L10 18L15 11L23 23Z') +
    C(8, 2.8, 1.6) +
    S('M7.6 4.8L6.6 8.8 M7.4 5.8L10 5L10.8 2.5 M7.4 5.8L5 7L3.8 4.8 M6.6 8.8L9 9.8L9.3 12 M6.6 8.8L4.4 10.4L4.9 12.5', 1.6),
  // Mountainbike
  BIKETOUR:
    CS(5.5, 16.5, 4.2, 2.2) +
    CS(18.5, 16.5, 4.2, 2.2) +
    S('M5.5 16.5L11 16.5L9 9.5Z M9 9.5L15.3 9.5L11 16.5 M15.3 9.5L18.5 16.5 M9 9.5L9 8 M7.5 8L10.5 8 M15.3 9.5L14.8 6.8 M13.6 6.8L16.6 6.8', 1.8),
  // Gekreuzte Ski
  SKITOUR: S('M4 21L17.5 4.5Q19 2.7 20.5 4 M20 21L6.5 4.5Q5 2.7 3.5 4', 2.2),
  // Leiter
  KLETTERSTEIG: S('M7 2.5L7 21.5 M17 2.5L17 21.5 M7 6L17 6 M7 10L17 10 M7 14L17 14 M7 18L17 18', 2.2),
  // Ort-Markierung (eigene Tourenart)
  CUSTOM: F('M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z'),
};

/** Hintergrund und Symbolfarbe; null = Farbe des Farbschemas. */
export const TYPE_COLORS = {
  MSL_KLETTERN: ['#D32F2F', '#FFFFFF'],
  SKITOUR: ['#1E6FD9', '#FFFFFF'],
  KLETTERGARTEN: ['#EF7C00', '#FFFFFF'],
  BERGSTEIGEN: ['#8BC34A', '#1F3A0B'],
  BIKETOUR: ['#F6C800', '#3A3000'],
  WANDERN: ['#2E7D32', '#FFFFFF'],
  KLETTERSTEIG: ['#7B4F2C', '#FFFFFF'],
  CUSTOM: null,
};

export const TYPE_NAMES = {
  BERGSTEIGEN: 'Bergsteigen',
  SKITOUR: 'Skitour',
  BIKETOUR: 'Biketour',
  KLETTERGARTEN: 'Klettergarten',
  MSL_KLETTERN: 'MSL-Klettern',
  WANDERN: 'Wandern',
  KLETTERSTEIG: 'Klettersteig',
  CUSTOM: 'Custom',
};

export function typeLabel(type, customType) {
  return type === 'CUSTOM' && customType?.trim() ? customType.trim() : TYPE_NAMES[type] ?? type;
}

/** Rundes, farbiges Symbol der Tourenart als HTML. */
export function typeBadge(type, size = 40, label = '') {
  const colors = TYPE_COLORS[type];
  const style = colors ? `background:${colors[0]};color:${colors[1]}` : '';
  return `<span class="badge${colors ? '' : ' badge-plain'}" style="${style};width:${size}px;height:${size}px" role="img" aria-label="${label}">` +
    `<svg viewBox="0 0 24 24" width="${Math.round(size * 0.65)}" height="${Math.round(size * 0.65)}" aria-hidden="true">${PATHS[type] ?? PATHS.CUSTOM}</svg></span>`;
}

// Kleine Bedien-Symbole (Material-Stil)
const UI = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  settings:
    'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  sync: 'M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  folder: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  chart: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A2.99 2.99 0 0 0 3 12a3 3 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z',
};

export function icon(name, size = 24) {
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${UI[name]}" fill="currentColor"/></svg>`;
}
