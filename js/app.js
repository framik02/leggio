// Libreria, evidenziati, impostazioni e navigazione.
import { db, impostazioni, salvaImpostazioni, dizionario, salvaDizionario, tempoOggi, chiediPersistenza } from './db.js';
import { h, icona, bottoneIcona, foglio, avviso, conferma, copertinaFinta, minuti } from './ui.js';
import { importa, FORMATI, esportaEpub, esportaTxt, stampaPdf, originale, consegna, backupDati } from './libri.js';
import { voci, prova, etichettaQualita, disponibile } from './voce.js';

const radice = document.getElementById('app');
let urlCopertine = [];
let lettoreAperto = null;

// ---------------------------------------------------------------- navigazione
async function instrada() {
  const [, sezione, arg] = (location.hash || '#/').split('/');
  if (lettoreAperto && sezione !== 'libro') { lettoreAperto = null; }
  if (sezione === 'libro' && arg) {
    const { apriLettore } = await import('./lettore.js');
    lettoreAperto = await apriLettore(radice, arg, () => { location.hash = '#/'; });
    return;
  }
  document.body.classList.remove('in-lettura');
  if (sezione === 'evidenziati') return vistaEvidenziati();
  if (sezione === 'impostazioni') return vistaImpostazioni();
  return vistaLibreria();
}
window.addEventListener('hashchange', () => instrada().catch(mostraErrore));

function mostraErrore(e) {
  console.error(e);
  radice.replaceChildren(h('main', { class: 'vista' }, h('section', { class: 'benvenuto' },
    h('h2', {}, "Qualcosa non va con l'archivio"),
    h('p', {}, String(e && e.message || e)),
    h('button', { class: 'btn primario', onclick: () => location.reload() }, 'Ricarica'))));
}

export const installata = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function schede(attiva) {
  const v = (k, ic, t) => h('a', { href: `#/${k}`, class: attiva === k ? 'attiva' : '' }, icona(ic), h('span', {}, t));
  return h('nav', { class: 'schede' }, v('', 'libri', 'Libreria'), v('evidenziati', 'evidenzia', 'Evidenziati'), v('impostazioni', 'ingranaggio', 'Impostazioni'));
}

function copertina(libro, cls = '') {
  if (libro.copertina) {
    const u = URL.createObjectURL(libro.copertina); urlCopertine.push(u);
    return h('img', { class: `cop ${cls}`, src: u, alt: '', loading: 'lazy' });
  }
  return h('div', { class: `cop ${cls}` }, copertinaFinta(libro.titolo, libro.autore));
}

// ---------------------------------------------------------------- libreria
let filtro = 'tutti', ordine = 'recenti', ricerca = '';

