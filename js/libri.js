// Import dei file e conversione verso altri formati.
import { db, nuovoId, chiediPersistenza } from './db.js';
import { escape } from './import/comune.js';

export const FORMATI = '.epub,.pdf,.txt,.md,.markdown,.html,.htm,.xhtml,.fb2,application/epub+zip,application/pdf,text/plain';

export async function importa(file, avanzamento) {
  const nome = file.name.toLowerCase();
  const est = nome.split('.').pop();
  let ris;
  if (est === 'epub') ris = await (await import('./import/epub.js')).importaEpub(file, avanzamento);
  else if (est === 'pdf') ris = await (await import('./import/pdf.js')).importaPdf(file, avanzamento);
  else if (['txt', 'md', 'markdown'].includes(est)) ris = await (await import('./import/testo.js')).importaTxt(file);
  else if (['html', 'htm', 'xhtml'].includes(est)) ris = await (await import('./import/testo.js')).importaHtml(file);
  else if (est === 'fb2') ris = await (await import('./import/testo.js')).importaFb2(file);
  else if (['mobi', 'azw', 'azw3', 'kfx'].includes(est)) throw new Error('I file Kindle (MOBI, AZW) arriveranno in una prossima versione. Per ora convertili in EPUB.');
  else throw new Error(`Formato .${est} non supportato.`);

  // Titolo e autore mancanti: si ricavano dal nome del file.
  const daNome = leggiNomeFile(file.name);
  const stelo = file.name.replace(/\.[^.]+$/, '');
  if (!ris.titolo || ris.titolo === stelo || ris.titolo.length < 2) ris.titolo = daNome.titolo;
  if (!ris.autore && daNome.autore) ris.autore = daNome.autore;

  const id = nuovoId();
  const libro = {
    id,
    titolo: ris.titolo.trim(),
    autore: (ris.autore || '').trim(),
    lingua: ris.lingua,
    copertina: ris.copertina || null,
    formato: est,
    capitoli: ris.capitoli.map(c => ({ titolo: c.titolo, frasi: c.frasi, parole: c.parole })),
    frasiTotali: ris.capitoli.reduce((s, c) => s + c.frasi, 0),
    paroleTotali: ris.capitoli.reduce((s, c) => s + c.parole, 0),
    posizione: { cap: 0, frase: 0 },
    progresso: 0,
    stato: 'da-leggere',
    aggiunto: Date.now(),
    aperto: 0,
    voce: '',
    velocita: null,
  };
  // Su iOS un File scelto dall'utente punta a una copia temporanea: si salva il contenuto.
  const copia = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' });
  await db.salvaLibro(libro, ris.capitoli, ris.risorse, { blob: copia, nome: file.name, tipo: file.type });
  const verifica = await db.get('libri', id);
  if (!verifica) throw new Error("Il telefono non ha salvato il libro. Riprova dall'app aggiunta alla schermata Home.");
  chiediPersistenza();
  return libro;
}

// ---------------------------------------------------------------- conversione

function testoPulito(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  const out = [];
  for (const b of d.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dd,dt,figcaption')) {
    if (b.querySelector('p,h1,h2,h3,li,blockquote')) continue;
    const t = b.textContent.replace(/\s+/g, ' ').trim();
    if (t) out.push(/^H/.test(b.nodeName) ? `\n${t.toUpperCase()}\n` : t);
  }
  return out.join('\n\n');
}

// Toglie gli span delle frasi e rimette le immagini come file.
function htmlEsportabile(html, mappaImg) {
  const d = document.createElement('div');
  d.innerHTML = html;
  for (const sp of d.querySelectorAll('span.s')) sp.replaceWith(...sp.childNodes);
  for (const img of d.querySelectorAll('img[data-risorsa]')) {
    const p = img.getAttribute('data-risorsa');
    img.removeAttribute('data-risorsa');
    if (mappaImg[p]) img.setAttribute('src', mappaImg[p]); else img.remove();
  }
  d.normalize();
  return new XMLSerializer().serializeToString(d).replace(/^<div[^>]*>|<\/div>$/g, '');
}

export async function esportaTxt(libro) {
  const caps = await db.capitoli(libro.id);
  const testa = `${libro.titolo}${libro.autore ? '\n' + libro.autore : ''}\n\n`;
  const t = testa + caps.map(c => testoPulito(c.html)).join('\n\n\n');
  return new File([t], `${nomeFile(libro)}.txt`, { type: 'text/plain' });
}

