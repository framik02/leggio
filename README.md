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
- Collegamenti ad altri autori accanto ai passaggi, preparati su Kaggle e
  consultabili offline. Scheda con estratto originale, rapporto fra le idee,
  spiegazione e contesto senza cambiare il progresso dell'altro libro.
- Confronti salvati e note in Evidenziati, inclusi nella copia completa.
  «Non pertinente» nasconde una coppia; Aspetto permette di togliere i richiami.

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
  toglie questo limite e porta la voce clonata.

## Collegamenti fra autori, versione 0.13

`js/echi.js` consulta soltanto i confronti con prove prodotti dalla pipeline
su Kaggle. Gli echi precedenti basati sulla sola somiglianza non diventano
automaticamente confronti fra idee. L'archivio passa alla versione 4 senza
cancellare i dati; confronti salvati, note e rifiuti stanno in `confronti`.

I confronti sono suggerimenti da controllare nel contesto. Autori sconosciuti
o uguali, riferimenti non validi e indici di versioni diverse vengono esclusi.
La preparazione è progressiva: i libri nuovi e i lotti ancora incompleti
vengono elaborati online, mentre i risultati già pronti rimangono sul telefono.
I testi vengono inviati al repository privato e a Kaggle per la preparazione.

Prova locale del lettore, con dati sintetici e migrazione di un archivio v3:

```powershell
python tests/test_echi_browser.py
```

Richiede Playwright per Python e Chromium (`python -m playwright install chromium`).
Verifica richiamo, filtri, estratti, contesto, offline, note, backup e rifiuto.
