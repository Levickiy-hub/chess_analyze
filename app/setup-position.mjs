import { Chess } from 'chess.js';

export function setupPosition(fen){
  if(typeof fen!=='string'||fen.length>200)throw new Error('Введите FEN позиции.');
  let board;try{board=new Chess(fen);}catch{throw new Error('Некорректная FEN: нужны оба короля, допустимые фигуры и шесть полей.');}
  const pieces=board.board().flat().filter(Boolean),kings=pieces.filter(p=>p.type==='k');
  const xy=s=>[s.charCodeAt(0)-97,Number(s[1])];
  if(kings.length!==2)throw new Error('В позиции должны быть два короля.');
  const [a,b]=kings.map(k=>xy(k.square));
  if(Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]))<=1)throw new Error('Короли не могут стоять рядом.');
  const other=board.turn()==='w'?'b':'w',king=kings.find(k=>k.color===other);
  if(board.isAttacked(king.square,board.turn()))throw new Error('Король стороны, которая уже сделала ход, не может оставаться под шахом. Проверьте очередь хода.');
  for(const color of ['w','b']){
    const own=pieces.filter(p=>p.color===color);
    if(own.length>16||own.filter(p=>p.type==='p').length>8)throw new Error('Слишком много фигур или пешек одного цвета.');
  }
  const fields=fen.trim().split(/\s+/),rights=fields[2],ep=fields[3];
  for(const [right,ks,rs,color] of [['K','e1','h1','w'],['Q','e1','a1','w'],['k','e8','h8','b'],['q','e8','a8','b']]){
    if(rights.includes(right)&&!(board.get(ks)?.type==='k'&&board.get(ks)?.color===color&&board.get(rs)?.type==='r'&&board.get(rs)?.color===color))throw new Error('Для указанных прав рокировки король и ладья должны стоять на исходных полях.');
  }
  if(ep!=='-'){
    const white=board.turn()==='w',pawn=board.get(ep[0]+(white?'5':'4'));
    if(ep[1]!== (white?'6':'3')||board.get(ep)||board.get(ep[0]+(white?'7':'2'))||pawn?.type!=='p'||pawn.color!==other)throw new Error('Неверное поле взятия на проходе.');
  }
  return board.fen();
}
