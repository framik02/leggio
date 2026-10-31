"""Prova del lettore reale con archivio sintetico; nessun servizio esterno."""
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

print('Carico il controllo del browser.', flush=True)
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == '/__test_shell':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<!doctype html><html><body>Verifica archivio</body></html>')
        else:
            super().do_GET()


server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'

SEED = r'''async () => {
  await new Promise((ok, ko) => {
    const q = indexedDB.open('leggio', 3);
    q.onupgradeneeded = () => {
      const d = q.result;
      d.createObjectStore('libri', {keyPath:'id'});
      d.createObjectStore('capitoli', {keyPath:['libro','n']});
      d.createObjectStore('risorse', {keyPath:['libro','percorso']});
      d.createObjectStore('originali', {keyPath:'libro'});
      const e = d.createObjectStore('evidenziati', {keyPath:'id'}); e.createIndex('libro','libro');
      ['impostazioni','diario','mappa'].forEach(n=>d.createObjectStore(n));
      d.createObjectStore('audio',{keyPath:['libro','n']});
      ['lavori','voci'].forEach(n=>d.createObjectStore(n,{keyPath:'id'}));
      q.transaction.objectStore('evidenziati').put({id:'precedente',libro:'a',tipo:'evidenza',testo:'Nota precedente',cap:0,frase:1,data:1});
    };
    q.onsuccess = () => {q.result.close();ok();};q.onerror=()=>ko(q.error);
  });
  const {db}=await import('/js/db.js');
  const books=[['a','Autore Primo','Il ricordo'],['b','Autore Secondo','La memoria'],['c','Primo, Autore','Secondo libro']];
  for(const [id,autore,titolo] of books) {
    await db.put('libri',{id,autore,titolo,lingua:'it',capitoli:[{n:0,titolo:'Capitolo uno'}],frasiTotali:2,paroleTotali:90,stato:'da-leggere',progresso:0,posizione:{cap:0,frase:0}});
    const testo=id==='a'?'Ricordare significa ricostruire il passato.':'«La memoria rielabora il passato, non ne conserva una copia intatta». ';
    await db.put('capitoli',{libro:id,n:0,titolo:'Capitolo uno',html:`<p><span class="s" data-s="1">${testo}</span></p><p><span class="s" data-s="2">Le esperienze del presente cambiano il modo di raccontare ciò che è accaduto.</span></p>`});
  }
  const link={id:'coppia-ab',libro:'b',passaggio:0,origine:[0,1,2],destinazione:[0,1,2],relazione:'affine',idea:'La memoria ricostruisce il passato.',ideaDestinazione:'Il ricordo rielabora il passato.',frasiOrigine:[1],frasiDestinazione:[1],spiegazione:'Entrambi i brani descrivono il ricordo come una ricostruzione che dipende dal presente.'};
  for(const [id] of books) await db.put('mappa',{id,versione:100,echiVersione:1,passaggi:[[0,1,2,0,0]],legami:id==='a'?[[link,{...link,id:'stesso-autore',libro:'c'},{...link,id:'prova-inventata',frasiDestinazione:[900]}]]:[[]]},`libro:${id}`);
  await db.put('mappa',{versione:100,libri:{a:{titolo:'Il ricordo',n:1},b:{titolo:'La memoria',n:1}}},'temi');
  await db.put('mappa',{versione:100,echiVersione:1,echi:{completo:true},remoto:{fase:'finito'}},'stato');
  return (await db.get('evidenziati','precedente')).testo;
}'''


