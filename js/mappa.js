// Mappa della conoscenza: il telefono manda i testi, Kaggle calcola passaggi,
// echi e temi, il telefono scarica il risultato e lo tiene in locale.
// Tutto parte da solo: dopo un'importazione, all'apertura della libreria e
// della mappa. Nessun modello da allenare.
import { db } from './db.js';
import { frasiDalCapitolo } from './voce.js';
import { gh, lancia, configurato } from './audio.js';

const RAMO = 'mappa';
const ATTESA_IMPORT = 2 * 60000;   // dopo un'importazione si aspetta: più libri, un giro solo
const CHIUSE = ['finito', 'errore', 'da riprendere'];

// ---------------------------------------------------------------- stato locale
async function locale() {
  return (await db.get('mappa', 'stato')) || { inviati: {}, scaricati: {}, versione: 0, lanciato: 0, controllato: 0, remoto: null };
}
async function salvaLocale(st) { await db.put('mappa', st, 'stato'); }

export function segnaImportazione() {
  try { localStorage.setItem('leggio-mappa-import', String(Date.now())); } catch { /* niente */ }
  setTimeout(() => aggiornaMappa().catch(e => console.warn('mappa', e)), ATTESA_IMPORT + 5000);
}
function ultimoImport() {
  try { return +localStorage.getItem('leggio-mappa-import') || 0; } catch { return 0; }
}

// Impronta del contenuto: il testo di un libro importato non cambia.
const firma = l => `${l.frasiTotali}-${l.paroleTotali}`;

// ---------------------------------------------------------------- testi
export async function testoLibro(l) {
  const capitoli = [];
  for (let n = 0; n < l.capitoli.length; n++) {
    const c = await db.get('capitoli', [l.id, n]);
    if (!c) continue;
    const div = document.createElement('div');
    div.innerHTML = c.html;
    const frasi = [];
    for (const f of frasiDalCapitolo(div)) {
      const t = (f.voce || '').replace(/\s+/g, ' ').trim();
      if (!/[\p{L}\p{N}]/u.test(t)) continue;
      frasi.push([f.id, t, f.titolo ? 't' : f.fineBlocco ? 'p' : '']);
    }
    if (frasi.length) capitoli.push({ n, titolo: c.titolo || '', frasi });
  }
  return { id: l.id, titolo: l.titolo, autore: l.autore || '', lingua: l.lingua, capitoli };
}

function base64(testo) {
  const b = new TextEncoder().encode(testo);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

// Un commit sul ramo della mappa, creato da main se non c'è ancora.
async function scriviRamo(file) {
  const ref = await gh(`/git/ref/heads/${RAMO}`, { consenti404: true });
  const padre = ref ? ref.object.sha : (await gh('/git/ref/heads/main')).object.sha;
  const base = await gh(`/git/commits/${padre}`);
  const albero = [];
  for (const f of file) {
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: base64(f.dati), encoding: 'base64' }) });
    albero.push({ path: f.percorso, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree: albero }) });
  const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: 'Mappa: testi dal telefono', tree: tree.sha, parents: [padre] }) });
  if (ref) await gh(`/git/refs/heads/${RAMO}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  else await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${RAMO}`, sha: commit.sha }) });
}

async function invia(st, libri, nuovi, avanzamento) {
  const file = [];
  for (const [i, l] of nuovi.entries()) {
    file.push({ percorso: `mappa/testi/${l.id}.json`, dati: JSON.stringify(await testoLibro(l)) });
    avanzamento && avanzamento((i + 1) / nuovi.length);
  }
  file.push({ percorso: 'lavoro/job.json', dati: JSON.stringify({ id: 'mappa', motore: 'mappa', gpu: true, libri: libri.map(l => l.id) }) });
  const partenza = { fase: 'in partenza', aggiornato: Math.floor(Date.now() / 1000) };
  file.push({ percorso: 'stato.json', dati: JSON.stringify(partenza) });
  await scriviRamo(file);
  await lancia(RAMO);
  for (const l of nuovi) st.inviati[l.id] = firma(l);
  st.libriInviati = libri.map(l => l.id);
  st.lanciato = Date.now();
  st.controllato = Date.now();
  st.remoto = partenza;
  await salvaLocale(st);
}

// ---------------------------------------------------------------- scaricamento
async function scarica(st, versione) {
  const indice = JSON.parse(await gh(`/contents/mappa/uscita/indice.json?ref=${RAMO}`, { raw: true }));
  const temi = JSON.parse(await gh(`/contents/mappa/uscita/temi.json?ref=${RAMO}`, { raw: true }));
  for (const [lid, info] of Object.entries(indice.libri)) {
    if (st.scaricati[lid] === info.impronta) continue;
    const corpo = JSON.parse(await gh(`/contents/mappa/uscita/libri/${lid}.json?ref=${RAMO}`, { raw: true }));
    const e5 = await (await gh(`/contents/mappa/uscita/libri/${lid}.e5?ref=${RAMO}`, { raw: 'blob' })).arrayBuffer();
    await db.put('mappa', { ...corpo, e5 }, `libro:${lid}`);
    st.scaricati[lid] = info.impronta;
  }
  for (const lid of Object.keys(st.scaricati)) {
    if (!indice.libri[lid]) { await db.del('mappa', `libro:${lid}`); delete st.scaricati[lid]; }
  }
  await db.put('mappa', temi, 'temi');
  st.versione = versione;
  st.aggiornata = Date.now();
  await salvaLocale(st);
  _cache = null;
}

