// Funzioni in più: evidenziati esportati, statistiche, riassunto del già letto,
// significato delle parole, copertine dal web.
import { db, oggi } from './db.js';
import { h, icona, foglio, avviso, minuti } from './ui.js';
import { escape } from './import/comune.js';

const PAROLE_PAGINA = 275;

// ---------------------------------------------------------------- pagina di una frase
function testiFrasi(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  const m = new Map();
  for (const sp of d.querySelectorAll('span.s')) m.set(+sp.dataset.s, (m.get(+sp.dataset.s) || '') + sp.textContent);
  return { d, m };
}

export async function paginaDi(libro, cap, frase) {
  const c = await db.get('capitoli', [libro.id, cap]);
  if (!c) return '';
  if (libro.pagine === 'stampa') {
    const i = c.html.indexOf(`data-s="${frase}"`);
    const prima = c.html.slice(0, i < 0 ? c.html.length : i);
    const m = [...prima.matchAll(/data-pag="([^"]+)"/g)].pop();
    if (m) return m[1];
    for (let k = cap - 1; k >= 0; k--) if (libro.capitoli[k].pag) return libro.capitoli[k].pag[1];
    return '';
  }
  const { m } = testiFrasi(c.html);
  let parole = libro.capitoli.slice(0, cap).reduce((s, x) => s + x.parole, 0);
  for (const [id, t] of m) if (id < frase) parole += (t.match(/[\p{L}\p{N}]+/gu) || []).length;
  return String(Math.floor(parole / PAROLE_PAGINA) + 1);
}

// ---------------------------------------------------------------- evidenziati esportati
async function raccogli(libro) {
  const ev = (await db.perIndice('evidenziati', 'libro', libro.id)).filter(e => e.tipo !== 'segno')
    .sort((a, b) => a.cap - b.cap || a.frase - b.frase);
  for (const e of ev) e.pagina = await paginaDi(libro, e.cap, e.da?.s ?? e.frase);
  return ev;
}

export async function esportaEvidenziatiMd(libro) {
  const ev = await raccogli(libro);
  if (!ev.length) throw new Error('Questo libro non ha ancora evidenziati.');
  let cap = null;
  const righe = [`# ${libro.titolo}`, libro.autore ? `*${libro.autore}*` : '', `${ev.length} evidenziati, esportati da Leggio il ${new Date().toLocaleDateString('it-IT')}`, ''];
  for (const e of ev) {
    if (e.cap !== cap) { cap = e.cap; righe.push(`## ${libro.capitoli[cap]?.titolo || ''}`, ''); }
    righe.push(`> ${e.testo}`, '', `— pag. ${e.pagina || '?'}`);
    if (e.nota) righe.push('', `**Nota.** ${e.nota}`);
    righe.push('');
  }
  const nome = `${libro.titolo.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)} - evidenziati.md`;
  return new File([righe.join('\n')], nome, { type: 'text/markdown' });
}

