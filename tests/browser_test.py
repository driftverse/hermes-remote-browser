"""Isolated real Chrome tests. Requires Chrome and Python websockets; no personal profiles."""
import json, os, shutil, subprocess, tempfile, time, urllib.request
from pathlib import Path
from websockets.sync.client import connect
ROOT=Path(os.environ.get('BRIDGE_EXTENSION',Path(__file__).resolve().parents[1]/'extension'))
source=(ROOT/'background.js').read_text()
functions=source[source.index('function pageSnapshot('):source.index('// ---- lifecycle')]
html='''<style>body{margin:0;overflow:hidden}.panel{height:300px;width:400px;overflow:auto}.tall{height:2000px}</style><div id="panel" class="panel"><div class="tall"><button id="anchor">Anchor</button></div></div><button id="click" style="position:absolute;left:500px;top:100px" onclick="this.textContent='clicked'">Click me</button>'''
chrome=os.environ.get('CHROME_BIN') or shutil.which('google-chrome') or shutil.which('chromium')
assert chrome, 'Install Chrome or set CHROME_BIN'
with tempfile.TemporaryDirectory(prefix='bridge-test-') as folder:
    path=Path(folder); (path/'fixture.html').write_text(html)
    proc=subprocess.Popen([chrome,'--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',f'--user-data-dir={folder}/profile','--window-size=1100,850',(path/'fixture.html').as_uri()],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        active=path/'profile/DevToolsActivePort'
        for _ in range(100):
            if active.exists(): break
            time.sleep(.1)
        port=active.read_text().splitlines()[0]
        tab=next(t for t in json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json')) if t['type']=='page')
        with connect(tab['webSocketDebuggerUrl'],origin=None) as ws:
            seq=0
            def cmd(method,params=None):
                global seq
                seq+=1; ws.send(json.dumps({'id':seq,'method':method,'params':params or {}}))
                while True:
                    r=json.loads(ws.recv())
                    if r.get('id')==seq:
                        assert 'error' not in r,r
                        return r.get('result',{})
            def evaluate(js):
                r=cmd('Runtime.evaluate',{'expression':js,'returnByValue':True,'awaitPromise':True})
                assert 'exceptionDetails' not in r,r
                return r['result'].get('value')
            evaluate(functions)
            cursor=ROOT/'cursor.js'
            if cursor.exists(): evaluate(cursor.read_text())
            evaluate('pageCursor({kind:"move",x:530,y:110,label:"Penny"})')
            assert evaluate('getComputedStyle(document.querySelector("[data-remote-browser-cursor]")).pointerEvents')=='none'
            assert evaluate('document.elementFromPoint(530,110).id')=='click'
            assert evaluate('document.querySelector("[data-remote-browser-cursor]").shadowRoot') is None
            print('PASS: visible pointer is click-through and closed-shadow isolated')
            evaluate('pageCursor({kind:"wheel",x:200,y:150,direction:"up",label:"Penny"})')
            assert evaluate('document.querySelectorAll("[data-remote-browser-cursor]").length')==1
            assert 'Penny' not in evaluate('pageSnapshot(6000).text')
            print('PASS: overlay reused and excluded from snapshot text')
            cmd('Page.captureScreenshot',{'format':'png'})
            screenshot=os.environ.get('BRIDGE_TEST_SCREENSHOT')
            if screenshot:
                import base64
                Path(screenshot).write_bytes(base64.b64decode(cmd('Page.captureScreenshot',{'format':'png'})['data']))
            evaluate('pageCursor({remove:true})')
            assert evaluate('document.querySelectorAll("[data-remote-browser-cursor]").length')==0
            print('PASS: explicit cursor cleanup')
            snap=evaluate('pageSnapshot(6000)'); ref=next(e['ref'] for e in snap['elements'] if e['label']=='Anchor')
            result=evaluate(f'pageAction("scroll",{{ref:{ref},direction:"down",pixels:200}})')
            assert evaluate('document.querySelector("#panel").scrollTop')==200,result
            assert result['moved'] and evaluate('scrollY')==0
            print('PASS: targeted nested scroll')
            evaluate(f'pageAction("scroll",{{ref:{ref},direction:"bottom"}})')
            assert not evaluate(f'pageAction("scroll",{{ref:{ref},direction:"down",pixels:100}})')['moved']
            assert 'error' in evaluate('pageAction("scroll",{ref:99999,direction:"down"})')
            print('PASS: boundary no-op and stale ref')
            evaluate('document.querySelector("#panel").scrollTop=0')
            evaluate('pageCursor({kind:"wheel",x:200,y:150,delta_y:300,label:"Penny"})')
            cmd('Input.dispatchMouseEvent',{'type':'mouseWheel','x':200,'y':150,'deltaX':0,'deltaY':300});time.sleep(.4)
            assert evaluate('document.querySelector("#panel").scrollTop')>0
            print('PASS: real wheel works through overlay')
            evaluate('pageCursor({kind:"click",x:530,y:110,label:"Penny"})')
            for kind in ['mousePressed','mouseReleased']: cmd('Input.dispatchMouseEvent',{'type':kind,'x':530,'y':110,'button':'left','clickCount':1})
            assert evaluate('document.querySelector("#click").textContent')=='clicked'
            print('PASS: real click works through overlay')
            evaluate("document.body.insertAdjacentHTML('beforeend', '<div id=reverse style=\"position:absolute;left:750px;top:50px;width:200px;height:200px;overflow:auto;display:flex;flex-direction:column-reverse\"><div style=\"height:800px;flex-shrink:0\">Older messages</div></div>')")
            snap=evaluate('pageSnapshot(6000)'); reverse_ref=next(e['ref'] for e in snap['elements'] if e.get('scroll') and e['bounds']['x']==750)
            evaluate(f'pageAction("scroll",{{ref:{reverse_ref},direction:"top"}})')
            assert evaluate('document.querySelector("#reverse").scrollTop')<0
            evaluate(f'pageAction("scroll",{{ref:{reverse_ref},direction:"bottom"}})')
            assert evaluate('document.querySelector("#reverse").scrollTop')==0
            print('PASS: column-reverse chat top and bottom')
            time.sleep(2.5)
            assert evaluate('document.querySelectorAll("[data-remote-browser-cursor]").length')==0
            print('PASS: overlay expires automatically')
            ws.send(json.dumps({'id':seq+1,'method':'Browser.close'}))
            proc.wait(timeout=10)
            time.sleep(.3)  # Chrome children finish flushing the disposable profile.
    finally:
        if proc.poll() is None:
            proc.terminate();proc.wait(timeout=10)
            time.sleep(.3)
