const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const extension=process.env.BRIDGE_EXTENSION||path.join(__dirname,'../extension');
function harness(){
 const calls=[],tabs=new Map([[1,{id:1,groupId:4,windowId:8,status:'complete',active:false}]]);const event={addListener(){},removeListener(){}};
 const chrome={storage:{local:{get:async()=>({armed:true,lastTabId:1}),set:async()=>{}},session:{set:async()=>{}}},
 action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
 windows:{getLastFocused:async()=>({id:8}),get:async()=>({id:8,state:'normal'}),update:async(id,p)=>{calls.push(['window',id,p]);}},
 tabGroups:{query:async()=>[{id:4}],update:async(id,p)=>{calls.push(['group',id,p]);}},
 tabs:{query:async()=>[...tabs.values()].filter(t=>t.groupId===4),get:async(id)=>tabs.get(id),
 update:async(id,p)=>{calls.push(['update',id,p]);Object.assign(tabs.get(id),p);return tabs.get(id)},
 create:async(p)=>{calls.push(['create',p]);const t={id:2,groupId:-1,windowId:8,status:'complete',...p};tabs.set(2,t);return t;},
 group:async(p)=>{tabs.get(p.tabIds[0]).groupId=4;return 4},onUpdated:event},
 runtime:{onStartup:event,onInstalled:event,onMessage:event},alarms:{create(){},onAlarm:event}};
 const ctx=vm.createContext({chrome,console,setTimeout,clearTimeout,setInterval,clearInterval,WebSocket:{OPEN:1},navigator:{},URL});
 ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(extension,f),'utf8'),ctx));
 vm.runInContext(fs.readFileSync(path.join(extension,'background.js'),'utf8'),ctx);return{ctx,calls,tabs,chrome};
}
test('foreground open activates new grouped tab and focuses window',async()=>{
 const h=harness();const r=await h.ctx.runCommand('open',{url:'https://example.com/',foreground:true});
 assert.equal(r.active,true);assert.ok(h.calls.some(c=>c[0]==='group'&&c[2].collapsed===false));assert.ok(h.calls.some(c=>c[0]==='window'&&c[2].focused===true));
});
test('default background open never steals window focus',async()=>{
 const h=harness();const r=await h.ctx.runCommand('open',{url:'https://example.com/'});assert.equal(r.active,false);assert.ok(!h.calls.some(c=>c[0]==='window'));
});
test('foreground reused tab becomes active',async()=>{
 const h=harness();const r=await h.ctx.runCommand('open',{url:'https://example.com/',tab_id:1,foreground:true});assert.equal(r.active,true);
});
test('focus selects existing tab without navigating',async()=>{
 const h=harness();await h.ctx.runCommand('focus',{tab_id:1});assert.equal(h.tabs.get(1).active,true);assert.ok(!h.calls.some(c=>c[0]==='create'||c[0]==='update'&&c[2].url));
});
test('focus refuses tabs outside shared group',async()=>{
 const h=harness();h.tabs.get(1).groupId=9;await assert.rejects(h.ctx.runCommand('focus',{tab_id:1}),/tab group/);assert.equal(h.calls.length,0);
});
test('foreground restores minimized window without unmaximizing normal windows',async()=>{
 const h=harness();h.chrome.windows.get=async()=>({state:'minimized'});await h.ctx.runCommand('focus',{tab_id:1});assert.ok(h.calls.some(c=>c[0]==='window'&&c[2].state==='normal'));
});
