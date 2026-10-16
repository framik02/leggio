// La mappa disegnata. Due viste: i temi (nodi = temi, anello colorato = quali
// libri ne parlano) e i libri (nodi = libri, archi = quanto dialogano).
// Per restare leggibile: niente passaggi singoli, solo gli archi portanti,
// etichette che non si sovrappongono, tocco che mette a fuoco un nodo.
import { h, icona, bottoneIcona, avviso } from './ui.js';
import { db } from './db.js';
import { caricaMappa, statoMappa, aggiornaMappa, ricostruisci, seguiMappa, descriviStatoMappa, testoPassaggio } from './mappa.js';
import { configurato } from './audio.js';

const COLORI = ['#2F5D8A', '#C9952E', '#7A4E7E', '#2A8F9E', '#8A6247', '#5560A8', '#B9A27A', '#56656F'];
const GRIGIO = '#C9C2B6';
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attr = {}, ...figli) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attr)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  figli.flat().forEach(f => f && el.append(f));
  return el;
};

let vista = 'idee';
const mappaDi = tm => tm.mappa || 'idee';
// Un tema è condiviso se almeno due libri vi contribuiscono davvero, non con un passaggio sparso.
export const condiviso = tm => Object.values(tm.libri).filter(c => c >= Math.max(2, tm.n * 0.1)).length >= 2;

