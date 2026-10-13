// Strumenti comuni a tutti i formati: pulizia dell'HTML, taglio in frasi, lingua.

const BLOCCHI = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'DD', 'DT',
  'FIGCAPTION', 'TD', 'TH', 'PRE', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'FIGURE',
  'UL', 'OL', 'DL', 'TABLE', 'TBODY', 'THEAD', 'TR', 'HR', 'NAV', 'MAIN', 'CAPTION']);

const AMMESSI = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'EM', 'I', 'B', 'STRONG', 'U', 'S',
  'BLOCKQUOTE', 'UL', 'OL', 'LI', 'BR', 'HR', 'IMG', 'SUP', 'SUB', 'SPAN', 'DIV', 'SECTION', 'FIGURE',
  'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'CODE', 'SMALL', 'DL', 'DT', 'DD',
  'CITE', 'Q', 'ABBR', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'CAPTION', 'A', 'MARK']);

const VIA = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT',
  'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'LINK', 'META', 'TITLE', 'HEAD', 'NAV']);

// Pulisce un body: tiene solo struttura e stile del testo. Le immagini passano
// per `risolviImg`, che restituisce la chiave della risorsa salvata o null.
export function pulisci(radice, risolviImg) {
  const doc = radice.ownerDocument;
  const fuori = doc.createElement('div');
  const copia = (n, dest) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) { dest.appendChild(doc.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.localName ? c.localName.toUpperCase() : c.nodeName.toUpperCase();
      if (VIA.has(tag)) continue;
      if (tag === 'IMG' || tag === 'IMAGE') {
        const src = c.getAttribute('src') || c.getAttribute('xlink:href') || c.getAttribute('href');
        const chiave = src && risolviImg ? risolviImg(src) : null;
        if (chiave) {
          const img = doc.createElement('img');
          img.setAttribute('data-risorsa', chiave);
          img.setAttribute('alt', c.getAttribute('alt') || '');
          dest.appendChild(img);
        }
        continue;
      }
      if (!AMMESSI.has(tag)) { copia(c, dest); continue; }
      const el = doc.createElement(tag === 'A' ? 'span' : tag.toLowerCase());
      if (tag === 'TD' || tag === 'TH') {
        const cs = c.getAttribute('colspan'); if (cs) el.setAttribute('colspan', cs);
      }
      copia(c, el);
      dest.appendChild(el);
    }
  };
  copia(radice, fuori);
  return fuori;
}

function eBlocco(el) { return el.nodeType === 1 && BLOCCHI.has(el.nodeName.toUpperCase()); }

function haBlocchiFigli(el) {
  for (const c of el.children) if (eBlocco(c) || haBlocchiFigli(c)) return true;
  return false;
}

