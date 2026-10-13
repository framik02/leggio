// Lettura ad alta voce con le voci installate sul dispositivo.
// Va frase per frase: così si evidenzia il testo, si salta avanti e indietro,
// e a ogni frase si regolano tono e pause.

let _voci = [];
function caricaVoci() {
  _voci = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  return _voci;
}
if ('speechSynthesis' in window) {
  caricaVoci();
  speechSynthesis.addEventListener?.('voiceschanged', caricaVoci);
}

export function disponibile() { return 'speechSynthesis' in window; }

// Le voci migliori prima: premium e avanzate, poi le altre. Niente voci giocattolo.
const GIOCATTOLO = /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|ralph|kathy|rocko|grandma|grandpa|eddy|flo|reed|sandy|shelley/i;
export async function voci(lingua) {
  if (!_voci.length) {
    caricaVoci();
    if (!_voci.length) await new Promise(ok => setTimeout(ok, 400));
    caricaVoci();
  }
  const qualita = v => /premium/i.test(v.name) ? 0 : /enhanced|avanzat|neural|natural/i.test(v.name) ? 1 : 2;
  return _voci
    .filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(lingua))
    .filter(v => !GIOCATTOLO.test(v.name))
    .sort((a, b) => qualita(a) - qualita(b) || a.name.localeCompare(b.name));
}
export function etichettaQualita(v) {
  return /premium/i.test(v.name) ? 'premium' : /enhanced|avanzat|neural|natural/i.test(v.name) ? 'avanzata' : '';
}

export async function trovaVoce(lingua, nome) {
  const elenco = await voci(lingua);
  return elenco.find(v => v.voiceURI === nome || v.name === nome) || elenco[0] || null;
}

export function prova(voce, testo, velocita = 1) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(testo);
  if (voce) { u.voice = voce; u.lang = voce.lang; }
  u.rate = velocita;
  speechSynthesis.speak(u);
}

