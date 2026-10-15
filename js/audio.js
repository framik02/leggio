// Audio generato: lavori su GitHub e Kaggle, scaricamento dei capitoli,
// riproduzione con un vero file audio, che continua a schermo spento.
import { db, impostazioni, salvaImpostazioni, dizionario } from './db.js';
import { frasiDalCapitolo, applicaDizionario, perVoce } from './voce.js';

export const REPO_PREDEFINITO = 'framik02/leggio-audio';

// ---------------------------------------------------------------- GitHub
async function conf() {
  const imp = await impostazioni();
  // Seconda copia del codice in localStorage: se l'archivio principale si svuota, si recupera da lì.
  if (!imp.githubToken) {
    try {
      const c = localStorage.getItem('leggio-github');
      if (c) await salvaImpostazioni({ githubToken: c });
    } catch { /* niente */ }
  }
  return { token: imp.githubToken || '', repo: imp.githubRepo || REPO_PREDEFINITO };
}
export async function configurato() { return !!(await conf()).token; }

async function gh(percorso, opz = {}) {
  const { token, repo } = await conf();
  if (!token) throw new Error('Manca il codice di accesso a GitHub. Inseriscilo in Impostazioni › Audio generato.');
  const url = percorso.startsWith('http') ? percorso : `https://api.github.com/repos/${repo}${percorso}`;
  const r = await fetch(url, {
    ...opz,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: opz.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opz.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (opz.consenti404 && r.status === 404) return null;
  if (!r.ok) {
    let msg = `GitHub ha risposto ${r.status}`;
    try { msg += ': ' + (await r.json()).message; } catch { /* niente */ }
    if (r.status === 401) msg = 'Il codice di accesso a GitHub non è valido o è scaduto.';
    if (r.status === 403 || r.status === 404) msg += '. Controlla che il codice abbia accesso a ' + (await conf()).repo + ' con i permessi Contents e Actions.';
    throw new Error(msg);
  }
  if (opz.raw === 'blob') return r.blob();
  if (opz.raw) return r.text();
  return r.status === 204 ? null : r.json();
}

export async function verificaAccesso() {
  const { repo } = await conf();
  const info = await gh('');
  if (!info.permissions?.push) throw new Error(`Il codice legge ${repo} ma non può scriverci.`);
  await gh('/actions/workflows');
  return info.full_name;
}

function base64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

// Un solo commit con tutti i file del lavoro, su un ramo nuovo.
async function creaRamo(ramo, file) {
  const main = await gh('/git/ref/heads/main');
  const base = await gh(`/git/commits/${main.object.sha}`);
  const albero = [];
  for (const f of file) {
    const contenuto = typeof f.dati === 'string' ? base64(new TextEncoder().encode(f.dati)) : base64(await f.dati.arrayBuffer());
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: contenuto, encoding: 'base64' }) });
    albero.push({ path: f.percorso, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree: albero }) });
  const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: `Lavoro ${ramo}`, tree: tree.sha, parents: [main.object.sha] }) });
  await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${ramo}`, sha: commit.sha }) });
}

async function lancia(ramo, azione = 'avvia') {
  await gh('/actions/workflows/lettura.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { lavoro: ramo, azione } }) });
}

// ---------------------------------------------------------------- voci su Kaggle (RVC)
// L'elenco sta nel repository privato: modelli RVC caricati come dataset Kaggle.
let _vociKaggle = null;
export async function vociKaggle(aggiorna = false) {
  if (_vociKaggle && !aggiorna) return _vociKaggle;
  try {
    if (await configurato()) {
      const t = await gh('/contents/voci-kaggle.json', { raw: true, consenti404: true });
      if (t) { _vociKaggle = JSON.parse(t); await salvaImpostazioni({ vociKaggle: _vociKaggle }); return _vociKaggle; }
    }
  } catch (e) { console.warn('voci su Kaggle', e); }
  _vociKaggle = (await impostazioni()).vociKaggle || [];
  return _vociKaggle;
}
export async function preferenzeRvc(id) {
  return ((await impostazioni()).rvcPref || {})[id] || {};
}
export async function salvaPreferenzeRvc(id, pref) {
  const tutte = (await impostazioni()).rvcPref || {};
  tutte[id] = { ...(tutte[id] || {}), ...pref };
  await salvaImpostazioni({ rvcPref: tutte });
}

// ---------------------------------------------------------------- catalogo
let _catalogo = null;
export async function catalogo() {
  if (_catalogo) return _catalogo;
  try { _catalogo = await (await fetch('voci/elenco.json')).json(); } catch { _catalogo = []; }
  return _catalogo;
}

const ACCENTO = { a: 'americano', b: 'britannico', i: 'italiano' };
export function nomeVoce(id, voci = []) {
  if (!id) return 'Voce del telefono';
  if (id.startsWith('rvc:')) return (_vociKaggle || []).find(v => v.id === id)?.nome || 'La mia voce (RVC)';
  if (id.startsWith('clonata:')) return voci.find(v => v.id === id.slice(8))?.nome || 'La tua voce';
  if (id.startsWith('kokoro:')) {
    const v = id.slice(7);
    return v.slice(3, 4).toUpperCase() + v.slice(4);
  }
  return id.split(':')[1] || id;
}
export function descriviVoce(v) {
  if (v.motore === 'kokoro') {
    const sigla = v.nome.slice(0, 2);
    return `${sigla[1] === 'f' ? 'Femminile' : 'Maschile'}, accento ${ACCENTO[sigla[0]] || ''} · veloce da creare`;
  }
  return `${v.genere === 'm' ? (v.grave ? 'Maschile, grave' : 'Maschile') : 'Femminile'} · espressiva, più lenta da creare`;
}

// ---------------------------------------------------------------- lavori

// Stima in minuti del tempo di creazione, dalla lunghezza dell'audio.
export function stima(parole, motore) {
  const audio = parole / 150;
  const calcolo = motore === 'kokoro' ? audio / 40 : audio * 0.5;
  return { audio, attesa: calcolo + 7 };
}

// Prepara il testo come lo leggerebbe il telefono: stesse frasi, stesse pause.
async function preparaCapitolo(libroId, n, imp, regole, lingua) {
  const c = await db.get('capitoli', [libroId, n]);
  const div = document.createElement('div');
  div.innerHTML = c.html;
  const frasi = frasiDalCapitolo(div);
  const fuori = [];
  for (const f of frasi) {
    const t = perVoce(applicaDizionario(f.voce || '', regole, lingua, libroId));
    if (!/[\p{L}\p{N}]/u.test(t)) continue;
    let pausa = 60;
    if (f.titolo) pausa = 900;
    else if (f.scena) pausa = imp.pausaScena;
    else if (f.fineBlocco) pausa = imp.pausaParagrafo;
    fuori.push([f.id, t, f.titolo ? 't' : (f.dialogo ? 'd' : ''), pausa]);
  }
  return { n, titolo: c.titolo, frasi: fuori };
}

export async function creaLavoro(libro, voceId, capitoli, avanzamento) {
  const imp = await impostazioni();
  const regole = await dizionario();
  let motore = voceId.startsWith('kokoro:') ? 'kokoro' : voceId.startsWith('xtts:') ? 'xtts' : voceId.startsWith('rvc:') ? 'rvc' : 'clonata';
  const voceClonata = motore === 'clonata' ? await db.get('voci', voceId.slice(8)) : null;
  if (voceClonata?.allenata?.kernel) motore = 'allenata';
  const caps = [];
  for (const [i, n] of capitoli.entries()) {
    caps.push(await preparaCapitolo(libro.id, n, imp, regole, libro.lingua));
    avanzamento && avanzamento(0.5 * (i + 1) / capitoli.length);
  }
  const id = `${libro.id}-${Date.now().toString(36)}`;
  const ramo = `lavoro/${id}`;
  const lavoro = { id, motore, voce: voceId, lingua: libro.lingua, opz: { dialoghiVivaci: imp.dialoghiVivaci }, titolo: libro.titolo, capitoli: caps };
  if (motore === 'allenata') lavoro.modello = voceClonata.allenata.kernel;
  if (motore === 'rvc') {
    const conf = (await vociKaggle()).find(v => v.id === voceId);
    if (!conf) throw new Error('La voce RVC non è più nell’elenco su GitHub.');
    const pref = await preferenzeRvc(voceId);
    lavoro.rvc = { dataset: conf.dataset, pth: conf.pth, index: conf.index, versione: conf.versione || 'v2', indice: conf.indice ?? 0.75,
      base: pref.base?.[libro.lingua] || conf.base?.[libro.lingua] || conf.base?.it, tono: pref.tono ?? conf.tono ?? 0 };
  }
  const file = [{ percorso: 'lavoro/job.json', dati: JSON.stringify(lavoro) }];
  if (motore === 'clonata') {
    const voce = voceClonata;
    if (!voce) throw new Error('La voce registrata non c\'è più.');
    voce.campioni.forEach((c, i) => file.push({ percorso: `lavoro/campioni/c${String(i).padStart(2, '0')}.${estensione(c.blob.type, c.nomeFile)}`, dati: c.blob }));
  }
  avanzamento && avanzamento(0.7);
  // Il lavoro si registra sul telefono prima di partire: se qualcosa va storto
  // dopo, l'app sa comunque che esiste e ne mostra lo stato.
  const rec = { id, ramo, libro: libro.id, voce: voceId, motore, capitoli, scaricati: [], creato: Date.now(), stato: { fase: 'in partenza' }, controllato: Date.now() };
  await db.put('lavori', rec);
  try {
    await creaRamo(ramo, file);
    avanzamento && avanzamento(0.9);
    await lancia(ramo);
  } catch (e) {
    await db.del('lavori', id);
    throw e;
  }
  try { libro.voceAudio = voceId; await db.put('libri', libro); } catch (e) { console.warn('voce del libro non salvata', e); }
  return rec;
}

function estensione(tipo, nome) {
  const daNome = (nome || '').match(/\.([a-z0-9]{2,5})$/i);
  if (daNome) return daNome[1].toLowerCase();
  if (/mpeg|mp3/.test(tipo)) return 'mp3';
  if (/flac/.test(tipo)) return 'flac';
  if (/mp4|m4a|aac/.test(tipo)) return 'm4a';
  if (/webm/.test(tipo)) return 'webm';
  if (/ogg/.test(tipo)) return 'ogg';
  if (/wav/.test(tipo)) return 'wav';
  return 'audio';
}

// Controlla un lavoro e scarica i capitoli pronti. Restituisce il lavoro aggiornato.
export async function aggiornaLavoro(rec) {
  const stato = await gh(`/contents/stato.json?ref=${encodeURIComponent(rec.ramo)}`, { raw: true, consenti404: true });
  if (stato) { try { rec.stato = JSON.parse(stato); } catch { /* niente */ } }
  const elenco = await gh(`/contents/audio?ref=${encodeURIComponent(rec.ramo)}`, { consenti404: true }) || [];
  const pronti = elenco.filter(f => /^c\d+\.json$/.test(f.name)).map(f => +f.name.slice(1, -5));
  for (const n of pronti) {
    if (rec.scaricati.includes(n)) continue;
    const nome = `c${String(n).padStart(3, '0')}`;
    const tempi = JSON.parse(await gh(`/contents/audio/${nome}.json?ref=${encodeURIComponent(rec.ramo)}`, { raw: true }));
    const blob = await gh(`/contents/audio/${nome}.mp3?ref=${encodeURIComponent(rec.ramo)}`, { raw: 'blob' });
    await db.put('audio', { libro: rec.libro, n, blob: new Blob([await blob.arrayBuffer()], { type: 'audio/mpeg' }), tempi: tempi.frasi, durata: tempi.durata, voce: rec.voce, data: Date.now() });
    rec.scaricati.push(n);
    await db.put('lavori', rec);
  }
  // Trascrizione degli audio della voce clonata: si conserva con la voce.
  if ((rec.motore === 'clonata' || rec.motore === 'allena') && !rec.trascritta) {
    const t = await gh(`/contents/voce/trascrizione.json?ref=${encodeURIComponent(rec.ramo)}`, { raw: true, consenti404: true });
    if (t) {
      const voce = await db.get('voci', rec.voce.slice(8));
      if (voce) { voce.trascrizione = JSON.parse(t); await db.put('voci', voce); }
      rec.trascritta = true;
    }
  }
  if (rec.motore === 'allena' && rec.stato?.fase === 'finito' && rec.stato?.allenata) {
    const voce = await db.get('voci', rec.voce.slice(8));
    if (voce) { voce.allenata = { kernel: rec.stato.kernel, data: Date.now(), frasi: rec.stato.frasi, minuti: rec.stato.minuti }; await db.put('voci', voce); }
  }
  const fase = rec.stato?.fase;
  const tutti = rec.capitoli.every(n => rec.scaricati.includes(n));
  if (tutti && fase === 'finito') {
    rec.chiuso = Date.now();
    await gh(`/git/refs/heads/${rec.ramo}`, { method: 'DELETE', consenti404: true }).catch(() => {});
  }
  // Nessuna notizia da tempo: si chiede a Kaggle che fine ha fatto il notebook.
  const fermo = Date.now() - (rec.stato?.aggiornato ? rec.stato.aggiornato * 1000 : rec.creato);
  if (!rec.chiuso && fase !== 'errore' && fermo > 25 * 60000 && Date.now() - (rec.controllato || 0) > 20 * 60000) {
    rec.controllato = Date.now();
    await lancia(rec.ramo, 'controlla').catch(() => {});
  }
  await db.put('lavori', rec);
  return rec;
}

// Fasi del lavoro dette in chiaro.
export function descriviStato(rec) {
  const st = rec.stato || {};
  const tot = rec.capitoli.length;
  const pronti = rec.scaricati.length;
  const quando = st.aggiornato ? Math.round((Date.now() - st.aggiornato * 1000) / 60000) : null;
  const ultimo = quando === null ? '' : quando < 1 ? 'Ultimo segnale adesso.' : `Ultimo segnale ${quando} min fa.`;
  const gpu = /batch GPU session count/i.test(st.errore || '');
  switch (st.fase) {
    case 'errore': return { errore: true, testo: gpu ? 'Kaggle accetta al massimo due lavori con GPU insieme.' : 'Il lavoro si è fermato.', dettaglio: gpu ? "Aspetta che finisca l'altro, poi premi Riprendi." : (st.errore || '') };
    case 'da riprendere': return { testo: 'Kaggle si è fermato prima della fine.', dettaglio: `${pronti} di ${tot} capitoli pronti. Premi Riprendi per continuare da lì.` };
    case 'finito': return rec.motore === 'allena'
      ? { testo: 'Voce allenata.', dettaglio: `${st.frasi || ''} frasi, ${st.minuti || ''} minuti di voce. Da ora l’audio con questa voce usa il modello allenato.` }
      : { testo: pronti >= tot ? 'Audio pronto.' : 'Finito su Kaggle, sto scaricando.', dettaglio: `${pronti} di ${tot} capitoli sul telefono.` };
    case 'in corso': return rec.motore === 'allena'
      ? { testo: 'Allenamento in corso.', dettaglio: `${st.dettaglio ? st.dettaglio[0].toUpperCase() + st.dettaglio.slice(1) + '. ' : ''}Di solito 20-60 minuti. Continua anche se chiudi l'app. ${ultimo}` }
      : { testo: `Lettura in corso: ${pronti} di ${tot} capitoli pronti.`, dettaglio: `Continua anche se chiudi l'app. ${ultimo}` };
    case 'preparo la voce': return { testo: 'Kaggle è partito e sta preparando la voce.', dettaglio: `Di solito 5-10 minuti, poi arriva il primo capitolo. ${ultimo}` };
    case 'in coda su Kaggle': return { testo: 'In coda su Kaggle, aspetta una macchina libera.', dettaglio: `Può volerci qualche minuto, a volte di più per la GPU. Continua anche se chiudi l'app. ${ultimo}` };
    case 'carico su Kaggle': return { testo: 'Sto preparando il lavoro su Kaggle.', dettaglio: ultimo };
    default: return { testo: 'Inviato. Kaggle lo prende in carico fra un minuto.', dettaglio: "Puoi chiudere l'app: il lavoro continua." };
  }
}

