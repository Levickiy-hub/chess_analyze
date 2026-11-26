import fs from 'node:fs';
import { Chess } from 'chess.js';

let book;
function openingBook(){return book??=JSON.parse(fs.readFileSync(new URL('../resources/chess-openings/book.json',import.meta.url),'utf8'));}
export function openingTheory(game){
  const reference=openingBook(),moves=game.moves.map(move=>{
    const key=move.fen.split(' ').slice(0,4).join(' ')+'|'+move.uci;
    const match=Object.hasOwn(reference.moves,key)?reference.moves[key]:null;
    return match?{ply:move.ply,...match}:null;
  });
  const known=moves.filter(Boolean),standard=game.initialFen===new Chess().fen();
  const firstOutside=standard?moves.findIndex(m=>!m):-1;
  return {source:reference.source,moves,bookMoves:known.length,lastBookPly:known.at(-1)?.ply??null,firstOutsidePly:firstOutside<0?null:game.moves[firstOutside].ply,standardStart:standard};
}
