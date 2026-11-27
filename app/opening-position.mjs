import fs from 'node:fs';
import { Chess } from 'chess.js';
import { setupPosition } from './setup-position.mjs';
let reference;
export function openingPosition(fen){
  const normalized=setupPosition(fen),key=normalized.split(' ').slice(0,4).join(' ');
  const book=reference??=JSON.parse(fs.readFileSync(new URL('../resources/chess-openings/book.json',import.meta.url),'utf8'));
  const refs=book.positions?.[key]??[],catalogue=book.catalogue??[];
  const all=refs.map(([id,ply])=>({...catalogue[id],ply}));
  const named=all.filter(l=>l.ply===l.plies);
  const continuations=Object.entries(book.moves).filter(([k])=>k.startsWith(key+'|')).map(([k,name])=>{
    const uci=k.slice(key.length+1),board=new Chess(normalized),move=board.move(uci);
    return {uci,san:move.san,...name};
  });
  return {fen:normalized,named:named.slice(0,20),lines:all.filter(l=>l.ply<l.plies).slice(0,30),total:all.length,continuations,source:book.source};
}