export async function vistaMappa(radice, schede) {
  const mappa = await caricaMappa();
  const st = await statoMappa();
  const libriTutti = await db.tutti('libri');
  const pronta = mappa && mappa.temi;

  const stato = h('div', { class: 'mappa-stato' });
  const disegnaStato = st2 => {
    const r = st2?.remoto || {};
    const testo = descriviStatoMappa(st2);
    const quando = st2?.aggiornata ? new Date(st2.aggiornata).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : '';
    const riassunto = pronta ? `${Object.keys(mappa.libri).length} libri · ${mappa.temi.length} temi${quando ? ' · aggiornata il ' + quando : ''}` : '';
    stato.replaceChildren(...[
      riassunto ? h('span', {}, riassunto) : null,
      testo ? h('span', { class: r.fase === 'errore' ? 'mappa-errore' : '' }, testo) : null,
      r.fase === 'errore' || r.fase === 'da riprendere' ? h('button', { class: 'btn piccolo', onclick: () => avvia() }, 'Riprova') : null].filter(Boolean));
  };
  const avvia = async () => {
    const av = avviso('Preparo i testi…', { fisso: true });
    try { const x = await ricostruisci(p => { av.querySelector && (av.textContent = `Preparo i testi… ${Math.round(p * 100)}%`); }); av.remove(); disegnaStato(x); avviso('Testi inviati: Kaggle costruisce la mappa, ci vogliono pochi minuti per libro.'); }
    catch (e) { av.remove(); avviso(e.message || 'Invio non riuscito', { durata: 6000 }); }
  };
  disegnaStato(st);
  const smetti = seguiMappa(async x => {
    if (!document.body.contains(stato)) { smetti(); return; }
    const prima = pronta ? mappa.versione : 0;
    const dopo = (await caricaMappa())?.versione || 0;
    if (dopo !== prima) vistaMappa(radice, schede);
    else disegnaStato(x);
  });
  aggiornaMappa().catch(e => console.warn('mappa', e));

  const testa = h('header', { class: 'lib-testa' },
    h('div', {}, h('div', { class: 'marchio' }, h('span', { class: 'marchio-segno' }), 'Leggio'), h('h1', {}, 'Mappa')),
    h('a', { class: 'ico', href: '#/chiedi', 'aria-label': 'Chiedi alla libreria', title: 'Chiedi alla libreria' }, icona('cerca')));

  let corpo;
  if (!pronta) {
    const collegato = await configurato();
    corpo = h('section', { class: 'benvenuto' },
      h('div', { class: 'benvenuto-segno' }, icona('mappa', 40)),
      h('h2', {}, 'La mappa dei tuoi libri'),
      h('p', {}, 'Leggio divide i libri in passaggi, trova quelli che parlano delle stesse cose anche fra italiano e inglese e li raggruppa in temi. Il calcolo gira su Kaggle, la mappa resta sul telefono.'),
      !collegato ? h('p', {}, 'Serve il collegamento a GitHub: Impostazioni › Audio generato.')
        : libriTutti.length < 2 ? h('p', {}, 'Servono almeno due libri.')
          : (st.remoto && !['finito', 'errore', 'da riprendere'].includes(st.remoto.fase)) ? null
            : h('button', { class: 'btn primario', onclick: avvia }, 'Costruisci la mappa'));
    radice.replaceChildren(h('main', { class: 'vista mappa-vista' }, testa, stato, corpo), schede('mappa'));
    return;
  }

  // colori dei libri: i più presenti hanno un colore, gli altri grigio
  const ids = Object.keys(mappa.libri).sort((a, b) => mappa.libri[b].n - mappa.libri[a].n);
  const colore = {};
  ids.forEach((id, i) => { colore[id] = COLORI[i] || GRIGIO; });
  const libri = Object.fromEntries(libriTutti.map(l => [l.id, l]));
  const titolo = id => libri[id]?.titolo || mappa.libri[id]?.titolo || 'Libro';

  let filtroLibro = null;
  const scelta = h('div', { class: 'mappa-scelta' });
  const chips = h('div', { class: 'mappa-libri' });
  const tela = h('div', { class: 'mappa-tela' });
  const scheda = h('div', { class: 'mappa-scheda' });

  const disegnaScelta = () => scelta.replaceChildren(
    ...[['idee', 'Idee'], ['motivi', 'Motivi'], ['libri', 'Libri']].filter(([k]) => k === 'libri' || mappa.temi.some(tm => mappaDi(tm) === k)).map(([k, t]) => h('button', { class: `pill ${vista === k ? 'attivo' : ''}`, onclick: () => { vista = k; disegnaScelta(); disegna(); } }, t)));
  const disegnaChips = () => chips.replaceChildren(...ids.map(id => h('button', {
    class: `mappa-chip ${filtroLibro === id ? 'attivo' : ''} ${filtroLibro && filtroLibro !== id ? 'spento' : ''}`,
    onclick: () => { filtroLibro = filtroLibro === id ? null : id; disegnaChips(); grafo?.filtra(filtroLibro); },
  }, h('span', { class: 'mappa-punto', style: { background: colore[id] } }), titolo(id))));

  let grafo = null;
  const ctx = { mappa, colore, titolo, libri, scheda, apriTema: id => { vista = mappaDi(mappa.temi.find(t => t.id === id) || {}); disegnaScelta(); disegna(id); } };
  const disegna = focoIniziale => {
    scheda.classList.remove('aperta');
    grafo?.chiudi();
    grafo = vista === 'libri' ? grafoLibri(tela, ctx) : grafoTemi(tela, ctx, mappa.temi.filter(tm => mappaDi(tm) === vista));
    if (filtroLibro) grafo.filtra(filtroLibro);
    if (focoIniziale !== undefined) grafo.fuoco(focoIniziale);
  };

  radice.replaceChildren(h('main', { class: 'vista mappa-vista piena' }, testa, stato, h('div', { class: 'mappa-barra' }, scelta), chips, tela, scheda), schede('mappa'));
  disegnaScelta(); disegnaChips();
  if (vista !== 'libri' && !mappa.temi.some(tm => mappaDi(tm) === vista)) vista = mappa.temi.length ? mappaDi(mappa.temi[0]) : 'libri';
  disegnaScelta();
  disegna();
}

