// Confronti preparati su Kaggle. Nel lettore non gira alcun modello.
import { db } from './db.js';
import { h, icona, foglio, avviso } from './ui.js';
import { datiLibro, statoMappa, aggiornaMappa, ricostruisci, seguiMappa } from './mappa.js';
import { frasiDalCapitolo } from './voce.js';

export const ETICHETTE = { affine: 'Idea affine', prospettiva: 'Un’altra prospettiva', contrasto: 'In contrasto' };
export const stessoAutore = (a, b) => {
  const normalizza = s => (s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .match(/\p{L}+/gu)?.sort().join(' ') || '';
  return !normalizza(a) || !normalizza(b) || normalizza(a) === normalizza(b);
};
const posizioneUguale = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length >= 3 && a.slice(0, 3).every((x, i) => x === b[i]);
const proveValide = (ids, p) => Array.isArray(ids) && ids.length > 0 && ids.every(n => Number.isInteger(n) && n >= p[1] && n <= p[2]);

export function legameValido(r, sorgente, destinazione, libro, altro, i) {
  const p = sorgente?.passaggi?.[i];
  const q = destinazione?.passaggi?.[r?.passaggio];
  return !!(r && ETICHETTE[r.relazione] && p && q && r.id && r.libro === altro?.id && altro.id !== libro.id
    && !stessoAutore(libro.autore, altro.autore) && sorgente.versione === destinazione.versione
    && posizioneUguale(r.origine, p) && posizioneUguale(r.destinazione, q)
    && proveValide(r.frasiOrigine, p) && proveValide(r.frasiDestinazione, q)
    && typeof r.spiegazione === 'string' && r.spiegazione.length > 0);
}

async function frasiCapitolo(libro, cap) {
  const c = await db.get('capitoli', [libro, cap]);
  if (!c) return null;
  const div = document.createElement('div');
  div.innerHTML = c.html;
  return { titolo: c.titolo, frasi: frasiDalCapitolo(div).filter(f => !f.titolo) };
}

async function estratto(libro, posizione, ids) {
  const c = await frasiCapitolo(libro.id, posizione[0]);
  if (!c) return null;
  const frasi = c.frasi.filter(f => ids.includes(f.id));
  if (frasi.length !== new Set(ids).size) return null;
  return { libro: libro.id, titolo: libro.titolo, autore: libro.autore || '', cap: posizione[0],
    capTitolo: c.titolo, da: posizione[1], a: posizione[2], frasi: ids,
    testo: frasi.map(f => f.testo.trim()).join(' ') };
}

function cita(e) {
  return h('div', {}, h('div', { class: 'echi-meta' }, `${e.autore} · ${e.titolo}`),
    h('p', { class: 'mf-citazione' }, e.testo), h('div', { class: 'echi-cap' }, e.capTitolo || `Capitolo ${e.cap + 1}`));
}

async function contesto(e, aperto) {
  const c = await frasiCapitolo(e.libro, e.cap);
  if (!c) { avviso('Il libro non è più sul telefono. Il confronto salvato conserva gli estratti.'); return; }
  const corpo = h('div', { class: 'echi-contesto' });
  let tutto = false;
  const disegna = () => {
    const a = c.frasi.findIndex(f => f.id >= e.da);
    const b = c.frasi.findIndex(f => f.id > e.a);
    const lista = tutto ? c.frasi : c.frasi.slice(Math.max(0, a - 3), Math.min(c.frasi.length, (b < 0 ? c.frasi.length : b) + 3));
    const paragrafi = [];
    let blocco = null, p = null;
    for (const f of lista) {
      if (!p || blocco !== f.blocco) { blocco = f.blocco; p = h('p'); paragrafi.push(p); }
      p.append(h('span', { class: e.frasi.includes(f.id) ? 'chiedi-frase' : '' }, f.testo.trim(), ' '));
    }
    corpo.replaceChildren(h('div', { class: 'echi-meta' }, `${e.autore} · ${e.titolo}`),
      h('h3', {}, c.titolo || `Capitolo ${e.cap + 1}`), ...paragrafi,
      ...(!tutto ? [h('button', { class: 'btn largo', onclick: () => { tutto = true; disegna(); } }, 'Tutto il capitolo')] : []),
      h('button', { class: 'btn largo', onclick: () => f.chiudi() }, 'Torna ai collegamenti'));
    if (tutto) requestAnimationFrame(() => corpo.querySelector('.chiedi-frase')?.scrollIntoView({ block: 'center' }));
  };
  const f = aperto('Nel contesto', corpo, { alto: true });
  disegna();
}

export async function mostraSalvati() {
  const corpo = h('div', { class: 'mappa-esempi' });
  const aperto = (titolo, contenuto, opz) => foglio(titolo, contenuto, opz);
  const disegna = async () => {
    const tutti = (await db.tutti('confronti')).filter(c => c.stato === 'salvato').sort((a, b) => b.data - a.data);
    corpo.replaceChildren(...(tutti.length ? tutti.map(c => {
      const nota = h('textarea', { class: 'campo', rows: 2, placeholder: 'Una nota su questo confronto',
        'aria-label': 'Nota sul confronto', onchange: async e => { c.nota = e.target.value; await db.put('confronti', c); } }, c.nota || '');
      return h('section', { class: 'mappa-passaggio echi-salvato' },
        h('div', { class: 'occhio' }, ETICHETTE[c.relazione] || 'Confronto'), cita(c.origine), cita(c.destinazione),
        h('p', { class: 'echi-spiegazione' }, c.spiegazione), nota,
        h('div', { class: 'riga-bottoni echi-azioni' },
          h('button', { class: 'btn piccolo', onclick: () => contesto(c.origine, aperto) }, 'Primo brano'),
          h('button', { class: 'btn piccolo', onclick: () => contesto(c.destinazione, aperto) }, 'Secondo brano'),
          h('button', { class: 'btn piccolo', onclick: async () => { await db.del('confronti', c.id); await disegna(); } }, 'Rimuovi')));
    }) : [h('p', { class: 'vuoto' }, 'Salva un confronto durante la lettura: qui ritrovi i due brani e le tue note.') ]));
  };
  foglio('Confronti salvati', corpo, { alto: true });
  await disegna();
}

export function creaEchi({ pagina, libro, capitolo, inUso, sospendi, riprendi, cambiato, visibili = () => true }) {
  let revisione = 0, distrutto = false, dati = null;
  let controllo = null;
  let libri = {}, nascosti = new Set();
  const fogli = new Set();
  const aperto = (titolo, contenuto, opz = {}) => {
    const f = foglio(titolo, contenuto, { ...opz, allaChiusura: () => { fogli.delete(f); opz.allaChiusura?.(); } });
    fogli.add(f);
    return f;
  };

  async function righe(i) {
    const out = [];
    for (const r of dati?.legami?.[i] || []) {
      if (nascosti.has(r.id)) continue;
      const altro = libri[r.libro];
      if (!altro) continue;
      const destinazione = await datiLibro(r.libro);
      if (legameValido(r, dati, destinazione, libro, altro, i)) out.push(r);
    }
    return out.slice(0, 3);
  }

  async function aggiorna() {
    const turno = ++revisione, cap = capitolo();
    const [nuovi, elenco, preferenze] = await Promise.all([datiLibro(libro.id), db.tutti('libri'), db.tutti('confronti')]);
    if (distrutto || turno !== revisione || cap !== capitolo() || !inUso()) return;
    dati = nuovi;
    libri = Object.fromEntries(elenco.map(l => [l.id, l]));
    nascosti = new Set(preferenze.filter(p => p.stato === 'nascosto').map(p => p.id));
    pagina.querySelectorAll('.eco-richiamo').forEach(e => e.remove());
    if (dati?.echiVersione !== 1 || !visibili()) return;
    const pronti = [];
    for (let i = 0; i < (dati.passaggi?.length || 0); i++) {
      const [c] = dati.passaggi[i];
      if (c !== cap) continue;
      const lista = await righe(i);
      if (!lista.length) continue;
      // Il richiamo è fuori dagli span.s: non entra nella voce né nelle citazioni.
      const id = lista[0].frasiOrigine[lista[0].frasiOrigine.length - 1];
      const spans = pagina.querySelectorAll(`span.s[data-s="${id}"]`);
      const ultimo = spans[spans.length - 1];
      if (ultimo) pronti.push([ultimo, i, lista.length]);
    }
    if (distrutto || turno !== revisione || cap !== capitolo()) return;
    for (const [ultimo, i, n] of pronti) ultimo.after(h('button', { class: 'eco-richiamo', type: 'button',
      'aria-label': `${n} collegamenti ad altri autori`, onclick: e => { e.stopPropagation(); mostra(i).catch(errore); } },
      icona('mappa', 13), String(n)));
    cambiato?.();
  }

  function errore(e) { console.warn('echi', e); avviso('Non riesco ad aprire il confronto. Riprova.'); }

  async function mostra(i, da = null, a = null) {
    if (distrutto) return;
    const lista = (await righe(i)).filter(r => da === null || r.frasiOrigine.some(n => n >= da && n <= a));
    if (!lista.length) { await nessuno(); return; }
    const corpo = h('div', { class: 'echi-elenco', 'aria-live': 'polite' });
    const suonava = sospendi();
    const f = aperto('Altri autori', corpo, { allaChiusura: () => { if (!distrutto && inUso()) riprendi(suonava); } });
    const schede = [];
    for (const r of lista) {
      const [origine, destinazione] = await Promise.all([
        estratto(libro, r.origine, r.frasiOrigine), estratto(libri[r.libro], r.destinazione, r.frasiDestinazione)]);
      if (!origine || !destinazione || distrutto) continue;
      const gia = await db.get('confronti', r.id);
      const btn = h('button', { class: 'btn piccolo', 'aria-pressed': gia?.stato === 'salvato' ? 'true' : 'false' },
        gia?.stato === 'salvato' ? 'Salvato' : 'Salva confronto');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const attuale = await db.get('confronti', r.id);
          const salvato = attuale?.stato !== 'salvato';
          if (salvato) await db.put('confronti', { id: r.id, stato: 'salvato', data: Date.now(),
            origine, destinazione, relazione: r.relazione, spiegazione: r.spiegazione, nota: attuale?.nota || '' });
          else await db.del('confronti', r.id);
          btn.textContent = salvato ? 'Salvato' : 'Salva confronto';
          btn.setAttribute('aria-pressed', String(salvato));
          avviso(salvato ? 'Confronto salvato' : 'Confronto rimosso dai salvati');
        } catch (e) { errore(e); } finally { btn.disabled = false; }
      });
      const scheda = h('section', { class: 'mappa-passaggio echi-scheda' },
        h('div', { class: 'occhio' }, ETICHETTE[r.relazione]),
        h('p', { class: 'echi-idea' }, r.idea), cita(destinazione),
        h('p', { class: 'echi-spiegazione' }, r.spiegazione),
        h('div', { class: 'riga-bottoni echi-azioni' },
          h('button', { class: 'btn piccolo', onclick: () => contesto(destinazione, aperto).catch(errore) }, 'Leggi nel contesto'), btn),
        h('button', { class: 'echi-nascondi', onclick: async () => {
          try {
            const salvato = await db.get('confronti', r.id);
            if (salvato?.stato === 'salvato') { avviso('Rimuovi prima il confronto dai salvati.'); return; }
            await db.put('confronti', { id: r.id, stato: 'nascosto', data: Date.now() });
            nascosti.add(r.id); scheda.remove(); await aggiorna();
            if (!corpo.querySelector('.echi-scheda')) f.chiudi();
          } catch (e) { errore(e); }
        } }, 'Non pertinente'));
      schede.push(scheda);
    }
    if (distrutto) return;
    corpo.replaceChildren(h('p', { class: 'nota' }, 'Confronti proposti sui testi originali. Apri il contesto per valutarli.'),
      ...schede, ...(!schede.length ? [h('p', { class: 'vuoto' }, 'Gli estratti non sono più disponibili. Aggiorna la mappa.')] : []));
  }

  async function nessuno() {
    const st = await statoMappa();
    const info = st.echi || st.remoto?.echi;
    const incompleto = dati?.echiVersione !== 1 || !info?.completo;
    const corpo = h('div', { class: 'modulo' },
      h('p', { class: 'nota' }, incompleto
        ? 'I collegamenti della libreria sono ancora in preparazione. Quelli già pronti restano disponibili anche senza rete.'
        : 'Per questo passaggio non ci sono confronti sufficientemente sostenuti da mostrare.'),
      incompleto ? h('button', { class: 'btn', onclick: async e => {
        e.target.disabled = true;
        try { await ricostruisci(); avviso('Preparazione dei collegamenti avviata.'); }
        catch (err) { avviso(err.message || 'Non riesco ad avviare la preparazione.'); }
        finally { e.target.disabled = false; }
      } }, 'Prepara i collegamenti') : null);
    aperto('Altri autori', corpo);
  }

  const smetti = seguiMappa(() => aggiorna().catch(console.warn));
  return {
    aggiorna,
    async cerca(frase, ultima = frase) {
      await aggiorna();
      const i = dati?.passaggi?.findIndex(p => p[0] === capitolo() && p[1] <= ultima && p[2] >= frase) ?? -1;
      if (i < 0) return nessuno();
      return mostra(i, frase, ultima);
    },
    chiudi() { distrutto = true; revisione++; clearInterval(controllo); smetti(); for (const f of fogli) f.chiudi(); fogli.clear(); },
    avvia() {
      aggiornaMappa().catch(() => {});
      if (!controllo) controllo = setInterval(() => {
        if (document.visibilityState !== 'hidden') aggiornaMappa().catch(() => {});
      }, 60000);
    },
  };
}
