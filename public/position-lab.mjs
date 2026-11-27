import { bindBoardDrag, cancelBoardDrag } from './board-drag.mjs';
import { StudyEngine } from './study-engine.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const glyphs={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'}};

export function positionHistoryHTML(personal){
  if(!personal)return '';
  const number=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(v);
  return `<div class="position-frequency"><p><strong>В ваших партиях: ${number(personal.games)} из ${number(personal.totalGames)}${personal.percent===null?'':' ('+number(personal.percent)+'%)'}</strong><br><span class="subtle">Всего появлений: ${number(personal.occurrences)} · вся загруженная история профиля</span></p>${personal.matches.length?`<details><summary>Посмотреть партии${personal.games>20?' · последние 20':''}</summary>${personal.matches.map(g=>`<p>${esc(g.opponent)} <small class="subtle">${esc(g.format)}${Number.isFinite(g.date)?' · '+new Date(g.date*1000).toLocaleDateString('ru-RU'):''}</small><br>${g.plies.map(ply=>`<a href="#game/${encodeURIComponent(g.gameId)}/${ply}">${ply?'Полуход '+ply:'Начало партии'}</a>`).join(' · ')}</p>`).join('')}</details>`:''}</div>`;
}

export class PositionLab {
  constructor(Chess,fen){this.Chess=Chess;this.orientation='w';this.tool='move';this.editFen(fen??new Chess().fen());}
  editFen(fen){
    const b=new this.Chess(fen),f=fen.trim().split(/\s+/);this.pieces=new Map(b.board().flat().filter(Boolean).map(p=>[p.square,{type:p.type,color:p.color}]));
    this.turn=f[1];this.rights=f[2];this.ep=f[3];this.half=f[4]??'0';this.full=f[5]??'1';this.editing=true;this.selected=null;
  }
  editorFen(){
    const rows=[];for(let rank=8;rank>=1;rank--){let text='',empty=0;for(const file of 'abcdefgh'){const p=this.pieces.get(file+rank);if(!p){empty++;continue;}if(empty){text+=empty;empty=0;}text+=p.color==='w'?p.type.toUpperCase():p.type;}if(empty)text+=empty;rows.push(text);}
    return `${rows.join('/')} ${this.turn} ${this.rights||'-'} ${this.ep||'-'} ${this.half} ${this.full}`;
  }
  clear(){this.pieces.clear();this.rights='-';this.ep='-';this.half='0';this.full='1';this.selected=null;}
  place(square,piece){
    if(!/^[a-h][1-8]$/.test(square))return;
    if(piece&&(!['w','b'].includes(piece.color)||!/^[kqrbnp]$/.test(piece.type)))return;
    if(piece?.type==='k')for(const [s,p] of this.pieces)if(p.color===piece.color&&p.type==='k')this.pieces.delete(s);
    if(piece)this.pieces.set(square,{...piece});else this.pieces.delete(square);
    for(const [right,king,rook,color] of [['K','e1','h1','w'],['Q','e1','a1','w'],['k','e8','h8','b'],['q','e8','a8','b']])if(this.pieces.get(king)?.type!=='k'||this.pieces.get(king)?.color!==color||this.pieces.get(rook)?.type!=='r'||this.pieces.get(rook)?.color!==color)this.rights=this.rights.replace(right,'');
    this.rights||='-';
  }
  moveEditor(from,to){if(from===to)return;const piece=this.pieces.get(from);if(!piece)return;this.pieces.delete(from);this.place(to,piece);this.selected=null;}
  start(fen){this.current=new this.Chess(fen);this.root=this.current.fen();this.editing=false;this.selected=null;}
  play(from,to,promotion='q'){try{this.current.move({from,to,promotion});this.selected=null;return true;}catch{return false;}}
  playLine(moves){
    const b=new this.Chess(this.root);try{for(const m of [...this.current.history({verbose:true}).map(m=>m.lan),...moves])b.move(m);}catch{return false;}
    this.current=b;this.selected=null;return true;
  }
  asStudy(){
    const history=this.current.history({verbose:true}),moves=history.map(m=>({fen:m.before,uci:m.lan}));
    return {line:{id:this.root+'|'+history.map(m=>m.lan).join(' '),moves:moves.length?moves:[{fen:this.root}]},ply:history.length,board:()=>this.current};
  }
}

