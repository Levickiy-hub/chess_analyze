const controllers=new WeakMap();
export function cancelBoardDrag(container){controllers.get(container)?.cancel();}

export function dropMoves(Chess,fen,from,to){
  if(from===to||!from||!to)return [];
  return new Chess(fen).moves({square:from,verbose:true}).filter(m=>m.to===to);
}

export function bindBoardDrag(container,options){
  let control=controllers.get(container);
  if(control){control.cancel();control.options=options;return;}
  if(!options.interactive||!options.onMove)return;
  control={options,active:null,suppressUntil:0,cancel:()=>{}};controllers.set(container,control);
  const doc=container.ownerDocument,win=doc.defaultView;
  function destination(event){const cell=doc.elementFromPoint(event.clientX,event.clientY)?.closest('[data-square]');return cell&&container.contains(cell)?cell:null;}
  function cleanup(){
    const s=control.active;if(!s)return;
    control.active=null;s.ghost?.remove();s.source.classList.remove('drag-source');container.classList.remove('is-dragging');
    for(const cell of container.querySelectorAll('.drag-legal,.drag-target'))cell.classList.remove('drag-legal','drag-target');
    if(container.hasPointerCapture?.(s.id))container.releasePointerCapture(s.id);
    doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('keydown',key,true);win.removeEventListener('blur',cancel);
  }
  function cancel(){if(control.active?.dragging)control.suppressUntil=Date.now()+500;cleanup();}
  control.cancel=cancel;
  function key(event){if(event.key==='Escape'){event.preventDefault();cancel();}}
  function move(event){
    const s=control.active;if(!s||event.pointerId!==s.id)return;
    if(!container.isConnected){cancel();return;}
    if(!s.dragging&&Math.hypot(event.clientX-s.x,event.clientY-s.y)<6)return;
    if(!s.dragging){
      s.dragging=true;container.setPointerCapture?.(s.id);s.source.classList.add('drag-source');container.classList.add('is-dragging');
      const rect=s.source.getBoundingClientRect(),style=win.getComputedStyle(s.source),ghost=doc.createElement('span');
      ghost.className='drag-piece';ghost.setAttribute('aria-hidden','true');ghost.textContent=s.source.querySelector('.piece-token')?.textContent??s.source.textContent;
      Object.assign(ghost.style,{width:rect.width+'px',height:rect.height+'px',fontSize:style.fontSize,fontFamily:style.fontFamily,color:style.color,textShadow:style.textShadow});
      doc.body.append(ghost);s.ghost=ghost;s.size=rect.width;
      for(const cell of container.querySelectorAll('[data-square]'))if(s.legal.has(cell.dataset.square))cell.classList.add('drag-legal');
    }
    if(event.cancelable)event.preventDefault();
    s.ghost.style.transform=`translate(${event.clientX-s.size/2}px, ${event.clientY-s.size/2}px)`;
    const target=destination(event);
    for(const cell of container.querySelectorAll('.drag-target'))cell.classList.remove('drag-target');
    if(target&&s.legal.has(target.dataset.square))target.classList.add('drag-target');
  }
  function up(event){
    const s=control.active;if(!s||event.pointerId!==s.id)return;
    const target=s.dragging?destination(event):null,callback=control.options.onMove;
    const to=target?.dataset.square,valid=s.dragging&&s.legal.has(to)&&container.isConnected&&control.options.fen===s.fen;
    if(s.dragging){control.suppressUntil=Date.now()+500;if(event.cancelable)event.preventDefault();}
    cleanup();
    if(valid)callback?.(s.from,to);
  }
  container.addEventListener('pointerdown',event=>{
    control.suppressUntil=0;
    const {interactive,Chess,fen,onMove,dragSource}=control.options;
    if(!interactive||!onMove||control.active||event.button!==0||event.isPrimary===false)return;
    const source=event.target.closest(dragSource?'[data-square],[data-palette]':'[data-square]');if(!source||!container.contains(source))return;
    let from,legal;
    if(dragSource){
      const info=dragSource(source);if(!info)return;from=info.from;
      legal=new Set([...container.querySelectorAll('[data-square]')].map(cell=>cell.dataset.square));
    }else{
      const board=new Chess(fen);from=source.dataset.square;const piece=board.get(from);
      if(!piece||piece.color!==board.turn())return;
      const moves=board.moves({square:from,verbose:true});if(!moves.length)return;
      legal=new Set(moves.map(m=>m.to));
    }
    control.active={id:event.pointerId,source,from,fen,x:event.clientX,y:event.clientY,dragging:false,legal};
    doc.addEventListener('pointermove',move,{capture:true,passive:false});doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('keydown',key,true);win.addEventListener('blur',cancel);
  });
  container.addEventListener('click',event=>{if(event.detail!==0&&Date.now()<control.suppressUntil){control.suppressUntil=0;event.preventDefault();event.stopImmediatePropagation();}},true);
  container.addEventListener('dragstart',event=>event.preventDefault());
}