// Lavori partiti senza che il telefono li abbia registrati: si ritrovano dai rami.
export async function recuperaLavori(libroId) {
  if (!(await configurato())) return 0;
  const rami = await gh('/branches?per_page=100');
  const noti = new Set((await db.tutti('lavori')).map(l => l.ramo));
  const libri = new Set((await db.tutti('libri')).map(l => l.id));
  let n = 0;
  for (const r of rami) {
    const m = r.name.match(/^lavoro\/([a-z0-9]+)-([a-z0-9]+)$/);
    if (!m || noti.has(r.name) || !libri.has(m[1]) || (libroId && m[1] !== libroId)) continue;
    try {
      const job = JSON.parse(await gh(`/contents/lavoro/job.json?ref=${encodeURIComponent(r.name)}`, { raw: true }));
      await db.put('lavori', { id: `${m[1]}-${m[2]}`, ramo: r.name, libro: m[1], voce: job.voce || 'clonata', motore: job.motore, capitoli: job.capitoli.map(c => c.n), scaricati: [], creato: parseInt(m[2], 36) || Date.now(), stato: {}, controllato: 0 });
      n++;
    } catch (e) { console.warn('ramo non recuperato', r.name, e); }
  }
  return n;
}

// Allenamento della voce: stessi audio della clonazione, nessun libro.
export async function allenaVoce(voce) {
  if ((await lavoriAttivi()).some(l => l.motore === 'allena' || l.motore === 'clonata' || l.motore === 'allenata' || l.motore === 'xtts'))
    throw new Error('C’è già un lavoro sulla GPU di Kaggle: aspetta che finisca.');
  const id = `${voce.id}-a${Date.now().toString(36)}`;
  const ramo = `lavoro/${id}`;
  const file = [{ percorso: 'lavoro/job.json', dati: JSON.stringify({ id, motore: 'allena', voce: `clonata:${voce.id}`, lingua: voce.lingua || 'it', capitoli: [] }) }];
  voce.campioni.forEach((c, i) => file.push({ percorso: `lavoro/campioni/c${String(i).padStart(2, '0')}.${estensione(c.blob.type, c.nomeFile)}`, dati: c.blob }));
  const rec = { id, ramo, libro: null, voce: `clonata:${voce.id}`, motore: 'allena', capitoli: [], scaricati: [], creato: Date.now(), stato: { fase: 'in partenza' }, controllato: Date.now() };
  await db.put('lavori', rec);
  try { await creaRamo(ramo, file); await lancia(ramo); } catch (e) { await db.del('lavori', id); throw e; }
  return rec;
}