with sync_playwright() as pw:
    print('Avvio Chromium.', flush=True)
    browser = pw.chromium.launch(timeout=30000)
    context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
    errors = []
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/__test_shell')
    assert page.evaluate(SEED) == 'Nota precedente'
    page.goto(base + '/index.html#/libro/a')
    page.locator('.eco-richiamo').wait_for()
    assert page.locator('.eco-richiamo').count() == 1
    assert page.locator('.eco-richiamo').inner_text() == '1'
    vista = page.evaluate("({root:scrollY,lettore:document.querySelector('.l-scorri').scrollTop})")
    assert page.evaluate("async()=>{const{frasiDalCapitolo}=await import('/js/voce.js');return frasiDalCapitolo(document.querySelector('.l-pagina')).map(f=>f.testo).join(' ')}").startswith('Ricordare significa ricostruire')
    page.locator('.eco-richiamo').click()
    sheet = page.get_by_role('dialog', name='Altri autori', exact=True)
    sheet.locator('.echi-scheda').wait_for()
    assert sheet.locator('.echi-scheda').count() == 1
    assert not __import__('re').search(r'\bnull\b', sheet.inner_text())
    assert '«La memoria' in sheet.locator('.mf-citazione').inner_text()
    sheet.get_by_role('button',name='Leggi nel contesto',exact=True).click()
    target = page.get_by_role('dialog',name='Nel contesto',exact=True)
    target.get_by_role('button',name='Tutto il capitolo',exact=True).click()
    assert not __import__('re').search(r'\bnull\b', target.inner_text())
    assert 'La memoria' in target.inner_text()
    assert page.evaluate("async()=>{const{db}=await import('/js/db.js');const b=await db.get('libri','b');return b.progresso===0&&b.posizione.frase===0&&!b.aperto}")
    target.get_by_role('button',name='Torna ai collegamenti',exact=True).click()
    target.wait_for(state='detached')
    assert page.evaluate("({root:scrollY,lettore:document.querySelector('.l-scorri').scrollTop})") == vista
    sheet.get_by_role('button',name='Salva confronto',exact=True).click()
    sheet.get_by_role('button',name='Salvato',exact=True).wait_for()
    assert page.evaluate("async()=>{const{db}=await import('/js/db.js');return (await db.get('confronti','coppia-ab')).destinazione.testo.startsWith('«La memoria')}")
    (ROOT/'.prova/echi').mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(3300)
    page.screenshot(path=str(ROOT/'.prova/echi/lettore-echi-mobile.png'),full_page=True)
    sheet.get_by_role('button',name='Chiudi',exact=True).click()
    sheet.wait_for(state='detached')
    assert page.evaluate("({root:scrollY,lettore:document.querySelector('.l-scorri').scrollTop})") == vista
    page.get_by_role('button',name='Aspetto',exact=True).click()
    aspect = page.get_by_role('dialog',name='Aspetto',exact=True)
    aspect.get_by_label('Collegamenti ad altri autori').uncheck()
    page.wait_for_function("document.querySelectorAll('.eco-richiamo').length===0")
    aspect.get_by_label('Collegamenti ad altri autori').check()
    page.locator('.eco-richiamo').wait_for()
    aspect.get_by_role('button',name='Chiudi',exact=True).click()
    aspect.wait_for(state='detached')
    # La consultazione non richiede rete né modelli caricati nel browser.
    context.set_offline(True)
    page.locator('.eco-richiamo').click()
    page.get_by_role('dialog',name='Altri autori',exact=True).locator('.echi-scheda').wait_for()
    page.get_by_role('dialog',name='Altri autori',exact=True).get_by_role('button',name='Chiudi',exact=True).click()
    context.set_offline(False)
    page.goto(base+'/index.html#/evidenziati')
    page.get_by_role('button',name='Confronti salvati',exact=True).click()
    saved = page.get_by_role('dialog',name='Confronti salvati',exact=True)
    saved.get_by_label('Nota sul confronto').fill('Da usare nel mio saggio.')
    saved.get_by_label('Nota sul confronto').blur()
    page.wait_for_function("document.querySelector('textarea').value==='Da usare nel mio saggio.'")
    # Copia e ripristino conservano gli estratti e la nota personale.
    result = page.evaluate('''async()=>{
      const {db}=await import('/js/db.js');const{creaCopia,ripristina}=await import('/js/copia.js');
      const f=await creaCopia({conAudio:false});const z=await window.JSZip.loadAsync(f);
      const presente=!!z.file('archivi/confronti.json');await db.del('confronti','coppia-ab');
      await ripristina(f);const c=await db.get('confronti','coppia-ab');return {presente,nota:c.nota,testo:c.destinazione.testo};
    }''')
    assert result['presente'] and result['nota']=='Da usare nel mio saggio.' and result['testo'].startswith('«La memoria')
    saved.get_by_role('button',name='Rimuovi',exact=True).click()
    saved.get_by_role('button',name='Chiudi',exact=True).click()
    page.goto(base+'/index.html#/libro/a')
    page.locator('.eco-richiamo').wait_for()
    page.locator('.eco-richiamo').click()
    page.get_by_role('button',name='Non pertinente',exact=True).click()
    page.wait_for_function("document.querySelectorAll('.eco-richiamo').length===0")
    assert page.evaluate("async()=>{const{db}=await import('/js/db.js');return (await db.get('confronti','coppia-ab')).stato==='nascosto'}")
    for width in [320,390,736]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), width
    assert not errors, errors
    print('Verificati: migrazione archivio, filtri autore/prove, richiamo, citazioni originali, contesto senza progresso, preferenza grafica, offline, salvataggio/note, copia/ripristino e rifiuto. Nessun errore JavaScript.', flush=True)
    browser.close()
server.shutdown()
