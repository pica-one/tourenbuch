// Zoomen in der Grossansicht (gleiche Datei im Tourenbuch und im LifePhotoBook):
// - zwei Finger auseinander/zusammen = stufenlos zoomen (bis 4-fach), dort wo die Finger sind
// - gezoomt: mit einem Finger (oder gedrückter Maus) schieben
// - Doppeltipp / Doppelklick: auf diese Stelle zoomen bzw. zurück auf ganz
// - Mausrad: zoomen (PC)
// - nicht gezoomt: links/rechts wischen = anderes Foto, nach unten wischen = schliessen
// Das Bild füllt die Fläche (object-fit: contain) und wird nur per CSS-Transform verschoben/vergrössert.

export const MAX_SCALE = 4;
const TAP_ZOOM = 2.5;

/**
 * Begrenzen: Das Bild darf nicht aus dem Bild geschoben werden; ist es kleiner als die Fläche, bleibt es mittig.
 * box: { w, h } Fläche; content: { x, y, w, h } sichtbares Bild bei Zoom 1; v: { s, tx, ty } → begrenztes v
 */
export function clampView(box, content, v) {
  const s = Math.min(MAX_SCALE, Math.max(1, v.s));
  const axis = (t, boxLen, start, len) => {
    const scaled = len * s;
    if (scaled <= boxLen) return (boxLen - scaled) / 2 - start * s;
    return Math.min(-start * s, Math.max(boxLen - scaled - start * s, t));
  };
  return { s, tx: axis(v.tx, box.w, content.x, content.w), ty: axis(v.ty, box.h, content.y, content.h) };
}

/** Neuer Zoom so, dass der Punkt (px, py) der Fläche an derselben Stelle bleibt. */
export function zoomAt(v, s, px, py) {
  const cx = (px - v.tx) / v.s;
  const cy = (py - v.ty) / v.s;
  return { s, tx: px - cx * s, ty: py - cy * s };
}

/**
 * stage: Fläche, img: Bild darin. onSwipe(+1/-1) anderes Foto, onClose() schliessen.
 * Ergebnis: { isZoomed(), reset() }
 */
export function attachZoom(stage, img, { onSwipe = () => {}, onClose = () => {} } = {}) {
  let v = { s: 1, tx: 0, ty: 0 };
  const pointers = new Map(); // pointerId → { x, y }
  let gesture = null; // { kind: 'pan'|'pinch', ... }
  let pinched = false; // in dieser Berührung wurde mit zwei Fingern gezoomt → kein Wischen/Tippen
  let lastTap = { t: 0, x: 0, y: 0 };
  let lastType = 'mouse';

  stage.classList.add('zoomable');

  function box() {
    return { w: stage.clientWidth, h: stage.clientHeight };
  }
  /** Sichtbares Bild bei Zoom 1 (object-fit: contain lässt links/rechts bzw. oben/unten schwarze Ränder) */
  function content() {
    const b = box();
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return { x: 0, y: 0, w: b.w, h: b.h };
    const f = Math.min(b.w / nw, b.h / nh);
    const w = nw * f;
    const h = nh * f;
    return { x: (b.w - w) / 2, y: (b.h - h) / 2, w, h };
  }
  function apply(next, animate = false) {
    v = clampView(box(), content(), next);
    if (v.s < 1.01) v = { s: 1, tx: 0, ty: 0 };
    img.classList.toggle('anim', animate);
    img.style.transform = v.s === 1 ? '' : `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
    stage.classList.toggle('zoomed', v.s > 1);
  }
  function local(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toggleAt(p) {
    apply(v.s > 1 ? { s: 1, tx: 0, ty: 0 } : zoomAt(v, TAP_ZOOM, p.x, p.y), true);
  }
  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, v0: v, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      pinched = true;
    } else if (pts.length === 1) {
      gesture = { kind: 'pan', p0: pts[0], v0: v, start: gesture?.start ?? pts[0] };
    } else gesture = null;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    lastType = e.pointerType;
    if (!pointers.size) {
      pinched = false;
      gesture = null;
    }
    pointers.set(e.pointerId, local(e));
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    startGesture();
    if (pointers.size === 1) gesture.start = pointers.get(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.min(MAX_SCALE, Math.max(1, (gesture.v0.s * d) / gesture.d0));
      const z = zoomAt(gesture.v0, s, gesture.m0.x, gesture.m0.y);
      apply({ s, tx: z.tx + (m.x - gesture.m0.x), ty: z.ty + (m.y - gesture.m0.y) });
    } else if (gesture.kind === 'pan' && v.s > 1) {
      const p = pointers.get(e.pointerId);
      apply({ s: v.s, tx: gesture.v0.tx + (p.x - gesture.p0.x), ty: gesture.v0.ty + (p.y - gesture.p0.y) });
    }
  });

  function end(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size) {
      // ein Finger bleibt: von dort aus weiterschieben
      const start = gesture?.start;
      startGesture();
      if (gesture) gesture.start = start;
      return;
    }
    const start = gesture?.start ?? p;
    const wasZoomed = (gesture?.v0?.s ?? v.s) > 1 || v.s > 1;
    gesture = null;
    if (cancelled || pinched) return;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!wasZoomed) {
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return onSwipe(dx < 0 ? 1 : -1);
      if (dy > 120 && Math.abs(dy) > Math.abs(dx)) return onClose();
    }
    // Doppeltipp (Touch); mit der Maus kommt dblclick
    if (e.pointerType !== 'mouse' && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now();
      if (now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
        lastTap = { t: 0, x: 0, y: 0 };
        toggleAt(p);
      } else lastTap = { t: now, x: p.x, y: p.y };
    }
  }
  stage.addEventListener('pointerup', (e) => end(e, false));
  stage.addEventListener('pointercancel', (e) => end(e, true));

  stage.addEventListener('dblclick', (e) => {
    if (lastType === 'mouse') toggleAt(local(e));
  });

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      const s = Math.min(MAX_SCALE, Math.max(1, v.s * Math.exp(-e.deltaY * 0.0025)));
      apply(zoomAt(v, s, p.x, p.y));
    },
    { passive: false },
  );

  // Grösseres Bild geladen oder Fenster gedreht: Lage neu begrenzen
  img.addEventListener('load', () => apply(v));
  const onResize = () => stage.isConnected ? apply(v) : window.removeEventListener('resize', onResize);
  window.addEventListener('resize', onResize);

  return {
    isZoomed: () => v.s > 1,
    reset: () => apply({ s: 1, tx: 0, ty: 0 }),
  };
}
