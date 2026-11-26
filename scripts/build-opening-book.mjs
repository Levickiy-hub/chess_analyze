import fs from 'node:fs';
import { Chess } from 'chess.js';

const root=new URL('../resources/chess-openings/',import.meta.url),edges=new Map();
let lines=0;
for(const file of ['a.tsv','b.tsv','c.tsv','d.tsv','e.tsv']){
  const rows=fs.readFileSync(new URL(file,root),'utf8').trim().split(/\r?\n/).slice(1);
  for(const row of rows){
    const [eco,name,pgn]=row.split('\t'),board=new Chess();board.loadPgn(pgn);
    const history=board.history({verbose:true});lines++;
    history.forEach((m,i)=>{
      const key=m.before.split(' ').slice(0,4).join(' ')+'|'+m.lan,distance=history.length-i;
      const previous=edges.get(key);
      // Prefer the named line ending closest to this move over a distant subvariation.
      if(!previous||distance<previous.distance)edges.set(key,{eco,name,distance});
    });
  }
}
const source=JSON.parse(fs.readFileSync(new URL('source.json',root),'utf8'));
const result={source:{...source,lines,edges:edges.size},moves:Object.fromEntries([...edges].map(([key,{eco,name}])=>[key,{eco,name}]))};
fs.writeFileSync(new URL('book.json',root),JSON.stringify(result)+'\n');
console.log(`${lines} named lines, ${edges.size} position/move pairs`);
