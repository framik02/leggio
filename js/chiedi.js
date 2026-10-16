// Chiedi alla libreria: ricerca per significato fra i passaggi di tutti i libri.
// La domanda diventa un vettore sul telefono con multilingual-e5-small (lo stesso
// modello con cui Kaggle ha indicizzato i passaggi), poi si confronta con i
// vettori int8 scaricati insieme alla mappa. Funziona anche fra italiano e
// inglese. Se il modello non c'è, si cerca per parole.
import { h, icona, avviso, foglio } from './ui.js';
import { db } from './db.js';
import { frasiDalCapitolo } from './voce.js';
import { caricaMappa, statoMappa, aggiornaMappa } from './mappa.js';

const MODELLO = 'Xenova/multilingual-e5-small';
const LIBRERIA = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const DIM = 384;
const MB = 118;
const COLORI = ['#2F5D8A', '#C9952E', '#7A4E7E', '#2A8F9E', '#8A6247', '#5560A8', '#B9A27A', '#56656F'];

// ---------------------------------------------------------------- modello
let _pipe = null, _caricando = null;
export function modelloScaricato() { try { return localStorage.getItem('leggio-e5') === '1'; } catch { return false; } }

export function caricaModello(progresso) {
  if (_pipe) return Promise.resolve(_pipe);
  if (_caricando) return _caricando;
  _caricando = (async () => {
    const { pipeline, env } = await import(LIBRERIA);
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;  // GitHub Pages non permette i thread condivisi
    const file = {};
    const p = await pipeline('feature-extraction', MODELLO, {
      dtype: 'q8', device: 'wasm',
      progress_callback: x => {
        if (x.status !== 'progress' || !x.total) return;
        file[x.file] = [x.loaded, x.total];
        const [l, t] = Object.values(file).reduce((a, [c, d]) => [a[0] + c, a[1] + d], [0, 0]);
        progresso && progresso(l / t);
      },
    });
    try { localStorage.setItem('leggio-e5', '1'); } catch { /* niente */ }
    _pipe = p;
    return p;
  })().finally(() => { _caricando = null; });
  return _caricando;
}

async function vettori(testi, prefisso) {
  const p = await caricaModello();
  const t = await p(testi.map(x => prefisso + x), { pooling: 'mean', normalize: true });
  const out = [];
  for (let i = 0; i < testi.length; i++) out.push(t.data.subarray(i * DIM, (i + 1) * DIM));
  return out;
}

// ---------------------------------------------------------------- indice
let _indice = null;
async function indice() {
  const temi = await caricaMappa();
  if (!temi) return null;
  if (_indice && _indice.versione === temi.versione) return _indice;
  const libri = [];
  for (const lid of Object.keys(temi.libri)) {
    const d = await db.get('mappa', `libro:${lid}`);
    if (!d?.passaggi || !d.e5) continue;
    libri.push({ lid, passaggi: d.passaggi, v: new Int8Array(d.e5) });
  }
  _indice = { versione: temi.versione, libri, temi };
  return _indice;
}

const VUOTE = new Set('alla alle allo agli dalla dalle dello degli della delle nella nelle sulla sulle come cosa cose dice dicono sono questo questa quello quella quali quale perché anche molto tutti tutto loro della dove quando what does about with from that this they their there have which into whose when'.split(' '));
function parole(testo) {
  return [...new Set((testo.toLowerCase().match(/[\p{L}]{4,}/gu) || []).filter(w => !VUOTE.has(w)))];
}
// radice grossolana: «paura» trova anche «paure», «memoria» anche «memorie»
const tronca = w => w.length > 5 ? w.slice(0, w.length - 2) : w;