// ---------------------------------------------------------------- tela con spostamento e zoom
function telaSvg(contenitore) {
  const svg = s('svg', { class: 'mappa-svg', width: '100%', height: '100%' });
  const g = s('g');
  svg.append(g);
  contenitore.replaceChildren(svg);
  const v = { x: 0, y: 0, k: 1 };
  const applica = () => { g.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`); onZoom && onZoom(v.k); };
  let onZoom = null;
  const punti = new Map();
  let mosso = 0, ultimo = null, distanza = null;
  svg.addEventListener('pointerdown', e => { punti.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (punti.size === 1) mosso = 0; ultimo = null; distanza = null; });
  svg.addEventListener('pointermove', e => {
    if (!punti.has(e.pointerId)) return;
    const prima = punti.get(e.pointerId);
    if (mosso > 6 && !svg.hasPointerCapture(e.pointerId)) { try { svg.setPointerCapture(e.pointerId); } catch { /* niente */ } }
    punti.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punti.size === 1) {
      v.x += e.clientX - prima.x; v.y += e.clientY - prima.y;
      mosso += Math.abs(e.clientX - prima.x) + Math.abs(e.clientY - prima.y);
      applica();
    } else if (punti.size === 2) {
      const [a, b] = [...punti.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (distanza) zoomIn(d / distanza, c, ultimo);
      distanza = d; ultimo = c; mosso += 10;
    }
  });
  const fine = e => { punti.delete(e.pointerId); distanza = null; ultimo = null; };
  svg.addEventListener('pointerup', fine);
  svg.addEventListener('pointercancel', fine);
  svg.addEventListener('wheel', e => { e.preventDefault(); zoomIn(Math.exp(-e.deltaY / 400), { x: e.clientX, y: e.clientY }); }, { passive: false });
  function zoomIn(f, c, cPrima) {
    const r = svg.getBoundingClientRect();
    const px = c.x - r.left, py = c.y - r.top;
    const k = Math.min(6, Math.max(0.3, v.k * f));
    const f2 = k / v.k;
    v.x = px - (px - v.x) * f2; v.y = py - (py - v.y) * f2; v.k = k;
    if (cPrima) { v.x += c.x - cPrima.x; v.y += c.y - cPrima.y; }
    applica();
  }
  // Si adatta quando la tela ha la sua misura vera.
  const adatta = (minx, miny, maxx, maxy) => requestAnimationFrame(() => {
    const r = svg.getBoundingClientRect();
    const W = r.width || 360, H = (r.height || 480) - 70;
    const k = Math.min(W / (maxx - minx + 24), H / (maxy - miny + 24), 2.5);
    v.k = k; v.x = (W - (maxx + minx) * k) / 2; v.y = (H - (maxy + miny) * k) / 2 + 6;
    applica();
  });
  // Porta un punto al centro della parte di tela non coperta dalla scheda.
  const centra = (x, y) => {
    const r = svg.getBoundingClientRect();
    const coperta = Math.max(0, r.bottom - window.innerHeight * 0.48);
    const k = Math.max(v.k, 1.1);
    const meta = { x: r.width / 2 - x * k, y: (r.height - coperta) / 2 - y * k };
    const da = { ...v }, t0 = performance.now();
    const passo = t => {
      const p = Math.min(1, (t - t0) / 280), e = 1 - (1 - p) ** 3;
      v.x = da.x + (meta.x - da.x) * e; v.y = da.y + (meta.y - da.y) * e; v.k = da.k + (k - da.k) * e;
      applica();
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };
  return { svg, g, v, adatta, centra, eUnTocco: () => mosso < 8, quandoZoom: fn => { onZoom = fn; }, zoomIn };
}

// Le etichette si mostrano in ordine di importanza e solo se non toccano quelle già messe.
function etichetteSenzaSovrapposizioni(nodi, k) {
  const messi = [];
  for (const n of [...nodi].sort((a, b) => b.peso - a.peso)) {
    const fs = n.fs / k;  // dimensione costante sullo schermo: con lo zoom c'è posto per più etichette
    const w = n.etichetta.length * fs * 0.56, hh = fs * 1.25;
    const box = { x0: n.x - w / 2, x1: n.x + w / 2, y0: n.y + n.r + 2, y1: n.y + n.r + 2 + hh };
    const libero = !messi.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)
      && !nodi.some(m => m !== n && Math.hypot(Math.max(box.x0 - m.x, 0, m.x - box.x1), Math.max(box.y0 - m.y, 0, m.y - box.y1)) < m.r * 0.9);
    n.testo.setAttribute('font-size', fs.toFixed(2));
    n.testo.style.display = libero || n.fuoco || n.sempre ? '' : 'none';
    if (libero) messi.push(box);
  }
}

// Allontana i nodi che si sovrappongono restando vicino alla posizione calcolata.
function separa(nodi, giri = 160, spazio = 14) {
  for (let it = 0; it < giri; it++) {
    for (let i = 0; i < nodi.length; i++) {
      const a = nodi[i];
      for (let j = i + 1; j < nodi.length; j++) {
        const b = nodi[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const minimo = a.r + b.r + spazio;
        if (d < minimo) {
          const spinta = (minimo - d) / 2;
          if (d === 0.01) { dx = Math.cos(i); dy = Math.sin(i); d = 1; }
          a.x -= dx / d * spinta; a.y -= dy / d * spinta;
          b.x += dx / d * spinta; b.y += dy / d * spinta;
        }
      }
      a.x += (a.x0 - a.x) * 0.02; a.y += (a.y0 - a.y) * 0.02;
    }
  }
}

// Archi dei temi: solo i legami forti, al massimo due per tema. Niente albero:
// con molti temi gli archi lunghi che lo tengono insieme attraversano tutto.
function legamiForti(archi) {
  const pesi = archi.map(a => a[2]).sort((a, b) => a - b);
  const soglia = pesi[Math.floor(pesi.length * 0.6)] ?? 0;
  const conta = new Map();
  const tenuti = new Set();
  [...archi.keys()].sort((a, b) => archi[b][2] - archi[a][2]).forEach(i => {
    const [a, b, w] = archi[i];
    if (w < soglia || (conta.get(a) || 0) >= 2 || (conta.get(b) || 0) >= 2) return;
    tenuti.add(i); conta.set(a, (conta.get(a) || 0) + 1); conta.set(b, (conta.get(b) || 0) + 1);
  });
  return tenuti;
}

// Archi portanti fra i libri: albero di peso massimo più l'arco più forte di ogni nodo.
function portanti(n, archi) {
  const padre = [...Array(n).keys()];
  const trova = x => (padre[x] === x ? x : (padre[x] = trova(padre[x])));
  const tenuti = new Set();
  const ord = [...archi.keys()].sort((a, b) => archi[b][2] - archi[a][2]);
  for (const i of ord) {
    const [a, b] = archi[i];
    const ra = trova(a), rb = trova(b);
    if (ra !== rb) { padre[ra] = rb; tenuti.add(i); }
  }
  const migliore = new Map();
  for (const i of ord) {
    const [a, b] = archi[i];
    if (!migliore.has(a)) migliore.set(a, i);
    if (!migliore.has(b)) migliore.set(b, i);
  }
  migliore.forEach(i => tenuti.add(i));
  return tenuti;
}

function curva(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  return `M${a.x},${a.y} Q${mx - dy * 0.12},${my + dx * 0.12} ${b.x},${b.y}`;
}

// ---------------------------------------------------------------- vista temi
function grafoTemi(contenitore, ctx, temi) {
  const { mappa, colore, scheda } = ctx;
  const t = telaSvg(contenitore);
  const L = 520;
  const xs = temi.map(x => x.x), ys = temi.map(x => x.y);
  const [mx, Mx, my, My] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scala = L / Math.max(Mx - mx, My - my, 1e-6);
  const nodi = temi.map(tm => {
    const r = Math.max(7, Math.min(30, 4 + 2.4 * Math.sqrt(tm.n)));
    const x = (tm.x - mx) * scala, y = (tm.y - my) * scala;
    // i temi condivisi fra libri sono il cuore della mappa: etichetta prima e colore pieno
    const comune = condiviso(tm);
    return { tm, id: tm.id, r, x, y, x0: x, y0: y, peso: tm.n * (comune ? 4 : 1), condiviso: comune, fs: r > 16 ? 13 : 12, etichetta: nomeBreve(tm.nome) };
  });
  separa(nodi, 160, 22);
  const perId = new Map(nodi.map((n, i) => [n.id, i]));
  const archi = (mappa.archi || []).filter(([a, b]) => perId.has(a) && perId.has(b)).map(([a, b, w]) => [perId.get(a), perId.get(b), w]);
  const tenuti = legamiForti(archi);
  const wmax = Math.max(...archi.map(a => a[2]), 1e-6);

  const strArchi = s('g', { class: 'm-archi' });
  const strNodi = s('g', { class: 'm-nodi' });
  t.g.append(strArchi, strNodi);
  const archiEl = archi.map(([a, b, w], i) => {
    const el = s('path', { d: curva(nodi[a], nodi[b]), class: 'm-arco', 'stroke-width': (0.8 + 3 * w / wmax).toFixed(2) });
    el.style.display = tenuti.has(i) ? '' : 'none';
    strArchi.append(el);
    return el;
  });
  for (const n of nodi) {
    const tot = Object.values(n.tm.libri).reduce((x, y) => x + y, 0);
    const C = 2 * Math.PI * n.r;
    let off = 0;
    const anello = Object.entries(n.tm.libri).sort((a, b) => b[1] - a[1]).map(([lid, c]) => {
      const lung = C * c / tot;
      const el = s('circle', { r: n.r, cx: 0, cy: 0, fill: 'none', stroke: colore[lid] || GRIGIO, 'stroke-width': Math.max(3, n.r * 0.32), 'stroke-dasharray': `${lung} ${C}`, 'stroke-dashoffset': -off, transform: 'rotate(-90)' });
      off += lung;
      return el;
    });
    n.testo = s('text', { class: 'm-etichetta', x: 0, y: n.r + 2, 'text-anchor': 'middle', 'dominant-baseline': 'hanging' });
    n.testo.textContent = n.etichetta;
    n.el = s('g', { class: `m-nodo ${n.condiviso ? '' : 'solo'}`, transform: `translate(${n.x} ${n.y})` }, s('circle', { r: n.r, class: 'm-fondo' }), anello, n.testo);
    n.el.addEventListener('click', e => { if (!t.eUnTocco()) return; e.stopPropagation(); fuoco(n.id); });
    strNodi.append(n.el);
  }
  // le etichette sono dentro il gruppo scalato: si riposizionano relative al nodo
  for (const n of nodi) { n.etichettaX = n.x; }
  const ricalcola = k => etichetteSenzaSovrapposizioni(nodi.map(n => ({ ...n, testo: n.testo, x: n.x, y: n.y, fuoco: n.fuoco })), k);
  t.quandoZoom(k => ricalcola(k));
  t.svg.addEventListener('click', () => { if (t.eUnTocco()) sfoca(); });
  t.adatta(Math.min(...nodi.map(n => n.x - n.r - 34)), Math.min(...nodi.map(n => n.y - n.r)), Math.max(...nodi.map(n => n.x + n.r + 34)), Math.max(...nodi.map(n => n.y + n.r + 18)));

  function sfoca() {
    nodi.forEach(n => { n.fuoco = false; n.el.classList.remove('spento', 'acceso'); });
    archiEl.forEach((el, i) => { el.style.display = tenuti.has(i) ? '' : 'none'; el.classList.remove('acceso'); });
    scheda.classList.remove('aperta');
    if (filtro) filtra(filtro);
    ricalcola(t.v.k);
  }
  function fuoco(id) {
    const i = perId.get(id);
    if (i === undefined) return;
    const vicini = archi.map((a, j) => [a, j]).filter(([a]) => a[0] === i || a[1] === i).sort((x, y) => y[0][2] - x[0][2]).slice(0, 6);
    const acc = new Set([i, ...vicini.map(([a]) => (a[0] === i ? a[1] : a[0]))]);
    nodi.forEach((n, j) => { n.fuoco = acc.has(j); n.el.classList.toggle('spento', !acc.has(j)); n.el.classList.toggle('acceso', j === i); });
    archiEl.forEach(el => { el.style.display = 'none'; el.classList.remove('acceso'); });
    vicini.forEach(([, j]) => { archiEl[j].style.display = ''; archiEl[j].classList.add('acceso'); });
    ricalcola(t.v.k);
    t.centra(nodi[i].x, nodi[i].y);
    schedaTema(nodi[i].tm, vicini.map(([a]) => nodi[a[0] === i ? a[1] : a[0]].tm), ctx, fuoco);
  }
  let filtro = null;
  function filtra(lid) {
    filtro = lid;
    nodi.forEach(n => {
      const c = lid ? (n.tm.libri[lid] || 0) : 1;
      n.el.classList.toggle('spento', !!lid && !c);
    });
  }
  ricalcola(t.v.k);
  return { chiudi() {}, filtra, fuoco };
}

function nomeBreve(nome) {
  const p = (nome || '').split(' · ').filter(Boolean);
  return p.slice(0, 2).join(' · ') || 'tema';
}

async function schedaTema(tm, vicini, ctx, fuoco) {
  const { scheda, colore, titolo } = ctx;
  const tot = Object.values(tm.libri).reduce((a, b) => a + b, 0);
  const esempi = h('div', { class: 'mappa-esempi' }, h('p', { class: 'tenue' }, 'Carico i passaggi…'));
  scheda.replaceChildren(
    h('div', { class: 'mappa-scheda-testa' },
      h('div', {}, h('h3', {}, tm.nome), h('div', { class: 'tenue' }, `${tm.n} passaggi · ${Object.keys(tm.libri).length === 1 ? 'un libro solo' : Object.keys(tm.libri).length + ' libri'}`)),
      bottoneIcona('chiudi', 'Chiudi', () => scheda.classList.remove('aperta'), 'piccola')),
    tm.parole?.length > 3 ? h('div', { class: 'mappa-parole' }, tm.parole.join(' · ')) : null,
    h('div', { class: 'mappa-barre' }, ...Object.entries(tm.libri).sort((a, b) => b[1] - a[1]).map(([lid, c]) =>
      h('div', { class: 'mappa-barra-libro' },
        h('span', { class: 'mappa-punto', style: { background: colore[lid] || GRIGIO } }),
        h('span', { class: 'mappa-barra-titolo' }, titolo(lid)),
        h('span', { class: 'mappa-barra-fondo' }, h('span', { style: { width: `${(100 * c / tot).toFixed(0)}%`, background: colore[lid] || GRIGIO } })),
        h('span', { class: 'tenue' }, String(c))))),
    vicini.length ? h('div', { class: 'mappa-vicini' }, h('span', { class: 'tenue' }, 'Vicino a'),
      ...vicini.map(v => h('button', { class: 'mappa-chip', onclick: () => fuoco(v.id) }, nomeBreve(v.nome)))) : null,
    esempi);
  scheda.classList.add('aperta');
  scheda.scrollTop = 0;
  const righe = [];
  for (const [lid, i] of tm.esempi || []) {
    const p = await testoPassaggio(lid, i);
    if (!p) continue;
    righe.push(passaggioCard(lid, p, ctx));
  }
  esempi.replaceChildren(...(righe.length ? righe : [h('p', { class: 'tenue' }, 'I passaggi di questo tema sono in libri non più sul telefono.')]));
}

function passaggioCard(lid, p, ctx) {
  const testo = p.testo.length > 320 ? p.testo.slice(0, 320).replace(/\s+\S*$/, '') + '…' : p.testo;
  const l = ctx.libri[lid];
  return h('div', { class: 'mappa-passaggio' },
    h('div', { class: 'mappa-passaggio-testa' },
      h('span', { class: 'mappa-punto', style: { background: ctx.colore[lid] || GRIGIO } }),
      h('strong', {}, ctx.titolo(lid)),
      h('span', { class: 'tenue' }, l?.capitoli?.[p.cap]?.titolo ? ' · ' + l.capitoli[p.cap].titolo : '')),
    h('p', {}, testo),
    l ? h('button', { class: 'btn piccolo', onclick: async () => { l.posizione = { cap: p.cap, frase: p.da }; await db.put('libri', l); try { localStorage.setItem(`leggio-pos-${l.id}`, JSON.stringify(l.posizione)); } catch { /* niente */ } location.hash = `#/libro/${l.id}`; } }, 'Leggi qui') : null);
}

// ---------------------------------------------------------------- vista libri
function grafoLibri(contenitore, ctx) {
  const { mappa, colore, titolo, scheda } = ctx;
  const t = telaSvg(contenitore);
  const ids = Object.keys(mappa.libri);
  const n = ids.length;
  const nodi = ids.map((id, i) => {
    const r = Math.max(14, Math.min(34, 6 + 1.1 * Math.sqrt(mappa.libri[id].n)));
    const ang = 2 * Math.PI * i / n;
    const x = 200 * Math.cos(ang), y = 200 * Math.sin(ang);
    const nome = titolo(id);
    return { id, r, x, y, x0: x, y0: y, vx: 0, vy: 0, peso: mappa.libri[id].n, fs: 12.5, sempre: n <= 12, etichetta: nome.length > 24 ? nome.slice(0, 23) + '…' : nome };
  });
  const perId = new Map(ids.map((id, i) => [id, i]));
  // forza dei legami: echi in comune rispetto alla grandezza dei due libri
  const archi = (mappa.archi_libri || []).filter(([a, b]) => perId.has(a) && perId.has(b))
    .map(([a, b, c]) => [perId.get(a), perId.get(b), c / Math.sqrt(mappa.libri[a].n * mappa.libri[b].n), c]);
  const wmax = Math.max(...archi.map(a => a[2]), 1e-6);
  // disposizione a molle, deterministica
  // Posizione dedotta dallo spazio (vicini per stile e argomento); altrimenti a molle.
  const dalloSpazio = ids.length >= 3 && ids.every(id => typeof mappa.libri[id].x === 'number');
  if (dalloSpazio) nodi.forEach(a => { a.x = 230 * mappa.libri[a.id].x; a.y = 230 * mappa.libri[a.id].y; });
  for (let it = 0; it < (dalloSpazio ? 0 : 400); it++) {
    const temp = 1 - it / 400;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = nodi[i], b = nodi[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const f = 9000 / (d * d);
      a.vx -= dx / d * f; a.vy -= dy / d * f; b.vx += dx / d * f; b.vy += dy / d * f;
    }
    for (const [i, j, w] of archi) {
      const a = nodi[i], b = nodi[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const ideale = 260 - 170 * (w / wmax);
      const f = (d - ideale) * 0.02 * (0.3 + w / wmax);
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const a of nodi) { a.vx -= a.x * 0.004; a.vy -= a.y * 0.004; a.x += a.vx * temp; a.y += a.vy * temp; a.vx *= 0.5; a.vy *= 0.5; }
  }
  nodi.forEach(a => { a.x0 = a.x; a.y0 = a.y; });
  separa(nodi, 80, 40);
  const tenuti = portanti(n, archi);
  // fra i libri si tengono anche i legami forti oltre all'albero
  archi.forEach((a, i) => { if (a[2] >= wmax * 0.45) tenuti.add(i); });

  const strArchi = s('g'), strNodi = s('g');
  t.g.append(strArchi, strNodi);
  const archiEl = archi.map(([a, b, w], i) => {
    const el = s('path', { d: curva(nodi[a], nodi[b]), class: 'm-arco', 'stroke-width': (1 + 6 * w / wmax).toFixed(2) });
    el.style.display = tenuti.has(i) ? '' : 'none';
    strArchi.append(el);
    return el;
  });
  for (const nd of nodi) {
    nd.testo = s('text', { class: 'm-etichetta', x: 0, y: nd.r + 3, 'text-anchor': 'middle', 'dominant-baseline': 'hanging' });
    nd.testo.textContent = nd.etichetta;
    nd.el = s('g', { class: 'm-nodo', transform: `translate(${nd.x} ${nd.y})` },
      s('circle', { r: nd.r, fill: colore[nd.id] || GRIGIO, class: 'm-libro' }), nd.testo);
    nd.el.addEventListener('click', e => { if (!t.eUnTocco()) return; e.stopPropagation(); fuoco(nd.id); });
    strNodi.append(nd.el);
  }
  const ricalcola = k => etichetteSenzaSovrapposizioni(nodi, k);
  t.quandoZoom(ricalcola);
  t.svg.addEventListener('click', () => { if (t.eUnTocco()) sfoca(); });
  t.adatta(Math.min(...nodi.map(a => a.x - a.r - 60)), Math.min(...nodi.map(a => a.y - a.r)), Math.max(...nodi.map(a => a.x + a.r + 60)), Math.max(...nodi.map(a => a.y + a.r + 22)));

  function sfoca() {
    nodi.forEach(a => { a.fuoco = false; a.el.classList.remove('spento', 'acceso'); });
    archiEl.forEach((el, i) => { el.style.display = tenuti.has(i) ? '' : 'none'; el.classList.remove('acceso'); });
    scheda.classList.remove('aperta');
    ricalcola(t.v.k);
  }
  function fuoco(id) {
    const i = perId.get(id);
    const miei = archi.map((a, j) => [a, j]).filter(([a]) => a[0] === i || a[1] === i).sort((x, y) => y[0][2] - x[0][2]);
    const acc = new Set([i, ...miei.map(([a]) => (a[0] === i ? a[1] : a[0]))]);
    nodi.forEach((a, j) => { a.fuoco = acc.has(j); a.el.classList.toggle('spento', !acc.has(j)); a.el.classList.toggle('acceso', j === i); });
    archiEl.forEach(el => { el.style.display = 'none'; el.classList.remove('acceso'); });
    miei.forEach(([, j]) => { archiEl[j].style.display = ''; archiEl[j].classList.add('acceso'); });
    ricalcola(t.v.k);
    t.centra(nodi[i].x, nodi[i].y);
    schedaLibro(id, miei.map(([a]) => ({ id: ids[a[0] === i ? a[1] : a[0]], forza: a[2] / wmax, echi: a[3] })), ctx);
  }
  ricalcola(t.v.k);
  return { chiudi() {}, filtra: lid => { if (lid) fuoco(lid); else sfoca(); }, fuoco: () => {} };
}

// Il genere si deduce dal profilo dei passaggi, senza chiederlo a nessuno.
const TIPI = { riflessione: ['Riflessione', '#5B6F8A'], esposizione: ['Spiegazione', '#9DB0C4'], narrazione: ['Narrazione', '#B08A5A'], descrizione: ['Descrizione', '#D9C49C'], dialogo: ['Dialogo', '#9C8AA8'] };
export function genere(p) {
  if (!p) return '';
  const idee = (p.riflessione || 0) + (p.esposizione || 0);
  if (idee >= 0.7) return (p.esposizione || 0) > (p.riflessione || 0) ? 'Saggio' : 'Saggio riflessivo';
  if ((p.riflessione || 0) >= 0.25) return 'Romanzo di idee';
  if ((p.dialogo || 0) >= 0.3) return 'Narrativa dialogata';
  if ((p.descrizione || 0) >= 0.3) return 'Narrativa descrittiva';
  return 'Narrativa';
}

function cartaIdentita(id, ctx) {
  const info = ctx.mappa.libri[id];
  if (!info?.profilo) return null;
  const voci = Object.entries(info.profilo).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]);
  return h('div', { class: 'mappa-carta' },
    h('div', { class: 'mappa-genere' }, genere(info.profilo)),
    h('div', { class: 'mappa-profilo' }, ...voci.map(([k, v]) => h('span', { title: TIPI[k]?.[0], style: { width: `${(v * 100).toFixed(1)}%`, background: TIPI[k]?.[1] || GRIGIO } }))),
    h('div', { class: 'mappa-legenda' }, ...voci.map(([k, v]) => h('span', {}, h('i', { style: { background: TIPI[k]?.[1] || GRIGIO } }), `${TIPI[k]?.[0] || k} ${Math.round(v * 100)}%`))),
    info.vicini?.length ? h('div', { class: 'tenue mappa-simili' }, 'Somiglia per stile e argomento a ', h('strong', {}, info.vicini.slice(0, 2).map(([l]) => ctx.titolo(l)).join(' e '))) : null);
}

