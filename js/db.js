// Archivio locale su IndexedDB. Tutto resta sul dispositivo.

const NOME = 'leggio';
const VERSIONE = 2;
let _db = null;

function apri() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, ko) => {
    const req = indexedDB.open(NOME, VERSIONE);
    req.onupgradeneeded = e => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('libri', { keyPath: 'id' });
        db.createObjectStore('capitoli', { keyPath: ['libro', 'n'] });
        db.createObjectStore('risorse', { keyPath: ['libro', 'percorso'] });
        db.createObjectStore('originali', { keyPath: 'libro' });
        const ev = db.createObjectStore('evidenziati', { keyPath: 'id' });
        ev.createIndex('libro', 'libro');
        db.createObjectStore('impostazioni');
        db.createObjectStore('diario');
      }
      if (e.oldVersion < 2) {
        // Audio generato: un capitolo per riga, i lavori in corso, le voci registrate.
        db.createObjectStore('audio', { keyPath: ['libro', 'n'] });
        db.createObjectStore('lavori', { keyPath: 'id' });
        db.createObjectStore('voci', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { _db = req.result; _db.onversionchange = () => { _db.close(); _db = null; }; ok(_db); };
    req.onerror = () => ko(req.error);
  });
}

function rich(r) {
  return new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}

async function tx(negozi, modo, fn) {
  const db = await apri();
  return new Promise((ok, ko) => {
    const t = modo === 'readwrite' ? db.transaction(negozi, modo, { durability: 'strict' }) : db.transaction(negozi, modo);
    let ris;
    Promise.resolve(fn(t)).then(v => { ris = v; }, ko);
    t.oncomplete = () => ok(ris);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error);
  });
}