// Testi di più passaggi dello stesso libro, leggendo ogni capitolo una volta sola.
async function testi(lid, indici, passaggi) {
  const perCap = new Map();
  for (const i of indici) { const c = passaggi[i][0]; if (!perCap.has(c)) perCap.set(c, []); perCap.get(c).push(i); }
  const out = new Map();
  for (const [cap, lista] of perCap) {
    const c = await db.get('capitoli', [lid, cap]);
    if (!c) continue;
    const div = document.createElement('div');
    div.innerHTML = c.html;
    const frasi = frasiDalCapitolo(div).filter(f => !f.titolo);
    for (const i of lista) {
      const [, da, a] = passaggi[i];
      const sue = frasi.filter(f => f.id >= da && f.id <= a).map(f => ({ id: f.id, t: (f.voce || '').replace(/\s+/g, ' ').trim() })).filter(f => f.t);
      out.set(i, { cap, da, frasi: sue, testo: sue.map(f => f.t).join(' ') });
    }
  }
  return out;
}

function bonusParole(testo, termini) {
  if (!termini.length) return 0;
  const t = testo.toLowerCase();
  return termini.filter(w => t.includes(tronca(w))).length / termini.length;
}

// ---------------------------------------------------------------- ricerca
export async function cerca(domanda, { perSignificato = true, quanti = 20 } = {}) {
  const ix = await indice();
  if (!ix || !ix.libri.length) return { risultati: [], motivo: 'mappa' };
  const termini = parole(domanda);
  let candidati = [];
  if (perSignificato) {
    const [q] = await vettori([domanda], 'query: ');
    for (const L of ix.libri) {
      const n = L.passaggi.length;
      for (let i = 0; i < n; i++) {
        if (L.passaggi[i][4] === -1) continue;  // pagine di servizio
        let s = 0;
        const o = i * DIM;
        for (let k = 0; k < DIM; k++) s += q[k] * L.v[o + k];
        candidati.push({ lid: L.lid, i, s: s / 127 });
      }
    }
    candidati.sort((a, b) => b.s - a.s);
    candidati = candidati.slice(0, 80);
  } else {
    // Solo parole: si leggono tutti i passaggi. Più lento, ma funziona senza modello.
    if (!termini.length) return { risultati: [], motivo: 'parole' };
    for (const L of ix.libri) {
      const tutti = L.passaggi.map((p, i) => i).filter(i => L.passaggi[i][4] !== -1);
      const tx = await testi(L.lid, tutti, L.passaggi);
      for (const [i, x] of tx) {
        const b = bonusParole(x.testo, termini);
        if (b <= 0) continue;
        // più volte compaiono le parole, più il passaggio ne parla; la finestra si apre sulla frase migliore
        const conta = f => termini.reduce((n, w) => n + (f.t.toLowerCase().split(tronca(w)).length - 1), 0);
        const volte = x.frasi.reduce((n, f) => n + conta(f), 0);
        const meglio = x.frasi.reduce((m, f) => (conta(f) > conta(m) ? f : m), x.frasi[0]);
        candidati.push({ lid: L.lid, i, s: b + 0.1 * Math.min(volte, 6), x, frase: meglio?.id });
      }
    }
    candidati.sort((a, b) => b.s - a.s);
    candidati = candidati.slice(0, 80);
  }
  // Testi dei candidati e un piccolo premio a chi contiene le parole della domanda.
  const perLibro = new Map();
  for (const c of candidati) { if (!c.x) { if (!perLibro.has(c.lid)) perLibro.set(c.lid, []); perLibro.get(c.lid).push(c.i); } }
  for (const [lid, lista] of perLibro) {
    const L = ix.libri.find(x => x.lid === lid);
    const tx = await testi(lid, lista, L.passaggi);
    for (const c of candidati) if (c.lid === lid && !c.x) c.x = tx.get(c.i);
  }
  candidati = candidati.filter(c => c.x && c.x.testo);
  if (perSignificato) {
    // le parole esatte della domanda contano un po'; i dialoghi, spesso vaghi, un po' meno
    const L = Object.fromEntries(ix.libri.map(x => [x.lid, x]));
    for (const c of candidati) {
      c.s += 0.045 * bonusParole(c.x.testo, termini);
      if (ix.temi.tipi && ix.temi.tipi[L[c.lid].passaggi[c.i][4]] === 'dialogo') c.s -= 0.015;
    }
    candidati.sort((a, b) => b.s - a.s);
    // si tengono solo quelli vicini al migliore: e5 comprime i punteggi, oltre il legame è debole
    const migliore = candidati[0]?.s || 0;
    candidati = candidati.filter(c => c.s >= migliore - 0.04);
  }
  // varietà: al massimo tre passaggi per libro nella prima pagina
  const conta = {}, primi = [], resto = [];
  for (const c of candidati) {
    conta[c.lid] = (conta[c.lid] || 0) + 1;
    (conta[c.lid] <= 3 ? primi : resto).push(c);
  }
  return { risultati: primi.concat(resto).slice(0, quanti), temi: ix.temi };
}

