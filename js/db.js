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

export const db = {
  async get(negozio, chiave) {
    return tx([negozio], 'readonly', t => rich(t.objectStore(negozio).get(chiave)));
  },
  async put(negozio, valore, chiave) {
    return tx([negozio], 'readwrite', t => rich(chiave === undefined
      ? t.objectStore(negozio).put(valore)
      : t.objectStore(negozio).put(valore, chiave)));
  },
  async del(negozio, chiave) {
    return tx([negozio], 'readwrite', t => rich(t.objectStore(negozio).delete(chiave)));
  },
  async tutti(negozio) {
    return tx([negozio], 'readonly', t => rich(t.objectStore(negozio).getAll()));
  },
  async coppie(negozio) {
    return tx([negozio], 'readonly', async t => {
      const s = t.objectStore(negozio);
      const [k, v] = await Promise.all([rich(s.getAllKeys()), rich(s.getAll())]);
      return k.map((x, i) => [x, v[i]]);
    });
  },
  async perIndice(negozio, indice, valore) {
    return tx([negozio], 'readonly', t => rich(t.objectStore(negozio).index(indice).getAll(valore)));
  },
  async capitoli(libro) {
    const r = IDBKeyRange.bound([libro, 0], [libro, Infinity]);
    return tx(['capitoli'], 'readonly', t => rich(t.objectStore('capitoli').getAll(r)));
  },

  // Salva un libro appena importato in una sola transazione.
  async salvaLibro(libro, capitoli, risorse, originale) {
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
    return tx(['audio'], 'readonly', t => rich(t.objectStore('audio').getAll(r)));
  },
  async cancellaAudio(libro) {
    return tx(['audio'], 'readwrite', t => rich(t.objectStore('audio').delete(IDBKeyRange.bound([libro, 0], [libro, Infinity]))));
  },

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
  giustifica: false,
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
