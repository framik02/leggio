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
    const scegli = async v => { libro.voceAudio = `clonata:${v.id}`; await db.put('libri', libro); opz.dopoCambio && opz.dopoCambio(); disegna(); };
    return [
      h('p', { class: 'nota' }, 'Una voce si crea registrando col microfono o importando un audio, anche lungo: Kaggle lo taglia, lo trascrive e la clona. Usa la tua voce, o quella di chi ti ha dato il permesso.'),
      mie.length ? h('div', { class: 'elenco-voci' }, mie.map(v => {
        const id = `clonata:${v.id}`;
        return h('div', { class: `voce-riga ${libro.voceAudio === id ? 'scelta-attiva' : ''}` },
          h('button', { class: 'voce-nome', onclick: () => scegli(v) },
            avatarVoce(v),
            h('span', { class: 'voce-testi' }, h('span', {}, v.nome), h('small', {}, descriviCampioni(v)))),
          bottoneIcona('matita', 'Modifica', () => apriVoce(v, libro.lingua, () => disegna())));
      })) : null,
      h('button', { class: 'btn largo', onclick: () => apriVoce(null, libro.lingua, async v => { if (v) await scegli(v); else disegna(); }) }, icona('piu', 18), 'Nuova voce'),
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
  // Capitoli di servizio che nessuno vuole ascoltare: note, bibliografia, indici.
  const servizio = /^(note|notes|endnotes|bibliografia|bibliography|riferimenti bibliografici|indice( analitico| dei nomi)?|index|colophon|copyright|crediti|credits|frontespizio)$/i;
  const daLeggere = libro.capitoli.map((c, i) => i).filter(i => !servizio.test((libro.capitoli[i].titolo || '').trim()));
  const esclusi = libro.capitoli.length - daLeggere.length;
  const scelte = {
    tutto: daLeggere,
    daqui: daLeggere.filter(i => i >= capAtt),
    questo: [capAtt],
  };
  let scelta = 'tutto';
  const info = h('p', { class: 'nota' });
  const aggiornaInfo = () => {
    const caps = scelte[scelta].filter(i => !giaPronti.has(i));
    const parole = caps.reduce((s, i) => s + libro.capitoli[i].parole, 0);
    const { audio, attesa } = stima(parole, motore);
    info.textContent = caps.length
      ? `${caps.length} capitoli, circa ${minuti(audio * 60)} di audio${esclusi && scelta !== 'questo' ? ` (saltati ${esclusi} capitoli di note, bibliografia o indice)` : ''}. Primo capitolo pronto in 10 o 15 minuti, tutto in circa ${minuti(attesa * 60)}.${motore !== 'kokoro' ? ' Usa la GPU gratuita di Kaggle: 30 ore a settimana.' : ''}`
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
// Testi vari apposta: racconto, dialogo, domande, esclamazioni, numeri, elenchi.
// Il modello impara come la voce sale e scende, non solo il timbro.
const TESTI = {
  it: [
    ['Racconto', 'Il sole di settembre entrava di sbieco dalla finestra e disegnava sul pavimento un rettangolo dorato. Mi fermai a guardarlo, come si guarda una cosa che sta per finire.'],
    ['Dialogo', '«Ma davvero pensi che basti?» mi chiese, alzando appena la voce. Non risposi subito. Poi, piano, dissi che no, non bastava, ma che era tutto quello che avevamo.'],
    ['Domande', 'Dove eravamo rimasti? Chi aveva chiuso la porta? E perché nessuno, in quella casa, voleva ammettere di aver sentito il telefono suonare tre volte, nel cuore della notte?'],
    ['Allegria', 'Che giornata! Avevamo vinto, finalmente! Mio fratello saltava sul divano, la radio gridava i risultati e perfino il cane, che di solito dormiva, abbaiava come un matto.'],
    ['Tristezza', 'Quando la casa fu vuota, rimase soltanto il segno dei quadri sulle pareti. Mia madre passò la mano sul muro, lentamente, come per salutare qualcuno che non c’era più.'],
    ['Rabbia trattenuta', 'Non alzare la voce con me. Ti ho aspettato tre ore, sotto la pioggia, senza una telefonata. Adesso non voglio scuse: voglio solo sapere perché.'],
    ['Paura', 'Il corridoio era buio. Sentii un rumore, poi un altro, più vicino. Trattenni il respiro e restai immobile, con la mano sulla maniglia, senza il coraggio di aprire.'],
    ['Tenerezza', 'Dormi, piccola mia, che fuori c’è il vento ma qui siamo al caldo. Domani andiamo al mare, te lo prometto, e raccogliamo le conchiglie più belle.'],
    ['Ironia', 'Naturalmente il treno era in orario. Così in orario che era partito dieci minuti prima, lasciandoci sulla banchina con le valigie e un’ottima occasione per fare amicizia.'],
    ['Solenne', 'Signore e signori, in questo giorno ricordiamo chi ha costruito, con fatica e silenzio, la libertà di cui oggi godiamo. A loro va la nostra gratitudine.'],
    ['Confidenza', 'Te lo dico sottovoce, perché non voglio che lo sappiano gli altri: quella lettera l’ho scritta io. Non l’ho mai spedita, ma ogni tanto la rileggo.'],
    ['Numeri e date', 'Il treno delle sette e un quarto partiva dal binario tre. Ventitré chilometri, tre gallerie e un ponte: arrivavo alle otto meno dieci, il dodici di ogni mese, dal millenovecentonovantotto.'],
    ['Cifre e percentuali', 'Nel duemilaventitré le vendite sono cresciute del quattordici virgola cinque per cento, mentre i costi sono scesi di un terzo. Un risultato che nessuno, a gennaio, si aspettava.'],
    ['Nomi e luoghi', 'Da Bolzano a Palermo, passando per Firenze, Matera e Cagliari, Giuseppe, Chiara, Federico e Anna attraversarono l’Italia in sei settimane, su una vecchia Fiat azzurra.'],
    ['Nomi stranieri e sigle', 'Al convegno di Berlino parlarono Jean-Paul Sartre, Virginia Woolf e Friedrich Nietzsche, almeno nei ricordi di un giornalista della RAI che aveva confuso tutti i badge.'],
    ['Descrizione', 'La cucina profumava di pane e di pioggia. Sul tavolo c’erano tre tazze sbeccate, un barattolo di miele e una lettera mai aperta, con il francobollo azzurro e l’indirizzo scritto a mano.'],
    ['Elenco', 'Prima di partire controllò tutto: il passaporto, le chiavi, il caricabatterie, due maglioni, un ombrello piccolo e, nascosto nella tasca interna, il biglietto che lei gli aveva lasciato.'],
    ['Istruzioni', 'Per prima cosa, accendete il forno a centottanta gradi. Poi sbattete le uova con lo zucchero, aggiungete la farina un poco alla volta e mescolate con calma, senza fretta.'],
    ['Notiziario', 'Buonasera. Apriamo con il maltempo che da questa mattina interessa il Nord: strade allagate in Liguria, scuole chiuse in tre province e treni in ritardo fino a due ore.'],
    ['Riflessione', 'Forse non esistono scelte giuste o sbagliate, pensava. Esistono soltanto scelte fatte con attenzione oppure in fretta, e la differenza, a volte, la si scopre molti anni dopo.'],
    ['Saggistica', 'Secondo gli studi più recenti, la memoria non funziona come un archivio, ma come una ricostruzione: ogni volta che ricordiamo un episodio, lo riscriviamo, e un poco lo cambiamo.'],
    ['Poesia', 'Sera di ottobre, il cielo si fa basso, / le foglie cadono senza far rumore. / Cammino piano, e conto passo a passo / le cose che ho perduto, e il loro odore.'],
    ['Filastrocca', 'Trentatré trentini entrarono a Trento, tutti e trentatré trotterellando. Sopra la panca la capra campa, sotto la panca la capra crepa.'],
    ['Frase lunga', 'Quando arrivammo al paese, dopo una salita che sembrava non finire mai, tra muretti a secco, ulivi storti e qualche cane che ci seguiva per curiosità, il campanile stava suonando mezzogiorno.'],
  ],
  en: [
    ['Story', 'The September sun came in sideways through the window and drew a golden rectangle on the floor. I stopped to look at it, the way you look at something that is about to end.'],
    ['Dialogue', '"Do you really think that is enough?" she asked, barely raising her voice. I did not answer at once. Then, quietly, I said no, it was not enough, but it was all we had.'],
    ['Questions', 'Where were we? Who had closed the door? And why did nobody in that house want to admit hearing the phone ring three times, in the middle of the night?'],
    ['Joy', 'What a day! We had won, at last! My brother was jumping on the sofa, the radio was shouting the results, and even the dog, who usually slept, was barking like mad.'],
    ['Sadness', 'When the house was empty, only the marks of the paintings remained on the walls. My mother ran her hand along the wall, slowly, as if saying goodbye to someone who was gone.'],
    ['Restrained anger', 'Do not raise your voice with me. I waited three hours for you, in the rain, without a single call. I do not want excuses now: I just want to know why.'],
    ['Fear', 'The corridor was dark. I heard a noise, then another, closer. I held my breath and stood still, my hand on the handle, without the courage to open the door.'],
    ['Tenderness', 'Sleep now, little one, the wind is outside but we are warm in here. Tomorrow we will go to the sea, I promise, and pick up the most beautiful shells.'],
    ['Irony', 'Naturally, the train was on time. So on time that it had left ten minutes early, leaving us on the platform with our suitcases and an excellent chance to make new friends.'],
    ['Numbers and dates', 'The seven fifteen train left from platform three. Fourteen miles, three tunnels and a bridge: I arrived at ten to eight, on the twelfth of every month, since nineteen ninety-eight.'],
    ['Names and places', 'From Edinburgh to Cornwall, by way of York, Oxford and Bath, Margaret, Oliver, Priya and Tom crossed Britain in six weeks, in an old blue Land Rover.'],
    ['Instructions', 'First, preheat the oven to one hundred and eighty degrees. Then beat the eggs with the sugar, add the flour a little at a time, and stir slowly, without hurrying.'],
    ['News', 'Good evening. We begin with the storms that have hit the north since this morning: flooded roads, schools closed in three counties and trains delayed by up to two hours.'],
    ['Reflection', 'Perhaps there are no right or wrong choices, he thought. There are only choices made with care or in a hurry, and sometimes you find out the difference many years later.'],
    ['Poetry', 'October evening, and the sky hangs low, / the leaves come down without a single sound. / I walk on slowly, counting as I go / the things I lost, and where they can be found.'],
    ['Long sentence', 'When we reached the village, after a climb that seemed endless, between dry stone walls, crooked olive trees and a few dogs that followed us out of curiosity, the bell was ringing noon.'],
  ],
};
const OBIETTIVO = 180; // secondi per una voce ricca di sfumature
const MASSIMO_CAMPIONI = 60;

function tipoRegistrazione() {
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

// esistente: una voce già salvata a cui aggiungere registrazioni.
export function registraVoce(lingua, dopo, esistente, daEditor = false) {
  const testi = TESTI[lingua] || TESTI.it;
  const prese = [];
  const giaFatti = esistente ? esistente.campioni.reduce((s, c) => s + c.durata, 0) : 0;
  let flusso = null, reg = null, inizio = 0, timer = null, analisi = null, raf = null;
  let k = esistente ? esistente.campioni.length : 0;
  const nome = esistente ? null : h('input', { class: 'campo', placeholder: 'Nome della voce, per esempio La mia voce' });
  const etichetta = h('div', { class: 'occhio' });
  const testo = h('blockquote', { class: 'reg-testo' });
  const tempo = h('div', { class: 'reg-tempo' }, '0:00');
  const livello = h('div', { class: 'reg-livello' }, h('div'));
  const tasto = h('button', { class: 'reg-tasto', 'aria-label': 'Registra' }, h('span'));
  const altro = h('button', { class: 'btn reg-altro', onclick: () => { k++; mostraTesto(); } }, 'Un altro testo');
  const elenco = h('div', { class: 'reg-prese' });
  const barra = h('div', { class: 'reg-obiettivo' }, h('div'));
  const salva = h('button', { class: 'btn primario largo', disabled: true }, esistente ? 'Aggiungi alla voce' : 'Salva la voce');
  const stato = h('p', { class: 'nota' });

  const mostraTesto = () => { const [tipo, t] = testi[k % testi.length]; etichetta.textContent = tipo; testo.textContent = t; };
  const totale = () => giaFatti + prese.reduce((s, p) => s + p.durata, 0);
  const disegnaPrese = () => {
    elenco.replaceChildren(...prese.map((p, i) => h('div', { class: 'reg-presa' },
      h('span', {}, `Registrazione ${i + 1} · ${Math.round(p.durata)} s`),
      bottoneIcona('play', 'Ascolta', () => { const a = new Audio(p.url); a.play(); }, 'piccola'),
      bottoneIcona('cestino', 'Togli', () => { prese.splice(i, 1); disegnaPrese(); }, 'piccola'))));
    const t = totale();
    barra.firstChild.style.width = `${Math.min(100, t / OBIETTIVO * 100)}%`;
    barra.classList.toggle('pieno', t >= OBIETTIVO);
    salva.disabled = esistente ? !prese.length : (t < 25 || prese.length < 2);
    const quanti = (esistente ? esistente.campioni.length : 0) + prese.length;
    tasto.disabled = quanti >= MASSIMO_CAMPIONI;
    stato.textContent = quanti >= MASSIMO_CAMPIONI ? `Hai ${MASSIMO_CAMPIONI} registrazioni, il massimo che serve.`
      : t < 25 ? `Hai ${Math.round(t)} secondi: ne servono almeno 25, meglio tre minuti, su testi diversi.`
        : t < 60 ? `Hai ${Math.round(t)} secondi. Va già, ma con un minuto la voce somiglia di più.`
          : t < OBIETTIVO ? `Hai ${Math.round(t)} secondi: buono. Arrivando a tre minuti, con emozioni diverse, la voce prende più sfumature.`
            : `Hai ${Math.round(t)} secondi: ottimo, bastano.`;
  };

  async function avvia() {
    try {
      // Niente controllo automatico del volume né cancellazione dell'eco: cambiano il timbro.
      flusso = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
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
    const v = esistente || { id: nuovoId(), nome: nome.value.trim() || 'La mia voce', lingua, creato: Date.now(), campioni: [] };
    for (const p of prese) v.campioni.push({ blob: new Blob([await p.blob.arrayBuffer()], { type: p.tipo }), tipo: p.tipo, durata: p.durata });
    v.campioni = v.campioni.slice(0, MASSIMO_CAMPIONI);
    await db.put('voci', v);
    f.chiudi();
    avviso(esistente ? 'Registrazioni aggiunte. Il prossimo audio userà anche queste.' : 'Voce salvata. Sceglila e crea l\'audio del libro.');
    dopo && dopo(v);
  });

  mostraTesto();
  disegnaPrese();
  const f = foglio(esistente ? `Aggiungi a «${esistente.nome}»` : 'Registra una voce', h('div', { class: 'registra' },
    nome,
    h('p', { class: 'nota' }, 'In un posto silenzioso, sempre alla stessa distanza, una spanna dalla bocca. Leggi come un audiolibro e recita l’emozione indicata sopra il testo: allegria, tristezza, rabbia, sussurro. È così che la voce clonata impara le sfumature. Tocca per iniziare e di nuovo per fermare: al massimo 45 secondi per volta.'),
    h('div', { class: 'reg-testata' }, etichetta, altro),
    testo,
    h('div', { class: 'reg-centro' }, tasto, h('div', {}, tempo, livello)),
    barra, stato, elenco, salva),
  { alto: true, allaChiusura: () => { try { if (reg && reg.state === 'recording') reg.stop(); flusso && flusso.getTracks().forEach(t => t.stop()); } catch { /* niente */ } } });
}

// ---------------------------------------------------------------- le mie voci
const TINTE_VOCE = ['#B4532A', '#2F5D50', '#4B3F72', '#1F3A5F', '#8A6A2F', '#6B2D3C'];
export function avatarVoce(v, dim = 44) {
  if (v.immagine) {
    const u = URL.createObjectURL(v.immagine);
    return h('img', { class: 'avatar', src: u, alt: '', style: { width: `${dim}px`, height: `${dim}px` } });
  }
  let x = 0; for (const c of v.nome || '?') x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return h('span', { class: 'avatar', style: { width: `${dim}px`, height: `${dim}px`, background: TINTE_VOCE[x % TINTE_VOCE.length], fontSize: `${dim * 0.42}px` } }, (v.nome || '?').trim().charAt(0).toUpperCase());
}

export function descriviCampioni(v) {
  const sec = v.campioni.reduce((s, c) => s + (c.durata || 0), 0);
  const durata = sec >= 90 ? `${Math.round(sec / 60)} minuti` : `${Math.round(sec)} secondi`;
  return `${v.campioni.length} audio · ${durata}${v.trascrizione ? ' · trascritta' : ''}`;
}

// Foto profilo: quadrata, ritagliata al centro, 256 pixel.
async function preparaImmagine(file) {
  const bmp = await createImageBitmap(file);
  const lato = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d').drawImage(bmp, (bmp.width - lato) / 2, (bmp.height - lato) / 2, lato, lato, 0, 0, 256, 256);
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.86));
}

function durataAudio(blob) {
  return new Promise(ok => {
    const a = new Audio();
    const u = URL.createObjectURL(blob);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      // Alcuni file dicono Infinity finché non si cerca la fine.
      if (a.duration === Infinity) { a.currentTime = 1e9; a.ontimeupdate = () => { a.ontimeupdate = null; ok(a.duration); URL.revokeObjectURL(u); }; }
      else { ok(a.duration || 0); URL.revokeObjectURL(u); }
    };
    a.onerror = () => { ok(0); URL.revokeObjectURL(u); };
    a.src = u;
  });
}

