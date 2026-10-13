// Pannello delle voci: telefono, voci naturali, la tua voce, audio del libro.
import { db, impostazioni, salvaImpostazioni, nuovoId } from './db.js';
import { h, icona, bottoneIcona, foglio, avviso, conferma, minuti } from './ui.js';
import { voci as vociTelefono, prova, etichettaQualita } from './voce.js';
import { catalogo, descriviVoce, nomeVoce, creaLavoro, stima, configurato, lavoriAttivi, aggiornaLavoro, riprendi, annulla, descriviStato, recuperaLavori } from './audio.js';

let _anteprima = null;
function ascolta(url) {
  if (!_anteprima) _anteprima = new Audio();
  if (!_anteprima.paused && _anteprima.src.endsWith(url)) { _anteprima.pause(); return; }
  _anteprima.src = url;
  _anteprima.play().catch(() => avviso('Anteprima non disponibile'));
}

// opz: { libro, cap, voceTelefono, scegliTelefono(v), dopoCambio() }
export async function apriPannelloVoci(opz) {
  const { libro } = opz;
  let scheda = libro.voceAudio ? (libro.voceAudio.startsWith('clonata:') ? 'tua' : 'naturali') : 'telefono';
  const corpo = h('div', { class: 'voci' });
  let giro = null;
  const ascoltaLavoro = () => disegnaAudioLibro();
  const f = foglio('Voce', corpo, { alto: true, allaChiusura: () => { _anteprima && _anteprima.pause(); clearInterval(giro); document.removeEventListener('leggio-lavoro', ascoltaLavoro); } });
  document.addEventListener('leggio-lavoro', ascoltaLavoro);
  // Mentre il pannello è aperto lo stato si aggiorna da solo.
  giro = setInterval(async () => {
    for (const l of await lavoriAttivi(libro.id)) { try { await aggiornaLavoro(l); } catch { /* rete */ } }
    disegnaAudioLibro();
    opz.dopoCambio && opz.dopoCambio();
  }, 30000);
  configurato().then(c => c && recuperaLavori(libro.id).then(n => n && disegna()).catch(() => {}));
  const schede = h('div', { class: 'segmenti' });
  const lingue = h('div', { class: 'segmenti piccoli' });
  const contenuto = h('div', { class: 'voci-contenuto' });
  const audioLibro = h('div', { class: 'audio-libro' });
  corpo.append(audioLibro, schede, lingue, contenuto);

  const disegnaLingue = () => lingue.replaceChildren(...[['it', 'Libro in italiano'], ['en', 'Libro in inglese']].map(([k, t]) =>
    h('button', { class: libro.lingua === k ? 'attivo' : '', onclick: async () => { libro.lingua = k; await db.put('libri', libro); opz.dopoCambio && opz.dopoCambio(); disegnaLingue(); disegna(); } }, t)));

  const disegna = async () => {
    schede.replaceChildren(...[['telefono', 'Telefono'], ['naturali', 'Naturali'], ['tua', 'La tua voce']].map(([k, t]) =>
      h('button', { class: scheda === k ? 'attivo' : '', onclick: () => { scheda = k; disegna(); } }, t)));
    const parti = scheda === 'telefono' ? await schedaTelefono() : scheda === 'naturali' ? await schedaNaturali() : await schedaTua();
    contenuto.replaceChildren(...parti.filter(Boolean));
    await disegnaAudioLibro();
  };

  async function schedaTelefono() {
    const elenco = await vociTelefono(libro.lingua);
    const att = opz.voceTelefono();
    return [
      h('p', { class: 'nota' }, 'Leggono subito, senza attese, ma si fermano quando lo schermo si spegne. Le versioni premium si scaricano da Impostazioni › Accessibilità › Contenuto letto ad alta voce › Voci.'),
      elenco.length ? h('div', { class: 'elenco-voci' }, elenco.map(v => {
        const q = etichettaQualita(v);
        return h('div', { class: `voce-riga ${att && att.voiceURI === v.voiceURI && !libro.voceAudio ? 'scelta-attiva' : ''}` },
          h('button', { class: 'voce-nome', onclick: async () => { await opz.scegliTelefono(v); libro.voceAudio = ''; await db.put('libri', libro); disegna(); } },
            h('span', {}, v.name.replace(/\s*\(.*\)$/, '')), q ? h('span', { class: `badge ${q}` }, q) : null, h('span', { class: 'voce-lingua' }, v.lang)),
          bottoneIcona('orecchio', 'Prova', () => prova(v, libro.lingua === 'en' ? 'This is how I will read your book.' : 'Ecco come leggerò il tuo libro.')));
      })) : h('p', { class: 'nota' }, 'Nessuna voce del telefono per questa lingua.'),
    ];
  }

  async function schedaNaturali() {
    const tutte = (await catalogo()).filter(v => v.lingue.includes(libro.lingua));
    if (!tutte.length) return [h('p', { class: 'nota' }, 'Il catalogo delle voci naturali non è ancora disponibile.')];
    const gruppi = [['kokoro', 'Veloci', 'Pronte in pochi minuti anche per un libro intero.'], ['xtts', 'Espressive', 'Più calde e variate. Per un libro lungo servono alcune ore.']];
    return [
      h('p', { class: 'nota' }, 'Audio vero, creato gratis su Kaggle. Si ascolta anche a schermo spento, coi controlli nella schermata di blocco.'),
      ...gruppi.map(([m, titolo, nota]) => {
        const voci = tutte.filter(v => v.motore === m);
        if (!voci.length) return null;
        return h('section', { class: 'gruppo-voci' }, h('h3', {}, titolo), h('p', { class: 'nota' }, nota),
          h('div', { class: 'elenco-voci' }, voci.map(v => rigaVoce(v.id, nomeVoce(v.id), descriviVoce(v), `voci/${typeof v.file === 'string' ? v.file : v.file[libro.lingua]}`))));
      }),
    ];
  }

  function rigaVoce(id, nome, desc, anteprima) {
    return h('div', { class: `voce-riga ${libro.voceAudio === id ? 'scelta-attiva' : ''}` },
      h('button', { class: 'voce-nome', onclick: async () => { libro.voceAudio = id; await db.put('libri', libro); opz.dopoCambio && opz.dopoCambio(); disegna(); } },
        h('span', { class: 'voce-testi' }, h('span', {}, nome), h('small', {}, desc))),
      anteprima ? bottoneIcona('orecchio', 'Ascolta', () => ascolta(anteprima)) : null);
  }

  async function schedaTua() {
    const mie = (await db.tutti('voci')).sort((a, b) => b.creato - a.creato);
    return [
      h('p', { class: 'nota' }, 'Registra un paio di minuti di voce: Kaggle la clona e legge il libro con quel timbro. Registra la tua voce, o quella di chi ti ha dato il permesso.'),
      mie.length ? h('div', { class: 'elenco-voci' }, mie.map(v => {
        const id = `clonata:${v.id}`;
        const url = URL.createObjectURL(v.campioni[0].blob);
        return h('div', { class: `voce-riga ${libro.voceAudio === id ? 'scelta-attiva' : ''}` },
          h('button', { class: 'voce-nome', onclick: async () => { libro.voceAudio = id; await db.put('libri', libro); opz.dopoCambio && opz.dopoCambio(); disegna(); } },
            h('span', { class: 'voce-testi' }, h('span', {}, v.nome), h('small', {}, `${v.campioni.length} registrazioni · ${Math.round(v.campioni.reduce((s, c) => s + c.durata, 0))} secondi`))),
          bottoneIcona('orecchio', 'Ascolta', () => ascolta(url)),
          bottoneIcona('cestino', 'Elimina', async () => { if (await conferma('Eliminare la voce?', `«${v.nome}» sparisce da questo telefono.`, 'Elimina')) { await db.del('voci', v.id); disegna(); } }, 'piccola'));
      })) : null,
      h('button', { class: 'btn largo', onclick: () => registraVoce(libro.lingua, async v => {
        if (v) { libro.voceAudio = `clonata:${v.id}`; await db.put('libri', libro); opz.dopoCambio && opz.dopoCambio(); }
        disegna();
      }) }, icona('voce', 18), 'Registra una voce'),
    ];
  }

  async function disegnaAudioLibro() {
    const pronti = await db.audioLibro(libro.id);
    const attivi = await lavoriAttivi(libro.id);
    const lav = attivi[0];
    const voceSel = libro.voceAudio;
    const mie = await db.tutti('voci');
    const parti = [];
    if (pronti.length) {
      const durata = pronti.reduce((s, a) => s + (a.durata || 0), 0);
      parti.push(h('div', { class: 'al-riga' }, h('div', {},
        h('strong', {}, `Audio pronto: ${pronti.length} di ${libro.capitoli.length} capitoli`),
        h('small', {}, `${nomeVoce(pronti[0].voce, mie)} · ${minuti(durata)}`)),
      h('button', { class: 'al-togli', onclick: async () => { if (await conferma('Cancellare l\'audio?', 'I capitoli scaricati di questo libro vengono tolti dal telefono.', 'Cancella')) { await db.cancellaAudio(libro.id); opz.dopoCambio && opz.dopoCambio(); disegna(); } } }, 'Cancella')));
    }
    if (lav) {
      const st = lav.stato || {};
      const tot = lav.capitoli.length;
      const d = descriviStato(lav);
      const inAttesa = !['errore', 'da riprendere', 'finito'].includes(st.fase);
      parti.push(h('div', { class: `al-lavoro ${d.errore ? 'errore' : ''}` },
        h('div', { class: 'al-titolo' }, inAttesa ? h('span', { class: 'al-pulsa' }) : null, h('strong', {}, d.testo)),
        h('div', { class: `al-barra ${inAttesa && !lav.scaricati.length ? 'indeterminata' : ''}` }, h('div', { style: { width: `${Math.max(3, lav.scaricati.length / tot * 100).toFixed(1)}%` } })),
        d.dettaglio ? h('p', {}, d.dettaglio) : null,
        h('div', { class: 'riga-bottoni' },
          h('button', { class: 'btn', onclick: async () => { try { await aggiornaLavoro(lav); opz.dopoCambio && opz.dopoCambio(); } catch (e) { avviso(e.message); } disegna(); } }, 'Aggiorna'),
          (st.fase === 'errore' || st.fase === 'da riprendere') ? h('button', { class: 'btn primario', onclick: async () => { try { await riprendi(lav); avviso('Ripartito'); } catch (e) { avviso(e.message); } disegna(); } }, 'Riprendi') : null,
          h('button', { class: 'btn pericolo', onclick: async () => { if (await conferma('Fermare il lavoro?', 'I capitoli già scaricati restano.', 'Ferma')) { await annulla(lav); disegna(); } } }, 'Ferma'))));
    } else if (voceSel) {
      parti.push(h('button', { class: 'btn primario largo', onclick: () => creaAudio(libro, opz.cap, voceSel, () => disegna()) }, icona('cuffie', 18), `Crea audio con ${nomeVoce(voceSel, mie)}`));
    } else {
      parti.push(h('p', { class: 'nota al-nota' }, 'Per ascoltare a schermo spento scegli una voce naturale o la tua voce, poi crea l\'audio del libro.'));
    }
    audioLibro.replaceChildren(...parti.filter(Boolean));
  }

  disegnaLingue();
  disegna();
  return f;
}

