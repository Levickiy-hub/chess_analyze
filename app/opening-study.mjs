import fs from 'node:fs';
import { Chess } from 'chess.js';
import { openingTheory } from './opening-theory.mjs';

let catalogue;
function lines(){
  if(catalogue)return catalogue;
  catalogue=[];
  for(const file of ['a.tsv','b.tsv','c.tsv','d.tsv','e.tsv']){
    for(const row of fs.readFileSync(new URL('../resources/chess-openings/'+file,import.meta.url),'utf8').trim().split(/\r?\n/).slice(1)){
      const [eco,name,pgn]=row.split('\t');catalogue.push({id:String(catalogue.length),eco,name,pgn});
    }
  }
  return catalogue;
}

export function studyLine(id){
  const line=lines().find(l=>l.id===id);if(!line)throw new Error('Вариант не найден.');
  const board=new Chess();board.loadPgn(line.pgn);
  return {...line,moves:board.history({verbose:true}).map(m=>({uci:m.lan,san:m.san,fen:m.before,after:m.after,color:m.color,from:m.from,to:m.to,piece:m.piece,captured:m.captured??null,fullmove:Number(m.before.split(' ')[5])})),finalFen:board.fen()};
}

export function openingStudy(games,{q='',line=null,order='personal'}={}){
  const search=String(q).trim().toLocaleLowerCase().slice(0,120),ecoCounts=new Map();
  const annotated=games.map(game=>({game,theory:openingTheory(game)}));
  for(const {game:g,theory} of annotated){const prefix=theory.firstOutsidePly?theory.moves.slice(0,theory.firstOutsidePly-1):theory.moves;const eco=g.eco??prefix.filter(Boolean).at(-1)?.eco;if(eco)ecoCounts.set(eco,(ecoCounts.get(eco)??0)+1);}
  const found=lines().filter(l=>!search||(l.eco+' '+l.name+' '+l.pgn).toLocaleLowerCase().includes(search));
  const depth=l=>l.pgn.trim().split(/\s+/).filter(s=>!/^\d+\.(\.\.)?$/.test(s)).length;
  const sorted=found.slice().sort((a,b)=>order==='deep'?depth(b)-depth(a)||a.eco.localeCompare(b.eco):(ecoCounts.get(b.eco)??0)-(ecoCounts.get(a.eco)??0)||a.eco.localeCompare(b.eco));
  const selected=line===null?sorted[0]:lines().find(l=>l.id===line);
  if(line!==null&&!selected)throw new Error('Вариант не найден.');
  // Keep all matching choices accessible by searching, without rendering thousands of options.
  const choices=sorted.slice(0,100).map(l=>({id:l.id,eco:l.eco,name:l.name,plies:depth(l),games:ecoCounts.get(l.eco)??0}));
  if(selected&&!choices.some(l=>l.id===selected.id))choices.unshift({id:selected.id,eco:selected.eco,name:selected.name,plies:depth(selected),games:ecoCounts.get(selected.eco)??0});
  const selectedIndex=selected?sorted.findIndex(l=>l.id===selected.id):-1;
  const nextLineId=selectedIndex>=0?sorted[selectedIndex+1]?.id??null:null;
  const deviations=[];
  for(const {game:g,theory} of annotated){
    const ply=theory.firstOutsidePly;
    if(ply&&ply<=24){const m=g.moves[ply-1];deviations.push({gameId:g.id,opponent:g.opponent,ply,san:m.san,fullmove:m.fullmove,color:m.color,playerColor:g.color,opening:g.opening,date:g.end});}
  }
  return {total:found.length,choices,nextLineId,selected:selected?studyLine(selected.id):null,deviations:deviations.sort((a,b)=>a.ply-b.ply||(b.date??0)-(a.date??0)).slice(0,8),games:games.length};
}
