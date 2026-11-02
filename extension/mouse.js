// chrome.debugger is used only for scoped browser mouse input, never arbitrary commands.
async function mouseInput(tab, p) {
  if (!['click','move','drag','wheel'].includes(p.kind)) throw new Error('Invalid mouse kind.');
  for (const k of ['x','y',...(p.kind === 'drag' ? ['to_x','to_y'] : [])]) {
    if (!Number.isFinite(p[k]) || p[k] < 0) throw new Error('Coordinates must be finite nonnegative CSS pixels.');
  }
  const button = p.button || 'left', masks = {left:1,right:2,middle:4};
  if (!Object.hasOwn(masks,button)) throw new Error('Invalid mouse button.');
  const dx = p.delta_x ?? 0, dy = p.delta_y ?? 0;
  if (![dx,dy].every(Number.isFinite) || Math.abs(dx)>10000 || Math.abs(dy)>10000) throw new Error('Invalid wheel delta.');
  const target = {tabId:tab.id};
  await chrome.debugger.attach(target,'1.3');
  try {
    const metrics = await chrome.debugger.sendCommand(target,'Runtime.evaluate',{
      expression:'({width:innerWidth,height:innerHeight,device_pixel_ratio:devicePixelRatio})',returnByValue:true});
    const viewport = metrics.result?.value;
    if (!viewport) throw new Error('Could not measure viewport.');
    for (const [x,y] of [[p.x,p.y],...(p.kind==='drag'?[[p.to_x,p.to_y]]:[])]) {
      if (x>=viewport.width || y>=viewport.height) throw new Error('Coordinates outside viewport; use CSS pixels.');
    }
    const send = async(event) => {
      if (!(await local()).armed) throw new Error('Browser control switched off.');
      await targetTab(tab.id);
      await showCursor(tab,{...p,x:event.x,y:event.y});
      // Feedback injection is async: recheck authorization after it as well.
      if (!(await local()).armed) throw new Error('Browser control switched off.');
      await targetTab(tab.id);
      await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',event);
    };
    if(p.kind==='wheel') await send({type:'mouseWheel',x:p.x,y:p.y,deltaX:dx,deltaY:dy});
    else if(p.kind==='move') await send({type:'mouseMoved',x:p.x,y:p.y});
    else {
      if(p.kind==='drag') await send({type:'mouseMoved',x:p.x,y:p.y});
      await send({type:'mousePressed',x:p.x,y:p.y,button,buttons:masks[button],clickCount:1});
      if(p.kind==='drag') for(let i=1;i<=12;i++) {
        await send({type:'mouseMoved',x:p.x+(p.to_x-p.x)*i/12,y:p.y+(p.to_y-p.y)*i/12,button,buttons:masks[button]});
        await sleep(16);
      }
      await send({type:'mouseReleased',x:p.kind==='drag'?p.to_x:p.x,y:p.kind==='drag'?p.to_y:p.y,button,buttons:0,clickCount:1});
    }
    return {mouse:p.kind,viewport,coordinates:'viewport CSS pixels'};
  } finally { await chrome.debugger.detach(target).catch(()=>{}); }
}