export async function stampaEvidenziati(libro) {
  const ev = await raccogli(libro);
  if (!ev.length) throw new Error('Questo libro non ha ancora evidenziati.');
  const colori = { giallo: '#FCE7A0', ciano: '#BFE6EF', lilla: '#E3D6F5' };
  let cap = null;
  const corpo = ev.map(e => {
    const testa = e.cap !== cap ? `<h2>${escape(libro.capitoli[(cap = e.cap)]?.titolo || '')}</h2>` : '';
    return `${testa}<blockquote style="border-left-color:${colori[e.colore] || colori.giallo}"><p>${escape(e.testo)}</p><span>pag. ${escape(e.pagina || '?')}</span>${e.nota ? `<p class="nota">${escape(e.nota)}</p>` : ''}</blockquote>`;
  }).join('');
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${escape(libro.titolo)} · evidenziati</title><style>
@page{size:A5;margin:16mm}body{font-family:Georgia,serif;color:#111;background:#fff;font-size:10.5pt;line-height:1.45}
h1{font-size:18pt;margin:0 0 2pt}h2{font-size:12pt;margin:18pt 0 6pt;border-bottom:1px solid #ddd;padding-bottom:3pt}
.autore{color:#555;margin:0 0 14pt}blockquote{margin:0 0 10pt;padding:2pt 0 2pt 10pt;border-left:4pt solid #FCE7A0;break-inside:avoid}
blockquote p{margin:0}blockquote span{display:block;color:#777;font-size:9pt;margin-top:2pt}.nota{font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;background:#F6F2EA;padding:4pt 6pt;margin-top:4pt!important}
</style></head><body><h1>${escape(libro.titolo)}</h1><p class="autore">${escape(libro.autore || '')}</p>${corpo}</body></html>`;
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(ifr);
  ifr.contentDocument.open(); ifr.contentDocument.write(html); ifr.contentDocument.close();
  await new Promise(ok => setTimeout(ok, 300));
  ifr.contentWindow.focus(); ifr.contentWindow.print();
  setTimeout(() => ifr.remove(), 60000);
}

// ---------------------------------------------------------------- statistiche
function giorno(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export async function apriStatistiche() {
  const diario = Object.fromEntries(await db.coppie('diario'));
  const libri = await db.tutti('libri');
  const oggiD = new Date();
  // Giorni di fila con almeno un minuto, contando da oggi o da ieri.
  let fila = 0;
  const d = new Date(oggiD);
  if (!((diario[giorno(d)] || 0) >= 60)) d.setDate(d.getDate() - 1);
  while ((diario[giorno(d)] || 0) >= 60) { fila++; d.setDate(d.getDate() - 1); }
  const settimana = [];
  for (let k = 6; k >= 0; k--) { const x = new Date(oggiD); x.setDate(x.getDate() - k); settimana.push({ g: x, min: Math.round((diario[giorno(x)] || 0) / 60) }); }
  const totSett = settimana.reduce((s, x) => s + x.min, 0);
  const totale = Object.values(diario).reduce((s, x) => s + x, 0);
  const anno = oggiD.getFullYear();
  const finitiAnno = libri.filter(l => l.stato === 'finito' && (!l.finito || new Date(l.finito).getFullYear() === anno));
  const max = Math.max(30, ...settimana.map(x => x.min));
  const giorniNomi = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
  const W = 300, H = 120, larg = 30, passo = (W - larg) / 6;
  const barre = settimana.map((x, i) => {
    const alt = Math.round((x.min / max) * (H - 40));
    const xx = i * passo;
    return `<rect x="${xx}" y="${H - 18 - alt}" width="${larg}" height="${Math.max(2, alt)}" rx="5" fill="${giorno(x.g) === oggi() ? '#B4532A' : '#D9CBB8'}"/>
      <text x="${xx + larg / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#6F6A62">${giorniNomi[x.g.getDay()]}</text>
      ${x.min ? `<text x="${xx + larg / 2}" y="${H - 22 - alt}" text-anchor="middle" font-size="10" fill="#6F6A62">${x.min}</text>` : ''}`;
  }).join('');
  const grafico = h('div', { class: 'stat-grafico', html: `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Minuti di lettura negli ultimi sette giorni">${barre}</svg>` });
  const riquadro = (n, t) => h('div', { class: 'stat-riq' }, h('strong', {}, n), h('span', {}, t));
  foglio('Statistiche', h('div', { class: 'statistiche' },
    h('div', { class: 'stat-griglia' },
      riquadro(fila, fila === 1 ? 'giorno di fila' : 'giorni di fila'),
      riquadro(minuti(totSett * 60), 'questa settimana'),
      riquadro(finitiAnno.length, `libri finiti nel ${anno}`),
      riquadro(minuti(totale), 'in tutto con Leggio')),
    h('h3', { class: 'sl-sezione' }, 'Ultimi sette giorni, in minuti'), grafico,
    finitiAnno.length ? h('div', {}, h('h3', { class: 'sl-sezione' }, `Finiti nel ${anno}`),
      h('ul', { class: 'stat-finiti' }, finitiAnno.map(l => h('li', {}, h('strong', {}, l.titolo), l.autore ? ` · ${l.autore}` : '')))) : null,
    h('p', { class: 'nota' }, 'Si contano lettura e ascolto, un minuto alla volta, solo quando stai davvero leggendo o la voce va.')));
}

// ---------------------------------------------------------------- riassunto del già letto
const VUOTE = new Set(('il lo la i gli le un uno una di a da in con su per tra fra e o ma se che non come più anche ci si ne mi ti vi del della dei degli delle al alla ai agli alle dal dalla nel nella sul sulla è era sono fu ha aveva hanno essere stato questo questa quello quella così poi già ancora quando dove chi cosa perché mio mia suo sua loro lui lei io tu noi voi ' +
  'the a an of to in on at for with and or but if that this it is was were be been he she they we you i his her their my not as by from so then when what who').split(' '));

export function riassunto(frasi, quante = 6) {
  // Frasi più rappresentative del tratto letto: parole frequenti, frasi né troppo corte né troppo lunghe.
  const freq = new Map();
  const parole = t => (t.toLowerCase().match(/\p{L}{4,}/gu) || []).filter(p => !VUOTE.has(p));
  for (const f of frasi) for (const p of parole(f.testo)) freq.set(p, (freq.get(p) || 0) + 1);
  const punteggio = f => {
    const ps = parole(f.testo);
    if (ps.length < 5 || f.testo.length > 400) return -1;
    return ps.reduce((s, p) => s + (freq.get(p) || 0), 0) / Math.sqrt(ps.length);
  };
  const scelte = frasi.map((f, i) => ({ f, i, p: punteggio(f) })).filter(x => x.p > 0).sort((a, b) => b.p - a.p).slice(0, quante).sort((a, b) => a.i - b.i);
  return scelte.map(x => x.f.testo.trim());
}

export async function apriRiassunto(libro, cap, fraseAttuale, leggi) {
  // Il tratto da riassumere: il capitolo fino a qui, più il precedente se si è appena all'inizio.
  const raccolte = [];
  for (const n of [cap - 1, cap]) {
    if (n < 0) continue;
    const c = await db.get('capitoli', [libro.id, n]);
    if (!c) continue;
    const { m } = testiFrasi(c.html);
    for (const [id, t] of m) if (n < cap || id < fraseAttuale) raccolte.push({ testo: t, cap: n });
  }
  const tratto = raccolte.filter(x => x.cap === cap).length >= 25 ? raccolte.filter(x => x.cap === cap) : raccolte;
  const frasi = riassunto(tratto, 6);
  foglio('Dove eravamo rimasti', h('div', { class: 'riassunto' },
    frasi.length ? h('ol', {}, frasi.map(t => h('li', {}, t))) : h('p', { class: 'nota' }, 'Hai letto ancora troppo poco per un riassunto.'),
    h('p', { class: 'nota' }, 'Le frasi più importanti del tratto appena letto, scelte dal testo stesso. Niente intelligenza artificiale e niente rete: funziona anche offline.'),
    frasi.length && leggi ? h('button', { class: 'btn primario largo', onclick: () => leggi(frasi.join(' ')) }, icona('cuffie', 18), 'Ascolta il riassunto') : null));
}

// ---------------------------------------------------------------- significato e traduzione
export async function apriSignificato(parola, lingua) {
  parola = parola.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!parola) return;
  const corpo = h('div', { class: 'significato' }, h('p', { class: 'nota' }, 'Cerco…'));
  foglio(parola, corpo);
  const parti = [];
  // Definizione dal Wikizionario della lingua del libro.
  try {
    const sito = lingua === 'en' ? 'en' : 'it';
    const u = `https://${sito}.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(parola.toLowerCase())}`;
    const j = await (await fetch(u)).json();
    const pag = Object.values(j.query?.pages || {})[0];
    let testo = pag?.extract || '';
    if (testo) {
      // Si tiene la sezione della lingua giusta e le prime righe di definizione.
      const sez = lingua === 'en' ? /==\s*English\s*==([\s\S]*?)(\n==[^=]|$)/ : /==\s*Italiano\s*==([\s\S]*?)(\n==[^=]|$)/;
      const m = testo.match(sez);
      if (m) testo = m[1];
      const righe = testo.split('\n').map(r => r.trim()).filter(r => r && !/^=+/.test(r) && r.length > 3).slice(0, 8);
      if (righe.length) parti.push(h('h3', { class: 'sl-sezione' }, 'Significato'), h('div', { class: 'sig-def' }, righe.map(r => h('p', {}, r))));
    }
  } catch { /* rete */ }
  // Traduzione: inglese → italiano, oppure italiano → inglese, con le alternative per categoria.
  const da = lingua === 'en' ? 'en' : 'it', a = lingua === 'en' ? 'it' : 'en';
  const CATEGORIE = { noun: 'sostantivo', verb: 'verbo', adjective: 'aggettivo', adverb: 'avverbio', pronoun: 'pronome', preposition: 'preposizione', conjunction: 'congiunzione', interjection: 'interiezione', sostantivo: 'sostantivo', verbo: 'verbo', aggettivo: 'aggettivo', avverbio: 'avverbio' };
  try {
    const j = await (await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${da}&tl=${a}&dt=t&dt=bd&q=${encodeURIComponent(parola)}`)).json();
    const principale = j?.[0]?.[0]?.[0];
    const alternative = (j?.[1] || []).map(([cat, termini]) => h('p', {}, h('em', {}, `${CATEGORIE[cat] || cat}: `), termini.slice(0, 5).join(', ')));
    if (principale) parti.push(h('h3', { class: 'sl-sezione' }, a === 'it' ? 'In italiano' : 'In inglese'), h('p', { class: 'sig-trad' }, principale), ...alternative);
  } catch {
    try {
      const j = await (await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(parola)}&langpair=${da}|${a}`)).json();
      const t = j.responseData?.translatedText;
      if (t && t.toLowerCase() !== parola.toLowerCase()) parti.push(h('h3', { class: 'sl-sezione' }, a === 'it' ? 'In italiano' : 'In inglese'), h('p', { class: 'sig-trad' }, t));
    } catch { /* rete */ }
  }
  parti.push(h('a', { class: 'btn largo', href: `https://${lingua === 'en' ? 'en' : 'it'}.wiktionary.org/wiki/${encodeURIComponent(parola.toLowerCase())}`, target: '_blank', rel: 'noopener' }, 'Apri il Wikizionario'));
  corpo.replaceChildren(...(parti.length > 1 ? parti : [h('p', { class: 'nota' }, 'Non ho trovato la parola: serve la rete, o la parola è un nome proprio.'), ...parti]));
}

// ---------------------------------------------------------------- copertine dal web
async function candidate(libro) {
  const out = [];
  const q = encodeURIComponent(`${libro.titolo} ${libro.autore || ''}`.trim());
  try {
    const j = await (await fetch(`https://openlibrary.org/search.json?q=${q}&limit=8&fields=cover_i,title,author_name`)).json();
    for (const d of j.docs || []) if (d.cover_i) out.push({ url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`, titolo: d.title, autore: (d.author_name || [])[0] || '' });
  } catch { /* rete */ }
  try {
    const j = await (await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=8`)).json();
    for (const v of j.items || []) {
      const img = v.volumeInfo?.imageLinks?.thumbnail;
      if (img) out.push({ url: img.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=2'), titolo: v.volumeInfo.title, autore: (v.volumeInfo.authors || [])[0] || '' });
    }
  } catch { /* rete */ }
  return out;
}

export async function cercaCopertina(libro, dopo) {
  const corpo = h('div', { class: 'copertine' }, h('p', { class: 'nota' }, 'Cerco su Open Library e Google Libri…'));
  const f = foglio('Scegli la copertina', corpo, { alto: true });
  const lista = await candidate(libro);
  if (!lista.length) { corpo.replaceChildren(h('p', { class: 'nota' }, 'Nessuna copertina trovata. Controlla titolo e autore, poi riprova.')); return; }
  corpo.replaceChildren(
    h('p', { class: 'nota' }, 'Tocca quella giusta.'),
    h('div', { class: 'cop-griglia' }, lista.map(c => h('button', { class: 'cop-scelta', onclick: async () => {
      try {
        const b = await (await fetch(c.url)).blob();
        if (!b.type.startsWith('image/') || b.size < 2000) throw new Error();
        libro.copertina = new Blob([await b.arrayBuffer()], { type: b.type });
        await db.put('libri', libro);
        f.chiudi(); avviso('Copertina aggiornata'); dopo && dopo();
      } catch { avviso('Questa immagine non si scarica, provane un\'altra'); }
    } }, h('img', { src: c.url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), h('small', {}, c.titolo)))));
}
