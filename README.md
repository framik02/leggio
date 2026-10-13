# Leggio

Libreria personale per leggere e ascoltare i propri libri sul telefono. È una
web app installabile (PWA) pubblicata su GitHub Pages. Si apre da Safari, si
aggiunge alla schermata Home e funziona anche senza rete. Libri, note e
progressi restano sul dispositivo, in IndexedDB, senza server.

## Cosa fa

- Importa EPUB, PDF con testo, TXT, Markdown, HTML e FB2. I PDF vengono
  ricomposti in testo scorrevole.
- Lettore con quattro temi chiari, quattro caratteri, corpo, interlinea e
  margini regolabili. Indice, ricerca nel libro, segnalibri.
- Tieni premuto su una frase per evidenziarla in tre colori, annotarla,
  copiarla, ascoltare da lì o correggerne la pronuncia.
- Ascolto con le voci del telefono, frase per frase, col testo che segue la
  voce. Pause diverse per paragrafi e cambi di scena, dialoghi più vivaci,
  velocità, timer di spegnimento.
- Le correzioni di pronuncia diventano regole che valgono da lì in avanti, per
  un libro o per tutti.
- Esporta in EPUB, PDF (tramite la stampa), TXT, o restituisce l'originale.
- Minuti di lettura al giorno con obiettivo.

## Struttura

```
index.html, sw.js, manifest.webmanifest
css/app.css           tavolozza chiara sola, per scelta
js/app.js             libreria, evidenziati, impostazioni, navigazione
js/lettore.js         vista di lettura e ascolto
js/voce.js            sintesi vocale frase per frase
js/libri.js           import, conversioni, backup
js/db.js              archivio IndexedDB
js/import/            un modulo per formato, più il taglio in frasi
vendor/               pdf.js 4.10.38, JSZip 3.10.1
fonts/                Literata, Atkinson Hyperlegible
```

Niente build. Per provarla in locale si lancia `python -m http.server 8765` e
si apre http://127.0.0.1:8765. Il service worker si attiva solo in https.

## Limiti noti

- I libri con DRM non si aprono.
- I PDF scansionati senza testo richiedono prima un OCR.
- MOBI e AZW non sono ancora supportati.
- Le voci del telefono si fermano a schermo spento. L'audio generato su Kaggle,
  in arrivo, toglie questo limite e porta la voce clonata.