const MAX_MB_FILE = 60;

// Editor di una voce: nome, foto, registrazioni e audio importati.
export async function apriVoce(esistente, lingua, dopo) {
  const v = esistente ? { ...esistente, campioni: [...esistente.campioni] } : { id: nuovoId(), nome: '', lingua, creato: Date.now(), campioni: [] };
  const nuova = !esistente;
  const nome = h('input', { class: 'campo', placeholder: 'Nome della voce', value: v.nome });
  const foto = h('button', { class: 'voce-foto', 'aria-label': 'Cambia immagine' });
  const sceltaFoto = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const sceltaAudio = h('input', { type: 'file', accept: 'audio/*,video/mp4,video/quicktime,.m4a,.mp3,.wav,.ogg,.opus,.aac,.flac', multiple: true, hidden: true });
  const elenco = h('div', { class: 'reg-prese' });
  const riepilogo = h('p', { class: 'nota' });
  const salva = h('button', { class: 'btn primario largo' }, nuova ? 'Crea la voce' : 'Salva');

  const disegnaFoto = () => foto.replaceChildren(avatarVoce({ ...v, nome: nome.value || v.nome }, 84), h('span', { class: 'voce-foto-testo' }, v.immagine ? 'Cambia foto' : 'Aggiungi foto'));
  const disegnaElenco = () => {
    elenco.replaceChildren(...v.campioni.map((c, i) => h('div', { class: 'reg-presa' },
      h('span', {}, c.nomeFile ? `${c.nomeFile} · ${Math.round((c.durata || 0) / 60 * 10) / 10} min` : `Registrazione ${i + 1} · ${Math.round(c.durata || 0)} s`),
      bottoneIcona('play', 'Ascolta', () => ascolta(URL.createObjectURL(c.blob)), 'piccola'),
      bottoneIcona('cestino', 'Togli', () => { v.campioni.splice(i, 1); disegnaElenco(); }, 'piccola'))));
    const sec = v.campioni.reduce((s, c) => s + (c.durata || 0), 0);
    riepilogo.textContent = !v.campioni.length ? 'Ancora nessun audio. Registra col microfono o importa un file: un memo vocale, un mp3, anche di mezz’ora.'
      : sec < 60 ? `Hai ${Math.round(sec)} secondi di voce: ne servono almeno 25, meglio qualche minuto.`
        : `Hai ${Math.round(sec / 60 * 10) / 10} minuti di voce. ${sec < 600 ? 'Per la clonazione bastano; dai 10 minuti in su si potrà anche allenare il modello.' : 'Abbastanza anche per allenare il modello sulla tua voce.'}`;
    salva.disabled = !v.campioni.length && !nuova;
  };

  foto.addEventListener('click', () => sceltaFoto.click());
  sceltaFoto.addEventListener('change', async () => {
    const f = sceltaFoto.files[0];
    if (!f) return;
    try { v.immagine = await preparaImmagine(f); disegnaFoto(); } catch { avviso('Immagine non leggibile'); }
  });
  nome.addEventListener('input', () => { if (!v.immagine) disegnaFoto(); });
  sceltaAudio.addEventListener('change', async () => {
    for (const f of sceltaAudio.files) {
      if (f.size > MAX_MB_FILE * 1048576) { avviso(`${f.name} supera ${MAX_MB_FILE} MB: taglialo in più parti`, { durata: 6000 }); continue; }
      const blob = new Blob([await f.arrayBuffer()], { type: f.type || 'audio/mp4' });
      const durata = await durataAudio(blob);
      v.campioni.push({ blob, tipo: blob.type, durata, nomeFile: f.name, importato: true });
    }
    sceltaAudio.value = '';
    disegnaElenco();
  });

  const salvaVoce = async () => {
    v.nome = nome.value.trim() || v.nome || 'La mia voce';
    v.campioni = v.campioni.slice(0, MASSIMO_CAMPIONI);
    await db.put('voci', v);
    return v;
  };
  salva.addEventListener('click', async () => {
    if (nuova && !v.campioni.length) { avviso('Aggiungi almeno un audio: registra o importa un file.'); return; }
    await salvaVoce();
    f.chiudi();
    avviso(nuova ? 'Voce creata. Ora crea l’audio del libro.' : 'Voce salvata');
    dopo && dopo(v);
  });

  disegnaFoto();
  disegnaElenco();
  const f = foglio(nuova ? 'Nuova voce' : v.nome, h('div', { class: 'modulo voce-editor' },
    h('div', { class: 'voce-testa' }, foto, nome),
    h('div', { class: 'riga-bottoni' },
      h('button', { class: 'btn', onclick: async () => {
        v.nome = nome.value.trim() || v.nome || 'La mia voce';
        f.chiudi();
        registraVoce(lingua, async nuovaV => { await apriVoce(nuovaV || v, lingua, dopo); }, v, true);
      } }, icona('voce', 18), 'Registra'),
      h('button', { class: 'btn', onclick: () => sceltaAudio.click() }, icona('piu', 18), 'Importa audio')),
    riepilogo, elenco,
    h('p', { class: 'nota' }, 'Gli audio importati vengono tagliati e trascritti su Kaggle: puoi caricare registrazioni lunghe, anche con pause. Evita musica di sottofondo e altre voci.'),
    salva,
    nuova ? null : h('button', { class: 'btn pericolo largo', onclick: async () => {
      if (await conferma('Eliminare la voce?', `«${v.nome}» sparisce da questo telefono.`, 'Elimina')) { await db.del('voci', v.id); f.chiudi(); dopo && dopo(null); }
    } }, icona('cestino', 18), 'Elimina la voce'),
    sceltaFoto, sceltaAudio), { alto: true });
}