// La frase più vicina alla domanda dentro ogni passaggio: lì si apre il libro.
// Un solo calcolo per tutte le frasi dei primi passaggi, poi un riordino leggero.
// Ogni frase costa sul telefono quasi un decimo di secondo: si scelgono prima
// le candidate senza modello, quelle con le parole della domanda.
export async function frasiMigliori(domanda, risultati, quanti = 6, perPassaggio = 4) {
  const primi = risultati.slice(0, quanti);
  const termini = parole(domanda).map(tronca);
  const tutte = [];
  primi.forEach((r, n) => {
    const fr = r.x.frasi.filter(f => f.t.length > 25);
    const punti = f => { const t = f.t.toLowerCase(); return termini.filter(w => t.includes(w)).length; };
    // senza parole in comune (per esempio fra lingue diverse) si prendono frasi sparse nel passaggio
    const scelte = termini.length && fr.some(f => punti(f) > 0)
      ? [...fr].sort((a, b) => punti(b) - punti(a)).slice(0, perPassaggio)
      : fr.filter((f, k) => k % Math.max(1, Math.ceil(fr.length / perPassaggio)) === 0).slice(0, perPassaggio);
    scelte.forEach(f => tutte.push([n, f.id, f.t.slice(0, 300)]));
  });
  if (!tutte.length) return;
  const [q] = await vettori([domanda], 'query: ');
  const vv = await vettori(tutte.map(x => x[2]), 'passage: ');
  const migliore = primi.map(() => [-1, null]);
  vv.forEach((v, j) => {
    let s = 0; for (let k = 0; k < DIM; k++) s += q[k] * v[k];
    const n = tutte[j][0];
    if (s > migliore[n][0]) migliore[n] = [s, tutte[j][1]];
  });
  primi.forEach((r, n) => { if (migliore[n][1] !== null) { r.frase = migliore[n][1]; r.sf = migliore[n][0]; } });
  // Un passaggio con una frase precisa sulla domanda sale sopra quelli solo genericamente vicini.
  primi.forEach(r => { r.sc = r.sf === undefined ? r.s : 0.5 * r.s + 0.5 * r.sf; });
  primi.sort((a, b) => b.sc - a.sc);
  risultati.splice(0, primi.length, ...primi);
}

// ---------------------------------------------------------------- vista
function ricordaDomanda(q) {
  try {
    const r = JSON.parse(localStorage.getItem('leggio-domande') || '[]').filter(x => x !== q);
    r.unshift(q);
    localStorage.setItem('leggio-domande', JSON.stringify(r.slice(0, 8)));
  } catch { /* niente */ }
}
function domandeRecenti() { try { return JSON.parse(localStorage.getItem('leggio-domande') || '[]'); } catch { return []; } }

const ESEMPI = ['Cosa dicono sulla paura?', 'Il tempo che passa', 'Come si prende una decisione', 'La memoria e il ricordo', 'Cosa rende felici'];

