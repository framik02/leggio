// EPUB 2 e 3, senza DRM.
import { pulisci, capitolo, titoloDaContenuto, indovinaLingua } from './comune.js';

function risolvi(base, rel) {
  if (!rel) return '';
  rel = decodeURIComponent(rel.split('#')[0]);
  if (rel.startsWith('/')) return rel.slice(1);
  const parti = base.split('/'); parti.pop();
  for (const p of rel.split('/')) {
    if (p === '..') parti.pop(); else if (p !== '.' && p !== '') parti.push(p);
  }
  return parti.join('/');
}

function testoDi(doc, sel) {
  const el = doc.querySelector(sel) || [...doc.getElementsByTagName('*')].find(e => e.localName === sel.split(':').pop());
  return el ? el.textContent.trim() : '';
}

function primo(doc, nome) {
  const els = doc.getElementsByTagName('*');
  for (const e of els) if (e.localName === nome) return e;
  return null;
}
function tutti(doc, nome) {
  return [...doc.getElementsByTagName('*')].filter(e => e.localName === nome);
}

export async function importaEpub(file, avanzamento) {
  const zip = await window.JSZip.loadAsync(file);
  const leggi = p => zip.file(p) ? zip.file(p).async('string') : Promise.resolve(null);
  const contXml = await leggi('META-INF/container.xml');
  if (!contXml) throw new Error('EPUB non valido: manca container.xml');
  if (zip.file('META-INF/encryption.xml')) {
    const enc = await leggi('META-INF/encryption.xml');
    if (/EncryptedData/.test(enc) && !/obfuscation|font/i.test(enc)) throw new Error('Questo EPUB è protetto da DRM e non si può aprire.');
  }
  const xp = new DOMParser();
  const cont = xp.parseFromString(contXml, 'application/xml');
  const opfPath = primo(cont, 'rootfile').getAttribute('full-path');
  const opf = xp.parseFromString(await leggi(opfPath), 'application/xml');

  const meta = primo(opf, 'metadata');
  const md = n => { const e = meta && [...meta.getElementsByTagName('*')].find(x => x.localName === n); return e ? e.textContent.trim() : ''; };
  const titolo = md('title') || file.name.replace(/\.[^.]+$/, '');
  const autore = md('creator');
  const linguaDich = md('language');

  const manifest = {};
  for (const it of tutti(opf, 'item')) {
    manifest[it.getAttribute('id')] = {
      href: risolvi(opfPath, it.getAttribute('href')),
      tipo: it.getAttribute('media-type') || '',
      prop: it.getAttribute('properties') || '',
    };
  }
  const spine = tutti(opf, 'itemref').filter(i => i.getAttribute('linear') !== 'no').map(i => manifest[i.getAttribute('idref')]).filter(Boolean);

  // Indice: nav (EPUB 3) o NCX (EPUB 2). Mappa file → titolo.
  const titoli = {};
  const navItem = Object.values(manifest).find(m => m.prop.split(' ').includes('nav'));
  if (navItem) {
    const nav = xp.parseFromString(await leggi(navItem.href), 'application/xhtml+xml');
    const navToc = tutti(nav, 'nav').find(n => (n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').includes('toc')) || primo(nav, 'nav');
    if (navToc) for (const a of tutti(navToc, 'a')) {
      const f = risolvi(navItem.href, a.getAttribute('href'));
      if (f && !titoli[f]) titoli[f] = a.textContent.trim().replace(/\s+/g, ' ');
    }
  }
  const spineEl = primo(opf, 'spine');
  const ncxId = spineEl && spineEl.getAttribute('toc');
  const ncxItem = (ncxId && manifest[ncxId]) || Object.values(manifest).find(m => m.tipo === 'application/x-dtbncx+xml');
  if (ncxItem && !Object.keys(titoli).length) {
    const ncx = xp.parseFromString(await leggi(ncxItem.href) || '', 'application/xml');
    for (const np of tutti(ncx, 'navPoint')) {
      const c = primo(np, 'content'); const l = primo(np, 'text');
      const f = c && risolvi(ncxItem.href, c.getAttribute('src'));
      if (f && !titoli[f] && l) titoli[f] = l.textContent.trim().replace(/\s+/g, ' ');
    }
  }

  // Copertina.
  let copertina = null;
  let coverItem = Object.values(manifest).find(m => m.prop.split(' ').includes('cover-image'));
  if (!coverItem && meta) {
    const m = [...meta.getElementsByTagName('*')].find(x => x.localName === 'meta' && x.getAttribute('name') === 'cover');
    if (m) coverItem = manifest[m.getAttribute('content')];
  }
  if (!coverItem) coverItem = Object.values(manifest).find(m => m.tipo.startsWith('image/') && /cover/i.test(m.href));
  if (coverItem && zip.file(coverItem.href)) {
    copertina = new Blob([await zip.file(coverItem.href).async('arraybuffer')], { type: coverItem.tipo });
  }

  const risorse = [];
  const giaSalvate = new Set();
  const capitoli = [];
  let testoCampione = '';
  let lingua = indovinaLingua('', linguaDich);
  if (!/^(it|en)/i.test(linguaDich || '')) lingua = null;

  for (let i = 0; i < spine.length; i++) {
    const voce = spine[i];
    if (!/html|xml/.test(voce.tipo)) continue;
    const src = await leggi(voce.href);
    if (!src) continue;
    let doc = xp.parseFromString(src, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = xp.parseFromString(src, 'text/html');
    const body = doc.body || primo(doc, 'body');
    if (!body) continue;
    if (!lingua) { testoCampione += body.textContent.slice(0, 4000); if (testoCampione.length > 8000 || i === spine.length - 1) lingua = indovinaLingua(testoCampione, linguaDich); }
    const pendenti = [];
    const htmlDoc = document.implementation.createHTMLDocument('');
    const radice = htmlDoc.importNode(body, true);
    const pulito = pulisci(radice, s => {
      const p = risolvi(voce.href, s);
      if (!zip.file(p)) return null;
      if (!giaSalvate.has(p)) { giaSalvate.add(p); pendenti.push(p); }
      return p;
    });
    for (const p of pendenti) {
      const est = p.split('.').pop().toLowerCase();
      const tipo = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[est] || 'application/octet-stream';
      risorse.push({ percorso: p, blob: new Blob([await zip.file(p).async('arraybuffer')], { type: tipo }) });
    }
    const haTesto = pulito.textContent.trim().length > 0;
    const haImg = pulito.querySelector('img');
    if (!haTesto && !haImg) continue;
    // Una pagina con la sola copertina non diventa un capitolo.
    if (!haTesto && capitoli.length === 0 && copertina) continue;
    const t = titoli[voce.href] || titoloDaContenuto(pulito) || (haTesto ? `Sezione ${capitoli.length + 1}` : 'Immagini');
    capitoli.push(capitolo(pulito, t, capitoli.length, lingua || 'it'));
    avanzamento && avanzamento((i + 1) / spine.length);
  }
  if (!capitoli.length) throw new Error('Nessun testo trovato nel file.');
  if (!lingua) lingua = indovinaLingua(testoCampione, linguaDich);
  return { titolo, autore, lingua, copertina, capitoli, risorse };
}