// ---------------------------------------------------------------- crea audio
async function creaAudio(libro, capAtt, voceId, dopo) {
  if (!(await configurato())) { configuraGithub(); return; }
  const altri = (await lavoriAttivi()).filter(l => l.libro !== libro.id);
  if (altri.length) { avviso('C\'è già un audio in preparazione per un altro libro: aspetta che finisca.'); return; }
  const motore = voceId.startsWith('kokoro:') ? 'kokoro' : voceId.startsWith('xtts:') ? 'xtts' : 'clonata';
  const giaPronti = new Set((await db.audioLibro(libro.id)).filter(a => a.voce === voceId).map(a => a.n));
  const scelte = {
    tutto: libro.capitoli.map((_, i) => i),
    daqui: libro.capitoli.map((_, i) => i).filter(i => i >= capAtt),
    questo: [capAtt],
  };
  let scelta = 'tutto';
  const info = h('p', { class: 'nota' });
  const aggiornaInfo = () => {
    const caps = scelte[scelta].filter(i => !giaPronti.has(i));
    const parole = caps.reduce((s, i) => s + libro.capitoli[i].parole, 0);
    const { audio, attesa } = stima(parole, motore);
    info.textContent = caps.length
      ? `${caps.length} capitoli, circa ${minuti(audio * 60)} di audio. Primo capitolo pronto in 10 o 15 minuti, tutto in circa ${minuti(attesa * 60)}.${motore !== 'kokoro' ? ' Usa la GPU gratuita di Kaggle: 30 ore a settimana.' : ''}`
      : 'Questi capitoli hanno già l\'audio con questa voce.';
  };
  const seg = h('div', { class: 'segmenti' });
  const disegnaSeg = () => seg.replaceChildren(...[['tutto', 'Tutto il libro'], ['daqui', 'Da qui in poi'], ['questo', 'Questo capitolo']].map(([k, t]) =>
    h('button', { class: scelta === k ? 'attivo' : '', onclick: () => { scelta = k; disegnaSeg(); aggiornaInfo(); } }, t)));
  disegnaSeg(); aggiornaInfo();
  const bottone = h('button', { class: 'btn primario largo' }, 'Crea audio');
  const f = foglio('Crea audio', h('div', { class: 'modulo' }, seg, info,
    h('p', { class: 'nota' }, 'Puoi chiudere l\'app: il lavoro continua. Quando la riapri i capitoli pronti si scaricano da soli.'), bottone));
  bottone.addEventListener('click', async () => {
    const caps = scelte[scelta].filter(i => !giaPronti.has(i));
    if (!caps.length) { f.chiudi(); return; }
    bottone.disabled = true;
    try {
      await creaLavoro(libro, voceId, caps, p => { bottone.textContent = `Preparo… ${Math.round(p * 100)}%`; });
      f.chiudi();
      avviso('Audio in preparazione. Il primo capitolo arriva fra 10 o 15 minuti.');
      dopo && dopo();
    } catch (e) {
      bottone.disabled = false; bottone.textContent = 'Crea audio';
      avviso(e.message, { durata: 7000 });
    }
  });
}

