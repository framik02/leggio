// Copia completa di Leggio in un file .zip, da salvare nell'app File, e ripristino.
// Ogni archivio diventa un JSON; i file (libri, copertine, voci, audio) restano
// file veri dentro lo zip, senza ricompressione.
import { db, salvaImpostazioni, impostazioni } from './db.js';

const ARCHIVI = ['libri', 'capitoli', 'risorse', 'originali', 'evidenziati', 'impostazioni', 'diario', 'voci', 'audio'];
const SENZA_CHIAVE = new Set(['impostazioni', 'diario']);

export async function dimensioni() {
  const misura = async n => (await db.tutti(n)).reduce((s, r) => s + pesa(r), 0);
  return { audio: await misura('audio'), voci: await misura('voci'), libri: await misura('originali') + await misura('risorse') + await misura('libri') };
}
function pesa(v) {
  if (v instanceof Blob) return v.size;
  if (Array.isArray(v)) return v.reduce((s, x) => s + pesa(x), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce((s, x) => s + pesa(x), 0);
  return 0;
}

export async function creaCopia({ conAudio }, avanzamento) {
  const zip = new window.JSZip();
  let n = 0;
  // Sostituisce ogni Blob con un riferimento a un file dello zip.
  const appiattisci = v => {
    if (v instanceof Blob) {
      const nome = `file/${n++}`;
      zip.file(nome, v, { compression: 'STORE', binary: true });
      return { __file: nome, tipo: v.type };
    }
    if (Array.isArray(v)) return v.map(appiattisci);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, appiattisci(x)]));
    return v;
  };
  const elenco = ARCHIVI.filter(a => conAudio || a !== 'audio');
  for (const [i, a] of elenco.entries()) {
    let righe = SENZA_CHIAVE.has(a) ? await db.coppie(a) : await db.tutti(a);
    if (a === 'impostazioni') righe = righe.map(([k, v]) => [k, k === 'generali' ? { ...v, githubToken: '' } : v]);
    zip.file(`archivi/${a}.json`, JSON.stringify(appiattisci(righe)));
    avanzamento && avanzamento(0.4 * (i + 1) / elenco.length);
  }
  zip.file('leggio.json', JSON.stringify({ app: 'leggio', versione: 1, data: new Date().toISOString(), archivi: elenco }));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } }, m => avanzamento && avanzamento(0.4 + 0.6 * m.percent / 100));
  await salvaImpostazioni({ ultimaCopia: Date.now() });
  const d = new Date();
  const nome = `leggio-copia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
  return new File([blob], nome, { type: 'application/zip' });
}

// Rimette tutto com'era. I record con la stessa chiave vengono sovrascritti,
// il resto di quello che c'è già sul telefono resta.
export async function ripristina(file, avanzamento) {
  const zip = await window.JSZip.loadAsync(file);
  const intestazione = zip.file('leggio.json');
  if (!intestazione) throw new Error('Questo file non è una copia di Leggio.');
  const info = JSON.parse(await intestazione.async('string'));
  const tokenAttuale = (await impostazioni()).githubToken || '';
  const ricostruisci = async v => {
    if (v && typeof v === 'object' && v.__file) {
      const f = zip.file(v.__file);
      return f ? new Blob([await f.async('arraybuffer')], { type: v.tipo || '' }) : null;
    }
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await ricostruisci(x)); return out; }
    if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await ricostruisci(x); return out; }
    return v;
  };
  let libri = 0;
  for (const [i, a] of info.archivi.entries()) {
    const f = zip.file(`archivi/${a}.json`);
    if (!f) continue;
    const righe = JSON.parse(await f.async('string'));
    for (const r of righe) {
      const v = await ricostruisci(r);
      if (SENZA_CHIAVE.has(a)) {
        let [k, val] = v;
        if (a === 'impostazioni' && k === 'generali') val = { ...val, githubToken: val.githubToken || tokenAttuale };
        await db.put(a, val, k);
      } else {
        await db.put(a, v);
        if (a === 'libri') libri++;
      }
    }
    avanzamento && avanzamento((i + 1) / info.archivi.length);
  }
  return { libri, data: info.data };
}