const SCENA = /^\s*([*·•~#✻⁂❦◆-]\s*){1,5}\s*$/;

let _seg = {};
function segmentatore(lingua) {
  const l = lingua || 'it';
  if (!_seg[l]) {
    try { _seg[l] = new Intl.Segmenter(l, { granularity: 'sentence' }); } catch { _seg[l] = null; }
  }
  return _seg[l];
}

// Divide il testo di un blocco in frasi. Restituisce gli indici di fine.
function confini(testo, lingua) {
  const s = segmentatore(lingua);
  const fini = [];
  if (s) {
    for (const p of s.segment(testo)) fini.push(p.index + p.segment.length);
  } else {
    const re = /[^.!?…]+[.!?…]+["»”’)\]]*\s*|[^.!?…]+$/g;
    let m; while ((m = re.exec(testo))) fini.push(m.index + m[0].length);
  }
  // Unisce i pezzi senza lettere (es. "…") al precedente e spezza le frasi lunghissime.
  const out = [];
  let ini = 0;
  for (const f of fini) {
    const pezzo = testo.slice(ini, f);
    if (out.length && !/[\p{L}\p{N}]/u.test(pezzo)) { out[out.length - 1] = f; ini = f; continue; }
    if (pezzo.length > 420) {
      let a = ini;
      const re = /[;:,]\s+/g; re.lastIndex = 0;
      const sub = testo.slice(ini, f);
      let m, ultimo = 0;
      while ((m = re.exec(sub))) {
        const pos = m.index + m[0].length;
        if (pos - ultimo > 180) { out.push(a + pos); ultimo = pos; }
      }
      a = ini;
    }
    out.push(f);
    ini = f;
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

// Avvolge ogni frase in <span class="s" data-s="n">. Una frase che attraversa
// un corsivo diventa più span con lo stesso numero, così la formattazione resta.
export function segmenta(contenitore, lingua) {
  const doc = contenitore.ownerDocument;
  let n = 0;
  let parole = 0;
  const foglie = [];
  const visita = el => {
    for (const c of Array.from(el.children)) {
      if (!eBlocco(c)) continue;
      if (c.nodeName === 'HR') continue;
      if (haBlocchiFigli(c)) visita(c); else foglie.push(c);
    }
  };
  // Testo sciolto direttamente nel contenitore: lo chiude in un paragrafo.
  const sciolti = [];
  let corrente = null;
  for (const c of Array.from(contenitore.childNodes)) {
    if ((c.nodeType === 3 && c.nodeValue.trim()) || (c.nodeType === 1 && !eBlocco(c))) {
      if (!corrente) { corrente = doc.createElement('p'); contenitore.insertBefore(corrente, c); sciolti.push(corrente); }
      corrente.appendChild(c);
    } else if (c.nodeType === 1) corrente = null;
  }
  visita(contenitore);

  for (const b of foglie) {
    const testo = b.textContent;
    if (!testo.trim()) continue;
    if (SCENA.test(testo)) { b.setAttribute('data-scena', ''); continue; }
    // Mappa dei nodi di testo con le loro posizioni.
    const nodi = [];
    const w = doc.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let pos = 0, t;
    while ((t = w.nextNode())) { nodi.push({ t, da: pos, a: pos + t.nodeValue.length }); pos += t.nodeValue.length; }
    const fini = confini(testo, lingua);
    let ini = 0;
    const frasi = fini.map(f => { const r = [ini, f, n++]; ini = f; return r; });
    for (const { t: nodo, da, a } of nodi) {
      const pezzi = [];
      for (const [fd, fa, id] of frasi) {
        const x = Math.max(da, fd), y = Math.min(a, fa);
        if (x < y) pezzi.push([x - da, y - da, id]);
      }
      if (!pezzi.length) continue;
      const frag = doc.createDocumentFragment();
      for (const [x, y, id] of pezzi) {
        const txt = nodo.nodeValue.slice(x, y);
        if (!txt.trim()) { frag.appendChild(doc.createTextNode(txt)); continue; }
        const sp = doc.createElement('span');
        sp.className = 's';
        sp.setAttribute('data-s', id);
        sp.textContent = txt;
        frag.appendChild(sp);
      }
      nodo.parentNode.replaceChild(frag, nodo);
    }
    parole += (testo.match(/[\p{L}\p{N}]+/gu) || []).length;
  }
  return { frasi: n, parole };
}

// Lingua: italiano o inglese, contando le parole più frequenti.
const PAROLE = {
  it: ['il', 'di', 'che', 'e', 'la', 'un', 'non', 'per', 'una', 'del', 'della', 'gli', 'con', 'è', 'sono', 'come', 'ma', 'si', 'nel', 'anche'],
  en: ['the', 'of', 'and', 'to', 'a', 'in', 'that', 'is', 'was', 'he', 'for', 'it', 'with', 'as', 'his', 'on', 'be', 'at', 'by', 'i'],
};
export function indovinaLingua(testo, dichiarata) {
  const d = (dichiarata || '').toLowerCase().slice(0, 2);
  if (d === 'it' || d === 'en') return d;
  const campione = testo.slice(0, 20000).toLowerCase().match(/\p{L}+/gu) || [];
  const conta = { it: 0, en: 0 };
  const insiemi = { it: new Set(PAROLE.it), en: new Set(PAROLE.en) };
  for (const p of campione) { if (insiemi.it.has(p)) conta.it++; if (insiemi.en.has(p)) conta.en++; }
  if (d && !conta.it && !conta.en) return d;
  return conta.en > conta.it ? 'en' : 'it';
}

// Costruisce un capitolo pronto da salvare a partire da un contenitore pulito.
export function capitolo(contenitore, titolo, n, lingua) {
  const { frasi, parole } = segmenta(contenitore, lingua);
  return { n, titolo, html: contenitore.innerHTML, frasi, parole };
}

export function titoloDaContenuto(contenitore) {
  const h = contenitore.querySelector('h1,h2,h3');
  const t = h ? h.textContent.trim().replace(/\s+/g, ' ') : '';
  return t.length > 2 && t.length < 120 ? t : '';
}

export function escape(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Testo semplice → paragrafi e capitoli. Usato da TXT, Markdown e PDF.
const RE_CAPITOLO = /^\s*(capitolo|chapter|parte|part|libro|book|prologo|prologue|epilogo|epilogue|introduzione|introduction|prefazione|preface)\b.{0,80}$|^\s*([IVXLC]{1,7}|\d{1,3})\.?\s*$/i;

export function capitoliDaParagrafi(paragrafi, lingua, opz = {}) {
  // paragrafi: [{ testo, titolo?: bool }]
  const gruppi = [];
  let att = null;
  for (const p of paragrafi) {
    const eTitolo = p.titolo || (p.testo.length < 90 && RE_CAPITOLO.test(p.testo));
    if (eTitolo && (!att || att.corpo.length)) {
      att = { titolo: p.testo.trim(), corpo: [] };
      gruppi.push(att);
      continue;
    }
    if (!att) { att = { titolo: '', corpo: [] }; gruppi.push(att); }
    att.corpo.push(p.testo);
  }
  // Senza capitoli riconoscibili: blocchi di circa 4.000 parole.
  let finali = gruppi;
  if (gruppi.length <= 1 && paragrafi.length > 60) {
    finali = [];
    let blocco = null, conta = 0;
    for (const t of gruppi[0]?.corpo || []) {
      if (!blocco || conta > (opz.paroleBlocco || 4000)) { blocco = { titolo: '', corpo: [] }; finali.push(blocco); conta = 0; }
      blocco.corpo.push(t);
      conta += t.split(/\s+/).length;
    }
  }
  // Nessun capitolo oltre le 5.000 parole: un blocco enorme rallenta il telefono.
  const MAX = 5000;
  const spezzati = [];
  for (const g of finali) {
    let parte = { titolo: g.titolo, corpo: [] }, conta = 0, k = 1;
    spezzati.push(parte);
    for (const t of g.corpo) {
      const n = t.split(/\s+/).length;
      if (conta + n > MAX && parte.corpo.length) {
        k++;
        parte = { titolo: g.titolo ? `${g.titolo} (${k})` : '', corpo: [] };
        spezzati.push(parte); conta = 0;
      }
      parte.corpo.push(t); conta += n;
    }
  }
  finali = spezzati;
  const doc = document.implementation.createHTMLDocument('');
  return finali.filter(g => g.corpo.length || g.titolo).map((g, i) => {
    const div = doc.createElement('div');
    if (g.titolo) { const h = doc.createElement('h2'); h.textContent = g.titolo; div.appendChild(h); }
    for (const t of g.corpo) { const pp = doc.createElement('p'); pp.textContent = t; div.appendChild(pp); }
    const titolo = g.titolo || (finali.length > 1 ? `Parte ${i + 1}` : 'Testo');
    return capitolo(div, titolo, i, lingua);
  });
}