export async function allenamentoDi(voceId) {
  return (await db.tutti('lavori')).find(l => l.motore === 'allena' && l.voce === `clonata:${voceId}` && !l.chiuso);
}

export async function riprendi(rec) {
  rec.stato = { ...rec.stato, fase: 'in partenza', errore: null };
  rec.controllato = Date.now();
  await lancia(rec.ramo, 'avvia');
  await db.put('lavori', rec);
}

export async function annulla(rec) {
  await gh(`/git/refs/heads/${rec.ramo}`, { method: 'DELETE', consenti404: true }).catch(() => {});
  await db.del('lavori', rec.id);
}

export async function lavoriAttivi(libro) {
  const tutti = await db.tutti('lavori');
  return tutti.filter(l => !l.chiuso && (!libro || l.libro === libro));
}

let _giro = null;
export function avviaControlli(quandoCambia) {
  let recuperato = 0;
  const giro = async () => {
    if (document.visibilityState !== 'visible' || !(await configurato())) return;
    if (Date.now() - recuperato > 10 * 60000) { recuperato = Date.now(); try { if (await recuperaLavori()) quandoCambia && quandoCambia(null); } catch (e) { console.warn(e); } }
    for (const l of await lavoriAttivi()) {
      const prima = l.scaricati.length + (l.stato?.fase || '');
      try { await aggiornaLavoro(l); } catch (e) { console.warn('controllo lavoro', e); }
      if (prima !== l.scaricati.length + (l.stato?.fase || '')) quandoCambia && quandoCambia(l);
      document.dispatchEvent(new CustomEvent('leggio-lavoro', { detail: l }));
    }
  };
  clearInterval(_giro);
  _giro = setInterval(giro, 45000);
  document.addEventListener('visibilitychange', giro);
  setTimeout(giro, 1500);
}

