"""Grafo reale degli autori, affinità pregresse e confronti navigabili."""
import functools
import json
import re
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

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
            self.wfile.write(b'<!doctype html><html><body>Verifica autori</body></html>')
        else:
            super().do_GET()


server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'

SEED = r'''async () => {
 const {db}=await import('/js/db.js');
 const books=[['a','Autore Primo','Ricostruire'],['b','Autore Secondo','La memoria'],['c','Primo, Autore','Raccontare'],['d','Autore Isolato','Il paesaggio']];
 for(const [id,autore,titolo] of books) {
   await db.put('libri',{id,autore,titolo,lingua:'it',capitoli:[{n:0,titolo:'Capitolo uno'}],frasiTotali:2,paroleTotali:80,stato:'da-leggere',progresso:0,posizione:{cap:0,frase:0}});
   const frase=id==='b'?'«Il ricordo rielabora il passato».':'Ricordare è ricostruire gli eventi dal presente.';
   await db.put('capitoli',{libro:id,n:0,titolo:'Capitolo uno',html:`<p><span class="s" data-s="1">${frase}</span></p><p><span class="s" data-s="2">Un racconto può cambiare con le esperienze.</span></p>`});
 }
 const r={id:'verificato-ab',libro:'b',passaggio:0,origine:[0,1,2],destinazione:[0,1,2],relazione:'affine',idea:'Il ricordo ricostruisce il passato.',ideaDestinazione:'La memoria rielabora il passato.',frasiOrigine:[1],frasiDestinazione:[1],spiegazione:'Entrambi i brani descrivono la memoria come una ricostruzione del passato.'};
 const inverse={...r,libro:'a',idea:r.ideaDestinazione,ideaDestinazione:r.idea};
 const rows={a:{legami:[[r]],echi:[[['b',0,.8,0,0,1],['c',0,.9,0,0,1]]]},b:{legami:[[inverse]],echi:[[['a',0,.8,0,0,1],['c',0,.7,0,0,1]]]},c:{legami:[[]],echi:[[['b',0,.7,0,0,1]]]},d:{legami:[[]],echi:[[]]}};
 for(const [id] of books) await db.put('mappa',{id,versione:100,echiVersione:1,passaggi:[[0,1,2,0,0]],...rows[id]},`libro:${id}`);
 await db.put('mappa',{versione:100,temi:[],archi:[],archi_libri:[],libri:Object.fromEntries(books.map(([id,,titolo],i)=>[id,{titolo,n:1,x:Math.cos(i*2),y:Math.sin(i*2)}]))},'temi');
 await db.put('mappa',{versione:100,echiVersione:1,echi:{completo:false},remoto:{fase:'in corso',dettaglio:'preparo i confronti'}},'stato');
 return true;
}'''