// ---------------------------------------------------------------- GitHub
export function configuraGithub(dopo) {
  // Un vero modulo con nome utente e password: l'iPhone propone di salvarlo nel
  // Portachiavi iCloud e la volta dopo lo compila da solo.
  const utente = h('input', { class: 'campo', type: 'text', name: 'username', autocomplete: 'username', value: 'Leggio GitHub', readonly: true });
  const campo = h('input', { class: 'campo', type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'github_pat_… oppure ghp_…', autocapitalize: 'off', spellcheck: 'false' });
  impostazioni().then(i => { campo.value = i.githubToken || ''; });
  const bottone = h('button', { class: 'btn primario largo', type: 'submit' }, 'Salva e verifica');
  const modulo = h('form', { class: 'modulo guida', autocomplete: 'on', action: '#', method: 'post' },
    h('p', {}, "L'audio si crea gratis su Kaggle e arriva al telefono passando dal tuo repository privato leggio-audio. Serve un codice di accesso a GitHub, da creare una volta sola."),
    h('ol', {},
      h('li', {}, 'Apri ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'github.com › nuovo codice di accesso'), '.'),
      h('li', {}, 'Nome: Leggio. Scadenza: quella che preferisci, anche un anno.'),
      h('li', {}, 'Repository access: Only select repositories › leggio-audio.'),
      h('li', {}, 'Permissions › Add permissions: Contents e Actions, tutti e due su Read and write.'),
      h('li', {}, 'Genera il codice, copialo e incollalo qui sotto.')),
    utente, campo,
    h('p', { class: 'nota' }, "Quando l'iPhone chiede di salvare la password, accetta: il codice resta nel Portachiavi e lo ritrovi anche se i dati dell'app vengono cancellati."),
    bottone);
  modulo.addEventListener('submit', async e => {
    e.preventDefault();
    const { salvaConfigurazione, verificaAccesso } = await import('./audio.js');
    bottone.disabled = true;
    await salvaConfigurazione(campo.value);
    try { const r = await verificaAccesso(); avviso(`Collegato a ${r}`); f.chiudi(); dopo && dopo(); } catch (err) { avviso(err.message, { durata: 7000 }); }
    bottone.disabled = false;
  });
  const f = foglio('Audio generato', modulo);
}

// ---------------------------------------------------------------- registrazione
const TESTI = {
  it: [
    'Il sole di settembre entrava di sbieco dalla finestra e disegnava sul pavimento un rettangolo dorato. Mi fermai a guardarlo, come si guarda una cosa che sta per finire.',
    '«Ma davvero pensi che basti?» mi chiese, alzando appena la voce. Non risposi subito. Poi, piano, dissi che no, non bastava, ma che era tutto quello che avevamo.',
    'Ventitré chilometri, tre gallerie e un ponte sul fiume: questo era il tragitto, ogni mattina, alle sette e un quarto. Lo conoscevo a memoria, eppure ogni volta trovavo qualcosa di nuovo.',
    'Quella sera la cucina profumava di pane e di pioggia. Mia nonna rideva, raccontando di quando, da ragazza, aveva perso il treno per Napoli e aveva deciso di restare.',
  ],
  en: [
    'The September sun came in sideways through the window and drew a golden rectangle on the floor. I stopped to look at it, the way you look at something that is about to end.',
    '"Do you really think that is enough?" she asked, barely raising her voice. I did not answer at once. Then, quietly, I said no, it was not enough, but it was all we had.',
    'Fourteen miles, three tunnels and a bridge over the river: that was the journey, every morning, at a quarter past seven. I knew it by heart, and yet each time I found something new.',
    'That evening the kitchen smelled of bread and rain. My grandmother was laughing, telling us how, as a girl, she had missed the train to the city and decided to stay.',
  ],
};

function tipoRegistrazione() {
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function registraVoce(lingua, dopo) {
  const testi = TESTI[lingua] || TESTI.it;
  const prese = [];
  let flusso = null, reg = null, inizio = 0, timer = null, analisi = null, raf = null, k = 0;
  const nome = h('input', { class: 'campo', placeholder: 'Nome della voce, per esempio La mia voce' });
  const testo = h('blockquote', { class: 'reg-testo' });
  const tempo = h('div', { class: 'reg-tempo' }, '0:00');
  const livello = h('div', { class: 'reg-livello' }, h('div'));
  const tasto = h('button', { class: 'reg-tasto', 'aria-label': 'Registra' }, h('span'));
  const elenco = h('div', { class: 'reg-prese' });
  const salva = h('button', { class: 'btn primario largo', disabled: true }, 'Salva la voce');
  const stato = h('p', { class: 'nota' });

  const mostraTesto = () => { testo.textContent = testi[k % testi.length]; };
  const totale = () => prese.reduce((s, p) => s + p.durata, 0);
  const disegnaPrese = () => {
    elenco.replaceChildren(...prese.map((p, i) => h('div', { class: 'reg-presa' },
      h('span', {}, `Registrazione ${i + 1} · ${Math.round(p.durata)} s`),
      bottoneIcona('play', 'Ascolta', () => { const a = new Audio(p.url); a.play(); }, 'piccola'),
      bottoneIcona('cestino', 'Togli', () => { prese.splice(i, 1); disegnaPrese(); }, 'piccola'))));
    const t = totale();
    salva.disabled = t < 25 || prese.length < 2;
    stato.textContent = t < 25 ? `Hai ${Math.round(t)} secondi: ne servono almeno 25, meglio un minuto, in due o più registrazioni.` : `Hai ${Math.round(t)} secondi di voce. ${t < 60 ? 'Un\'altra registrazione migliora la somiglianza.' : 'Bastano.'}`;
  };

  async function avvia() {
    try {
      flusso = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch { avviso('Serve il permesso del microfono.'); return; }
    const tipo = tipoRegistrazione();
    reg = new MediaRecorder(flusso, tipo ? { mimeType: tipo } : undefined);
    const pezzi = [];
    reg.ondataavailable = e => e.data.size && pezzi.push(e.data);
    reg.onstop = () => {
      const durata = (Date.now() - inizio) / 1000;
      const blob = new Blob(pezzi, { type: reg.mimeType || tipo || 'audio/mp4' });
      flusso.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(raf); clearInterval(timer);
      tasto.classList.remove('attivo');
      if (durata >= 4) { prese.push({ blob, durata, tipo: blob.type, url: URL.createObjectURL(blob) }); k++; mostraTesto(); }
      else avviso('Troppo corta, riprova');
      disegnaPrese();
    };
    // Livello del microfono, per vedere che sente.
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(flusso);
      analisi = ctx.createAnalyser(); analisi.fftSize = 512; src.connect(analisi);
      const dati = new Uint8Array(analisi.fftSize);
      const passo = () => { analisi.getByteTimeDomainData(dati); let m = 0; for (const v of dati) m = Math.max(m, Math.abs(v - 128)); livello.firstChild.style.width = `${Math.min(100, m / 1.0)}%`; raf = requestAnimationFrame(passo); };
      passo();
    } catch { /* niente */ }
    inizio = Date.now();
    timer = setInterval(() => { const s = Math.floor((Date.now() - inizio) / 1000); tempo.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s >= 45) reg.stop(); }, 250);
    reg.start();
    tasto.classList.add('attivo');
  }
  tasto.addEventListener('click', () => { if (reg && reg.state === 'recording') reg.stop(); else avvia(); });

  salva.addEventListener('click', async () => {
    const v = { id: nuovoId(), nome: nome.value.trim() || 'La mia voce', lingua, creato: Date.now(), campioni: [] };
    for (const p of prese) v.campioni.push({ blob: new Blob([await p.blob.arrayBuffer()], { type: p.tipo }), tipo: p.tipo, durata: p.durata });
    await db.put('voci', v);
    f.chiudi();
    avviso('Voce salvata. Sceglila e crea l\'audio del libro.');
    dopo && dopo(v);
  });

  mostraTesto();
  disegnaPrese();
  const f = foglio('Registra una voce', h('div', { class: 'registra' },
    nome,
    h('p', { class: 'nota' }, 'In un posto silenzioso, col telefono a una spanna dalla bocca. Leggi con calma e con naturalezza il testo qui sotto, poi tocca di nuovo per fermare. Ogni registrazione dura al massimo 45 secondi.'),
    testo,
    h('div', { class: 'reg-centro' }, tasto, h('div', {}, tempo, livello)),
    elenco, stato, salva),
  { alto: true, allaChiusura: () => { try { if (reg && reg.state === 'recording') reg.stop(); flusso && flusso.getTracks().forEach(t => t.stop()); } catch { /* niente */ } } });
}