async function vistaLibreria() {
  urlCopertine.forEach(u => URL.revokeObjectURL(u)); urlCopertine = [];
  const libri = await db.tutti('libri');
  const imp = await impostazioni();
  const secOggi = await tempoOggi();

  const input = h('input', { type: 'file', accept: FORMATI, multiple: true, hidden: true, onchange: e => importaFile([...e.target.files]) });
  const inLettura = libri.filter(l => l.aperto).sort((a, b) => b.aperto - a.aperto)[0];

  const minOggi = Math.floor(secOggi / 60);
  const pct = Math.min(1, minOggi / (imp.obiettivo || 20));
  const anello = h('div', { class: 'anello', title: `Obiettivo ${imp.obiettivo} minuti`, style: { '--p': pct } },
    h('span', {}, `${minOggi}`), h('small', {}, 'min'));

  const testa = h('header', { class: 'lib-testa' },
    h('div', {},
      h('div', { class: 'marchio' }, h('span', { class: 'marchio-segno' }), 'Leggio'),
      h('h1', {}, 'Libreria')),
    anello);

  const griglia = h('div', { class: 'griglia' });
  const disegnaGriglia = () => {
    let el = libri.filter(l => filtro === 'tutti' || l.stato === filtro);
    if (ricerca) { const q = ricerca.toLowerCase(); el = el.filter(l => `${l.titolo} ${l.autore}`.toLowerCase().includes(q)); }
    el.sort(ordine === 'titolo' ? (a, b) => a.titolo.localeCompare(b.titolo)
      : ordine === 'autore' ? (a, b) => (a.autore || '~').localeCompare(b.autore || '~')
        : (a, b) => (b.aperto || b.aggiunto) - (a.aperto || a.aggiunto));
    griglia.replaceChildren(...el.map(l => h('div', { class: 'libro' },
      h('a', { href: `#/libro/${l.id}`, class: 'libro-cop' }, copertina(l),
        l.stato === 'finito' ? h('span', { class: 'libro-finito' }, icona('spunta', 14)) : null,
        l.progresso > 0 && l.stato !== 'finito' ? h('span', { class: 'libro-prog', style: { '--p': l.progresso } }) : null),
      h('div', { class: 'libro-riga' },
        h('div', { class: 'libro-testi' },
          h('div', { class: 'libro-titolo' }, l.titolo),
          h('div', { class: 'libro-autore' }, l.autore || formatoBreve(l))),
        bottoneIcona('altro', 'Opzioni', () => schedaLibro(l), 'piccola')))));
    if (!el.length && libri.length) griglia.replaceChildren(h('p', { class: 'vuoto' }, 'Nessun libro con questi filtri.'));
  };

  const filtri = h('div', { class: 'filtri' });
  const disegnaFiltri = () => filtri.replaceChildren(
    ...[['tutti', 'Tutti'], ['in-lettura', 'In lettura'], ['da-leggere', 'Da leggere'], ['finito', 'Finiti']].map(([k, t]) =>
      h('button', { class: `pill ${filtro === k ? 'attivo' : ''}`, onclick: () => { filtro = k; disegnaFiltri(); disegnaGriglia(); } }, t)));
  const selOrdine = h('select', { class: 'ordine', 'aria-label': 'Ordina', onchange: e => { ordine = e.target.value; disegnaGriglia(); } },
    ...[['recenti', 'Recenti'], ['titolo', 'Titolo'], ['autore', 'Autore']].map(([k, t]) => h('option', { value: k, selected: ordine === k }, t)));
  disegnaFiltri();

  const cercaCampo = h('input', { class: 'campo cerca-lib', type: 'search', placeholder: 'Cerca titolo o autore', value: ricerca, oninput: e => { ricerca = e.target.value; disegnaGriglia(); } });

  const continua = inLettura ? h('section', { class: 'continua' },
    h('a', { href: `#/libro/${inLettura.id}`, class: 'continua-cop' }, copertina(inLettura)),
    h('div', { class: 'continua-testi' },
      h('div', { class: 'occhio' }, 'Continua'),
      h('div', { class: 'continua-titolo' }, inLettura.titolo),
      h('div', { class: 'continua-cap' }, inLettura.capitoli[inLettura.posizione?.cap || 0]?.titolo || ''),
      h('div', { class: 'continua-prog' }, h('div', { style: { width: `${(inLettura.progresso * 100).toFixed(1)}%` } })),
      h('div', { class: 'continua-meta' }, `${Math.round(inLettura.progresso * 100)}% · circa ${minuti((1 - inLettura.progresso) * inLettura.paroleTotali / 230 * 60)} alla fine`),
      h('div', { class: 'continua-bottoni' },
        h('a', { class: 'btn primario', href: `#/libro/${inLettura.id}` }, 'Leggi'),
        h('a', { class: 'btn', href: `#/libro/${inLettura.id}`, onclick: () => { sessionStorage.setItem('leggio-ascolta', '1'); try { speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch { /* sblocca la voce su iOS */ } } }, icona('cuffie', 18), 'Ascolta')))) : null;

  const vuota = !libri.length ? h('section', { class: 'benvenuto' },
    h('div', { class: 'benvenuto-segno' }, icona('libri', 40)),
    h('h2', {}, 'La tua libreria è vuota'),
    h('p', {}, 'Importa EPUB, PDF, TXT, Markdown, HTML o FB2 dall\'app File. I libri restano su questo telefono.'),
    h('button', { class: 'btn primario', onclick: () => input.click() }, icona('piu', 18), 'Importa un libro')) : null;

  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const avvisoBrowser = iOS && !installata() ? h('div', { class: 'avviso-browser' },
    h('strong', {}, 'Stai usando Leggio dentro Safari.'),
    h('p', {}, 'Safari e l\'icona sulla schermata Home tengono due librerie separate. Aggiungi Leggio alla Home (Condividi › Aggiungi alla schermata Home) e importa i libri da lì.')) : null;

  const fab = h('button', { class: 'fab', 'aria-label': 'Importa libri', onclick: () => input.click() }, icona('piu', 26));

  radice.replaceChildren(h('main', { class: 'vista libreria' }, testa, avvisoBrowser, continua, vuota,
    libri.length ? h('div', { class: 'strumenti' }, h('div', { class: 'cerca-riga' }, cercaCampo, selOrdine), filtri) : null,
    libri.length ? griglia : null, input), libri.length ? fab : null, schede(''));
  disegnaGriglia();
}

function formatoBreve(l) { return (l.formato || '').toUpperCase(); }

async function importaFile(files) {
  for (const f of files) {
    const av = avviso(`Importo ${f.name}…`, { fisso: true });
    try {
      const l = await importa(f, p => { av.firstChild.textContent = `Importo ${f.name}… ${Math.round(p * 100)}%`; });
      av.remove();
      avviso(`Aggiunto: ${l.titolo}`, { azione: { testo: 'Apri', fn: () => { location.hash = `#/libro/${l.id}`; } } });
    } catch (e) {
      av.remove();
      console.error(e);
      avviso(e.message || 'Import non riuscito', { durata: 6000 });
    }
  }
  if (!location.hash.startsWith('#/libro')) vistaLibreria();
}

function schedaLibro(l) {
  const lingue = { it: 'Italiano', en: 'Inglese' };
  const tit = h('input', { class: 'campo', value: l.titolo });
  const aut = h('input', { class: 'campo', value: l.autore || '', placeholder: 'Autore' });
  const salvaMeta = async () => { l.titolo = tit.value.trim() || l.titolo; l.autore = aut.value.trim(); await db.put('libri', l); };
  const lavora = async (fn, msg) => {
    const av = avviso(msg, { fisso: true });
    try { const f = await fn(); av.remove(); if (f) await consegna(f); } catch (e) { av.remove(); avviso(e.message || 'Non riuscito'); }
  };
  const f = foglio(null, h('div', { class: 'scheda-libro' },
    h('div', { class: 'sl-testa' }, copertina(l, 'piccola'),
      h('div', {}, h('div', { class: 'sl-titolo' }, l.titolo), h('div', { class: 'sl-meta' },
        `${formatoBreve(l)} · ${l.capitoli.length} capitoli · ${Math.round(l.paroleTotali / 1000)}k parole · ${minuti(l.paroleTotali / 230 * 60)} di lettura`))),
    h('div', { class: 'modulo' }, tit, aut,
      h('div', { class: 'segmenti' }, Object.entries(lingue).map(([k, v]) =>
        h('button', { class: l.lingua === k ? 'attivo' : '', onclick: async e => { l.lingua = k; await db.put('libri', l); e.target.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('attivo', b === e.target)); } }, v))),
      h('div', { class: 'segmenti' }, [['da-leggere', 'Da leggere'], ['in-lettura', 'In lettura'], ['finito', 'Finito']].map(([k, v]) =>
        h('button', { class: l.stato === k ? 'attivo' : '', onclick: async e => { l.stato = k; await db.put('libri', l); e.target.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('attivo', b === e.target)); } }, v)))),
    h('h3', { class: 'sl-sezione' }, 'Converti ed esporta'),
    h('div', { class: 'sl-esporta' },
      h('button', { class: 'btn', onclick: () => lavora(() => esportaEpub(l), 'Preparo l\'EPUB…') }, 'EPUB'),
      h('button', { class: 'btn', onclick: () => lavora(() => stampaPdf(l), 'Impagino il PDF…') }, 'PDF'),
      h('button', { class: 'btn', onclick: () => lavora(() => esportaTxt(l), 'Preparo il testo…') }, 'TXT'),
      h('button', { class: 'btn', onclick: () => lavora(() => originale(l), 'Recupero il file…') }, 'Originale')),
    h('p', { class: 'nota' }, 'Il PDF si apre nella stampa: scegli Condividi › Salva su File.'),
    h('button', { class: 'btn pericolo largo', onclick: async () => {
      if (await conferma('Eliminare il libro?', `«${l.titolo}» sparisce da questo telefono con evidenziati e note.`, 'Elimina')) {
        await db.eliminaLibro(l.id); f.chiudi(); avviso('Libro eliminato'); vistaLibreria();
      }
    } }, icona('cestino', 18), 'Elimina')),
  { allaChiusura: async () => { await salvaMeta(); if (!location.hash.startsWith('#/libro')) vistaLibreria(); } });
}

