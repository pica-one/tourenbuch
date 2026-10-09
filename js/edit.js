// Bildschirm "Neue Tour" / "Tour bearbeiten" (wie TourEditScreen.kt in der App).

import { TOUR_TYPES } from './format.js';
import { icon, typeBadge, TYPE_NAMES } from './icons.js';
import { addTour, allPartnerNames, editTour, favorites, newId } from './tourbook.js';
import { esc, normalizeText, rankByUse, sameText, showToast, todayIso, topbar } from './ui.js';

/**
 * root: Element für den Bildschirm; id: Tour-Kennung oder null (neue Tour)
 * done(id): nach dem Speichern; cancel(): Abbrechen
 */
export function renderEdit(root, { book, id, done, cancel }) {
  const doc = book.current();
  const existing = id ? doc.tours.find((t) => t.id === id && t.deleted == null) : null;
  if (id && !existing) {
    root.innerHTML = topbar('Tour bearbeiten', { back: true }) + '<div class="empty">Diese Tour gibt es nicht mehr.</div>';
    root.querySelector('[data-action="back"]').onclick = cancel;
    return;
  }
  // Formularwerte
  const f = existing
    ? {
        tourType: existing.tourType.value,
        customType: existing.customType?.value ?? '',
        start: existing.dates.value.start,
        end: existing.dates.value.end,
        mountain: existing.mountain.value,
        routeName: existing.routeName?.value ?? '',
        rating: existing.rating?.value ?? 0,
        partners: [...(existing.partners?.value ?? [])],
        details: existing.details?.value ?? '',
      }
    : { tourType: 'BERGSTEIGEN', customType: '', start: todayIso(), end: todayIso(), mountain: '', routeName: '', rating: 0, partners: [], details: '' };

  // Vorschläge aus früheren Touren (neueste zuerst)
  const past = doc.tours.filter((t) => t.deleted == null).sort((a, b) => (a.dates.value.start < b.dates.value.start ? 1 : -1));
  const mountains = rankByUse(past.map((t) => t.mountain.value));
  const customTypes = rankByUse(past.filter((t) => t.tourType.value === 'CUSTOM').map((t) => t.customType?.value ?? ''));
  const knownPartners = allPartnerNames(doc);
  const favs = favorites(doc);

  root.innerHTML = `
    ${topbar(existing ? 'Tour bearbeiten' : 'Neue Tour', { back: true })}
    <form id="form" class="form" novalidate>
      <div class="section"><h2>Tourenart</h2>
        <div class="types">
          ${TOUR_TYPES.map((t) => `<button type="button" class="typechip" data-type="${t}" aria-pressed="${f.tourType === t}">
            ${typeBadge(t, 28, '')}<span>${esc(TYPE_NAMES[t])}</span></button>`).join('')}
        </div>
        <label class="field" id="customField" ${f.tourType === 'CUSTOM' ? '' : 'hidden'}>
          <span>Eigener Tourentyp</span>
          <input id="customType" list="customTypes" value="${esc(f.customType)}" autocomplete="off">
        </label>
      </div>

      <div class="section"><h2>Datum</h2>
        <div class="dates">
          <label class="field"><span>Von</span><input type="date" id="start" value="${f.start}" required></label>
          <label class="field"><span>Bis</span><input type="date" id="end" value="${f.end}" required></label>
        </div>
      </div>

      <div class="section"><h2>Tour</h2>
        <label class="field"><span>Berg / Ort *</span><input id="mountain" list="mountains" value="${esc(f.mountain)}" autocomplete="off" required></label>
        <label class="field"><span>Route</span><input id="routeName" list="routes" value="${esc(f.routeName)}" autocomplete="off"></label>
        <div class="field"><span>Bewertung</span>
          <div class="rating" id="rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} Sterne">☆</button>`).join('')}</div>
        </div>
      </div>

      <div class="section"><h2>Tourenpartner</h2>
        <div class="partnerchips" id="partnerChips"></div>
        <div class="favs" id="favs"></div>
        <div class="addpartner">
          <input id="partnerInput" list="partnerList" placeholder="Name eingeben" autocomplete="off" aria-label="Partner hinzufügen">
          <button type="button" class="btn outline" id="addPartner">${icon('add', 20)}</button>
        </div>
      </div>

      <div class="section"><h2>Details</h2>
        <label class="field"><textarea id="details" rows="5" placeholder="Hier kannst du zusätzliche Informationen zu dieser Tour eingeben …">${esc(f.details)}</textarea></label>
      </div>

      <div class="section"><p class="formerror" id="error" hidden></p>
        <button type="submit" class="btn wide">Speichern</button></div>
    </form>
    <datalist id="mountains">${mountains.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="routes"></datalist>
    <datalist id="customTypes">${customTypes.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="partnerList">${knownPartners.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`;

  const $ = (sel) => root.querySelector(sel);
  $('[data-action="back"]').onclick = cancel;

  // Tourenart
  root.querySelectorAll('.typechip').forEach((b) => {
    b.onclick = () => {
      f.tourType = b.dataset.type;
      root.querySelectorAll('.typechip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#customField').hidden = f.tourType !== 'CUSTOM';
    };
  });

  // Datum: "Bis" nie vor "Von"
  $('#start').onchange = () => {
    if (!$('#end').value || $('#end').value < $('#start').value) $('#end').value = $('#start').value;
  };

  // Routen: zuerst die am eingegebenen Berg
  const updateRoutes = () => {
    const m = $('#mountain').value;
    const atMountain = m.trim() ? rankByUse(past.filter((t) => sameText(t.mountain.value, m)).map((t) => t.routeName?.value ?? '')) : [];
    const all = rankByUse(past.map((t) => t.routeName?.value ?? ''));
    const seen = new Set();
    const list = [...atMountain, ...all].filter((r) => !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase()));
    $('#routes').innerHTML = list.slice(0, 200).map((r) => `<option value="${esc(r)}">`).join('');
  };
  $('#mountain').addEventListener('change', updateRoutes);
  updateRoutes();

  // Bewertung: gleicher Stern nochmals = keine Bewertung
  const drawRating = () =>
    root.querySelectorAll('[data-star]').forEach((b) => {
      const on = Number(b.dataset.star) <= f.rating;
      b.textContent = on ? '★' : '☆';
      b.classList.toggle('on', on);
    });
  root.querySelectorAll('[data-star]').forEach((b) => {
    b.onclick = () => {
      const n = Number(b.dataset.star);
      f.rating = f.rating === n ? 0 : n;
      drawRating();
    };
  });
  drawRating();

  // Partner
  const drawPartners = () => {
    $('#partnerChips').innerHTML = f.partners.length
      ? f.partners.map((p, i) => `<span class="pchip">${esc(p)}<button type="button" data-remove="${i}" aria-label="${esc(p)} entfernen">${icon('close', 16)}</button></span>`).join('')
      : '<span class="muted">Noch keine Partner</span>';
    const open = favs.filter((n) => !f.partners.some((p) => sameText(p, n)));
    $('#favs').innerHTML = open.map((n) => `<button type="button" class="chip" data-fav="${esc(n)}">+ ${esc(n)}</button>`).join('');
    root.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => {
      f.partners.splice(Number(b.dataset.remove), 1);
      drawPartners();
    }));
    root.querySelectorAll('[data-fav]').forEach((b) => (b.onclick = () => addPartner(b.dataset.fav)));
  };
  const addPartner = (name) => {
    const n = normalizeText(name);
    if (!n) return;
    // Schreibweise eines bekannten Partners übernehmen
    const known = knownPartners.find((k) => sameText(k, n)) ?? n;
    if (!f.partners.some((p) => sameText(p, known))) f.partners.push(known);
    drawPartners();
  };
  $('#addPartner').onclick = () => {
    addPartner($('#partnerInput').value);
    $('#partnerInput').value = '';
    $('#partnerInput').focus();
  };
  $('#partnerInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#addPartner').click();
    }
  });
  drawPartners();

  // Speichern
  $('#form').onsubmit = async (e) => {
    e.preventDefault();
    // Halb eingetippter Partner zählt mit
    if ($('#partnerInput').value.trim()) addPartner($('#partnerInput').value);
    const start = $('#start').value;
    const end = $('#end').value || start;
    const mountain = normalizeText($('#mountain').value);
    const customType = normalizeText($('#customType').value);
    const error = !start
      ? 'Bitte ein Datum wählen.'
      : end < start
        ? 'Das Enddatum darf nicht vor dem Startdatum liegen.'
        : !mountain
          ? 'Bitte Berg / Ort eingeben.'
          : f.tourType === 'CUSTOM' && !customType
            ? 'Bitte den eigenen Tourentyp eingeben.'
            : null;
    if (error) {
      $('#error').textContent = error;
      $('#error').hidden = false;
      return;
    }
    const values = {
      tourType: f.tourType,
      customType: f.tourType === 'CUSTOM' ? customType : null,
      dates: { start, end },
      mountain,
      routeName: normalizeText($('#routeName').value) || null,
      rating: f.rating,
      partners: f.partners,
      details: $('#details').value.trim() ? $('#details').value.replace(/\s+$/, '') : null,
    };
    const now = Date.now();
    const tourId = existing?.id ?? newId();
    try {
      await book.update((d) => (existing ? editTour(d, tourId, values, now) : addTour(d, values, now, tourId)));
      done(tourId);
    } catch (err) {
      console.error(err);
      showToast('Speichern fehlgeschlagen: ' + (err.message || err));
    }
  };
}
