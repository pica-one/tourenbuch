// Statistik (wie TourStats.kt / StatsScreen.kt in der App): Kennzahlen, Tourenarten, Verlauf,
// häufigste Berge und Partner, Besonderes – für alle Jahre oder ein einzelnes Jahr.

import { TYPE_COLORS, TYPE_NAMES, typeBadge } from './icons.js';
import { visibleTours } from './tourbook.js';
import { dateRange, dayCount, esc, topbar } from './ui.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const yearOf = (t) => Number(t.dates.value.start.slice(0, 4));

/** Jahre mit Touren, neuestes zuerst. */
export function statYears(tours) {
  return [...new Set(tours.map(yearOf))].sort((a, b) => b - a);
}

/** Berechnet die Statistik. Gleiche Berge in anderer Schreibweise ("titlis"/"Titlis") zählen zusammen. */
export function computeStats(all, year, top = 5) {
  const tours = year == null ? all : all.filter((t) => yearOf(t) === year);

  const typeMap = new Map();
  for (const t of tours) typeMap.set(t.tourType.value, (typeMap.get(t.tourType.value) ?? 0) + 1);
  const byType = [...typeMap.entries()]
    .map(([type, count]) => ({ type, label: type === 'CUSTOM' ? 'Eigene' : TYPE_NAMES[type] ?? type, count }))
    .sort((a, b) => b.count - a.count);

  let timeline = [];
  if (year == null) {
    const years = all.map(yearOf);
    if (years.length) {
      for (let y = Math.min(...years); y <= Math.max(...years); y++) timeline.push({ label: String(y), count: years.filter((v) => v === y).length });
    }
  } else {
    timeline = MONTHS.map((label, i) => ({ label, count: tours.filter((t) => Number(t.dates.value.start.slice(5, 7)) === i + 1).length }));
  }

  const ranking = (names) => {
    const groups = new Map();
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!groups.has(key)) groups.set(key, new Map());
      const spellings = groups.get(key);
      spellings.set(name, (spellings.get(name) ?? 0) + 1);
    }
    return [...groups.values()]
      .map((spellings) => {
        // häufigste Schreibweise als Beschriftung
        const label = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { label, count: [...spellings.values()].reduce((s, n) => s + n, 0) };
      })
      .sort((a, b) => b.count - a.count || a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
      .slice(0, top);
  };

  let longest = null;
  for (const t of tours) {
    const d = dayCount(t.dates.value);
    if (d <= 1) continue;
    if (!longest || d > longest.days || (d === longest.days && t.dates.value.start > longest.tour.dates.value.start)) longest = { tour: t, days: d };
  }

  return {
    year,
    tours: tours.length,
    days: tours.reduce((s, t) => s + dayCount(t.dates.value), 0),
    photos: tours.reduce((s, t) => s + t.photos.filter((p) => p.deleted == null).length, 0),
    places: new Set(tours.map((t) => t.mountain.value.trim().toLowerCase())).size,
    byType,
    timeline,
    topPlaces: ranking(tours.map((t) => t.mountain.value)),
    topPartners: ranking(tours.flatMap((t) => t.partners?.value ?? [])),
    longest: longest && {
      tourId: longest.tour.id,
      title: [longest.tour.mountain.value, longest.tour.routeName?.value].filter(Boolean).join(' · '),
      detail: `${longest.days} Tage, ${dateRange(longest.tour.dates.value)}`,
    },
    favorites: tours.filter((t) => (t.rating?.value ?? 0) === 5).length,
  };
}

/** Bildschirm Statistik. state = { year } wird zwischen Aufrufen behalten. */
export function renderStats(root, book, state) {
  const all = visibleTours(book.current());
  const years = statYears(all);
  if (state.year != null && !years.includes(state.year)) state.year = null;
  if (!all.length) {
    root.innerHTML = topbar('Statistik', { back: true }) + '<div class="empty">Noch keine Touren – sobald du Touren einträgst, erscheint hier deine Statistik.</div>';
    return;
  }
  const s = computeStats(all, state.year);
  root.innerHTML = `
    ${topbar('Statistik', { back: true })}
    <div class="chips">
      <button class="chip${state.year == null ? ' on' : ''}" data-year="">Alle Jahre</button>
      ${years.map((y) => `<button class="chip${state.year === y ? ' on' : ''}" data-year="${y}">${y}</button>`).join('')}
    </div>
    <div class="section stats">
      <div class="tiles">
        ${tile('Touren', s.tours)}${tile('Tage unterwegs', s.days)}${tile('Berge / Orte', s.places)}${tile('Fotos', s.photos)}
      </div>
      ${typeSection(s)}
      ${timelineSection(s)}
      ${rankingSection('Häufigste Berge / Orte', s.topPlaces)}
      ${rankingSection('Häufigste Tourenpartner', s.topPartners)}
      <div class="panel statcard"><h3>Besonderes</h3>
        <p class="big">★ ${s.favorites} ${s.favorites === 1 ? 'Tour' : 'Touren'} mit 5 Sternen</p>
        ${s.longest ? `<a class="highlight" href="#/tour/${encodeURIComponent(s.longest.tourId)}">
          <small>Längste Tour</small><strong>${esc(s.longest.title)}</strong><span>${esc(s.longest.detail)}</span><em>Tour anzeigen</em></a>` : ''}
      </div>
    </div>`;
  root.querySelectorAll('[data-year]').forEach((b) => {
    b.onclick = () => {
      state.year = b.dataset.year ? Number(b.dataset.year) : null;
      renderStats(root, book, state);
    };
  });
}

function tile(label, value) {
  return `<div class="panel tile"><strong>${value}</strong><span>${label}</span></div>`;
}

function bar(fraction, color) {
  const pct = Math.max(2, Math.min(100, Math.round(fraction * 100)));
  return `<span class="bar statbar"><span style="width:${pct}%;background:${color}"></span></span>`;
}

function typeSection(s) {
  if (!s.byType.length) return '';
  const max = Math.max(...s.byType.map((t) => t.count));
  return `<div class="panel statcard"><h3>Nach Tourenart</h3>
    ${s.byType.map((t) => `<div class="statrow">${typeBadge(t.type, 28, '')}<span class="statlabel">${esc(t.label)}</span>${bar(t.count / max, TYPE_COLORS[t.type]?.[0] ?? 'var(--primary)')}<span class="statnum">${t.count}</span></div>`).join('')}
  </div>`;
}

function timelineSection(s) {
  if (!s.timeline.length) return '';
  const max = Math.max(1, ...s.timeline.map((i) => i.count));
  const short = s.year == null && s.timeline.length > 6;
  return `<div class="panel statcard"><h3>${s.year == null ? 'Touren pro Jahr' : `Touren pro Monat ${s.year}`}</h3>
    <div class="columns">${s.timeline
      .map((i) => `<div class="col"><span class="colnum">${i.count || ''}</span><span class="colbar" style="height:${(78 * i.count) / max}%"></span></div>`)
      .join('')}</div>
    <div class="collabels">${s.timeline.map((i) => `<span>${short ? "'" + i.label.slice(-2) : esc(i.label)}</span>`).join('')}</div>
  </div>`;
}

function rankingSection(title, items) {
  if (!items.length) return '';
  const max = Math.max(...items.map((i) => i.count));
  return `<div class="panel statcard"><h3>${title}</h3>
    ${items.map((i, n) => `<div class="statrow"><span class="rank">${n + 1}.</span><span class="statlabel wide">${esc(i.label)}</span>${bar(i.count / max, 'var(--tertiary)')}<span class="statnum">${i.count}</span></div>`).join('')}
  </div>`;
}