// ---------------------------------------------------------------- evidenziati
async function vistaEvidenziati() {
  const tutti = (await db.tutti('evidenziati')).filter(e => e.tipo !== 'segno');
  const libri = Object.fromEntries((await db.tutti('libri')).map(l => [l.id, l]));
  const perLibro = {};
  for (const e of tutti) if (libri[e.libro]) (perLibro[e.libro] ||= []).push(e);
  const blocchi = Object.entries(perLibro).sort((a, b) => Math.max(...b[1].map(e => e.data)) - Math.max(...a[1].map(e => e.data)));
  const esporta = async () => {
    const md = blocchi.map(([id, ev]) => `# ${libri[id].titolo}${libri[id].autore ? `\n${libri[id].autore}` : ''}\n\n` +
      ev.sort((a, b) => a.cap - b.cap || a.frase - b.frase).map(e => `> ${e.testo}${e.nota ? `\n\n${e.nota}` : ''}\n\n${e.capTitolo || ''}`).join('\n\n---\n\n')).join('\n\n\n');
    await consegna(new File([md], 'evidenziati-leggio.md', { type: 'text/markdown' }));
  };
  radice.replaceChildren(h('main', { class: 'vista' },
    h('header', { class: 'lib-testa' }, h('div', {}, h('div', { class: 'marchio' }, h('span', { class: 'marchio-segno' }), 'Leggio'), h('h1', {}, 'Evidenziati')),
      tutti.length ? h('button', { class: 'btn', onclick: esporta }, icona('condividi', 18), 'Esporta') : null),
    blocchi.length ? blocchi.map(([id, ev]) => h('section', { class: 'ev-libro' },
      h('h2', {}, libri[id].titolo, h('small', {}, ` ${ev.length}`)),
      ev.sort((a, b) => a.cap - b.cap || a.frase - b.frase).map(e => h('a', { class: `ev-voce c-${e.colore}`, href: `#/libro/${id}`, onclick: async () => { const l = libri[id]; l.posizione = { cap: e.cap, frase: e.frase }; await db.put('libri', l); } },
        h('span', { class: 'ev-testo' }, e.testo), e.nota ? h('span', { class: 'ev-nota-testo' }, e.nota) : null, h('span', { class: 'ev-cap' }, e.capTitolo || '')))))
      : h('p', { class: 'vuoto' }, 'Durante la lettura tieni premuto su una frase per evidenziarla. Qui trovi tutto, libro per libro.')),
  schede('evidenziati'));
}

