// L'ascolto che continua fuori dal lettore. Quando si esce da un libro mentre
// la voce va, i due motori passano qui: i capitoli avanzano da soli, la
// posizione si salva e la libreria mostra la mini-barra. Rientrando nel libro,
// il lettore se li riprende senza interrompere l'audio.
import { db } from './db.js';
import { frasiDalCapitolo } from './voce.js';

const s = { libro: null, cap: 0, frase: 0, lettore: null, sintesi: null, registrato: null };
const ascoltatori = new Set();

export function seguiAscolto(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }
function avvisa() { const x = stato(); ascoltatori.forEach(f => f(x)); }

export function stato() {
  if (!s.libro) return null;
  return { libro: s.libro.id, titolo: s.libro.titolo, capitolo: s.libro.capitoli[s.cap]?.titolo || '', attivo: !!s.lettore?.attivo, copertina: s.libro.copertina };
}

export function inCorsoPer(id) { return s.libro && s.libro.id === id; }

let tSalva = null;
function salva() {
  const l = s.libro;
  if (!l) return;
  l.posizione = { cap: s.cap, frase: s.frase, t: Date.now() };
  try { localStorage.setItem(`leggio-pos-${l.id}`, JSON.stringify(l.posizione)); } catch { /* niente */ }
  clearTimeout(tSalva);
  tSalva = setTimeout(() => db.put('libri', l), 1500);
}

function comandiBlocco() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ms.metadata = new MediaMetadata({ title: s.libro.capitoli[s.cap]?.titolo || '', artist: s.libro.titolo, album: s.libro.autore || '' });
  ms.setActionHandler('play', () => alterna());
  ms.setActionHandler('pause', () => alterna());
  ms.setActionHandler('nexttrack', () => capitolo(1));
  ms.setActionHandler('previoustrack', () => capitolo(-1));
  try {
    ms.setActionHandler('seekforward', () => s.lettore === s.registrato ? s.registrato.salta(15) : s.lettore.avanti());
    ms.setActionHandler('seekbackward', () => s.lettore === s.registrato ? s.registrato.salta(-15) : s.lettore.indietro());
  } catch { /* non tutti li hanno */ }
}

// Il lettore consegna i motori mentre stanno suonando.
export function prendi({ libro, cap, frase, lettore, sintesi, registrato }) {
  Object.assign(s, { libro, cap, frase, lettore, sintesi, registrato });
  for (const m of [sintesi, registrato]) {
    m.onFrase = f => { if (f) { s.frase = f.id; salva(); } };
    m.onStato = () => avvisa();
    m.onFine = () => capitolo(1, true);
  }
  comandiBlocco();
  avvisa();
}

// Il lettore se li riprende: da qui in poi pensa lui ai comandi.
export function restituisci() {
  const x = { ...s };
  s.libro = null;
  clearTimeout(tSalva);
  avvisa();
  return x;
}

async function carica(n) {
  const l = s.libro;
  const c = await db.get('capitoli', [l.id, n]);
  if (!c) return false;
  const div = document.createElement('div');
  div.innerHTML = c.html;
  const frasi = frasiDalCapitolo(div);
  s.cap = n; s.frase = frasi[0]?.id || 0;
  s.sintesi.imposta(frasi);
  s.registrato.imposta(frasi);
  const reg = await db.get('audio', [l.id, n]);
  if (reg) { s.registrato.carica(reg); s.lettore = s.registrato; }
  else s.lettore = s.sintesi;
  return true;
}

export async function capitolo(passo, daSolo = false) {
  const l = s.libro;
  if (!l) return;
  const n = s.cap + passo;
  if (n >= l.capitoli.length && daSolo) { await libroSuccessivo(); return; }
  if (n < 0 || n >= l.capitoli.length) { if (daSolo) ferma(); return; }
  const suonava = daSolo || s.lettore?.attivo;
  s.lettore?.pausa();
  if (!(await carica(n))) return;
  salva();
  comandiBlocco();
  // A schermo spento si può proseguire solo con l'audio creato.
  if (suonava && (s.lettore === s.registrato || document.visibilityState === 'visible')) {
    const r = s.lettore.play(0);
    if (r && r.catch) r.catch(() => avvisa());
  }
  avvisa();
}

export function alterna() {
  if (!s.lettore) return;
  if (s.lettore.attivo) s.lettore.pausa();
  else { const r = s.lettore.play(); if (r && r.catch) r.catch(() => {}); }
  avvisa();
}

export function ferma() {
  if (!s.libro) return;
  s.lettore?.pausa();
  db.put('libri', s.libro);
  s.libro = null;
  avvisa();
}

// ---------------------------------------------------------------- coda di ascolto
function leggiCoda() { try { return JSON.parse(localStorage.getItem('leggio-coda') || '[]'); } catch { return []; } }
function scriviCoda(c) { try { localStorage.setItem('leggio-coda', JSON.stringify(c)); } catch { /* niente */ } }
export function coda() { return leggiCoda(); }
export function inCoda(id) { return leggiCoda().includes(id); }
export function aggiungiCoda(id) { const c = leggiCoda().filter(x => x !== id); c.push(id); scriviCoda(c); }
export function togliCoda(id) { scriviCoda(leggiCoda().filter(x => x !== id)); }

// Libro finito: esce dalla coda e si restituisce il prossimo.
export async function prossimoInCoda(finito) {
  const c = leggiCoda().filter(x => x !== finito);
  scriviCoda(c);
  for (const id of c) { const l = await db.get('libri', id); if (l) return l; }
  return null;
}

// In sottofondo: finito un libro si apre il prossimo della coda dove era rimasto.
async function libroSuccessivo() {
  const finito = s.libro;
  finito.stato = 'finito'; finito.finito = Date.now();
  await db.put('libri', finito);
  const dopo = await prossimoInCoda(finito.id);
  if (!dopo) { ferma(); return; }
  s.libro = dopo;
  const n = dopo.posizione?.cap || 0;
  if (!(await carica(n))) { ferma(); return; }
  salva();
  comandiBlocco();
  if (s.lettore === s.registrato || document.visibilityState === 'visible') {
    const r = s.lettore.play(0);
    if (r && r.catch) r.catch(() => avvisa());
  }
  avvisa();
}
