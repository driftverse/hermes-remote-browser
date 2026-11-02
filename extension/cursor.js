// Injected in the isolated world. Visual feedback only: never handles page input.
function pageCursor(p) {
  const key = '__remoteBrowserCursorState';
  let state = globalThis[key];
  if (p.remove) {
    if (state) { clearTimeout(state.timer); state.host.remove(); delete globalThis[key]; }
    return { cursor: 'removed' };
  }
  let x = p.x, y = p.y;
  if (p.ref !== undefined) {
    const el = document.querySelector(`[data-hermes-ref="${Number(p.ref)}"],[data-penny-ref="${Number(p.ref)}"]`);
    if (!el) return { cursor: 'skipped' };
    if (p.kind === 'click') el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    x = Math.max(12, Math.min(innerWidth - 28, r.x + r.width / 2));
    y = Math.max(12, Math.min(innerHeight - 28, r.y + r.height / 2));
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { cursor: 'skipped' };
  if (!state || !state.host.isConnected) {
    const host = document.createElement('div');
    host.setAttribute('data-remote-browser-cursor', '');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;pointer-events:none!important;z-index:2147483647!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `:host,*{pointer-events:none!important;box-sizing:border-box} .pointer{position:fixed;left:0;top:0;filter:drop-shadow(0 2px 3px #0008);color:#fff;font:12px system-ui;z-index:2147483647}.arrow{width:22px;height:28px;display:block}.label{position:absolute;left:20px;top:22px;white-space:nowrap;background:#7c3aed;color:#fff;border:1px solid #ddd8;padding:3px 7px;border-radius:5px;font:600 12px system-ui}.ring{position:absolute;left:-15px;top:-15px;width:36px;height:36px;border:3px solid #a78bfa;border-radius:50%;opacity:0}.pointer[data-kind=click] .ring{opacity:1;animation:pulse .6s ease-out}.pointer[data-kind=drag] .ring{opacity:1;background:#8b5cf633}.wheel{display:none;position:absolute;left:3px;top:32px;color:#fff;background:#7c3aed;border-radius:4px;padding:1px 4px;font:700 16px system-ui}.pointer[data-kind=wheel] .wheel,.pointer[data-kind=scroll] .wheel{display:block}@keyframes pulse{from{transform:scale(.5);opacity:1}to{transform:scale(1.5);opacity:0}}`;
    const pointer = document.createElement('div');pointer.className = 'pointer';
    // Constant SVG only; no page-supplied HTML is inserted.
    pointer.innerHTML = '<span class="ring"></span><svg class="arrow" viewBox="0 0 24 30"><path d="M2 2 L21 17 L12 18 L8 27 Z" fill="#7c3aed" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg><span class="label"></span><span class="wheel"></span>';
    shadow.append(style, pointer);document.documentElement.append(host);
    state = globalThis[key] = { host, pointer, label: pointer.querySelector('.label'), wheel: pointer.querySelector('.wheel') };
  }
  clearTimeout(state.timer);
  state.pointer.style.transform = `translate(${x}px,${y}px)`;
  state.pointer.dataset.kind = p.kind || 'move';
  state.label.textContent = String(p.label || 'Browser agent').slice(0, 32);
  state.wheel.textContent = p.direction === 'up' || p.direction === 'top' || p.delta_y < 0 ? '↑' : '↓';
  state.timer = setTimeout(() => { state.host.remove(); if (globalThis[key] === state) delete globalThis[key]; }, 2200);
  return { cursor: 'shown', x, y };
}

async function showCursor(tab, p) {
  // Feedback must not make a valid browser action fail on an unscriptable page.
  try { await inPage(tab, pageCursor, [{ ...p, label: GROUP_TITLE }]); } catch (_) {}
}