export async function esportaEpub(libro) {
  const zip = new window.JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const caps = await db.capitoli(libro.id);
  const risorse = await db.tutti('risorse').then(r => r.filter(x => x.libro === libro.id));
  const mappaImg = {}; const manImg = [];
  risorse.forEach((r, i) => {
    const est = (r.percorso.split('.').pop() || 'img').toLowerCase();
    const nome = `img/i${i}.${est}`;
    mappaImg[r.percorso] = nome;
    zip.file(`OEBPS/${nome}`, r.blob);
    manImg.push(`<item id="i${i}" href="${nome}" media-type="${r.blob.type || 'image/jpeg'}"/>`);
  });
  let cop = '';
  if (libro.copertina) {
    zip.file('OEBPS/img/copertina.jpg', libro.copertina);
    cop = `<item id="copertina" href="img/copertina.jpg" media-type="${libro.copertina.type || 'image/jpeg'}" properties="cover-image"/>`;
  }
  const pagina = (titolo, corpo) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${libro.lingua}"><head><meta charset="utf-8"/><title>${escape(titolo)}</title><link rel="stylesheet" href="stile.css"/></head><body>${corpo}</body></html>`;
  caps.forEach((c, i) => zip.file(`OEBPS/c${i}.xhtml`, pagina(c.titolo, htmlEsportabile(c.html, mappaImg))));
  zip.file('OEBPS/stile.css', 'body{font-family:serif;line-height:1.5}p{margin:0;text-indent:1.2em}h1,h2,h3{text-align:center}img{max-width:100%}');
  zip.file('OEBPS/nav.xhtml', pagina('Indice', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Indice</h1><ol>${caps.map((c, i) => `<li><a href="c${i}.xhtml">${escape(c.titolo)}</a></li>`).join('')}</ol></nav>`));
  const uid = `urn:uuid:${libro.id}`;
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${escape(libro.titolo)}</dc:title>${libro.autore ? `<dc:creator>${escape(libro.autore)}</dc:creator>` : ''}<dc:language>${libro.lingua}</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>${libro.copertina ? '<meta name="cover" content="copertina"/>' : ''}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="stile.css" media-type="text/css"/>${cop}${manImg.join('')}${caps.map((c, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${caps.map((c, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
  return new File([blob], `${nomeFile(libro)}.epub`, { type: 'application/epub+zip' });
}

// PDF: impagina il libro in una finestra di stampa, da cui iOS salva il PDF.
export async function stampaPdf(libro) {
  const caps = await db.capitoli(libro.id);
  const risorse = (await db.tutti('risorse')).filter(x => x.libro === libro.id);
  const mappa = {};
  for (const r of risorse) mappa[r.percorso] = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(r.blob); });
  const corpo = caps.map(c => `<section>${htmlEsportabile(c.html, mappa)}</section>`).join('');
  const html = `<!doctype html><html lang="${libro.lingua}"><head><meta charset="utf-8"><title>${escape(libro.titolo)}</title><style>
@page{size:A5;margin:18mm 16mm}body{font-family:Georgia,'Times New Roman',serif;font-size:10.5pt;line-height:1.5;color:#111;background:#fff}
section{break-before:page}p{margin:0;text-indent:1.2em;text-align:justify;hyphens:auto}h1,h2,h3{text-align:center;margin:2em 0 1.2em;font-weight:normal}
img{max-width:100%}.fr{text-align:center;padding-top:30vh}.fr h1{font-size:22pt}</style></head><body>
<div class="fr"><h1>${escape(libro.titolo)}</h1><p style="text-indent:0">${escape(libro.autore || '')}</p></div>${corpo}</body></html>`;
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(ifr);
  ifr.contentDocument.open(); ifr.contentDocument.write(html); ifr.contentDocument.close();
  await new Promise(ok => setTimeout(ok, 400));
  ifr.contentWindow.focus();
  ifr.contentWindow.print();
  setTimeout(() => ifr.remove(), 60000);
}

export async function originale(libro) {
  const o = await db.get('originali', libro.id);
  return o ? new File([o.blob], o.nome, { type: o.tipo || o.blob.type }) : null;
}

function nomeFile(libro) {
  return `${libro.autore ? libro.autore + ' - ' : ''}${libro.titolo}`.replace(/[\\/:*?"<>|]+/g, '').slice(0, 120);
}

// Su iPhone il foglio di condivisione permette "Salva su File".
export async function consegna(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Copia di sicurezza di evidenziati, impostazioni, progressi e dizionario.
export async function backupDati() {
  const libri = (await db.tutti('libri')).map(({ copertina, ...l }) => l);
  const dati = {
    app: 'leggio', versione: 1, data: new Date().toISOString(),
    libri: libri.map(l => ({ titolo: l.titolo, autore: l.autore, posizione: l.posizione, progresso: l.progresso, stato: l.stato, voce: l.voce, velocita: l.velocita, id: l.id })),
    evidenziati: await db.tutti('evidenziati'),
    impostazioni: await db.get('impostazioni', 'generali'),
    dizionario: await db.get('impostazioni', 'dizionario'),
  };
  return new File([JSON.stringify(dati, null, 1)], `leggio-backup-${dati.data.slice(0, 10)}.json`, { type: 'application/json' });
}

// «(Collana) Autore - Titolo-Editore (anno).epub» e «Autore - Titolo (anno, Editore) - libgen.li.pdf».
export function leggiNomeFile(nome) {
  let t = nome.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  t = t.replace(/\s*-\s*libgen\.\w+$/i, '').replace(/\s*--.*$/, '');
  t = t.replace(/^\s*[([][^)\]]*[)\]]\s*/, '');
  t = t.replace(/\s*\((\d{4}|[^()]*\d{4}[^()]*)\)\s*$/, '');
  t = t.replace(/(\S)-(?=[A-Z][^-\s]*(\s[^-]*)?$)[^-]*$/, '$1');
  const pulito = x => x.replace(/\s{2,}/g, ' ').replace(/[\s,;-]+$/, '').trim();
  const parti = t.split(/\s+-\s+/);
  if (parti.length >= 2) return { autore: pulito(parti[0]), titolo: pulito(parti.slice(1).join(' - ')) };
  return { autore: '', titolo: pulito(t) };
}
