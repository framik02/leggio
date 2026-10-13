// Libreria, evidenziati, impostazioni e navigazione.
import { db, impostazioni, salvaImpostazioni, dizionario, salvaDizionario, tempoOggi, chiediPersistenza } from './db.js';
import { h, icona, bottoneIcona, foglio, avviso, conferma, copertinaFinta, minuti } from './ui.js';
import { importa, FORMATI, esportaEpub, esportaTxt, stampaPdf, originale, consegna } from './libri.js';
import { voci, prova, etichettaQualita, disponibile } from './voce.js';

const radice = document.getElementById('app');
let urlCopertine = [];
let lettoreAperto = null;

// ---------------------------------------------------------------- navigazione
async function instrada() {
  // Cambiando pagina si chiudono i fogli rimasti aperti.
  document.querySelectorAll('.foglio, .foglio-sfondo').forEach(e => e.remove());
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
    h('p', {}, 'Di solito succede quando il browser ha cancellato una parte dei dati. Ripara toglie solo quello che non si legge più.'),
    h('button', { class: 'btn primario', onclick: async () => {
      try { const n = await db.ripara(); avviso(`Archivio riparato, ${n} elementi tolti`); setTimeout(() => location.reload(), 1200); }
      catch (err) { avviso(err.message || 'Riparazione non riuscita', { durata: 6000 }); }
    } }, "Ripara l'archivio"),
    h('button', { class: 'btn', onclick: () => location.reload() }, 'Ricarica'),
    h('button', { class: 'btn pericolo', onclick: async () => {
      if (!(await conferma('Ricominciare da zero?', 'Libri, note e voci su questo telefono vengono cancellati. Se hai una copia completa la puoi ripristinare dopo.', 'Cancella tutto'))) return;
      indexedDB.deleteDatabase('leggio');
      setTimeout(() => location.reload(), 800);
    } }, 'Ricomincia da zero'))));
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

  const avvisoBrowser = avvisoNavigatore();
  const nRotti = db.numeroRotti();
  const avvisoRotti = nRotti ? h('div', { class: 'avviso-browser' },
    h('strong', {}, `${nRotti} elementi dell'archivio non si leggono più.`),
    h('p', {}, 'Il browser ha cancellato una parte dei dati. Toglili per rimettere in ordine la libreria.'),
    h('button', { class: 'btn', onclick: async () => { const n = await db.ripara(); avviso(`${n} elementi tolti`); vistaLibreria(); } }, 'Togli gli elementi rovinati')) : null;

  const fab = h('button', { class: 'fab', 'aria-label': 'Importa libri', onclick: () => input.click() }, icona('piu', 26));

  radice.replaceChildren(h('main', { class: 'vista libreria' }, testa, avvisoBrowser, avvisoRotti, continua, vuota,
    libri.length ? h('div', { class: 'strumenti' }, h('div', { class: 'cerca-riga' }, cercaCampo, selOrdine), filtri) : null,
    libri.length ? griglia : null, input), libri.length ? fab : null, schede(''));
  disegnaGriglia();
}