// ---------------------------------------------------------------- riproduzione

// Un solo elemento audio per tutta l'app: così iOS lascia passare da un
// capitolo al successivo anche a schermo spento.
let _el = null;
export function elementoAudio() {
  if (!_el) {
    _el = new Audio();
    _el.preload = 'auto';
    _el.setAttribute('playsinline', '');
    document.body.appendChild(_el);
    _el.style.display = 'none';
  }
  return _el;
}

export class LettoreAudio {
  constructor() {
    this.audio = elementoAudio();
    this.frasi = [];
    this.indice = 0;
    this.attivo = false;
    this.velocita = 1;
    this.tempi = [];
    this.url = null;
    this.onFrase = () => {};
    this.onStato = () => {};
    this.onFine = () => {};
    this._raf = null;
    this._fine = () => { this.attivo = false; this._ferma(); this.onStato(false); this.onFine(); };
    this._tempo = () => this._segui();
  }

  carica(registro) {
    const chiave = `${registro.libro}:${registro.n}:${registro.data || ''}`;
    if (this.chiave === chiave && this.url) { this.tempi = registro.tempi; return; }
    this.chiave = chiave;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(registro.blob);
    this.audio.src = this.url;
    this.tempi = registro.tempi; // [id, inizio, fine]
    this.audio.playbackRate = this.velocita;
    this.audio.onended = this._fine;
    this.audio.ontimeupdate = this._tempo;
  }