with sync_playwright() as pw:
    print('Verifico indice e navigazione del grafo.', flush=True)
    browser = pw.chromium.launch()
    context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base+'/__test_shell')
    assert page.evaluate(SEED)
    # L'indice mantiene tutti i brani, deduplica i versi e raggruppa le opere dello stesso autore.
    result = page.evaluate('''async()=>{
      const{caricaAutori,indicizzaAutori}=await import('/js/autori.js');
      const{db}=await import('/js/db.js');const r=await caricaAutori();
      const books=await db.tutti('libri');const data=Object.fromEntries(await Promise.all(books.map(async b=>[b.id,await db.get('mappa','libro:'+b.id)])));
      const mismatched=structuredClone(data);mismatched.b.versione=101;
      const rejected=structuredClone(data);rejected.c.esclusi=[[['b',0]]];
      const blocked=indicizzaAutori(books,data,[{id:'verificato-ab',stato:'nascosto'}]);
      return {autori:r.autori.length,archi:r.archi.length,totale:r.totale,verificati:r.verificati,affinita:r.affinita,
        opere:r.autori.find(a=>a.id==='autore primo').libri.length,
        incoerenti:indicizzaAutori(books,mismatched).totale,scartati:indicizzaAutori(books,rejected).totale,
        nascosti:blocked.totale};
    }''')
    assert result == {'autori':3,'archi':1,'totale':2,'verificati':1,'affinita':1,'opere':2,'incoerenti':0,'scartati':1,'nascosti':1}, result
    page.goto(base+'/index.html#/mappa')
    page.get_by_role('button',name='Autori',exact=True).wait_for()
    assert page.get_by_role('button',name='Autori',exact=True).get_attribute('class')=='pill attivo'
    assert page.locator('.autori-collegamento').count()==1
    assert page.locator('[data-autore]').count()==3
    page.get_by_label('Vai a un autore').select_option('autore primo')
    sheet=page.locator('.mappa-scheda.aperta')
    assert 'Autore Primo' in sheet.inner_text()
    assert 'Ricostruire' in sheet.inner_text() and 'Raccontare' in sheet.inner_text()
    sheet.get_by_role('button',name=re.compile('Autore Secondo')).click()
    dialog=page.get_by_role('dialog',name='Autore Primo · Autore Secondo',exact=True)
    dialog.locator('.autori-confronto').first.wait_for()
    assert dialog.locator('.autori-confronto').count()==2
    assert dialog.locator('.mf-citazione').count()==4
    assert dialog.get_by_text('Idea affine',exact=True).count()==1
    assert dialog.get_by_text('Affinità da verificare',exact=True).count()==1
    assert dialog.get_by_role('button',name='Mostra altri confronti',exact=True).is_hidden()
    dialog.locator('.autori-confronto').first.get_by_role('button',name='Secondo brano',exact=True).click()
    target=page.get_by_role('dialog',name='Nel contesto',exact=True)
    target.get_by_role('button',name='Tutto il capitolo',exact=True).click()
    assert page.evaluate("async()=>{const{db}=await import('/js/db.js');return(await db.get('libri','b')).progresso===0}")
    target.get_by_role('button',name='Apri nel lettore',exact=True).click()
    page.wait_for_function("location.hash === '#/libro/b'")
    page.wait_for_function("document.querySelector('.l-pagina')?.textContent.startsWith('«Il ricordo')")
    # Anche con la sola mappa precedente, le affinità sono immediatamente raggiungibili e marcate.
    page.goto(base+'/index.html#/mappa')
    page.get_by_role('button',name='Tutti i collegamenti',exact=True).click()
    all_links=page.get_by_role('dialog',name='Tutti i collegamenti',exact=True)
    assert all_links.locator('.autori-coppia').count()==1
    all_links.locator('.autori-coppia').click()
    dialog=page.get_by_role('dialog',name='Autore Primo · Autore Secondo',exact=True)
    dialog.locator('.autori-confronto').nth(1).get_by_role('button',name='Salva confronto',exact=True).click()
    dialog.locator('.autori-confronto').nth(1).get_by_role('button',name='Salvato',exact=True).wait_for()
    assert page.evaluate("async()=>{const{db}=await import('/js/db.js');return(await db.tutti('confronti')).some(c=>c.stato==='salvato'&&c.relazione==='affinita'&&c.verificato===false)}")
    context.set_offline(True)
    dialog.locator('.autori-confronto').first.get_by_role('button',name='Primo brano',exact=True).click()
    page.get_by_role('dialog',name='Nel contesto',exact=True).get_by_role('button',name='Torna ai collegamenti',exact=True).click()
    page.get_by_role('dialog',name='Nel contesto',exact=True).wait_for(state='detached')
    context.set_offline(False)
    dialog.get_by_role('button',name='Chiudi',exact=True).click()
    dialog.wait_for(state='detached')
    all_links.get_by_role('button',name='Chiudi',exact=True).click()
    all_links.wait_for(state='detached')
    page.goto(base+'/index.html#/mappa')
    # Un arco si apre anche direttamente dal disegno, senza passare dall'elenco.
    page.locator('.autori-collegamento').dispatch_event('click')
    page.get_by_role('dialog',name='Autore Primo · Autore Secondo',exact=True).locator('.autori-confronto').first.wait_for()
    page.get_by_role('dialog',name='Autore Primo · Autore Secondo',exact=True).get_by_role('button',name='Chiudi',exact=True).click()
    page.get_by_role('dialog',name='Autore Primo · Autore Secondo',exact=True).wait_for(state='detached')
    # Più di venti coppie restano tutte raggiungibili; nessun troncamento a tre risultati.
    page.evaluate('''async()=>{const{caricaAutori}=await import('/js/autori.js');const{apriConfronti}=await import('/js/echi.js');
      const r=await caricaAutori();await apriConfronti(Array.from({length:41},(_,i)=>({...r.archi[0].confronti[0],id:'pagina-'+i})),'Prova pagine');}''')
    pages=page.get_by_role('dialog',name='Prova pagine',exact=True)
    assert pages.locator('.autori-confronto').count()==20
    pages.get_by_role('button',name='Mostra altri confronti',exact=True).click()
    pages.locator('.autori-confronto').nth(39).wait_for()
    pages.get_by_role('button',name='Mostra altri confronti',exact=True).click()
    pages.locator('.autori-confronto').nth(40).wait_for()
    assert pages.get_by_role('button',name='Mostra altri confronti',exact=True).is_hidden()
    pages.get_by_role('button',name='Chiudi',exact=True).click()
    pages.wait_for(state='detached')
    # I libri senza autore restano visibili e l'autore può essere indicato dal grafo.
    page.evaluate("async()=>{const{db}=await import('/js/db.js');const b=await db.get('libri','d');b.autore='';await db.put('libri',b);}")
    page.reload()
    page.get_by_label('Vai a un autore').select_option('senza-autore:d')
    page.get_by_role('button',name='Indica l’autore',exact=True).click()
    edit=page.get_by_role('dialog',name='Indica l’autore',exact=True)
    edit.get_by_label('Autore del libro').fill('Autore Isolato')
    edit.get_by_role('button',name='Salva',exact=True).click()
    edit.wait_for(state='detached')
    page.wait_for_function("[...document.querySelectorAll('select option')].some(o=>o.value==='autore isolato')")
    page.goto(base+'/index.html#/mappa')
    page.locator('.mappa-svg').wait_for()
    for width in [320,390,736]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        assert page.locator('.mappa-tela').bounding_box()['height']>100
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(500)
    (ROOT/'.prova/autori').mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(ROOT/'.prova/autori/grafo.png'))
    assert not errors,errors
    print('Passati: raggruppamento autori, deduplica reciproci, versioni, scarti, selezione, archi, elenco, entrambi i contesti, apertura libro, salvataggio, offline e accesso a 41 coppie. Layout verificato a 320/390/736 px.',flush=True)
    browser.close()
server.shutdown()
