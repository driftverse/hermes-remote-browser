const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const vm=require('node:vm');
const path=require('node:path');
const extension=process.env.BRIDGE_EXTENSION || path.join(__dirname,'../extension');
const source=fs.readFileSync(path.join(extension,'background.js'),'utf8');
function harness(){
 const calls=[]; let grouped=true;
 const event={addListener(){},removeListener(){}};
 const chrome={storage:{local:{get:async()=>({armed:true,lastTabId:1}),set:async()=>{}},session:{set:async()=>{}}},
 action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
 tabGroups:{query:async()=>[{id:4}]},tabs:{query:async()=>grouped?[{id:1,groupId:4}]:[],get:async()=>({id:1}),onUpdated:event},
 scripting:{executeScript:async(p)=>{calls.push(['overlay',p.args]);return [{result:{}}];}},
 runtime:{onStartup:event,onInstalled:event,onMessage:event}, alarms:{create(){},onAlarm:event},
 debugger:{attach:async(t,v)=>calls.push(['attach',t,v]),detach:async(t)=>calls.push(['detach',t]),sendCommand:async(t,m,p)=>{calls.push([m,p]);return m==='Runtime.evaluate'?{result:{value:{width:1000,height:800,device_pixel_ratio:1}}}:{};}}};
 const ctx=vm.createContext({chrome,console,setTimeout,clearTimeout,setInterval,clearInterval,WebSocket:{OPEN:1}, navigator:{}, URL});
 ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(extension,f),'utf8'),ctx));
 vm.runInContext(source,ctx); return {ctx,calls,chrome,ungroup:()=>grouped=false};
}
test('mouse wheel uses real input at viewport coordinates and detaches',async()=>{
 const h=harness(); await h.ctx.runCommand('mouse',{kind:'wheel',x:600,y:400,delta_y:500});
 const event=h.calls.find(c=>c[0]==='Input.dispatchMouseEvent'); assert.ok(event); assert.equal(event[1].type,'mouseWheel');assert.equal(event[1].deltaY,500);
 assert.ok(h.calls.some(c=>c[0]==='overlay' && c[1][0].kind==='wheel'));
 assert.equal(h.calls.at(-1)[0],'detach');
});
test('mouse refuses tabs outside shared group',async()=>{
 const h=harness(); h.ungroup(); await assert.rejects(h.ctx.runCommand('mouse',{tab_id:1,kind:'click',x:1,y:1}),/tab group/);assert.equal(h.calls.length,0);
});
test('mouse rejects missing and out of bounds coordinates before input',async()=>{
 for(const p of [{kind:'click'},{kind:'click',x:-1,y:20},{kind:'click',x:1000,y:20},{kind:'drag',x:1,y:1,to_x:2000,to_y:1}]){
 const h=harness(); await assert.rejects(h.ctx.runCommand('mouse',p)); assert.ok(!h.calls.some(c=>c[0]==='Input.dispatchMouseEvent')); }
});
test('disarm during feedback prevents actual input and detaches',async()=>{
 const h=harness(); h.chrome.scripting.executeScript=async()=>{h.chrome.storage.local.get=async()=>({armed:false});return [{result:{}}]};
 await assert.rejects(h.ctx.runCommand('mouse',{kind:'click',x:40,y:50}),/switched off/);
 assert.ok(!h.calls.some(c=>c[0]==='Input.dispatchMouseEvent'));assert.equal(h.calls.at(-1)[0],'detach');
});
test('moving tab out of group during feedback prevents input',async()=>{
 const h=harness();h.chrome.scripting.executeScript=async()=>{h.ungroup();return [{result:{}}]};
 await assert.rejects(h.ctx.runCommand('mouse',{kind:'click',x:40,y:50}),/tab group/);
 assert.ok(!h.calls.some(c=>c[0]==='Input.dispatchMouseEvent'));assert.equal(h.calls.at(-1)[0],'detach');
});
test('existing debugger failure never steals or detaches it',async()=>{
 const h=harness();h.chrome.debugger.attach=async()=>{throw new Error('already attached')};
 await assert.rejects(h.ctx.runCommand('mouse',{kind:'click',x:40,y:50}),/already attached/);assert.equal(h.calls.length,0);
});
test('feedback failure does not block input',async()=>{
 const h=harness();h.chrome.scripting.executeScript=async()=>{throw new Error('page unavailable')};
 await h.ctx.runCommand('mouse',{kind:'move',x:40,y:50});assert.ok(h.calls.some(c=>c[0]==='Input.dispatchMouseEvent'));
});
test('click is press then release; drag moves with button held',async()=>{
 const h=harness();await h.ctx.runCommand('mouse',{kind:'click',x:40,y:50});
 assert.deepEqual(h.calls.filter(c=>c[0]==='Input.dispatchMouseEvent').map(c=>c[1].type),['mousePressed','mouseReleased']);
 const d=harness();await d.ctx.runCommand('mouse',{kind:'drag',x:40,y:50,to_x:200,to_y:300});
 const events=d.calls.filter(c=>c[0]==='Input.dispatchMouseEvent').map(c=>c[1]);assert.equal(events[0].type,'mouseMoved');assert.ok(events.some(e=>e.type==='mouseMoved'&&e.buttons===1));assert.equal(events.at(-1).type,'mouseReleased');
});