  imposta(frasi) { this.frasi = frasi; }

  _indiceFrase(id) { return this.frasi.findIndex(f => f.id === id); }

  _inizio(i) {
    const f = this.frasi[i];
    const t = f && this.tempi.find(x => x[0] === f.id);
    if (t) return t[1];
    // Frase senza audio (solo punteggiatura): la successiva che ce l'ha.
    for (let k = i + 1; k < this.frasi.length; k++) { const tt = this.tempi.find(x => x[0] === this.frasi[k].id); if (tt) return tt[1]; }
    return this.audio.duration || 0;
  }

  _segui() {
    const t = this.audio.currentTime;
    let lo = 0, hi = this.tempi.length - 1, trovato = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.tempi[m][1] <= t + 0.05) { trovato = m; lo = m + 1; } else hi = m - 1; }
    if (trovato < 0) return;
    const i = this._indiceFrase(this.tempi[trovato][0]);
    if (i >= 0 && i !== this.indice) { this.indice = i; this.onFrase(this.frasi[i]); }
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && this.audio.duration) {
      try { navigator.mediaSession.setPositionState({ duration: this.audio.duration, position: t, playbackRate: this.audio.playbackRate }); } catch { /* niente */ }
    }
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    const passo = () => { this._segui(); if (this.attivo) this._raf = requestAnimationFrame(passo); };
    this._raf = requestAnimationFrame(passo);
  }
  _ferma() { cancelAnimationFrame(this._raf); }

  async play(da) {
    if (typeof da === 'number') { this.indice = da; this.audio.currentTime = this._inizio(da); }
    this.audio.playbackRate = this.velocita;
    this.attivo = true;
    try { await this.audio.play(); } catch (e) { this.attivo = false; this.onStato(false); throw e; }
    this.onStato(true);
    this.onFrase(this.frasi[this.indice]);
    this._loop();
  }

  pausa() {
    this.attivo = false;
    this._ferma();
    this.audio.pause();
    this.onStato(false);
  }

  vai(i) {
    this.indice = Math.max(0, Math.min(i, this.frasi.length - 1));
    this.audio.currentTime = this._inizio(this.indice);
    this.onFrase(this.frasi[this.indice]);
  }
  avanti() { this.vai(this.indice + 1); }
  indietro() {
    // Come i lettori audio: se la frase è appena iniziata si torna alla precedente.
    const inizio = this._inizio(this.indice);
    this.vai(this.audio.currentTime - inizio > 1.5 ? this.indice : this.indice - 1);
  }
  salta(sec) { this.audio.currentTime = Math.max(0, Math.min(this.audio.duration || 0, this.audio.currentTime + sec)); this._segui(); }

  set velocitaAudio(v) { this.velocita = v; this.audio.playbackRate = v; }

  scarica() {
    this.chiave = null;
    this.pausa();
    this.audio.onended = null; this.audio.ontimeupdate = null;
  }
}

export async function salvaConfigurazione(token, repo) {
  await salvaImpostazioni({ githubToken: token.trim(), githubRepo: (repo || REPO_PREDEFINITO).trim() });
  try { localStorage.setItem('leggio-github', token.trim()); } catch { /* niente */ }
}