function schedaLibro(id, altri, ctx) {
  const { scheda, mappa, colore, titolo } = ctx;
  // temi in comune: quelli dove entrambi i libri hanno passaggi, pesati sul minore
  const comuni = altroId => mappa.temi.filter(tm => tm.libri[id] && tm.libri[altroId])
    .sort((a, b) => Math.min(b.libri[id], b.libri[altroId]) - Math.min(a.libri[id], a.libri[altroId])).slice(0, 4);
  const mieiTemi = mappa.temi.filter(tm => tm.libri[id]).sort((a, b) => b.libri[id] - a.libri[id]).slice(0, 6);
  scheda.replaceChildren(
    h('div', { class: 'mappa-scheda-testa' },
      h('div', {}, h('h3', {}, titolo(id)), h('div', { class: 'tenue' }, `${mappa.libri[id].n} passaggi`)),
      bottoneIcona('chiudi', 'Chiudi', () => scheda.classList.remove('aperta'), 'piccola')),
    cartaIdentita(id, ctx),
    mieiTemi.length ? h('div', { class: 'mappa-vicini' }, h('span', { class: 'tenue' }, 'Parla di'),
      ...mieiTemi.map(tm => h('button', { class: 'mappa-chip', onclick: () => ctx.apriTema(tm.id) }, nomeBreve(tm.nome)))) : null,
    h('h4', { class: 'mappa-sotto' }, 'Dialoga con'),
    ...(altri.length ? altri.map(a => h('div', { class: 'mappa-dialogo' },
      h('div', { class: 'mappa-dialogo-testa' },
        h('span', { class: 'mappa-punto', style: { background: colore[a.id] || GRIGIO } }),
        h('strong', {}, titolo(a.id)),
        h('span', { class: 'tenue' }, `${a.echi} echi`)),
      h('div', { class: 'mappa-vicini' }, ...comuni(a.id).map(tm => h('button', { class: 'mappa-chip', onclick: () => ctx.apriTema(tm.id) }, nomeBreve(tm.nome))))))
      : [h('p', { class: 'tenue' }, 'Nessun legame forte con gli altri libri, per ora.')]));
  scheda.classList.add('aperta');
  scheda.scrollTop = 0;
}
