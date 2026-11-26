// Chess is injected so the same history/variation logic runs in browser and Node tests.
export class ReviewTree {
  constructor(game,Chess,ply=0){
    this.game=game;this.Chess=Chess;this.nodes=new Map();this.chosen=new Map();this.nextId=1;
    this.nodes.set(0,{id:0,parent:null,fen:game.initialFen,original:true,mainPly:0,children:[]});
    this.main=[0];this.cursor=0;
    const board=new Chess(game.initialFen);
    for(const move of game.moves){const m=board.move({from:move.uci.slice(0,2),to:move.uci.slice(2,4),promotion:move.uci[4]});const node=this.add(this.cursor,m,true,this.main.length);this.cursor=node.id;this.main.push(node.id);}
    this.cursor=this.main[Math.max(0,Math.min(game.moves.length,Number.isFinite(ply)?Math.trunc(ply):0))];
  }
  get current(){return this.nodes.get(this.cursor);}
  add(parent,move,original=false,mainPly=null){
    if(this.nodes.size>=2048)throw new Error('Слишком много ходов в вариантах. Скопируйте нужную линию в PGN.');
    const node={id:this.nextId++,parent,uci:move.lan,san:move.san,from:move.from,to:move.to,color:move.color,fullmove:Number(move.before.split(' ')[5]),fen:move.after,original,mainPly,children:[]};
    this.nodes.set(node.id,node);this.nodes.get(parent).children.push(node.id);return node;
  }
  path(id=this.cursor){if(!this.nodes.has(id))throw new Error('Позиция варианта не найдена.');const result=[];for(let node=this.nodes.get(id);node.parent!==null;node=this.nodes.get(node.parent))result.unshift(node);return result;}
  board(id=this.cursor){const board=new this.Chess(this.game.initialFen);for(const node of this.path(id))board.move({from:node.uci.slice(0,2),to:node.uci.slice(2,4),promotion:node.uci[4]});return board;}
  go(id){if(!this.nodes.has(id))throw new Error('Позиция варианта не найдена.');this.cursor=id;for(const node of this.path())this.chosen.set(node.parent,node.id);return this.current;}
  goMain(ply){return this.go(this.main[Math.max(0,Math.min(this.main.length-1,Number.isFinite(ply)?Math.trunc(ply):0))]);}
  previous(){return this.current.parent===null?this.current:this.go(this.current.parent);}
  next(){const next=this.chosen.get(this.cursor)??this.current.children[0];return next===undefined?this.current:this.go(next);}
  end(){let next;while((next=this.chosen.get(this.cursor)??this.current.children[0])!==undefined)this.go(next);return this.current;}
  origin(id=this.cursor){let node=this.nodes.get(id);while(!node.original)node=this.nodes.get(node.parent);return node;}
  returnToGame(id=this.cursor){const origin=this.origin(id);this.chosen.delete(origin.id);return this.go(origin.id);}
  play(input){
    const board=this.board();if(this.status(board).terminal)throw new Error('Вариант завершён. Вернитесь на предыдущий ход.');
    const move=board.move(typeof input==='string'?{from:input.slice(0,2),to:input.slice(2,4),promotion:input[4]}:input);
    const existing=this.current.children.map(id=>this.nodes.get(id)).find(n=>n.uci===move.lan);
    return this.go(existing?.id??this.add(this.cursor,move).id);
  }
  playLine(line){
    if(!Array.isArray(line)||line.length>32||this.nodes.size+line.length>2048)throw new Error('Слишком длинная линия.');
    const board=this.board();for(const uci of line){if(typeof uci!=='string'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))throw new Error('Некорректный ход варианта.');board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});}
    for(const uci of line){if(this.status().terminal)break;this.play(uci);}return this.current;
  }
  status(board=this.board()){
    if(board.isCheckmate())return {terminal:true,text:'Мат. Вариант завершён.'};
    if(board.isStalemate())return {terminal:true,text:'Пат. Вариант завершён.'};
    if(board.isInsufficientMaterial())return {terminal:true,text:'Ничья: недостаточно материала.'};
    const half=Number(board.fen().split(' ')[4]),key=fen=>fen.split(' ').slice(0,4).join(' '),current=key(board.fen());
    const repetitions=[this.nodes.get(0),...this.path()].filter(n=>key(n.fen)===current).length;
    if(half>=150||repetitions>=5)return {terminal:true,text:'Ничья: '+(half>=150?'правило 75 ходов.':'пятикратное повторение.')};
    if(half>=100||repetitions>=3)return {terminal:false,text:'Доступна заявка на ничью: '+(half>=100?'правило 50 ходов.':'троекратное повторение.')};
    return {terminal:false,text:board.isCheck()?'Шах. Найдите ответ.':board.turn()==='w'?'Ход белых':'Ход чёрных'};
  }
  request(){return {fen:this.current.fen,initialFen:this.game.initialFen,moves:this.path().map(n=>n.uci)};}
  leaves(){return [...this.nodes.values()].filter(n=>!n.original&&!n.children.length);}
  serialize(){return {version:1,lines:this.leaves().map(n=>this.path(n.id).map(x=>x.uci))};}
  restore(data){
    if(data?.version!==1||!Array.isArray(data.lines)||data.lines.length>2048)return;
    const cursor=this.cursor;
    for(const line of data.lines){
      if(!Array.isArray(line)||line.length>2048)continue;
      try{const board=new this.Chess(this.game.initialFen);for(const uci of line){if(typeof uci!=='string'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))throw new Error('Invalid UCI');board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});}}
      catch{continue;}
      try{this.go(0);for(const uci of line)this.play(uci);}catch{continue;}
    }
    this.chosen.clear();this.go(cursor);
  }
  pgn(){const board=this.board();for(const key of ['Site','Date','Round','White','Black','WhiteElo','BlackElo'])if(this.game.headers?.[key])board.setHeader(key,this.game.headers[key]);board.setHeader('Event','Аналитический вариант');board.setHeader('Result',board.isCheckmate()?(board.turn()==='w'?'0-1':'1-0'):this.status(board).terminal?'1/2-1/2':'*');return board.pgn();}
}
