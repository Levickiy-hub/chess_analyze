import { Chess } from 'chess.js';

export function positionRequest(input){
  if(typeof input.fen!=='string')throw new Error('Нужна FEN позиции.');
  const target=new Chess(input.fen);
  if(input.initialFen===undefined){if(input.moves!==undefined)throw new Error('Для истории ходов нужна начальная FEN.');return {fen:target.fen()};}
  if(typeof input.initialFen!=='string'||!Array.isArray(input.moves)||input.moves.length>2048)throw new Error('Некорректная история позиции.');
  const board=new Chess(input.initialFen),initialFen=board.fen();
  for(const uci of input.moves){if(typeof uci!=='string'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))throw new Error('Некорректный ход в истории позиции.');board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});}
  if(board.fen()!==target.fen())throw new Error('История ходов не соответствует позиции.');
  return {fen:target.fen(),initialFen,moves:input.moves};
}
