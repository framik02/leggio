// Selezione del testo nel lettore: un tocco prende la frase, un doppio tocco la
// parola, due maniglie allungano o accorciano. Le posizioni si esprimono come
// { s: frase, off: carattere dentro la frase }, così restano valide anche se
// cambiano carattere, corpo o margini.
import { h } from './ui.js';

const API = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
const COLORI = ['giallo', 'ciano', 'lilla'];

export function creaSelezione({ pagina, scorri, quandoCambia, toccoVuoto }) {
  let sel = null; // { da, a, esistente }
  let evidenze = [];
  const mInizio = h('div', { class: 'maniglia inizio' }, h('span'));
  const mFine = h('div', { class: 'maniglia fine' }, h('span'));

  // ------------------------------------------------------------ posizioni
  const spans = s => pagina.querySelectorAll(`span.s[data-s="${s}"]`);
  const lunghezza = s => [...spans(s)].reduce((n, sp) => n + sp.textContent.length, 0);
  const confronta = (p, q) => (p.s - q.s) || (p.off - q.off);

  function posDaNodo(nodo, offset) {
    const elemento = nodo.nodeType === 3 ? nodo.parentElement : nodo;
    const sp = elemento?.closest?.('span.s');
    if (!sp || !pagina.contains(sp)) return null;
    const s = +sp.dataset.s;
    let off = 0;
    for (const x of spans(s)) { if (x === sp) break; off += x.textContent.length; }
    return { s, off: off + (nodo.nodeType === 3 ? offset : 0) };
  }

  function nodoDaPos({ s, off }) {
    let resto = off;
    const tutti = [...spans(s)];
    for (const sp of tutti) {
      const t = sp.firstChild;
      const n = sp.textContent.length;
      if (resto <= n && t) return [t, Math.max(0, resto)];
      resto -= n;
    }
    const ultimo = tutti[tutti.length - 1]?.firstChild;
    return ultimo ? [ultimo, ultimo.length] : null;
  }

  function range(da, a) {
    const x = nodoDaPos(da), y = nodoDaPos(a);
    if (!x || !y) return null;
    const r = document.createRange();
    try { r.setStart(...x); r.setEnd(...y); } catch { return null; }
    return r;
  }

  function cursore(x, y) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? [r.startContainer, r.startOffset] : null;
    }
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? [p.offsetNode, p.offset] : null;
    }
    return null;
  }

  // Su WebKit (iPhone) il cursore cade spesso nello spazio fra due frasi, fuori
  // dagli span: allora si cerca la lettera sotto il dito dentro la frase toccata.
  function puntoTesto(x, y) {
    const c = cursore(x, y);
    if (c && c[0].nodeType === 3 && c[0].parentElement?.closest('span.s') && pagina.contains(c[0])) return c;
    const sp = document.elementFromPoint(x, y)?.closest?.('span.s');
    const t = sp?.firstChild;
    if (!t || t.nodeType !== 3) return null;
    const r = document.createRange();
    let migliore = 0, distanza = Infinity;
    for (let i = 0; i < t.length; i++) {
      r.setStart(t, i); r.setEnd(t, i + 1);
      for (const q of r.getClientRects()) {
        if (y < q.top - 2 || y > q.bottom + 2) continue;
        const d = x < q.left ? q.left - x : x > q.right ? x - q.right : 0;
        if (d < distanza) { distanza = d; migliore = x > (q.left + q.right) / 2 ? i + 1 : i; }
      }
    }
    return [t, migliore];
  }

  function parolaIn(x, y) {
    const c = puntoTesto(x, y);
    if (!c || c[0].nodeType !== 3) return null;
    const testo = c[0].nodeValue;
    let i = c[1], j = c[1];
    const lettera = ch => /[\p{L}\p{N}'’-]/u.test(ch);
    if (!lettera(testo[i] || '') && lettera(testo[i - 1] || '')) i--, j--;
    while (i > 0 && lettera(testo[i - 1])) i--;
    while (j < testo.length && lettera(testo[j])) j++;
    if (i === j) return null;
    const da = posDaNodo(c[0], i), a = posDaNodo(c[0], j);
    return da && a ? { da, a } : null;
  }

  // ------------------------------------------------------------ disegno
  function disegna() {
    if (API) {
      for (const k of [...COLORI.map(c => `ev-${c}`), 'ev-nota', 'sel']) CSS.highlights.delete(k);
      const gruppi = {};
      for (const e of evidenze) {
        const r = range(e.da, e.a);
        if (!r) continue;
        (gruppi[`ev-${e.colore}`] ||= []).push(r);
        if (e.nota) (gruppi['ev-nota'] ||= []).push(r.cloneRange());
      }
      for (const [k, rr] of Object.entries(gruppi)) CSS.highlights.set(k, new Highlight(...rr));
      if (sel) { const r = range(sel.da, sel.a); if (r) CSS.highlights.set('sel', new Highlight(r)); }
    } else {
      // Browser vecchi: si colora la frase intera.
      pagina.querySelectorAll('span.s.ev, span.s.scelta').forEach(s => s.classList.remove('ev', 'ev-giallo', 'ev-ciano', 'ev-lilla', 'ev-nota', 'scelta'));
      for (const e of evidenze) for (let s = e.da.s; s <= e.a.s; s++) spans(s).forEach(sp => sp.classList.add('ev', `ev-${e.colore}`, ...(e.nota ? ['ev-nota'] : [])));
      if (sel) for (let s = sel.da.s; s <= sel.a.s; s++) spans(s).forEach(sp => sp.classList.add('scelta'));
    }
    posizionaManiglie();
  }

  function posizionaManiglie() {
    if (!sel) { mInizio.remove(); mFine.remove(); return; }
    const r = range(sel.da, sel.a);
    const rects = r ? [...r.getClientRects()].filter(x => x.width > 0) : [];
    if (!rects.length) { mInizio.remove(); mFine.remove(); return; }
    const base = pagina.getBoundingClientRect();
    const p = rects[0], u = rects[rects.length - 1];
    Object.assign(mInizio.style, { left: `${p.left - base.left}px`, top: `${p.top - base.top}px`, height: `${p.height}px` });
    Object.assign(mFine.style, { left: `${u.right - base.left}px`, top: `${u.top - base.top}px`, height: `${u.height}px` });
    if (!mInizio.isConnected) pagina.append(mInizio, mFine);
  }

  function imposta(nuova) {
    sel = nuova;
    if (sel && confronta(sel.da, sel.a) > 0) [sel.da, sel.a] = [sel.a, sel.da];
    disegna();
    quandoCambia(sel);
  }

  // ------------------------------------------------------------ gesti
  function frase(s) { return { da: { s, off: 0 }, a: { s, off: lunghezza(s) } }; }
  function evidenzaIn(pos) {
    return evidenze.find(e => confronta(e.da, pos) <= 0 && confronta(pos, e.a) <= 0);
  }
  function dentroSel(pos) { return sel && confronta(sel.da, pos) <= 0 && confronta(pos, sel.a) <= 0; }

  let ultimoTocco = null, attesa = null, giu = null, maniglia = false;
  // Pressione lunga: seleziona la parola e, senza staccare il dito, si trascina
  // per allungare. Doppio tocco: la frase. Tocco: i comandi.
  let trascina = null; // { ancora } mentre il dito tiene premuto dopo la pressione lunga
  let lungoTimer = null;
  pagina.addEventListener('pointerdown', e => {
    if (e.target.closest('.maniglia, button')) return;
    giu = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    clearTimeout(lungoTimer);
    lungoTimer = setTimeout(() => {
      if (!giu) return;
      const p = parolaIn(giu.x, giu.y);
      if (!p) return;
      clearTimeout(attesa);
      navigator.vibrate?.(8);
      trascina = { ancora: p.da, fine: p.a };
      imposta(p);
    }, 450);
  });
  pagina.addEventListener('pointermove', e => {
    if (giu && !trascina && Math.hypot(e.clientX - giu.x, e.clientY - giu.y) > 10) clearTimeout(lungoTimer);
    if (!trascina || !sel) return;
    const c = puntoTesto(e.clientX, e.clientY);
    const grezza = c && posDaNodo(c[0], c[1]);
    if (!grezza) return;
    // La selezione va dall'ancora al dito, in avanti o all'indietro.
    if (confronta(grezza, trascina.ancora) >= 0) sel = { da: trascina.ancora, a: aggancia(grezza, 'a') };
    else sel = { da: aggancia(grezza, 'da'), a: trascina.fine };
    disegna();
    const rs = scorri.getBoundingClientRect();
    if (e.clientY > rs.bottom - 90) scorri.scrollBy(0, 12);
    else if (e.clientY < rs.top + 90) scorri.scrollBy(0, -12);
  });
  // Su iPhone serve fermare lo scorrimento della pagina mentre si trascina.
  pagina.addEventListener('touchmove', e => { if (trascina || maniglia) e.preventDefault(); }, { passive: false });
  const fineTrascina = () => { if (trascina) { trascina = null; quandoCambia(sel); } };
  pagina.addEventListener('pointercancel', () => { clearTimeout(lungoTimer); giu = null; fineTrascina(); });
  pagina.addEventListener('pointerup', e => {
    clearTimeout(lungoTimer);
    if (trascina) { giu = null; fineTrascina(); return; }
    if (!giu || e.target.closest('.maniglia, button')) { giu = null; return; }
    const fermo = Math.hypot(e.clientX - giu.x, e.clientY - giu.y) < 10;
    giu = null;
    if (!fermo) return;
    const x = e.clientX, y = e.clientY;
    const doppio = ultimoTocco && Date.now() - ultimoTocco.t < 320 && Math.hypot(x - ultimoTocco.x, y - ultimoTocco.y) < 30;
    ultimoTocco = { x, y, t: Date.now() };
    clearTimeout(attesa);
    if (doppio) { ultimoTocco = null; doppioTocco(x, y); return; }
    attesa = setTimeout(() => { if (sel) imposta(null); else toccoVuoto(); }, 300);
  });
  pagina.addEventListener('contextmenu', e => e.preventDefault());

  // Le maniglie scattano a parole intere: niente parole tagliate a metà.
  function aggancia(pos, lato) {
    const t = [...spans(pos.s)].map(x => x.textContent).join('');
    const lettera = ch => /[\p{L}\p{N}'’-]/u.test(ch || '');
    let i = pos.off;
    if (lato === 'da') { while (i > 0 && lettera(t[i - 1])) i--; while (i < t.length && /\s/.test(t[i])) i++; }
    else { while (i < t.length && lettera(t[i])) i++; }
    return { s: pos.s, off: i };
  }

  function doppioTocco(x, y) {
    const c = puntoTesto(x, y);
    const pos = c && posDaNodo(c[0], c[1]);
    if (!pos) return;
    navigator.vibrate?.(8);
    const ev = evidenzaIn(pos);
    if (ev) { imposta({ da: { ...ev.da }, a: { ...ev.a }, esistente: ev }); return; }
    imposta(frase(pos.s));
  }

  // Maniglie trascinabili.
  for (const [m, lato] of [[mInizio, 'da'], [mFine, 'a']]) {
    let dy = 0;
    m.addEventListener('touchstart', e => { maniglia = true; e.stopPropagation(); }, { passive: true });
    m.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    m.addEventListener('pointerdown', e => {
      maniglia = true;
      e.preventDefault(); e.stopPropagation();
      m.setPointerCapture(e.pointerId);
      const r = m.getBoundingClientRect();
      dy = e.clientY - (r.top + r.height / 2);
      m.classList.add('presa');
    });
    m.addEventListener('pointermove', e => {
      if (!m.hasPointerCapture(e.pointerId) || !sel) return;
      const c = puntoTesto(e.clientX, e.clientY - dy);
      const grezza = c && posDaNodo(c[0], c[1]);
      if (!grezza) return;
      const pos = aggancia(grezza, lato);
      sel = { ...sel, [lato]: pos, esistente: sel.esistente };
      if (confronta(sel.da, sel.a) > 0) return;
      disegna();
      // Vicino ai bordi lo schermo scorre da solo.
      const rs = scorri.getBoundingClientRect();
      if (e.clientY > rs.bottom - 90) scorri.scrollBy(0, 12);
      else if (e.clientY < rs.top + 90) scorri.scrollBy(0, -12);
    });
    const lascia = e => { maniglia = false; m.classList.remove('presa'); if (m.hasPointerCapture?.(e.pointerId)) m.releasePointerCapture(e.pointerId); quandoCambia(sel); };
    m.addEventListener('pointerup', lascia);
    m.addEventListener('pointercancel', lascia);
  }

  return {
    attuale: () => sel,
    pulisci: () => { if (sel) imposta(null); },
    evidenze(lista) { evidenze = lista; disegna(); },
    ridisegna: disegna,
    testo(s = sel) {
      if (!s) return '';
      const r = range(s.da, s.a);
      return r ? r.toString().replace(/\s+/g, ' ').trim() : '';
    },
    frase,
    lunghezza,
  };
}
