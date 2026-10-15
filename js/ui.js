// Piccoli strumenti di interfaccia: creazione elementi, fogli dal basso, avvisi.

export function h(tag, attr = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attr || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.appendChild(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

// Icone disegnate a mano, tratto 1.75, tutte nello stesso riquadro 24.
const P = {
  piu: '<path d="M12 5v14M5 12h14"/>',
  indietro: '<path d="M15 5l-7 7 7 7"/>',
  avanti: '<path d="M9 5l7 7-7 7"/>',
  chiudi: '<path d="M6 6l12 12M18 6L6 18"/>',
  lista: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".9" fill="currentColor"/><circle cx="4" cy="12" r=".9" fill="currentColor"/><circle cx="4" cy="18" r=".9" fill="currentColor"/>',
  testo: '<path d="M4 18L9 6l5 12M5.6 14h6.8M15 18l3-7.5 3 7.5M15.9 15.8h4.2"/>',
  cuffie: '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pausa: '<rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none"/>',
  indietroFrase: '<path d="M11 7L6 12l5 5M18 7l-5 5 5 5"/>',
  avantiFrase: '<path d="M13 7l5 5-5 5M6 7l5 5-5 5"/>',
  luna: '<path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z"/>',
  segno: '<path d="M7 4h10v16l-5-4-5 4z"/>',
  segnoPieno: '<path d="M7 4h10v16l-5-4-5 4z" fill="currentColor"/>',
  cerca: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  altro: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  libri: '<path d="M4 4.5h4v15H4zM10 4.5h4v15h-4zM16.2 5.2l3.8-1 3.2 14.6-3.8 1z"/>',
  matita: '<path d="M4 20l1-4.5L15.5 5a2 2 0 012.9 0l.6.6a2 2 0 010 2.9L8.5 19z"/>',
  ingranaggio: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  voce: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  condividi: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M5 12v7.5h14V12"/>',
  cestino: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13"/>',
  evidenzia: '<path d="M14.5 4.5l5 5L10 19H5v-5z"/><path d="M4 21h16"/>',
  copia: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
  orecchio: '<path d="M7 9a5 5 0 0110 0c0 3-3 4-3 6.5a2.5 2.5 0 01-5 0M10 9.5a2 2 0 014 0"/>',
  spunta: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

export function icona(nome, dim = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', dim); s.setAttribute('height', dim);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.75'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[nome] || '';
  return s;
}

export function bottoneIcona(nome, etichetta, onclick, cls = '') {
  return h('button', { class: `ico ${cls}`, 'aria-label': etichetta, title: etichetta, onclick }, icona(nome));
}

// Foglio dal basso. Restituisce { el, chiudi }.
export function foglio(titolo, contenuto, opz = {}) {
  const sfondo = h('div', { class: 'foglio-sfondo' });
  const corpo = h('div', { class: 'foglio-corpo' }, contenuto);
  const el = h('div', { class: `foglio ${opz.alto ? 'alto' : ''}`, role: 'dialog', 'aria-label': titolo },
    h('div', { class: 'foglio-maniglia' }),
    titolo ? h('div', { class: 'foglio-testa' },
      h('h2', {}, titolo),
      bottoneIcona('chiudi', 'Chiudi', () => chiudi())) : null,
    corpo);
  const chiudi = () => {
    el.classList.remove('aperto'); sfondo.classList.remove('aperto');
    setTimeout(() => { el.remove(); sfondo.remove(); opz.allaChiusura && opz.allaChiusura(); }, 260);
  };
  sfondo.addEventListener('click', chiudi);
  // Trascinare la maniglia verso il basso chiude.
  let y0 = null;
  el.querySelector('.foglio-maniglia').addEventListener('pointerdown', e => { y0 = e.clientY; });
  el.addEventListener('pointerup', e => { if (y0 !== null && e.clientY - y0 > 60) chiudi(); y0 = null; });
  document.body.append(sfondo, el);
  requestAnimationFrame(() => { sfondo.classList.add('aperto'); el.classList.add('aperto'); });
  return { el, corpo, chiudi };
}

let _avviso = null;
export function avviso(testo, opz = {}) {
  if (_avviso) _avviso.remove();
  const el = h('div', { class: 'avviso', role: 'status' }, h('span', {}, testo),
    opz.azione ? h('button', { onclick: () => { opz.azione.fn(); el.remove(); } }, opz.azione.testo) : null);
  document.body.appendChild(el);
  _avviso = el;
  requestAnimationFrame(() => el.classList.add('visibile'));
  if (!opz.fisso) setTimeout(() => { el.classList.remove('visibile'); setTimeout(() => el.remove(), 300); }, opz.durata || 2800);
  return el;
}

export function conferma(titolo, testo, azione, pericolo = true) {
  return new Promise(ok => {
    const f = foglio(titolo, h('div', { class: 'conferma' },
      h('p', {}, testo),
      h('div', { class: 'riga-bottoni' },
        h('button', { class: 'btn', onclick: () => { f.chiudi(); ok(false); } }, 'Annulla'),
        h('button', { class: `btn ${pericolo ? 'pericolo' : 'primario'}`, onclick: () => { f.chiudi(); ok(true); } }, azione))));
  });
}

// Copertina disegnata quando il libro non ne ha una.
const TINTE = [
  ['#2F4858', '#F3E9D2'], ['#7A3E2B', '#F7EBDD'], ['#3D5A4C', '#EFE9DA'], ['#4B3F72', '#EEE8F7'],
  ['#8A6A2F', '#FBF3E0'], ['#1F3A5F', '#E8EEF6'], ['#6B2D3C', '#F6E6EA'], ['#33413C', '#E6ECE8'],
];
export function copertinaFinta(titolo, autore) {
  let x = 0; for (const c of titolo) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const [fondo, inchiostro] = TINTE[x % TINTE.length];
  return h('div', { class: 'cop-finta', style: { background: fondo, color: inchiostro } },
    h('div', { class: 'cop-finta-filetto' }),
    h('div', { class: 'cop-finta-titolo' }, titolo),
    autore ? h('div', { class: 'cop-finta-autore' }, autore) : null);
}

export function minuti(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return 'meno di un minuto';
  if (m < 60) return `${m} min`;
  const o = Math.floor(m / 60), r = m % 60;
  return r ? `${o} h ${r} min` : `${o} h`;
}

export function pressioneLunga(el, fn, ms = 450) {
  let t = null, x0 = 0, y0 = 0, scattato = false;
  el.addEventListener('pointerdown', e => {
    scattato = false; x0 = e.clientX; y0 = e.clientY;
    t = setTimeout(() => { scattato = true; fn(e); }, ms);
  });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) { clearTimeout(t); t = null; } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, () => { clearTimeout(t); t = null; }));
  el.addEventListener('click', e => { if (scattato) { e.stopImmediatePropagation(); e.preventDefault(); scattato = false; } }, true);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