// Su iPhone l'unico posto dove l'archivio resta è l'app aggiunta alla Home da Safari.
function avvisoNavigatore() {
  const ua = navigator.userAgent;
  if (!/iPhone|iPad|iPod/.test(ua) || installata()) return null;
  const altro = /DuckDuckGo|Ddg/i.test(ua) ? 'DuckDuckGo' : /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : /OPiOS|OPT\//.test(ua) ? 'Opera' : '';
  return h('div', { class: 'avviso-browser' },
    altro ? h('strong', {}, `Stai usando ${altro}: qui libri, voci e codice di GitHub possono sparire.`) : h('strong', {}, 'Stai usando Leggio dentro Safari.'),
    h('p', {}, altro
      ? `${altro} cancella i dati dei siti, per esempio col tasto per pulire. Apri framik02.github.io/leggio in Safari, tocca Condividi › Aggiungi alla schermata Home e usa sempre l'icona: è l'unico posto dove l'archivio resta.`
      : "Safari e l'icona sulla schermata Home tengono due librerie separate. Aggiungi Leggio alla Home (Condividi › Aggiungi alla schermata Home) e usa sempre l'icona."));
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
async function sezioneAudio() {
  const imp = await impostazioni();
  const collegato = !!imp.githubToken;
  const lavori = (await db.tutti('lavori')).filter(l => !l.chiuso);
  const audio = await db.tutti('audio');
  const mb = audio.reduce((s, a) => s + (a.blob?.size || 0), 0) / 1048576;
  const { configuraGithub } = await import('./vocipanel.js');
  return h('section', { class: 'imp-sez' }, h('h2', {}, 'Audio generato'),
    h('p', { class: 'nota' }, 'Voci naturali e voce clonata, create gratis su Kaggle e scaricate sul telefono. Si ascoltano anche a schermo spento.'),
    h('p', { class: 'nota' }, collegato ? `Collegato a ${imp.githubRepo || 'framik02/leggio-audio'}.` : 'Non ancora collegato.',
      ` ${audio.length} capitoli scaricati, ${mb.toFixed(0)} MB.`, lavori.length ? ` ${lavori.length} lavori in corso.` : ''),
    h('button', { class: `btn largo ${collegato ? '' : 'primario'}`, onclick: () => configuraGithub(() => vistaImpostazioni()) }, collegato ? 'Cambia codice di accesso' : 'Collega GitHub'));
}

async function sezioneCopia() {
  const { dimensioni, creaCopia, ripristina } = await import('./copia.js');
  const imp = await impostazioni();
  const d = await dimensioni();
  const mb = b => `${Math.max(1, Math.round(b / 1048576))} MB`;
  let conAudio = false;
  const quando = imp.ultimaCopia ? `Ultima copia: ${new Date(imp.ultimaCopia).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Non hai ancora fatto una copia.';
  const input = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: async e => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await conferma('Ripristinare la copia?', 'Libri, note, voci e impostazioni della copia tornano sul telefono. Quello che hai già e non è nella copia resta.', 'Ripristina', false))) return;
    const av = avviso('Ripristino…', { fisso: true });
    try {
      const r = await ripristina(f, p => { av.firstChild.textContent = `Ripristino… ${Math.round(p * 100)}%`; });
      av.remove();
      avviso(`Ripristinati ${r.libri} libri`);
      setTimeout(() => location.reload(), 1200);
    } catch (err) { av.remove(); avviso(err.message || 'Ripristino non riuscito', { durata: 6000 }); }
  } });
  const salva = h('button', { class: 'btn primario largo', onclick: async () => {
    const av = avviso('Preparo la copia…', { fisso: true });
    try {
      const f = await creaCopia({ conAudio }, p => { av.firstChild.textContent = `Preparo la copia… ${Math.round(p * 100)}%`; });
      av.remove();
      await consegna(f);
    } catch (err) { av.remove(); avviso(err.message || 'Copia non riuscita', { durata: 6000 }); }
  } }, icona('condividi', 18), 'Salva una copia completa');
  return h('div', { class: 'copia' },
    h('p', { class: 'nota' }, `Un file solo con libri, evidenziati, note, segnalibri, pronunce, voci registrate e impostazioni (${mb(d.libri + d.voci)}). Salvalo con Condividi › Salva su File, meglio su iCloud Drive: così sopravvive anche se cancelli l'app. ${quando}`),
    d.audio ? h('label', { class: 'interruttore' }, h('span', {}, `Includi l'audio creato (${mb(d.audio)})`),
      h('input', { type: 'checkbox', onchange: e => { conAudio = e.target.checked; } })) : null,
    salva,
    h('button', { class: 'btn largo', onclick: () => input.click() }, 'Ripristina da una copia'),
    h('p', { class: 'nota' }, 'Il codice di accesso a GitHub non entra nella copia.'),
    input);
}

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
    await sezioneAudio(),
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
      await sezioneCopia()),
    h('p', { class: 'firma' }, 'Leggio · versione 0.3.3')),
  schede('impostazioni'));
}

// ---------------------------------------------------------------- avvio
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (installata()) chiediPersistenza();
import('./audio.js').then(m => m.avviaControlli(l => {
  if (l) avviso(`Audio: ${l.scaricati.length} di ${l.capitoli.length} capitoli pronti`);
  if (!location.hash.startsWith('#/libro')) instrada().catch(mostraErrore);
}));
instrada().catch(mostraErrore);
