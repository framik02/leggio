// PDF con livello di testo. Il testo viene ricomposto in paragrafi scorrevoli.
import { capitoliDaParagrafi, indovinaLingua } from './comune.js';

let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import('../../vendor/pdf.min.mjs');
  _pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return _pdfjs;
}

// Righe di una pagina: raggruppa i frammenti per altezza.
function righe(items) {
  const r = [];
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || it.height || 10;
    let riga = r.find(q => Math.abs(q.y - y) < h * 0.5);
    if (!riga) { riga = { y, x, h, pezzi: [] }; r.push(riga); }
    riga.pezzi.push({ x, s: it.str, w: it.width });
    riga.x = Math.min(riga.x, x);
    riga.h = Math.max(riga.h, h);
  }
  r.sort((a, b) => b.y - a.y);
  for (const riga of r) {
    riga.pezzi.sort((a, b) => a.x - b.x);
    let t = '', fine = null;
    for (const p of riga.pezzi) {
      if (fine !== null && p.x - fine > 1.5 && !t.endsWith(' ') && !p.s.startsWith(' ')) t += ' ';
      t += p.s; fine = p.x + (p.w || 0);
    }
    // Titoli con le lettere spaziate: «I L  Q U A D R O» diventa «IL QUADRO».
    const gettoni = t.trim().split(' ').filter(Boolean);
    if (gettoni.length > 4 && gettoni.filter(g => g.length === 1).length / gettoni.length > 0.7) {
      t = t.trim().split(/\s{2,}/).map(w => w.replace(/\s/g, '')).join(' ');
    }
    riga.t = t.replace(/\s+/g, ' ').trim();
  }
  return r.filter(q => q.t);
}

export async function importaPdf(file, avanzamento) {
  const lib = await pdfjs();
  const dati = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({ data: dati, isEvalSupported: false }).promise;
  const info = (await pdf.getMetadata().catch(() => null))?.info || {};
  const n = pdf.numPages;

  const pagine = [];
  let caratteri = 0;
  for (let i = 1; i <= n; i++) {
    const p = await pdf.getPage(i);
    const tc = await p.getTextContent();
    const rr = righe(tc.items);
    caratteri += rr.reduce((s, q) => s + q.t.length, 0);
    pagine.push(rr);
    p.cleanup();
    avanzamento && avanzamento(i / n * 0.9);
  }
  if (caratteri < n * 40) throw new Error('Il PDF sembra una scansione senza testo. Serve prima un riconoscimento del testo (OCR) sul computer.');

  // Intestazioni e piè di pagina ripetuti: righe uguali (numeri a parte) su molte pagine.
  const norm = t => t.replace(/\d+/g, '#').toLowerCase();
  const conta = {};
  for (const rr of pagine) {
    const bordi = new Set([...rr.slice(0, 2), ...rr.slice(-2)].map(q => norm(q.t)));
    bordi.forEach(k => { conta[k] = (conta[k] || 0) + 1; });
  }
  const soglia = Math.max(3, n * 0.3);
  const ripetute = new Set(Object.keys(conta).filter(k => conta[k] >= soglia));

  // Corpo del testo: altezza più frequente.
  const altezze = {};
  pagine.flat().forEach(q => { const h = Math.round(q.h); altezze[h] = (altezze[h] || 0) + q.t.length; });
  const hCorpo = +Object.entries(altezze).sort((a, b) => b[1] - a[1])[0][0];

  // Inizio delle pagine dei capitoli dall'indice del PDF, se c'è.
  const segnaPagina = {};
  try {
    const outline = await pdf.getOutline();
    if (outline) for (const o of outline) {
      let dest = o.dest;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (dest && dest[0]) {
        const idx = await pdf.getPageIndex(dest[0]);
        if (!(idx in segnaPagina)) segnaPagina[idx] = o.title.trim();
      }
    }
  } catch { /* nessun indice */ }

  const paragrafi = [];
  let att = '';
  const chiudi = () => { if (att.trim()) paragrafi.push({ testo: att.trim() }); att = ''; };
  pagine.forEach((rr, pi) => {
    if (segnaPagina[pi]) { chiudi(); paragrafi.push({ testo: segnaPagina[pi], titolo: true }); }
    const corpo = rr.filter((q, k) => !((k < 2 || k >= rr.length - 2) && (ripetute.has(norm(q.t)) || /^\d{1,3}$/.test(q.t))));
    const xMin = Math.min(...corpo.map(q => q.x));
    let yPrec = null;
    for (const q of corpo) {
      const grande = q.h > hCorpo * 1.3 && q.t.length < 100 && (q.t.match(/\p{L}/gu) || []).length >= 3;
      const salto = yPrec !== null && (yPrec - q.y) > q.h * 1.8;
      const rientro = q.x - xMin > hCorpo * 0.8;
      if (grande) {
        chiudi();
        if (!segnaPagina[pi] || segnaPagina[pi] !== q.t) paragrafi.push({ testo: q.t, titolo: true });
        yPrec = q.y; continue;
      }
      if (salto || (rientro && /[.!?»”"]$/.test(att.trim()))) chiudi();
      if (att.endsWith('-') && /^\p{Ll}/u.test(q.t)) att = att.slice(0, -1) + q.t;
      else att += (att ? ' ' : '') + q.t;
      yPrec = q.y;
    }
    // Il paragrafo continua sulla pagina dopo se non finisce con un punto.
    if (/[.!?»”"]$/.test(att.trim())) chiudi();
  });
  chiudi();

  // Titoli consecutivi uniti in uno solo.
  const puliti = [];
  for (const p of paragrafi) {
    const prec = puliti[puliti.length - 1];
    if (p.titolo && prec && prec.titolo) { prec.testo += ' · ' + p.testo; continue; }
    puliti.push(p);
  }

  const lingua = indovinaLingua(puliti.slice(0, 200).map(p => p.testo).join(' '), info.Language);
  const capitoli = capitoliDaParagrafi(puliti, lingua);

  // Copertina: prima pagina in miniatura.
  let copertina = null;
  try {
    const p1 = await pdf.getPage(1);
    const vp0 = p1.getViewport({ scale: 1 });
    const vp = p1.getViewport({ scale: 360 / vp0.width });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await p1.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    copertina = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
  } catch { /* niente copertina */ }
  avanzamento && avanzamento(1);
  await pdf.destroy();

  const titolo = (info.Title && info.Title.length > 2 && !/^untitled|microsoft word/i.test(info.Title)) ? info.Title : file.name.replace(/\.[^.]+$/, '');
  return { titolo, autore: info.Author || '', lingua, copertina, capitoli, risorse: [] };
}