export function mountPositionLab(host,{Chess,api,drawBoard,showPromotion,evalText,pvSAN,initialFen,onOpenLine,onSave,preset='standard'}){
  const lab=new PositionLab(Chess,initialFen);let alive=true,serial=0,lookupController=null,book=null,error='',loading=false;
  const engine=new StudyEngine((body,signal)=>api('/api/position',{method:'POST',body,signal}),()=>paintResults());
  const $=s=>host.querySelector(s);
  function stop(){serial++;lookupController?.abort();lookupController=null;engine.cancel();loading=false;}
  function editorBoard(){
    const files=lab.orientation==='w'?'abcdefgh':'hgfedcba',ranks=lab.orientation==='w'?[8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8];
    return `<div class="board-wrap"><div class="board setup-board" role="group" aria-label="Редактор позиции">${ranks.flatMap((rank,row)=>[...files].map((file,col)=>{
      const square=file+rank,p=lab.pieces.get(square);
      return `<button type="button" data-square="${square}" class="square ${((file.charCodeAt(0)-97)+rank)%2===1?'dark':''} ${p?.color==='w'?'white-piece':'black-piece'} ${lab.selected===square?'selected':''}" aria-label="${square}${p?' '+p.color+' '+p.type:''}">${p?`<span class="piece-token" aria-hidden="true">${glyphs[p.color][p.type]}</span>`:''}${col===0||row===7?`<small>${col===0?rank:''}${row===7?file:''}</small>`:''}</button>`;
    })).join('')}</div></div>`;
  }
  function paint(){
    if(!alive)return;
    const fen=lab.editing?lab.editorFen():lab.current.fen();
    host.innerHTML=`<section class="card"><div class="review"><div><div id="lab-board"></div><div class="board-controls"><button class="button secondary small" data-lab="flip">Повернуть</button>${lab.editing?'<button class="button secondary small" data-lab="initial">Начальная</button><button class="button ghost small" data-lab="clear">Очистить</button>':'<button class="button secondary small" data-lab="undo">Назад</button><button class="button ghost small" data-lab="reset">К заданной позиции</button><button class="button secondary small" data-lab="edit">Редактировать</button>'}</div></div><div>${lab.editing?`<h2>Задайте позицию</h2><div class="setup-palette">${['w','b'].map(color=>Object.entries(glyphs[color]).map(([type,glyph])=>`<button type="button" class="palette-piece ${color==='w'?'white-piece':'black-piece'} ${lab.tool===color+type?'active':''}" data-palette="${color+type}" aria-label="${color} ${type}" title="${color} ${type}"><span class="piece-token" aria-hidden="true">${glyph}</span></button>`).join('')).join('')}<button type="button" class="button secondary small" data-palette="move">Перемещать</button><button type="button" class="button ghost small" data-palette="erase">Удалять</button></div><p class="subtle">Выберите фигуру и поле или перетащите фигуру из набора. На доске фигуры можно переставлять свободно.</p><div class="section-actions"><label>Ход <select id="lab-turn"><option value="w" ${lab.turn==='w'?'selected':''}>Белых</option><option value="b" ${lab.turn==='b'?'selected':''}>Чёрных</option></select></label><label>На проходе <select id="lab-ep">${['-',...'abcdefgh'.split('').map(f=>f+'3'),...'abcdefgh'.split('').map(f=>f+'6')].map(s=>`<option ${lab.ep===s?'selected':''}>${s}</option>`).join('')}</select></label></div><div class="section-actions"><span>Рокировка:</span>${[['K','Белые O-O'],['Q','Белые O-O-O'],['k','Чёрные O-O'],['q','Чёрные O-O-O']].map(([r,label])=>`<label><input type="checkbox" data-right="${r}" ${lab.rights.includes(r)?'checked':''}> ${label}</label>`).join('')}</div><button class="button" data-lab="apply">Найти дебют и рассчитать</button>`:'<h2>Продолжения из позиции</h2><p class="subtle">Играйте за обе стороны. После каждого хода обновляются справочник и оценка Stockfish.</p>'}<form id="lab-fen-form" class="form-grid"><label class="field">FEN<textarea id="lab-fen" rows="3" spellcheck="false">${esc(fen)}</textarea></label><button class="button secondary small">Найти по FEN</button></form><p id="lab-error" class="method" role="status"></p><details><summary>Об истории позиции</summary><p class="method">Очередь хода и права должны быть указаны правильно. История до заданной позиции неизвестна; повторения до неё не учитываются. Справочник не охватывает все дебюты.</p></details></div></div></section><br><div class="grid two"><section class="card" id="lab-book"></section><section class="card study-engine" id="lab-engine"></section></div>`;
    if(lab.editing)$('#lab-board').innerHTML=editorBoard();
    else {
      const legal=lab.selected?lab.current.moves({square:lab.selected,verbose:true}).map(m=>m.to):[];
      drawBoard($('#lab-board'),fen,{orientation:lab.orientation,interactive:!lab.current.isCheckmate()&&!lab.current.isStalemate()&&!lab.current.isInsufficientMaterial(),selected:lab.selected,legal,onMove:play,onSquare:square=>{
        if(lab.selected&&lab.current.moves({square:lab.selected,verbose:true}).some(m=>m.to===square)){play(lab.selected,square);return;}
        lab.selected=lab.current.get(square)?.color===lab.current.turn()?square:null;paint();
      }});
    }
    $('#lab-fen-form').onsubmit=e=>{e.preventDefault();e.stopPropagation();void apply($('#lab-fen').value.trim());};
    if(lab.editing){$('#lab-turn').onchange=e=>{stop();lab.turn=e.target.value;lab.ep='-';paint();};$('#lab-ep').onchange=e=>{stop();lab.ep=e.target.value;paint();};}
    bindBoardDrag(host,{interactive:lab.editing,fen:lab.editorFen(),dragSource:source=>{
      const tool=source.dataset.palette;
      if(tool&&/^[wb][kqrbnp]$/.test(tool))return {from:'palette:'+tool};
      return lab.pieces.has(source.dataset.square)?{from:source.dataset.square}:null;
    },onMove:(from,to)=>{
      stop();if(from.startsWith('palette:')){const tool=from.slice(8);lab.place(to,{color:tool[0],type:tool[1]});}else lab.moveEditor(from,to);paint();
    }});
    paintResults();
  }
  function paintResults(){
    if(!alive||!$('#lab-book'))return;
    $('#lab-error').textContent=error;
    $('#lab-book').innerHTML='<h3>Дебютный справочник</h3>'+(lab.editing?'<p class="subtle">Задайте позицию и нажмите «Найти дебют и рассчитать».</p>':loading?'<p role="status">Ищем позицию…</p>':book?`${positionHistoryHTML(book.personal)}${book.named.length?`<p><strong>${book.named.map(n=>esc(n.eco+' · '+n.name)).join('<br>')}</strong></p>`:book.total?'<p>Позиция встречается внутри справочных линий.</p>':'<p>Позиция не найдена в локальном справочнике.</p>'}${book.continuations.length?'<h4>Справочные продолжения</h4>'+book.continuations.map(m=>`<p><button class="button secondary small" data-book-move="${m.uci}">${esc(m.san)}</button> <small>${esc(m.eco+' · '+m.name)}</small></p>`).join(''):''}${book.lines.length?`<details><summary>Линии через позицию · ${book.total}</summary>${book.lines.map(l=>`<p><a href="#theory" data-lab-line="${l.id}">${esc(l.eco+' · '+l.name)}</a></p>`).join('')}</details>`:''}<small class="subtle">Lichess chess-openings · CC0</small>`:'');
    const r=lab.editing?null:engine.result;
    $('#lab-engine').innerHTML=`<div class="card-head"><h3>Stockfish</h3><button class="button secondary small" data-lab="engine" ${lab.editing||engine.busy?'disabled':''}>${r?'Уточнить оценку':'Рассчитать'}</button>${engine.busy||engine.pending?'<button class="button ghost small" data-lab="stop">Стоп</button>':''}</div><p class="subtle" role="status">${engine.busy?'Считаем…':engine.pending?'Готовится расчёт…':engine.error?esc(engine.error):r?'С точки зрения белых · глубина '+r.depth:lab.editing?'Расчёт после применения позиции.':''}</p>${!lab.editing&&r?`<strong class="study-eval">${evalText(r.score)}</strong>${(r.lines??[]).filter(l=>l.pv?.length).slice(0,3).map((l,i)=>`<div class="variation"><strong>${i+1}. ${evalText(l.score)}</strong><p>${esc(pvSAN(lab.current.fen(),l.pv))}</p><div class="section-actions"><button class="button secondary small" data-engine-first="${i}">Сыграть ход</button><button class="button ghost small" data-engine-line="${i}">Проиграть линию</button></div></div>`).join('')}`:''}`;
  }
  async function lookup(){
    stop();const token=serial;book=null;error='';loading=true;lookupController=new AbortController();engine.key=null;engine.position(lab.asStudy(),true);paint();
    try{const data=await api('/api/opening-position',{method:'POST',body:{fen:lab.current.fen()},signal:lookupController.signal});if(alive&&serial===token){book=data;loading=false;paintResults();}}
    catch(e){if(alive&&serial===token&&e.name!=='AbortError'){error=e.message;loading=false;paintResults();}}
  }
  async function apply(fen){
    stop();const token=serial;error='';lookupController=new AbortController();
    try{const data=await api('/api/opening-position',{method:'POST',body:{fen},signal:lookupController.signal});if(!alive||serial!==token)return;lab.start(data.fen);onSave?.(data.fen);book=data;engine.key=null;engine.position(lab.asStudy(),true);paint();}
    catch(e){if(alive&&serial===token&&e.name!=='AbortError'){error=e.message;paintResults();}}
  }
  function play(from,to){
    const options=lab.current.moves({square:from,verbose:true}).filter(m=>m.to===to);if(!options.length)return;
    const fen=lab.current.fen(),commit=piece=>{if(!alive||lab.editing||lab.current.fen()!==fen)return;if(lab.play(from,to,piece))void lookup();};
    if(options.some(m=>m.promotion))showPromotion(commit);else commit('q');
  }
  host.onclick=e=>{
    const target=e.target.closest('button,a');if(!target)return;e.stopPropagation();
    if(target.dataset.labLine!==undefined){e.preventDefault();onOpenLine?.(target.dataset.labLine);return;}
    if(target.dataset.palette){lab.tool=target.dataset.palette;lab.selected=null;paint();return;}
    const square=target.dataset.square;
    if(lab.editing&&square){stop();if(lab.tool==='move'){if(lab.selected)lab.moveEditor(lab.selected,square);else if(lab.pieces.has(square))lab.selected=square;}else lab.place(square,lab.tool==='erase'?null:{color:lab.tool[0],type:lab.tool[1]});paint();return;}
    if(target.dataset.bookMove){const u=target.dataset.bookMove;if(lab.play(u.slice(0,2),u.slice(2,4),u[4]))void lookup();return;}
    if(target.dataset.engineFirst!==undefined||target.dataset.engineLine!==undefined){const i=Number(target.dataset.engineFirst??target.dataset.engineLine),pv=engine.result?.lines[i]?.pv;if(pv&&lab.playLine(target.dataset.engineFirst!==undefined?pv.slice(0,1):pv))void lookup();return;}
    const action=target.dataset.lab;
    if(action==='apply'){void apply(lab.editorFen());return;}
    if(action==='engine'){void engine.analyze(preset);return;}
    if(action==='stop'){engine.cancel();paintResults();return;}
    if(action==='flip'){lab.orientation=lab.orientation==='w'?'b':'w';paint();return;}
    if(action==='undo'){if(lab.current.undo())void lookup();return;}
    if(action==='reset'){lab.start(lab.root);void lookup();return;}
    if(action==='edit'){stop();book=null;engine.result=null;lab.editFen(lab.current.fen());paint();return;}
    if(action==='initial'){stop();lab.editFen(new Chess().fen());paint();return;}
    if(action==='clear'){stop();lab.clear();paint();return;}
  };
  host.onchange=e=>{if(!e.target.dataset.right)return;stop();lab.rights=[...host.querySelectorAll('[data-right]:checked')].map(c=>c.dataset.right).join('')||'-';paint();};
  paint();
  return {model:lab,dispose(){alive=false;cancelBoardDrag(host);stop();engine.dispose();}};
}
