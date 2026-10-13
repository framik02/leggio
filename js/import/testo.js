// TXT, Markdown, HTML e FB2.
import { pulisci, capitolo, titoloDaContenuto, capitoliDaParagrafi, indovinaLingua } from './comune.js';

async function leggiTesto(file) {
  const buf = await file.arrayBuffer();
  let t = new TextDecoder('utf-8').decode(buf);
  // File in Windows-1252: troppi caratteri sostitutivi.
  if ((t.match(/�/g) || []).length > 5) t = new TextDecoder('windows-1252').decode(buf);
  return t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export async function importaTxt(file) {
  const t = await leggiTesto(file);
  const md = /\.(md|markdown)$/i.test(file.name);
  // Paragrafi separati da righe vuote; se non ce ne sono, una riga è un paragrafo.
  const blocchi = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n');
  const paragrafi = [];
  for (let b of blocchi) {
    b = b.replace(/\s*\n\s*/g, ' ').trim();
    if (!b) continue;
    if (md) {
      const h = b.match(/^#{1,3}\s+(.+)/);
      if (h) { paragrafi.push({ testo: h[1].replace(/[*_`]/g, ''), titolo: true }); continue; }
      b = b.replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1').replace(/^#{4,6}\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    }
    paragrafi.push({ testo: b });
  }
  const lingua = indovinaLingua(t);
  return { titolo: file.name.replace(/\.[^.]+$/, ''), autore: '', lingua, copertina: null, capitoli: capitoliDaParagrafi(paragrafi, lingua), risorse: [] };
}

export async function importaHtml(file) {
  const t = await leggiTesto(file);
  const doc = new DOMParser().parseFromString(t, 'text/html');
  const lingua = indovinaLingua(doc.body.textContent, doc.documentElement.lang);
  const pulito = pulisci(doc.body, null);
  // Ogni h1 o h2 apre un capitolo.
  const capitoli = [];
  let att = document.createElement('div');
  const chiudi = () => {
    if (att.textContent.trim()) capitoli.push(capitolo(att, titoloDaContenuto(att) || `Parte ${capitoli.length + 1}`, capitoli.length, lingua));
    att = document.createElement('div');
  };
  const piatti = pulito.querySelectorAll(':scope > *');
  const fuoco = piatti.length === 1 && piatti[0].children.length > 3 ? piatti[0] : pulito;
  for (const el of Array.from(fuoco.childNodes)) {
    if (el.nodeType === 1 && /^H[12]$/.test(el.nodeName) && att.textContent.trim()) chiudi();
    att.appendChild(el);
  }
  chiudi();
  return { titolo: doc.title || file.name.replace(/\.[^.]+$/, ''), autore: '', lingua, copertina: null, capitoli, risorse: [] };
}

export async function importaFb2(file) {
  const t = await leggiTesto(file);
  const xml = new DOMParser().parseFromString(t, 'application/xml');
  const q = (el, n) => [...el.getElementsByTagName('*')].filter(e => e.localName === n);
  const info = q(xml, 'title-info')[0];
  const titolo = info ? (q(info, 'book-title')[0]?.textContent || '') : '';
  const aut = info ? q(info, 'author')[0] : null;
  const autore = aut ? [q(aut, 'first-name')[0]?.textContent, q(aut, 'last-name')[0]?.textContent].filter(Boolean).join(' ') : '';
  const lingua = indovinaLingua(xml.documentElement.textContent, info ? q(info, 'lang')[0]?.textContent : '');
  const doc = document.implementation.createHTMLDocument('');
  const conv = (el, dest) => {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { dest.appendChild(doc.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      const m = { p: 'p', emphasis: 'em', strong: 'strong', 'empty-line': 'br', poem: 'blockquote', stanza: 'div', v: 'p', cite: 'blockquote', epigraph: 'blockquote', subtitle: 'h3', title: 'h2' }[c.localName];
      if (c.localName === 'section' || c.localName === 'image') continue;
      const e = doc.createElement(m || 'span');
      conv(c, e); dest.appendChild(e);
    }
  };
  const corpo = q(xml, 'body')[0];
  const sezioni = corpo ? q(corpo, 'section').filter(s => !q(s, 'section').length) : [];
  const capitoli = sezioni.map((s, i) => {
    const div = doc.createElement('div');
    conv(s, div);
    return capitolo(div, titoloDaContenuto(div) || `Sezione ${i + 1}`, i, lingua);
  }).filter(c => c.frasi > 0).map((c, i) => ({ ...c, n: i }));
  let copertina = null;
  const bin = q(xml, 'binary').find(b => /cover/i.test(b.getAttribute('id') || ''));
  if (bin) {
    const raw = atob(bin.textContent.replace(/\s/g, ''));
    const arr = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    copertina = new Blob([arr], { type: bin.getAttribute('content-type') || 'image/jpeg' });
  }
  return { titolo: titolo || file.name.replace(/\.[^.]+$/, ''), autore, lingua, copertina, capitoli, risorse: [] };
}
