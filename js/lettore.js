// La vista di lettura: testo, indice, tipografia, evidenziati e ascolto.
import { db, impostazioni, salvaImpostazioni, dizionario, salvaDizionario, aggiungiTempo, nuovoId } from './db.js';
import { h, icona, bottoneIcona, foglio, avviso, minuti, pressioneLunga } from './ui.js';
import { LettoreAudio, nomeVoce, lavoriAttivi } from './audio.js';
import { creaSelezione } from './selezione.js';
import { Lettore, frasiDalCapitolo, voci, trovaVoce, prova, etichettaQualita, applicaDizionario, disponibile } from './voce.js';

const TEMI = {
  carta: { nome: 'Carta', fondo: '#FFFFFF', testo: '#1B1A18' },
  avorio: { nome: 'Avorio', fondo: '#F8F3E8', testo: '#2A251E' },
  seppia: { nome: 'Seppia', fondo: '#EEE2CB', testo: '#3A2E21' },
  pietra: { nome: 'Pietra', fondo: '#E8E8E4', testo: '#232321' },
};
const CARATTERI = {
  literata: { nome: 'Literata', css: "'Literata', Georgia, serif" },
  newyork: { nome: 'New York', css: "ui-serif, 'New York', Georgia, serif" },
  sistema: { nome: 'Sistema', css: "-apple-system, system-ui, 'Segoe UI', sans-serif" },
  atkinson: { nome: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
};
const PAROLE_MINUTO = 230;
// Pagine fisse quando il libro non porta quelle a stampa: circa una pagina stampata.
const PAROLE_PAGINA = 275;

export async function apriLettore(radice, id, esci) {
  const libro = await db.get('libri', id);
  if (!libro) { esci(); return; }
  libro.aperto = Date.now();
  if (libro.stato === 'da-leggere') libro.stato = 'in-lettura';
  await db.put('libri', libro);

  const imp = await impostazioni();
  let regole = await dizionario();
  let evidenziati = await db.perIndice('evidenziati', 'libro', id);
  let cap = libro.posizione?.cap || 0;
  let frasi = [];
  let urlImg = [];
  let attivo = true;

  // Due motori: la voce del telefono e l'audio creato, che va anche a schermo spento.
  const sintesi = new Lettore();
  sintesi.lingua = libro.lingua;
  sintesi.libro = id;
  sintesi.regole = regole;
  sintesi.velocita = libro.velocita || imp.velocita;
  sintesi.opz = { pausaParagrafo: imp.pausaParagrafo, pausaScena: imp.pausaScena, dialoghiVivaci: imp.dialoghiVivaci };
  trovaVoce(libro.lingua, libro.voce || imp[`voce_${libro.lingua}`]).then(v => { sintesi.voce = v; });
  const registrato = new LettoreAudio();
  registrato.velocita = sintesi.velocita;
  let lettore = sintesi;
  let vociMie = await db.tutti('voci');

  // ------------------------------------------------------------ struttura
  const titoloCap = h('div', { class: 'l-titolo' });
  const btnSegno = bottoneIcona('segno', 'Segnalibro', () => segnalibro());
  const barraSu = h('header', { class: 'l-barra-su' },
    bottoneIcona('indietro', 'Libreria', () => chiudi()),
    titoloCap,
    btnSegno,
    bottoneIcona('lista', 'Indice', () => apriIndice()),
    bottoneIcona('testo', 'Aspetto', () => apriAspetto()));
  const pagina = h('article', { class: 'l-pagina', lang: libro.lingua });
  const fondoCap = h('div', { class: 'l-fondo-cap' });
  const scorri = h('div', { class: 'l-scorri' }, pagina, fondoCap);
  const infoSx = h('span');
  const infoDx = h('span');
  const etichettaVoce = h('button', { class: 'l-voce', onclick: () => apriVoci() });
  const barraProg = h('div', { class: 'l-prog-riemp' });
  const info = h('div', { class: 'l-info' }, h('div', { class: 'l-prog' }, barraProg), h('div', { class: 'l-info-testo' }, infoSx, etichettaVoce, infoDx));

  const btnPlay = h('button', { class: 'p-play', 'aria-label': 'Ascolta', onclick: () => alternaAscolto() }, icona('play', 26));
  const chipVel = h('button', { class: 'p-chip', onclick: () => cambiaVelocita() });
  const chipTimer = h('button', { class: 'p-chip', 'aria-label': 'Timer', onclick: () => apriTimer() }, icona('luna', 18));
  const btnVoce = h('button', { class: 'p-chip', 'aria-label': 'Voce', onclick: () => apriVoci() }, icona('voce', 18));
  const player = h('div', { class: 'l-player' },
    chipVel,
    bottoneIcona('indietroFrase', 'Frase precedente', () => lettore.indietro()),
    btnPlay,
    bottoneIcona('avantiFrase', 'Frase successiva', () => lettore.avanti()),
    h('div', { class: 'p-dx' }, chipTimer, btnVoce));
  const torna = h('button', { class: 'l-torna', onclick: () => segui(true) }, 'Torna alla voce');

  const selbar = h('div', { class: 'l-selbar' });
  const el = h('div', { class: 'lettore' }, barraSu, scorri, torna, h('footer', { class: 'l-barra-giu' }, info, player), selbar);
  radice.replaceChildren(el);
  document.body.classList.add('in-lettura');

  // ------------------------------------------------------------ aspetto
  function applicaAspetto() {
    const t = TEMI[imp.tema] || TEMI.carta;
    el.style.setProperty('--l-fondo', t.fondo);
    el.style.setProperty('--l-testo', t.testo);
    el.style.setProperty('--l-corpo', `${imp.corpo}px`);
    el.style.setProperty('--l-interlinea', imp.interlinea);
    el.style.setProperty('--l-margini', `${imp.margini}px`);
    el.style.setProperty('--l-carattere', (CARATTERI[imp.carattere] || CARATTERI.literata).css);
    el.classList.toggle('giustifica', !!imp.giustifica);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.fondo);
  }
  applicaAspetto();
  chipVel.textContent = `${lettore.velocita.toFixed(2).replace(/0$/, '').replace('.', ',')}×`;

  // ------------------------------------------------------------ capitoli
  async function caricaCapitolo(n, frase = 0, verso = 'inizio') {
    const c = await db.get('capitoli', [id, n]);
    if (!c) return;
    cap = n;
    urlImg.forEach(u => URL.revokeObjectURL(u)); urlImg = [];
    pagina.innerHTML = c.html;
    for (const img of pagina.querySelectorAll('img[data-risorsa]')) {
      const r = await db.risorsa(id, img.getAttribute('data-risorsa'));
      if (r) { const u = URL.createObjectURL(r.blob); urlImg.push(u); img.src = u; } else img.remove();
    }
    titoloCap.textContent = c.titolo;
    frasi = frasiDalCapitolo(pagina);
    await scegliMotore(n);
    disegnaEvidenziati();
    fondoCap.replaceChildren(
      n < libro.capitoli.length - 1
        ? h('button', { class: 'l-prossimo', onclick: () => caricaCapitolo(n + 1) },
          h('span', { class: 'occhio' }, 'Capitolo successivo'), h('span', {}, libro.capitoli[n + 1].titolo), icona('avanti'))
        : h('div', { class: 'l-fine' }, h('div', { class: 'l-fine-segno' }, '❧'), h('p', {}, 'Fine del libro'),
          h('button', { class: 'btn', onclick: async () => { libro.stato = 'finito'; await db.put('libri', libro); avviso('Segnato come finito'); } }, 'Segna come finito')));
    if (n > 0) pagina.prepend(h('button', { class: 'l-precedente', onclick: () => caricaCapitolo(n - 1, Infinity) }, icona('indietro', 16), libro.capitoli[n - 1].titolo));
    requestAnimationFrame(() => {
      if (frase === Infinity) scorri.scrollTop = scorri.scrollHeight;
      else if (frase > 0) vaiAFrase(frase, false);
      else scorri.scrollTop = 0;
      salvaPosizione();
    });
    aggiornaSegno();
  }

  // Audio creato per questo capitolo? Allora si ascolta quello.
  async function scegliMotore(n) {
    const reg = await db.get('audio', [id, n]);
    if (lettore === registrato && registrato.attivo && !reg) registrato.pausa();
    lettore = reg ? registrato : sintesi;
    if (reg) registrato.carica(reg);
    sintesi.imposta(frasi);
    registrato.imposta(frasi);
    el.classList.toggle('con-audio', !!reg);
    await statoAudio();
  }

  // Etichetta in basso: la voce dell'audio, o a che punto è la sua creazione.
  async function statoAudio() {
    const reg = lettore === registrato ? await db.get('audio', [id, cap]) : null;
    const [lav] = await lavoriAttivi(id);
    let t = reg ? nomeVoce(reg.voce, vociMie) : '';
    if (lav) {
      const fase = lav.stato?.fase;
      t = fase === 'errore' ? 'Audio: errore' : fase === 'da riprendere' ? 'Audio da riprendere'
        : lav.scaricati.length ? `Audio ${lav.scaricati.length}/${lav.capitoli.length}` : 'Audio in preparazione';
    }
    etichettaVoce.textContent = t;
  }
  const quandoLavoro = async e => {
    if (e.detail?.libro !== id) return;
    if (!lettore.attivo) await scegliMotore(cap); else await statoAudio();
  };
  document.addEventListener('leggio-lavoro', quandoLavoro);

  // Numero di pagina: quello a stampa se il libro lo porta, altrimenti pagine fisse.
  function infoPagina(frase) {
    if (libro.pagine === 'stampa') {
      const sp = spanDi(frase);
      let num = null;
      if (sp) for (const m of pagina.querySelectorAll('[data-pag]')) {
        if (m.compareDocumentPosition(sp) & Node.DOCUMENT_POSITION_FOLLOWING) num = m.dataset.pag; else break;
      }
      if (num === null) for (let k = cap - 1; k >= 0; k--) if (libro.capitoli[k].pag) { num = libro.capitoli[k].pag[1]; break; }
      if (num === null) return '';
      const ultimo = [...libro.capitoli].reverse().find(c => c.pag)?.pag[1];
      return /^\d+$/.test(num) && /^\d+$/.test(ultimo || '') ? `pag. ${num} di ${ultimo}` : `pag. ${num}`;
    }
    const prima = libro.capitoli.slice(0, cap).reduce((s, c) => s + c.parole, 0);
    const qui = frasi.filter(f => f.id < frase).reduce((s, f) => s + f.parole, 0);
    const tot = Math.max(1, Math.ceil(libro.paroleTotali / PAROLE_PAGINA));
    return `pag. ${Math.min(tot, Math.floor((prima + qui) / PAROLE_PAGINA) + 1)} di ${tot}`;
  }
  function paginaInizio(i) {
    if (libro.pagine === 'stampa') return libro.capitoli[i].pag?.[0] || '';
    return String(Math.floor(libro.capitoli.slice(0, i).reduce((s, c) => s + c.parole, 0) / PAROLE_PAGINA) + 1);
  }
  async function vaiAPagina(num) {
    num = String(num).trim();
    if (!num) return false;
    const dopo = fn => requestAnimationFrame(() => requestAnimationFrame(fn));
    if (libro.pagine === 'stampa') {
      for (let k = 0; k < libro.capitoli.length; k++) {
        const c = await db.get('capitoli', [id, k]);
        if (!c.html.includes(`data-pag="${num}"`)) continue;
        await caricaCapitolo(k);
        dopo(() => {
          const m = pagina.querySelector(`[data-pag="${CSS.escape(num)}"]`);
          if (m) { const r = m.getBoundingClientRect(), rs = scorri.getBoundingClientRect(); scorri.scrollTo({ top: scorri.scrollTop + r.top - rs.top - 30 }); }
        });
        return true;
      }
      avviso(`Pagina ${num} non trovata`);
      return false;
    }
    const n = parseInt(num, 10);
    if (!n) return false;
    let obiettivo = (n - 1) * PAROLE_PAGINA, k = 0;
    while (k < libro.capitoli.length - 1 && obiettivo >= libro.capitoli[k].parole) { obiettivo -= libro.capitoli[k].parole; k++; }
    await caricaCapitolo(k);
    let somma = 0;
    const f = frasi.find(x => (somma += x.parole) > obiettivo) || frasi[frasi.length - 1];
    if (f) dopo(() => vaiAFrase(f.id, false));
    return true;
  }

  function spanDi(idFrase) { return pagina.querySelector(`span.s[data-s="${idFrase}"]`); }

  function vaiAFrase(idFrase, morbido = true) {
    const sp = spanDi(idFrase);
    if (!sp) return;
    const r = sp.getBoundingClientRect(), rs = scorri.getBoundingClientRect();
    scorri.scrollTo({ top: scorri.scrollTop + r.top - rs.top - rs.height * 0.3, behavior: morbido ? 'smooth' : 'auto' });
  }

  // Prima frase visibile in alto.
  function fraseInVista() {
    const rs = scorri.getBoundingClientRect();
    for (const sp of pagina.querySelectorAll('span.s')) {
      const r = sp.getBoundingClientRect();
      if (r.bottom > rs.top + 70) return +sp.dataset.s;
    }
    return 0;
  }

  let tSalva = null;
  function salvaPosizione() {
    const frase = lettore.attivo ? frasi[lettore.indice]?.id ?? 0 : fraseInVista();
    const prima = libro.capitoli.slice(0, cap).reduce((s, c) => s + c.frasi, 0);
    libro.posizione = { cap, frase };
    libro.progresso = libro.frasiTotali ? Math.min(1, (prima + frase) / libro.frasiTotali) : 0;
    barraProg.style.width = `${(libro.progresso * 100).toFixed(1)}%`;
    // Minuti rimasti nel capitolo, dalle parole che restano.
    const restanti = frasi.filter(f => f.id >= frase).reduce((s, f) => s + f.parole, 0);
    const vel = lettore.attivo ? PAROLE_MINUTO * 0.72 * lettore.velocita : PAROLE_MINUTO;
    infoSx.textContent = `${minuti(restanti / vel * 60)} alla fine del capitolo`;
    infoDx.textContent = infoPagina(frase) || `${Math.round(libro.progresso * 100)}%`;
    clearTimeout(tSalva);
    tSalva = setTimeout(() => db.put('libri', libro), 600);
    aggiornaSegno();
  }

  // ------------------------------------------------------------ interazione
  let ultimoScroll = 0, yPrec = 0, mosso = Date.now();
  scorri.addEventListener('scroll', () => {
    const y = scorri.scrollTop;
    if (Math.abs(y - yPrec) > 24) { el.classList.toggle('nascosto', y > yPrec && y > 80); yPrec = y; }
    mosso = Date.now();
    if (lettore.attivo && Date.now() - ultimoAuto > 900) { seguendo = false; torna.classList.add('visibile'); }
    if (Date.now() - ultimoScroll > 250) { ultimoScroll = Date.now(); if (!lettore.attivo) salvaPosizione(); }
  }, { passive: true });

  const selezione = creaSelezione({
    pagina, scorri,
    quandoCambia: s => mostraBarra(s),
    toccoVuoto: () => el.classList.toggle('nascosto'),
  });

  // Tempo di lettura: conta solo se la pagina è stata toccata da poco o se la voce va.
  const orologio = setInterval(() => {
    if (document.visibilityState !== 'visible' && !lettore.attivo) return;
    if (lettore.attivo || Date.now() - mosso < 120000) aggiungiTempo(15);
  }, 15000);

  // ------------------------------------------------------------ ascolto
  let seguendo = true, ultimoAuto = 0;
  function segui(subito) {
    seguendo = true; torna.classList.remove('visibile');
    if (subito && frasi[lettore.indice]) { ultimoAuto = Date.now(); vaiAFrase(frasi[lettore.indice].id); }
  }
  sintesi.onFrase = registrato.onFrase = f => {
    pagina.querySelectorAll('.in-voce').forEach(s => s.classList.remove('in-voce'));
    f.span.forEach(s => s.classList.add('in-voce'));
    if (seguendo && imp.segui) {
      const r = f.span[0].getBoundingClientRect(), rs = scorri.getBoundingClientRect();
      if (r.top < rs.top + rs.height * 0.15 || r.bottom > rs.top + rs.height * 0.7) { ultimoAuto = Date.now(); vaiAFrase(f.id); }
    }
    salvaPosizione();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: libro.capitoli[cap].titolo, artist: libro.titolo, album: libro.autore || '' });
    }
  };
  sintesi.onStato = registrato.onStato = acceso => {
    btnPlay.replaceChildren(icona(acceso ? 'pausa' : 'play', 26));
    el.classList.toggle('ascolto', acceso);
    if (!acceso) { torna.classList.remove('visibile'); pagina.querySelectorAll('.in-voce').forEach(s => s.classList.remove('in-voce')); }
  };
  sintesi.onFine = registrato.onFine = async () => {
    if (timerFineCap) { timerFineCap = false; aggiornaTimer(); return; }
    if (cap < libro.capitoli.length - 1) {
      await caricaCapitolo(cap + 1);
      // L'audio creato riparte subito, anche a schermo spento.
      if (lettore === registrato) lettore.play(0).catch(() => {});
      else if (document.visibilityState === 'visible') setTimeout(() => lettore.play(0), 700);
    }
  };
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { const r = lettore.play(); if (r && r.catch) r.catch(() => {}); });
    try {
      navigator.mediaSession.setActionHandler('seekbackward', () => lettore === registrato ? registrato.salta(-15) : lettore.indietro());
      navigator.mediaSession.setActionHandler('seekforward', () => lettore === registrato ? registrato.salta(15) : lettore.avanti());
      navigator.mediaSession.setActionHandler('seekto', d => { if (lettore === registrato && d.seekTime != null) { registrato.audio.currentTime = d.seekTime; registrato._segui(); } });
    } catch { /* non tutti i browser li hanno */ }
    navigator.mediaSession.setActionHandler('pause', () => lettore.pausa());
    navigator.mediaSession.setActionHandler('nexttrack', () => lettore.avanti());
    navigator.mediaSession.setActionHandler('previoustrack', () => lettore.indietro());
  }

  function alternaAscolto(daFrase) {
    if (lettore === sintesi && !disponibile()) { avviso('Questo browser non ha la sintesi vocale'); return; }
    if (lettore.attivo && daFrase === undefined) { lettore.pausa(); salvaPosizione(); return; }
    const idx = daFrase !== undefined ? frasi.findIndex(f => f.id === daFrase) : frasi.findIndex(f => f.id >= fraseInVista());
    segui(false);
    const r = lettore.play(Math.max(0, idx));
    if (r && r.catch) r.catch(() => avviso('Tocca di nuovo play per ascoltare'));
  }

  function cambiaVelocita() {
    const passi = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
    const i = passi.findIndex(v => v >= lettore.velocita - 0.001);
    const v = passi[(i + 1) % passi.length];
    sintesi.velocita = v;
    registrato.velocitaAudio = v;
    chipVel.textContent = `${String(v).replace('.', ',')}×`;
    libro.velocita = v;
    db.put('libri', libro);
    if (lettore === sintesi && lettore.attivo) lettore.vai(lettore.indice);
  }

  let timer = null, timerFine = 0, timerFineCap = false, timerTick = null;
  function aggiornaTimer() {
    clearInterval(timerTick);
    if (timerFineCap) { chipTimer.replaceChildren(icona('luna', 18), h('span', {}, 'cap.')); chipTimer.classList.add('acceso'); return; }
    if (!timer) { chipTimer.replaceChildren(icona('luna', 18)); chipTimer.classList.remove('acceso'); return; }
    const scrivi = () => {
      const s = Math.max(0, Math.round((timerFine - Date.now()) / 1000));
      chipTimer.replaceChildren(icona('luna', 18), h('span', {}, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`));
    };
    chipTimer.classList.add('acceso'); scrivi();
    timerTick = setInterval(scrivi, 1000);
  }
  function apriTimer() {
    const scegli = (min) => {
      clearTimeout(timer); timer = null; timerFineCap = false;
      if (min === 'cap') timerFineCap = true;
      else if (min) { timerFine = Date.now() + min * 60000; timer = setTimeout(() => { lettore.pausa(); timer = null; aggiornaTimer(); }, min * 60000); }
      aggiornaTimer(); f.chiudi();
    };
    const f = foglio('Timer di spegnimento', h('div', { class: 'lista-scelte' },
      [10, 15, 30, 45, 60].map(m => h('button', { class: 'scelta', onclick: () => scegli(m) }, `${m} minuti`)),
      h('button', { class: 'scelta', onclick: () => scegli('cap') }, 'Alla fine del capitolo'),
      h('button', { class: 'scelta tenue', onclick: () => scegli(0) }, 'Spento')));
  }

  async function apriVoci() {
    const { apriPannelloVoci } = await import('./vocipanel.js');
    apriPannelloVoci({
      libro, cap,
      voceTelefono: () => sintesi.voce,
      scegliTelefono: async v => {
        sintesi.voce = v; libro.voce = v.voiceURI; await db.put('libri', libro);
        await salvaImpostazioni({ [`voce_${libro.lingua}`]: v.voiceURI });
        if (lettore === sintesi && sintesi.attivo) sintesi.vai(sintesi.indice);
      },
      dopoCambio: async () => {
        statoAudio();
        sintesi.lingua = libro.lingua; pagina.lang = libro.lingua;
        sintesi.voce = await trovaVoce(libro.lingua, libro.voce || imp[`voce_${libro.lingua}`]);
        vociMie = await db.tutti('voci');
        if (!lettore.attivo) await scegliMotore(cap);
      },
    });
  }

  // ------------------------------------------------------------ evidenziati e segnalibri
  // Evidenziati vecchi (frase intera) e nuovi (pezzo libero) diventano intervalli.
  function disegnaEvidenziati() {
    const qui = evidenziati.filter(e => e.cap === cap && e.tipo !== 'segno');
    for (const e of qui) if (!e.da) { e.da = { s: e.frase, off: 0 }; e.a = { s: e.frase, off: selezione.lunghezza(e.frase) }; }
    selezione.evidenze(qui);
  }

  function segnoQui() {
    const f = fraseInVista();
    return evidenziati.find(e => e.tipo === 'segno' && e.cap === cap && Math.abs(e.frase - f) <= 2);
  }
  function aggiornaSegno() {
    const s = segnoQui();
    btnSegno.replaceChildren(icona(s ? 'segnoPieno' : 'segno'));
    btnSegno.classList.toggle('acceso', !!s);
  }
  async function segnalibro() {
    const s = segnoQui();
    if (s) { await db.del('evidenziati', s.id); evidenziati = evidenziati.filter(e => e !== s); avviso('Segnalibro tolto'); }
    else {
      const frase = fraseInVista();
      const e = { id: nuovoId(), libro: id, cap, frase, tipo: 'segno', testo: testoFrase(frase), data: Date.now() };
      await db.put('evidenziati', e); evidenziati.push(e); avviso('Segnalibro messo');
    }
    aggiornaSegno();
  }

  function testoFrase(idFrase) {
    return [...pagina.querySelectorAll(`span.s[data-s="${idFrase}"]`)].map(s => s.textContent).join('').trim();
  }

  function mostraBarra(sel) {
    el.classList.toggle('con-selezione', !!sel);
    if (!sel) return;
    const es = sel.esistente;
    const az = (ic, t, fn) => h('button', { class: 'sb-azione', onclick: fn }, icona(ic, 20), h('span', {}, t));
    selbar.replaceChildren(
      h('div', { class: 'sb-riga' },
        ...['giallo', 'ciano', 'lilla'].map(c => h('button', { class: `mf-colore c-${c} ${es?.colore === c ? 'attivo' : ''}`, 'aria-label': `Evidenzia ${c}`, onclick: () => salvaEvidenza(c) })),
        es ? h('button', { class: 'mf-togli', onclick: () => togliEvidenza(es) }, 'Togli') : h('span', { class: 'sb-suggerimento' }, 'Trascina le maniglie per allungare'),
        bottoneIcona('chiudi', 'Annulla', () => selezione.pulisci(), 'sb-chiudi')),
      h('div', { class: 'sb-azioni' },
        az('cuffie', 'Ascolta', () => { const da = sel.da.s; selezione.pulisci(); alternaAscolto(da); }),
        az('matita', es?.nota ? 'Nota ✓' : 'Nota', () => nota(es, testo => salvaEvidenza(null, testo))),
        az('copia', 'Copia', async () => {
          const t = selezione.testo();
          try { await navigator.clipboard.writeText(`«${t}» ${libro.titolo}${libro.autore ? ', ' + libro.autore : ''}`); avviso('Copiato'); } catch { avviso('Copia non riuscita'); }
          selezione.pulisci();
        }),
        az('voce', 'Pronuncia', () => correggiPronuncia(selezione.testo()))));
  }

  async function salvaEvidenza(colore, testoNota) {
    const sel = selezione.attuale();
    if (!sel) return;
    const e = sel.esistente || { id: nuovoId(), libro: id, cap, tipo: 'ev', data: Date.now(), capTitolo: libro.capitoli[cap].titolo };
    e.da = { ...sel.da }; e.a = { ...sel.a }; e.frase = sel.da.s;
    e.testo = selezione.testo(sel);
    e.colore = colore || e.colore || 'giallo';
    if (testoNota !== undefined) e.nota = testoNota;
    await db.put('evidenziati', e);
    if (!evidenziati.includes(e)) evidenziati.push(e);
    selezione.pulisci();
    disegnaEvidenziati();
  }

  async function togliEvidenza(e) {
    await db.del('evidenziati', e.id);
    evidenziati = evidenziati.filter(x => x !== e);
    selezione.pulisci();
    disegnaEvidenziati();
  }

  function nota(esistente, salva) {
    const area = h('textarea', { class: 'campo', rows: 5, placeholder: 'Cosa ti ha colpito…' });
    area.value = esistente?.nota || '';
    const f = foglio('Nota', h('div', { class: 'modulo' },
      h('blockquote', { class: 'mf-citazione' }, selezione.testo()),
      area,
      h('button', { class: 'btn primario largo', onclick: async () => { await salva(area.value.trim()); f.chiudi(); avviso('Nota salvata'); } }, 'Salva')));
    setTimeout(() => area.focus(), 300);
  }

  // La correzione diventa una regola che vale da qui in avanti.
  function correggiPronuncia(testo) {
    const parole = [...new Set(testo.match(/[\p{L}\p{N}'’-]+/gu) || [])];
    const da = h('input', { class: 'campo', placeholder: 'Parola o nome' });
    const a = h('input', { class: 'campo', placeholder: 'Come va letta, per esempio Ermaiòni' });
    let ambito = 'libro';
    const seg = h('div', { class: 'segmenti' });
    const disegnaSeg = () => seg.replaceChildren(
      h('button', { class: ambito === 'libro' ? 'attivo' : '', onclick: () => { ambito = 'libro'; disegnaSeg(); } }, 'Solo questo libro'),
      h('button', { class: ambito === 'tutti' ? 'attivo' : '', onclick: () => { ambito = 'tutti'; disegnaSeg(); } }, 'Tutti i libri'));
    disegnaSeg();
    const f = foglio('Correggi pronuncia', h('div', { class: 'modulo' },
      h('p', { class: 'nota' }, 'Tocca la parola letta male, poi scrivi come deve suonare. La correzione resta e vale anche per le prossime letture.'),
      h('div', { class: 'parole' }, parole.map(p => h('button', { class: 'parola', onclick: e => { da.value = p; a.value = a.value || p; a.focus(); e.currentTarget.parentNode.querySelectorAll('.attivo').forEach(x => x.classList.remove('attivo')); e.currentTarget.classList.add('attivo'); } }, p))),
      da, a, seg,
      h('div', { class: 'riga-bottoni' },
        h('button', { class: 'btn', onclick: () => prova(sintesi.voce, applicaDizionario(testo, [{ da: da.value, a: a.value }], libro.lingua, id), lettore.velocita) }, icona('orecchio', 18), 'Prova'),
        h('button', { class: 'btn primario', onclick: async () => {
          if (!da.value.trim() || !a.value.trim()) return;
          regole = regole.filter(r => !(r.da.toLowerCase() === da.value.trim().toLowerCase() && (r.libro || null) === (ambito === 'libro' ? id : null)));
          regole.push({ da: da.value.trim(), a: a.value.trim(), lingua: libro.lingua, libro: ambito === 'libro' ? id : null, data: Date.now() });
          await salvaDizionario(regole);
          sintesi.regole = regole;
          f.chiudi(); avviso('Pronuncia imparata');
        } }, 'Salva'))));
  }

  // ------------------------------------------------------------ indice, evidenziati, ricerca
  function apriIndice() {
    const corpo = h('div', { class: 'indice' });
    let scheda = 'capitoli';
    const f = foglio(libro.titolo, corpo, { alto: true });
    const schede = h('div', { class: 'segmenti' });
    const contenuto = h('div', { class: 'indice-contenuto' });
    corpo.append(schede, contenuto);
    const disegna = () => {
      schede.replaceChildren(...[['capitoli', 'Capitoli'], ['note', 'Evidenziati'], ['cerca', 'Cerca']].map(([k, v]) =>
        h('button', { class: scheda === k ? 'attivo' : '', onclick: () => { scheda = k; disegna(); } }, v)));
      if (scheda === 'capitoli') {
        const numero = h('input', { class: 'campo', type: 'text', inputmode: libro.pagine === 'stampa' ? 'text' : 'numeric', placeholder: 'Numero di pagina', enterkeyhint: 'go' });
        const vai = async () => { if (await vaiAPagina(numero.value)) f.chiudi(); };
        numero.addEventListener('keydown', e => { if (e.key === 'Enter') vai(); });
        contenuto.replaceChildren(
          h('div', { class: 'vai-pagina' }, numero, h('button', { class: 'btn', onclick: vai }, 'Vai')),
          h('ol', { class: 'capitoli' }, libro.capitoli.map((c, i) => {
            const p = paginaInizio(i);
            return h('li', {}, h('button', { class: i === cap ? 'attuale' : '', onclick: async () => { f.chiudi(); const era = lettore.attivo; lettore.pausa(); await caricaCapitolo(i); if (era) lettore.play(0); } },
              h('span', { class: 'cap-titolo' }, c.titolo), h('span', { class: 'cap-pct' }, p ? `p. ${p}` : '')));
          })));
        setTimeout(() => contenuto.querySelector('.attuale')?.scrollIntoView({ block: 'center' }), 50);
      } else if (scheda === 'note') {
        const ord = [...evidenziati].sort((a, b) => a.cap - b.cap || a.frase - b.frase);
        contenuto.replaceChildren(ord.length ? h('div', { class: 'elenco-ev' }, ord.map(e => h('button', { class: `ev-voce ${e.tipo === 'segno' ? 'segno' : 'c-' + e.colore}`, onclick: async () => { f.chiudi(); await caricaCapitolo(e.cap, e.frase); } },
          h('span', { class: 'ev-cap' }, e.tipo === 'segno' ? `Segnalibro · ${libro.capitoli[e.cap]?.titolo || ''}` : libro.capitoli[e.cap]?.titolo || ''),
          h('span', { class: 'ev-testo' }, e.testo),
          e.nota ? h('span', { class: 'ev-nota-testo' }, e.nota) : null)))
          : h('p', { class: 'vuoto' }, 'Tieni premuto su una frase per evidenziarla, annotarla o ascoltare da lì.'));
      } else {
        const campo = h('input', { class: 'campo', type: 'search', placeholder: 'Cerca nel libro', enterkeyhint: 'search' });
        const ris = h('div', { class: 'risultati' });
        let t = null;
        campo.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => cerca(campo.value, ris, f), 300); });
        contenuto.replaceChildren(campo, ris);
        setTimeout(() => campo.focus(), 250);
      }
    };
    disegna();
  }

  async function cerca(q, dove, f) {
    q = q.trim();
    if (q.length < 2) { dove.replaceChildren(); return; }
    const caps = await db.capitoli(id);
    const out = [];
    const ql = q.toLocaleLowerCase();
    const tmp = document.createElement('div');
    for (const c of caps) {
      if (!c.html.toLocaleLowerCase().includes(ql)) continue;
      tmp.innerHTML = c.html;
      const mappa = new Map();
      for (const s of tmp.querySelectorAll('span.s')) mappa.set(s.dataset.s, (mappa.get(s.dataset.s) || '') + s.textContent);
      for (const [k, v] of mappa) if (v.toLocaleLowerCase().includes(ql)) { out.push({ cap: c.n, frase: +k, testo: v.trim(), titolo: c.titolo }); if (out.length > 200) break; }
      if (out.length > 200) break;
    }
    dove.replaceChildren(h('p', { class: 'nota' }, out.length ? `${out.length > 200 ? 'Più di 200' : out.length} risultati` : 'Nessun risultato'),
      ...out.slice(0, 200).map(r => {
        const i = r.testo.toLocaleLowerCase().indexOf(ql);
        return h('button', { class: 'ris', onclick: async () => { f.chiudi(); await caricaCapitolo(r.cap, r.frase); spanDi(r.frase)?.classList.add('lampo'); } },
          h('span', { class: 'ev-cap' }, r.titolo),
          h('span', {}, r.testo.slice(Math.max(0, i - 60), i), h('mark', {}, r.testo.slice(i, i + q.length)), r.testo.slice(i + q.length, i + q.length + 80)));
      }));
  }

  function apriAspetto() {
    const corpo = h('div', { class: 'aspetto' });
    foglio('Aspetto', corpo);
    const cambia = async (parz) => { await salvaImpostazioni(parz); applicaAspetto(); disegna(); };
    const disegna = () => corpo.replaceChildren(
      h('div', { class: 'asp-riga' },
        h('button', { class: 'asp-corpo piccolo', onclick: () => cambia({ corpo: Math.max(14, imp.corpo - 1) }) }, 'A'),
        h('div', { class: 'asp-valore' }, `${imp.corpo}`),
        h('button', { class: 'asp-corpo grande', onclick: () => cambia({ corpo: Math.min(32, imp.corpo + 1) }) }, 'A')),
      h('div', { class: 'asp-temi' }, Object.entries(TEMI).map(([k, t]) =>
        h('button', { class: `asp-tema ${imp.tema === k ? 'attivo' : ''}`, style: { background: t.fondo, color: t.testo }, onclick: () => cambia({ tema: k }) }, h('span', {}, 'Aa'), h('small', {}, t.nome)))),
      h('div', { class: 'asp-caratteri' }, Object.entries(CARATTERI).map(([k, c]) =>
        h('button', { class: imp.carattere === k ? 'attivo' : '', style: { fontFamily: c.css }, onclick: () => cambia({ carattere: k }) }, c.nome))),
      cursore('Interlinea', 1.3, 2.1, 0.05, imp.interlinea, v => cambia({ interlinea: v })),
      cursore('Margini', 10, 48, 2, imp.margini, v => cambia({ margini: v })),
      h('label', { class: 'interruttore' }, h('span', {}, 'Testo giustificato'),
        h('input', { type: 'checkbox', checked: imp.giustifica, onchange: e => cambia({ giustifica: e.target.checked }) })));
    disegna();
  }
  function cursore(nome, min, max, passo, val, fn) {
    const i = h('input', { type: 'range', min, max, step: passo, value: val });
    i.addEventListener('change', () => fn(+i.value));
    return h('label', { class: 'asp-cursore' }, h('span', {}, nome), i);
  }

  // ------------------------------------------------------------ uscita
  function chiudi() {
    attivo = false;
    document.removeEventListener('leggio-lavoro', quandoLavoro);
    sintesi.pausa();
    registrato.scarica();
    clearInterval(orologio); clearInterval(timerTick); clearTimeout(timer);
    salvaPosizione();
    db.put('libri', libro);
    urlImg.forEach(u => URL.revokeObjectURL(u));
    document.body.classList.remove('in-lettura');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', '#F6F3EE');
    esci();
  }
  window.addEventListener('pagehide', () => { if (attivo) { salvaPosizione(); db.put('libri', libro); } });

  await caricaCapitolo(cap, libro.posizione?.frase || 0);
  if (sessionStorage.getItem('leggio-ascolta')) {
    sessionStorage.removeItem('leggio-ascolta');
    setTimeout(() => alternaAscolto(), 300);
  }
  return { chiudi };
}