export async function vistaChiedi(radice, schede, domandaIniziale = '') {
  const libri = Object.fromEntries((await db.tutti('libri')).map(l => [l.id, l]));
  const temi = await caricaMappa();
  const ids = temi ? Object.keys(temi.libri).sort((a, b) => temi.libri[b].n - temi.libri[a].n) : [];
  const colore = Object.fromEntries(ids.map((id, i) => [id, COLORI[i] || '#C9C2B6']));
  const titolo = id => libri[id]?.titolo || temi?.libri[id]?.titolo || 'Libro';

  const campo = h('input', { class: 'campo chiedi-campo', type: 'search', enterkeyhint: 'search', placeholder: 'Chiedi ai tuoi libri', value: domandaIniziale });
  const esito = h('div', { class: 'chiedi-esito' });
  const avvisoModello = h('div');

  const disegnaVuoto = () => {
    const recenti = domandeRecenti();
    esito.replaceChildren(
      h('p', { class: 'tenue chiedi-spiega' }, 'Scrivi una domanda o un argomento. Leggio trova i passaggi che ne parlano in tutti i tuoi libri, anche con parole diverse e anche fra italiano e inglese.'),
      h('div', { class: 'mappa-vicini' }, ...(recenti.length ? recenti : ESEMPI).map(q => h('button', { class: 'mappa-chip', onclick: () => { campo.value = q; vai(); } }, q))));
  };

  const disegnaModello = () => {
    if (modelloScaricato() || _pipe) { avvisoModello.replaceChildren(); return; }
    avvisoModello.replaceChildren(h('div', { class: 'chiedi-modello' },
      h('div', {}, h('strong', {}, 'Ricerca per significato'), h('p', { class: 'tenue' }, `Serve un modello di ${MB} MB, scaricato una volta sola e tenuto sul telefono. Meglio col Wi-Fi. Senza, la ricerca usa solo le parole.`)),
      h('button', { class: 'btn primario', onclick: e => scarica(e.target) }, 'Scarica')));
  };
  const scarica = async bottone => {
    bottone.disabled = true;
    try {
      await caricaModello(p => { bottone.textContent = `${Math.round(p * 100)}%`; });
      avviso('Modello pronto: ora la ricerca capisce il significato.');
      disegnaModello();
      if (campo.value.trim()) vai();
    } catch (e) {
      console.error(e);
      bottone.disabled = false; bottone.textContent = 'Riprova';
      avviso('Il modello non si è caricato su questo telefono. La ricerca userà le parole.', { durata: 6000 });
      try { localStorage.setItem('leggio-e5-ko', String(e.message || e).slice(0, 200)); } catch { /* niente */ }
    }
  };

  let filtro = null, ultimo = null;
  const vai = async () => {
    const q = campo.value.trim();
    if (!q) { disegnaVuoto(); return; }
    campo.blur();
    ricordaDomanda(q);
    history.replaceState(null, '', `#/chiedi/${encodeURIComponent(q)}`);
    const perSignificato = modelloScaricato() || !!_pipe;
    esito.replaceChildren(h('p', { class: 'tenue' }, perSignificato ? (_pipe ? 'Cerco…' : 'Carico il modello e cerco…') : 'Cerco per parole in tutti i libri…'));
    const t0 = performance.now();
    let r;
    try { r = await cerca(q, { perSignificato }); }
    catch (e) {
      console.error(e);
      if (perSignificato) { r = await cerca(q, { perSignificato: false }); r.ripiego = true; }
      else throw e;
    }
    if (r.motivo === 'mappa') {
      const st = await statoMappa();
      esito.replaceChildren(h('p', {}, st?.remoto?.fase && st.remoto.fase !== 'finito'
        ? 'La mappa dei libri si sta preparando su Kaggle. La ricerca funziona appena è pronta.'
        : 'La ricerca usa la mappa dei libri, che non c’è ancora. Si prepara da sola quando GitHub è collegato.'));
      aggiornaMappa().catch(() => {});
      return;
    }
    ultimo = { q, r, ms: performance.now() - t0, perSignificato: perSignificato && !r.ripiego };
    filtro = null;
    disegnaRisultati();
    // in un secondo momento: la frase più vicina dentro ogni passaggio
    if (ultimo.perSignificato && r.risultati.length) {
      frasiMigliori(q, r.risultati).then(() => { if (ultimo?.r === r) disegnaRisultati(); }).catch(e => console.warn(e));
    }
  };

  const disegnaRisultati = () => {
    const { q, r, perSignificato } = ultimo;
    const lista = r.risultati.filter(x => !filtro || x.lid === filtro);
    if (!r.risultati.length) {
      esito.replaceChildren(h('p', {}, 'Nessun passaggio trovato.'), perSignificato ? null : h('p', { class: 'tenue' }, 'La ricerca per parole cerca le parole esatte. Prova con altre parole o scarica il modello per cercare il significato.'));
      return;
    }
    const conta = {};
    r.risultati.forEach(x => { conta[x.lid] = (conta[x.lid] || 0) + 1; });
    const nLibri = Object.keys(conta).length;
    esito.replaceChildren(
      h('div', { class: 'chiedi-sintesi' }, nLibri === 1 ? 'Ne parla un libro' : `Ne parlano ${nLibri} libri`, perSignificato ? null : h('span', { class: 'tenue' }, ' · ricerca per parole')),
      h('div', { class: 'mappa-libri chiedi-filtri' }, ...Object.entries(conta).sort((a, b) => b[1] - a[1]).map(([lid, n]) => h('button', {
        class: `mappa-chip ${filtro === lid ? 'attivo' : ''} ${filtro && filtro !== lid ? 'spento' : ''}`,
        onclick: () => { filtro = filtro === lid ? null : lid; disegnaRisultati(); },
      }, h('span', { class: 'mappa-punto', style: { background: colore[lid] } }), `${titolo(lid)} · ${n}`))),
      h('div', { class: 'mappa-esempi' }, ...lista.map(x => scheda(x, q))));
  };

  const scheda = (x, q) => {
    const l = libri[x.lid];
    const termini = parole(q).map(tronca);
    // la frase migliore in evidenza, il resto attorno
    const j = x.x.frasi.findIndex(f => f.id === x.frase);
    const pezzi = x.x.frasi.map((f, k) => {
      let t = f.t;
      const fuori = j >= 0 && (k < j - 1 || k > j + 2);
      const el = h('span', { class: `${f.id === x.frase ? 'chiedi-frase' : ''} ${fuori ? 'fuori' : ''}` });
      if (termini.length) {
        const re = new RegExp(`(${termini.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}]*`, 'giu');
        let fine = 0;
        for (const m of t.matchAll(re)) { el.append(t.slice(fine, m.index), h('mark', {}, m[0])); fine = m.index + m[0].length; }
        el.append(t.slice(fine));
      } else el.append(t);
      return [el, ' '];
    }).flat();
    const corpo = h('p', { class: `chiedi-testo ${j >= 0 ? 'finestra' : ''}` }, j > 1 ? h('span', { class: 'tenue puntini' }, '… ') : null, ...pezzi);
    return h('div', { class: 'mappa-passaggio' },
      h('div', { class: 'mappa-passaggio-testa' },
        h('span', { class: 'mappa-punto', style: { background: colore[x.lid] } }),
        h('strong', {}, titolo(x.lid))),
      l?.capitoli?.[x.x.cap]?.titolo ? h('div', { class: 'tenue chiedi-cap' }, l.capitoli[x.x.cap].titolo) : null,
      corpo,
      h('div', { class: 'riga-bottoni' },
        h('button', { class: 'btn piccolo', onclick: () => corpo.classList.toggle('aperto') }, 'Tutto il passaggio'),
        l ? h('button', { class: 'btn piccolo', onclick: () => apri(l, x.x.cap, x.frase ?? x.x.da) }, 'Leggi qui') : null));
  };

  const apri = async (l, cap, frase) => {
    l.posizione = { cap, frase };
    await db.put('libri', l);
    try { localStorage.setItem(`leggio-pos-${l.id}`, JSON.stringify(l.posizione)); } catch { /* niente */ }
    location.hash = `#/libro/${l.id}`;
  };

  campo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); vai(); } });
  campo.addEventListener('search', () => { if (!campo.value) disegnaVuoto(); });

  const testa = h('header', { class: 'lib-testa' },
    h('div', {}, h('div', { class: 'marchio' }, h('span', { class: 'marchio-segno' }), 'Leggio'), h('h1', {}, 'Chiedi alla libreria')));
  radice.replaceChildren(h('main', { class: 'vista chiedi' }, testa,
    h('div', { class: 'chiedi-riga' }, icona('cerca', 20), campo), avvisoModello, esito), schede('chiedi'));
  disegnaModello();
  if (domandaIniziale) vai(); else { disegnaVuoto(); campo.focus(); }
}