// ---------------------------------------------------------------- il giro automatico
let _occupato = null;
let _ultimo = 0;
const ascoltatori = new Set();
export function seguiMappa(fn) { ascoltatori.add(fn); return () => ascoltatori.delete(fn); }

export function aggiornaMappa(opz = {}) {
  if (_occupato) return _occupato;
  if (!opz.forza && Date.now() - _ultimo < 45000) return Promise.resolve(null);
  _ultimo = Date.now();
  _occupato = giro(opz).finally(() => { _occupato = null; });
  return _occupato;
}

async function giro({ forza = false, avanzamento } = {}) {
  if (!(await configurato())) return null;
  const st = await locale();
  const t = await gh(`/contents/stato.json?ref=${RAMO}`, { raw: true, consenti404: true });
  if (t) { try { st.remoto = JSON.parse(t); } catch { /* niente */ } }
  const r = st.remoto || {};
  const eta = r.aggiornato ? Date.now() - r.aggiornato * 1000 : Infinity;
  const attivo = r.fase && !CHIUSE.includes(r.fase) && eta < 8 * 3600000;

  if (r.fase === 'finito' && r.versione && r.versione !== st.versione) await scarica(st, r.versione);

  // Nessuna notizia da tempo: si chiede a Kaggle che fine ha fatto il notebook.
  if (attivo && eta > 25 * 60000 && Date.now() - (st.controllato || 0) > 20 * 60000) {
    st.controllato = Date.now();
    await lancia(RAMO, 'controlla').catch(() => {});
  }

  if (!attivo) {
    const libri = await db.tutti('libri');
    const nuovi = libri.filter(l => st.inviati[l.id] !== firma(l));
    const tolti = (st.libriInviati || []).some(id => !libri.find(l => l.id === id));
    // Dopo un errore si riprova da soli solo a distanza di tempo; GPU occupate da un audio: mezz'ora.
    const fallito = r.fase === 'errore' || r.fase === 'da riprendere';
    const breve = r.fase === 'da riprendere' || /GPU session count/i.test(r.errore || '');
    const pausaErrore = fallito && !forza && Date.now() - (st.lanciato || 0) < (breve ? 30 : 360) * 60000;
    const daPoco = !forza && Date.now() - ultimoImport() < ATTESA_IMPORT;
    if ((nuovi.length || tolti || forza || fallito) && libri.length && !pausaErrore && !daPoco) {
      await invia(st, libri, nuovi, avanzamento);
    }
  }
  await salvaLocale(st);
  ascoltatori.forEach(f => f(st));
  return st;
}

export async function statoMappa() { return locale(); }

// Riprova subito, anche dopo un errore.
export async function ricostruisci(avanzamento) {
  return aggiornaMappa({ forza: true, avanzamento });
}

// ---------------------------------------------------------------- lettura
let _cache = null;
export async function caricaMappa() {
  if (_cache) return _cache;
  const temi = await db.get('mappa', 'temi');
  if (!temi) return null;
  _cache = temi;
  return temi;
}

export async function datiLibro(lid) {
  return db.get('mappa', `libro:${lid}`);
}

// Testo di un passaggio, dalle frasi del capitolo salvato sul telefono.
export async function testoPassaggio(lid, i) {
  const d = await datiLibro(lid);
  const p = d?.passaggi?.[i];
  if (!p) return null;
  const [cap, da, a] = p;
  const c = await db.get('capitoli', [lid, cap]);
  if (!c) return null;
  const div = document.createElement('div');
  div.innerHTML = c.html;
  const frasi = frasiDalCapitolo(div).filter(f => f.id >= da && f.id <= a && !f.titolo);
  return { cap, da, a, testo: frasi.map(f => (f.voce || '').trim()).join(' ').replace(/\s+/g, ' ') };
}

export function descriviStatoMappa(st) {
  const r = st?.remoto || {};
  const quando = r.aggiornato ? Math.round((Date.now() - r.aggiornato * 1000) / 60000) : null;
  const segnale = quando === null ? '' : quando < 1 ? ' Ultimo segnale adesso.' : ` Ultimo segnale ${quando} min fa.`;
  switch (r.fase) {
    case 'in partenza': return 'Testi inviati, Kaggle sta per partire.';
    case 'carico su Kaggle': return 'Preparo il notebook su Kaggle.';
    case 'in coda su Kaggle': return 'In coda su Kaggle, parte appena c’è una GPU libera.' + segnale;
    case 'in corso': return `Kaggle sta leggendo la libreria${r.dettaglio ? ': ' + r.dettaglio : ''}.` + segnale;
    case 'errore': return /GPU session count/i.test(r.errore || '')
      ? 'Kaggle ha già due lavori sulla GPU. Riprovo da solo fra mezz’ora.'
      : `La mappa non si è aggiornata: ${r.errore || 'errore su Kaggle'}`;
    case 'da riprendere': return 'Il notebook si è fermato prima di finire.';
    default: return '';
  }
}