// Applica le regole di pronuncia imparate.
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function applicaDizionario(testo, regole, lingua, libro) {
  for (const r of regole) {
    if (r.lingua && r.lingua !== '*' && r.lingua !== lingua) continue;
    if (r.libro && r.libro !== libro) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escRe(r.da)}(?![\\p{L}\\p{N}])`, 'giu');
    testo = testo.replace(re, r.a);
  }
  return testo;
}

// Pulizia del testo prima della sintesi.
export function perVoce(t) {
  return t
    .replace(/\[\d+\]|\(\d+\)/g, '')            // rimandi alle note
    .replace(/[«»“”"]/g, '')
    .replace(/\s[–—]\s/g, ', ')
    .replace(/^[–—-]\s*/, '')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

const APERTURE = /^[\s]*[«“"—–‘]/;

// Raccoglie dal DOM del capitolo le frasi con il loro contesto.
export function frasiDalCapitolo(radice) {
  const mappa = new Map();
  for (const sp of radice.querySelectorAll('span.s')) {
    const id = +sp.dataset.s;
    let f = mappa.get(id);
    if (!f) {
      const blocco = sp.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,figcaption,td,th,pre,div');
      f = { id, testo: '', blocco, span: [] };
      mappa.set(id, f);
    }
    f.testo += sp.textContent;
    f.span.push(sp);
  }
  const elenco = [...mappa.values()].sort((a, b) => a.id - b.id);
  // Tipo di frase e pausa dopo.
  let dialogoAperto = false;
  elenco.forEach((f, i) => {
    const succ = elenco[i + 1];
    const tag = f.blocco ? f.blocco.nodeName : 'P';
    f.titolo = /^H[1-6]$/.test(tag);
    const primaDelBlocco = !elenco[i - 1] || elenco[i - 1].blocco !== f.blocco;
    if (primaDelBlocco) dialogoAperto = false;
    const apre = APERTURE.test(f.testo) || (primaDelBlocco && /^[\s]*[—–-]\s/.test(f.blocco?.textContent || ''));
    const chiude = /[»”"]\s*$/.test(f.testo);
    f.dialogo = apre || dialogoAperto;
    dialogoAperto = (apre || dialogoAperto) && !chiude;
    f.fineBlocco = !succ || succ.blocco !== f.blocco;
    // Scena: un separatore fra questo blocco e il successivo.
    f.scena = false;
    if (f.fineBlocco && succ && f.blocco && succ.blocco) {
      let n = f.blocco.nextElementSibling;
      while (n && n !== succ.blocco && !n.contains(succ.blocco)) {
        if (n.nodeName === 'HR' || n.hasAttribute?.('data-scena')) { f.scena = true; break; }
        n = n.nextElementSibling;
      }
    }
    f.parole = (f.testo.match(/[\p{L}\p{N}]+/gu) || []).length;
  });
  return elenco;
}

export class Lettore {
  constructor() {
    this.frasi = [];
    this.indice = 0;
    this.attivo = false;
    this.voce = null;
    this.velocita = 1;
    this.opz = { pausaParagrafo: 350, pausaScena: 1100, dialoghiVivaci: true };
    this.regole = [];
    this.lingua = 'it';
    this.libro = null;
    this._gen = 0;
    this._timer = null;
    this._guardia = null;
    this.onFrase = () => {};
    this.onStato = () => {};
    this.onFine = () => {};
  }

  imposta(frasi) { this.frasi = frasi; this.indice = Math.min(this.indice, Math.max(0, frasi.length - 1)); }

  vai(i) {
    this.indice = Math.max(0, Math.min(i, this.frasi.length - 1));
    if (this.attivo) this._parla(); else this.onFrase(this.frasi[this.indice]);
  }

  play(da) {
    if (typeof da === 'number') this.indice = da;
    this.attivo = true;
    this.onStato(true);
    this._parla();
  }

  pausa() {
    this.attivo = false;
    this._gen++;
    clearTimeout(this._timer); clearTimeout(this._guardia);
    speechSynthesis.cancel();
    this.onStato(false);
  }

  avanti() { this.vai(this.indice + 1); }
  indietro() { this.vai(this.indice - 1); }

  _parla() {
    const gen = ++this._gen;
    clearTimeout(this._timer); clearTimeout(this._guardia);
    speechSynthesis.cancel();
    const f = this.frasi[this.indice];
    if (!f) { this.attivo = false; this.onStato(false); this.onFine(); return; }
    this.onFrase(f);
    const testo = perVoce(applicaDizionario(f.testo, this.regole, this.lingua, this.libro));
    if (!/[\p{L}\p{N}]/u.test(testo)) { this._prossima(gen, 0); return; }
    const u = new SpeechSynthesisUtterance(testo);
    if (this.voce) { u.voice = this.voce; u.lang = this.voce.lang; } else u.lang = this.lingua === 'en' ? 'en-GB' : 'it-IT';
    // Il tono: titoli più lenti, dialoghi un filo più vivi, incisi più raccolti.
    let rate = this.velocita, pitch = 1;
    if (f.titolo) rate *= 0.9;
    else if (f.dialogo && this.opz.dialoghiVivaci) { rate *= 1.04; pitch = 1.06; }
    if (/^\s*\(.*\)\s*$/.test(f.testo)) { pitch = 0.95; }
    u.rate = Math.max(0.5, Math.min(2, rate));
    u.pitch = pitch;
    let finito = false;
    const fine = () => {
      if (finito || gen !== this._gen) return;
      finito = true;
      clearTimeout(this._guardia);
      let pausa = 60;
      if (f.titolo) pausa = 900;
      else if (f.scena) pausa = this.opz.pausaScena;
      else if (f.fineBlocco) pausa = this.opz.pausaParagrafo;
      this._prossima(gen, pausa / this.velocita);
    };
    u.onend = fine;
    u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled') fine(); };
    // Su iOS a volte onend non arriva: una guardia calcolata sulla lunghezza.
    const attesa = (testo.length / (14 * u.rate)) * 1000 * 2.2 + 4000;
    this._guardia = setTimeout(fine, attesa);
    speechSynthesis.speak(u);
  }

  _prossima(gen, pausa) {
    this._timer = setTimeout(() => {
      if (gen !== this._gen || !this.attivo) return;
      if (this.indice >= this.frasi.length - 1) {
        this.attivo = false;
        this.onStato(false);
        this.onFine();
        return;
      }
      this.indice++;
      this._parla();
    }, pausa);
  }
}