// ---------------------------------------------------------------- impostazioni
async function vistaImpostazioni() {
  const imp = await impostazioni();
  let regole = await dizionario();
  const libri = Object.fromEntries((await db.tutti('libri')).map(l => [l.id, l.titolo]));
  const sezVoci = h('div');
  const disegnaVoci = async () => {
    if (!disponibile()) { sezVoci.replaceChildren(h('p', { class: 'nota' }, 'Sintesi vocale non disponibile.')); return; }
    const righe = [];
    for (const [k, nome, frase] of [['it', 'Italiano', 'Buongiorno, questa è la mia voce.'], ['en', 'Inglese', 'Hello, this is my voice.']]) {
      const elenco = await voci(k);
      const sel = h('select', { class: 'campo', onchange: e => salvaImpostazioni({ [`voce_${k}`]: e.target.value }) },
        elenco.map(v => h('option', { value: v.voiceURI, selected: imp[`voce_${k}`] === v.voiceURI }, `${v.name.replace(/\s*\(.*\)$/, '')}${etichettaQualita(v) ? ' · ' + etichettaQualita(v) : ''}`)));
      righe.push(h('div', { class: 'imp-voce' }, h('span', { class: 'imp-etichetta' }, nome), sel,
        bottoneIcona('orecchio', 'Prova', () => prova(elenco.find(v => v.voiceURI === sel.value) || elenco[0], frase, imp.velocita))));
    }
    sezVoci.replaceChildren(...righe);
  };
  disegnaVoci();

  const sezDiz = h('div', { class: 'diz' });
  const disegnaDiz = () => sezDiz.replaceChildren(regole.length ? h('ul', { class: 'diz-lista' }, regole.map(r => h('li', {},
    h('span', { class: 'diz-da' }, r.da), h('span', { class: 'diz-freccia' }, '→'), h('span', { class: 'diz-a' }, r.a),
    h('span', { class: 'diz-ambito' }, r.libro ? (libri[r.libro] || 'libro eliminato') : `tutti · ${r.lingua}`),
    bottoneIcona('cestino', 'Elimina regola', async () => { regole = regole.filter(x => x !== r); await salvaDizionario(regole); disegnaDiz(); }, 'piccola'))))
    : h('p', { class: 'nota' }, 'Ancora nessuna correzione. Mentre ascolti, tieni premuto su una frase e scegli Correggi pronuncia.'));
  disegnaDiz();

  const toggle = (chiave, testo) => h('label', { class: 'interruttore' }, h('span', {}, testo),
    h('input', { type: 'checkbox', checked: imp[chiave], onchange: e => salvaImpostazioni({ [chiave]: e.target.checked }) }));
  const numero = (chiave, testo, min, max, passo, unita) => {
    const v = h('span', { class: 'imp-num' }, `${imp[chiave]} ${unita}`);
    return h('label', { class: 'asp-cursore' }, h('span', {}, testo, ' ', v),
      h('input', { type: 'range', min, max, step: passo, value: imp[chiave], oninput: e => { v.textContent = `${e.target.value} ${unita}`; }, onchange: e => salvaImpostazioni({ [chiave]: +e.target.value }) }));
  };

  let spazio = '';
  try { const s = await navigator.storage.estimate(); spazio = `${(s.usage / 1048576).toFixed(0)} MB usati su ${(s.quota / 1073741824).toFixed(1)} GB disponibili`; } catch { /* niente */ }
  let persistente = false;
  try { persistente = await navigator.storage.persisted(); } catch { /* niente */ }

  radice.replaceChildren(h('main', { class: 'vista impostazioni' },
    h('header', { class: 'lib-testa' }, h('div', {}, h('div', { class: 'marchio' }, h('span', { class: 'marchio-segno' }), 'Leggio'), h('h1', {}, 'Impostazioni'))),
    h('section', { class: 'imp-sez' }, h('h2', {}, 'Voci'),
      h('p', { class: 'nota' }, 'La voce si sceglie per lingua, e ogni libro può averne una sua dal lettore. Per voci più naturali scarica le versioni premium o avanzate in Impostazioni › Accessibilità › Contenuto letto ad alta voce › Voci.'),
      sezVoci),
    h('section', { class: 'imp-sez' }, h('h2', {}, 'Tono della lettura'),
      toggle('dialoghiVivaci', 'Dialoghi più vivaci'),
      numero('pausaParagrafo', 'Pausa fra paragrafi', 0, 1200, 50, 'ms'),
      numero('pausaScena', 'Pausa ai cambi di scena', 300, 3000, 100, 'ms'),
      toggle('segui', 'Il testo segue la voce')),
    h('section', { class: 'imp-sez' }, h('h2', {}, 'Pronunce imparate'), sezDiz),
    h('section', { class: 'imp-sez' }, h('h2', {}, 'Obiettivo'),
      numero('obiettivo', 'Minuti al giorno', 5, 120, 5, 'min')),
    h('section', { class: 'imp-sez' }, h('h2', {}, 'Dati'),
      h('p', { class: 'nota' }, `Tutto resta su questo telefono. ${spazio}. ${persistente ? 'Archivio protetto dalla pulizia automatica.' : 'Archivio non ancora protetto dalla pulizia automatica.'}`),
      h('p', { class: 'nota' }, `Libri nell'archivio: ${Object.keys(libri).length}. ${installata() ? 'Stai usando l\'app installata.' : 'Stai usando Leggio dentro il browser: i libri importati qui non compaiono nell\'icona sulla schermata Home, che ha un archivio separato.'}`),
      h('button', { class: 'btn largo', onclick: async () => consegna(await backupDati()) }, icona('condividi', 18), 'Copia di sicurezza di note e progressi')),
    h('p', { class: 'firma' }, 'Leggio · versione 0.1.1')),
  schede('impostazioni'));
}

// ---------------------------------------------------------------- avvio
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (installata()) chiediPersistenza();
instrada().catch(mostraErrore);