// Alcuni browser per iPhone (DuckDuckGo e altri costruiti su WKWebView) non
// riescono a salvare i Blob in IndexedDB. Si salvano i byte col loro tipo e il
// Blob si ricostruisce in lettura. I Blob salvati prima restano leggibili.
async function aBytes(v) {
  if (v instanceof Blob) return { __blob: await v.arrayBuffer(), tipo: v.type };
  if (Array.isArray(v)) return Promise.all(v.map(aBytes));
  if (v && typeof v === 'object' && !(v instanceof ArrayBuffer) && !ArrayBuffer.isView(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = await aBytes(x);
    return o;
  }
  return v;
}
function daBytes(v) {
  if (!v || typeof v !== 'object') return v;
  if (v.__blob instanceof ArrayBuffer) return new Blob([v.__blob], { type: v.tipo || '' });
  if (Array.isArray(v)) return v.map(daBytes);
  if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = daBytes(x);
  return o;
}

// Se il browser ha cancellato i file legati a un record (copertine, audio,
// originali), quel record non si legge più e fa fallire la lettura in blocco.
// Allora si legge un record alla volta, si saltano quelli rotti e li si annota.
export const rotti = {};
async function leggiTutti(negozio, range, indice) {
  const sorgente = t => indice ? t.objectStore(negozio).index(indice) : t.objectStore(negozio);
  try {
    return daBytes(await tx([negozio], 'readonly', t => rich(sorgente(t).getAll(range))));
  } catch (e) {
    console.warn('lettura in blocco fallita, provo uno per uno:', negozio, e);
    const chiavi = await tx([negozio], 'readonly', t => rich(sorgente(t).getAllKeys(range)));
    const out = [];
    for (const k of chiavi) {
      try { out.push(daBytes(await tx([negozio], 'readonly', t => rich(t.objectStore(negozio).get(k))))); }
      catch { (rotti[negozio] ||= new Set()).add(JSON.stringify(k)); }
    }
    return out;
  }
}

export const db = {
  async get(negozio, chiave) {
    try {
      return daBytes(await tx([negozio], 'readonly', t => rich(t.objectStore(negozio).get(chiave))));
    } catch (e) {
      (rotti[negozio] ||= new Set()).add(JSON.stringify(chiave));
      console.warn('record illeggibile', negozio, chiave, e);
      return undefined;
    }
  },
  async put(negozio, valore, chiave) {
    valore = await aBytes(valore);
    return tx([negozio], 'readwrite', t => rich(chiave === undefined
      ? t.objectStore(negozio).put(valore)
      : t.objectStore(negozio).put(valore, chiave)));
  },
  async del(negozio, chiave) {
    return tx([negozio], 'readwrite', t => rich(t.objectStore(negozio).delete(chiave)));
  },
  async tutti(negozio) {
    return leggiTutti(negozio);
  },
  async coppie(negozio) {
    const chiavi = await tx([negozio], 'readonly', t => rich(t.objectStore(negozio).getAllKeys()));
    const out = [];
    for (const k of chiavi) { const v = await this.get(negozio, k); if (v !== undefined) out.push([k, v]); }
    return out;
  },
  async perIndice(negozio, indice, valore) {
    return leggiTutti(negozio, valore, indice);
  },
  async capitoli(libro) {
    return leggiTutti('capitoli', IDBKeyRange.bound([libro, 0], [libro, Infinity]));
  },

  // Salva un libro appena importato in una sola transazione.
  async salvaLibro(libro, capitoli, risorse, originale) {
    libro = await aBytes(libro);
    risorse = await aBytes(risorse);
    originale = originale && await aBytes(originale);
    return tx(['libri', 'capitoli', 'risorse', 'originali'], 'readwrite', t => {
      t.objectStore('libri').put(libro);
      capitoli.forEach(c => t.objectStore('capitoli').put({ ...c, libro: libro.id }));
      risorse.forEach(r => t.objectStore('risorse').put({ ...r, libro: libro.id }));
      if (originale) t.objectStore('originali').put({ libro: libro.id, ...originale });
    });
  },

  async eliminaLibro(id) {
    const ev = await this.perIndice('evidenziati', 'libro', id);
    return tx(['libri', 'capitoli', 'risorse', 'originali', 'evidenziati', 'audio'], 'readwrite', t => {
      t.objectStore('audio').delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
      t.objectStore('libri').delete(id);
      t.objectStore('capitoli').delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
      t.objectStore('risorse').delete(IDBKeyRange.bound([id, ''], [id, '￿']));
      t.objectStore('originali').delete(id);
      ev.forEach(e => t.objectStore('evidenziati').delete(e.id));
    });
  },

  async audioLibro(libro) {
    const r = IDBKeyRange.bound([libro, 0], [libro, Infinity]);
    return leggiTutti('audio', r);
  },
  async cancellaAudio(libro) {
    return tx(['audio'], 'readwrite', t => rich(t.objectStore('audio').delete(IDBKeyRange.bound([libro, 0], [libro, Infinity]))));
  },

  // Passa tutto l'archivio, poi toglie i record che non si leggono più.
  async ripara() {
    for (const n of ['libri', 'capitoli', 'risorse', 'originali', 'evidenziati', 'impostazioni', 'diario', 'audio', 'lavori', 'voci']) await leggiTutti(n);
    let tolti = 0;
    for (const [n, chiavi] of Object.entries(rotti)) {
      for (const k of chiavi) { try { await this.del(n, JSON.parse(k)); tolti++; } catch (e) { console.warn(e); } }
      delete rotti[n];
    }
    // Capitoli e file di libri che non esistono più.
    const libri = new Set((await leggiTutti('libri')).map(l => l.id));
    for (const n of ['capitoli', 'risorse', 'originali', 'audio']) {
      const chiavi = await tx([n], 'readonly', t => rich(t.objectStore(n).getAllKeys()));
      for (const k of chiavi) { const l = Array.isArray(k) ? k[0] : k; if (!libri.has(l)) { await this.del(n, k); tolti++; } }
    }
    return tolti;
  },
  numeroRotti() { return Object.values(rotti).reduce((s, x) => s + x.size, 0); },

  async risorsa(libro, percorso) {
    return this.get('risorse', [libro, percorso]);
  },
};

// Impostazioni con valori di partenza.
const PREDEFINITE = {
  tema: 'carta',
  carattere: 'literata',
  corpo: 19,
  interlinea: 1.6,
  margini: 22,
  giustifica: true,
  velocita: 1,
  voce_it: '',
  voce_en: '',
  pausaParagrafo: 350,
  pausaScena: 1100,
  dialoghiVivaci: true,
  segui: true,
  obiettivo: 20,
};

let _cache = null;
export async function impostazioni() {
  if (_cache) return _cache;
  const salvate = (await db.get('impostazioni', 'generali')) || {};
  _cache = { ...PREDEFINITE, ...salvate };
  // Dal 15/10/2026 il testo è giustificato per tutti, anche per chi aveva l'impostazione vecchia.
  if (!_cache.giustificaV2) { _cache.giustifica = true; _cache.giustificaV2 = true; db.put('impostazioni', { ..._cache }, 'generali'); }
  return _cache;
}
export async function salvaImpostazioni(parz) {
  const att = await impostazioni();
  Object.assign(att, parz);
  await db.put('impostazioni', { ...att }, 'generali');
  return att;
}

// Dizionario di pronuncia: regole che l'app impara dalle correzioni.
export async function dizionario() {
  return (await db.get('impostazioni', 'dizionario')) || [];
}
export async function salvaDizionario(regole) {
  await db.put('impostazioni', regole, 'dizionario');
}

// Diario dei minuti di lettura e ascolto, per giorno.
export function oggi() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export async function aggiungiTempo(secondi) {
  if (secondi <= 0) return;
  const k = oggi();
  const v = (await db.get('diario', k)) || 0;
  await db.put('diario', v + secondi, k);
}
export async function tempoOggi() {
  return (await db.get('diario', oggi())) || 0;
}

export async function chiediPersistenza() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* niente */ }
  return false;
}

export function nuovoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
