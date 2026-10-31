// Indice completo dei collegamenti disponibili, costruito dall'archivio locale.
import { db } from './db.js';
import { datiLibro } from './mappa.js';
import { chiaveAutore, stessoAutore, legameValido } from './echi.js';

const posizione = p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isInteger)
  && p[0] >= 0 && p[1] >= 0 && p[2] >= p[1];
const riferimento = (libro, i, p, frasi = null) => ({ libro, passaggio: i, posizione: p.slice(0, 3), frasi });
const chiaveBrano = a => JSON.stringify([a.libro, ...a.posizione]);
export function chiaveCoppia(a, b) { return [chiaveBrano(a), chiaveBrano(b)].sort().join('|'); }

export function indicizzaAutori(elenco, dati, preferenze = []) {
  const libri = Object.fromEntries(elenco.map(l => [l.id, l]));
  const autori = new Map();
  const autoreLibro = new Map();
  for (const l of elenco) {
    const id = chiaveAutore(l.autore) || `senza-autore:${l.id}`;
    if (!autori.has(id)) autori.set(id, { id, nome: l.autore?.trim() || `Autore non indicato · ${l.titolo}`, senzaAutore: !chiaveAutore(l.autore), libri: [], collegamenti: 0 });
    autori.get(id).libri.push(l.id);
    autoreLibro.set(l.id, id);
  }
  const nascosti = new Set(preferenze.filter(p => p.stato === 'nascosto').map(p => p.id));
  const esclusi = new Set(preferenze.filter(p => p.stato === 'nascosto' && p.chiave).map(p => p.chiave));
  const coppie = new Map();
  const base = (lid, i, target, j) => {
    const a = dati[lid], b = dati[target];
    const p = a?.passaggi?.[i], q = b?.passaggi?.[j];
    if (!libri[lid] || !libri[target] || lid === target || stessoAutore(libri[lid].autore, libri[target].autore)
      || !posizione(p) || !posizione(q) || p[4] === -1 || q[4] === -1 || a.versione !== b.versione) return null;
    return [riferimento(lid, i, p), riferimento(target, j, q)];
  };
  // Le coppie già respinte non devono riapparire come affinità automatiche.
  for (const [lid, d] of Object.entries(dati)) for (const [i, riga] of (d?.esclusi || []).entries()) {
    for (const [target, j] of riga || []) {
      const ab = base(lid, i, target, j);
      if (ab) esclusi.add(chiaveCoppia(...ab));
    }
  }
  for (const [lid, d] of Object.entries(dati)) for (const [i, riga] of (d?.legami || []).entries()) {
    for (const r of riga || []) {
      const ab = base(lid, i, r.libro, r.passaggio);
      if (!ab || !legameValido(r, d, dati[r.libro], libri[lid], libri[r.libro], i)) continue;
      const chiave = chiaveCoppia(...ab);
      if (nascosti.has(r.id)) { esclusi.add(chiave); continue; }
      ab[0].frasi = r.frasiOrigine; ab[1].frasi = r.frasiDestinazione;
      const inverso = chiaveBrano(ab[0]) > chiaveBrano(ab[1]);
      coppie.set(chiave, { id: r.id, chiave, a: ab[inverso ? 1 : 0], b: ab[inverso ? 0 : 1],
        verificato: true, relazione: r.relazione, idea: inverso ? r.ideaDestinazione : r.idea,
        spiegazione: r.spiegazione, versione: d.versione });
    }
  }
  for (const [lid, d] of Object.entries(dati)) for (const [i, riga] of (d?.echi || []).entries()) {
    for (const r of riga || []) {
      if (!Array.isArray(r) || !Number.isInteger(r[1]) || !Number.isFinite(r[2]) || r[2] <= 0) continue;
      const ab = base(lid, i, r[0], r[1]);
      if (!ab) continue;
      const chiave = chiaveCoppia(...ab), id = 'affinita:' + chiave;
      if (coppie.has(chiave) || esclusi.has(chiave) || nascosti.has(id)) continue;
      const inverso = chiaveBrano(ab[0]) > chiaveBrano(ab[1]);
      coppie.set(chiave, { id, chiave, a: ab[inverso ? 1 : 0], b: ab[inverso ? 0 : 1],
        verificato: false, relazione: 'affinita', versione: d.versione });
    }
  }
  const archi = new Map();
  for (const c of coppie.values()) {
    if (esclusi.has(c.chiave)) continue;
    const ids = [autoreLibro.get(c.a.libro), autoreLibro.get(c.b.libro)].sort();
    const id = JSON.stringify(ids);
    if (!archi.has(id)) archi.set(id, { id, a: ids[0], b: ids[1], confronti: [], verificati: 0, affinita: 0 });
    const arco = archi.get(id);
    arco.confronti.push(c);
    c.verificato ? arco.verificati++ : arco.affinita++;
  }
  for (const arco of archi.values()) {
    arco.confronti.sort((a, b) => Number(b.verificato) - Number(a.verificato)
      || (libri[a.a.libro]?.titolo || '').localeCompare(libri[b.a.libro]?.titolo || '', 'it')
      || a.a.posizione[0] - b.a.posizione[0] || a.a.posizione[1] - b.a.posizione[1]);
    autori.get(arco.a).collegamenti += arco.confronti.length;
    autori.get(arco.b).collegamenti += arco.confronti.length;
  }
  const listaArchi = [...archi.values()].sort((a, b) => autori.get(a.a).nome.localeCompare(autori.get(b.a).nome, 'it')
    || autori.get(a.b).nome.localeCompare(autori.get(b.b).nome, 'it'));
  return { autori: [...autori.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'it')), archi: listaArchi,
    libri, totale: listaArchi.reduce((n, a) => n + a.confronti.length, 0),
    verificati: listaArchi.reduce((n, a) => n + a.verificati, 0),
    affinita: listaArchi.reduce((n, a) => n + a.affinita, 0),
    senzaAutore: [...autori.values()].filter(a => a.senzaAutore).length };
}

export async function caricaAutori(elenco = null) {
  elenco ||= await db.tutti('libri');
  const [righe, preferenze] = await Promise.all([
    Promise.all(elenco.map(async l => [l.id, await datiLibro(l.id)])), db.tutti('confronti')]);
  return indicizzaAutori(elenco, Object.fromEntries(righe), preferenze);
}

export function descriviArco(arco) {
  return [arco.verificati ? `${arco.verificati} ${arco.verificati === 1 ? 'confronto' : 'confronti'}` : '',
    arco.affinita ? `${arco.affinita} ${arco.affinita === 1 ? 'affinità automatica' : 'affinità automatiche'}` : ''].filter(Boolean).join(' · ');
}
