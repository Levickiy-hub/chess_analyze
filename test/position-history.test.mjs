import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { positionHistory } from '../app/position-history.mjs';
import { positionHistoryHTML } from '../public/position-lab.mjs';
import { createApplication } from '../app/server.mjs';

function game(id,moves){
  const b=new Chess(),initialFen=b.fen(),history=[];
  for(const san of moves){const m=b.move(san);history.push({ply:history.length+1,after:m.after});}
  return {id,initialFen,moves:history,opponent:id,timeClass:'rapid',end:100};
}

test('personal frequency distinguishes games from repeated appearances and includes both endpoints',()=>{
  const games=[game('a',['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']),game('b',['e4'])];
  const start=positionHistory(games,new Chess().fen());assert.equal(start.games,2);assert.equal(start.occurrences,4);assert.equal(start.percent,100);
  assert.deepEqual(start.matches.find(m=>m.gameId==='a').plies,[0,4,8]);
  const last=positionHistory(games,games[1].moves[0].after);assert.equal(last.games,1);assert.equal(last.occurrences,1);assert.equal(last.percent,50);assert.deepEqual(last.matches[0].plies,[1]);
});

test('frequency recognizes transpositions and ignores counters but respects side and castling rights',()=>{
  const a=game('a',['Nf3','d5','d4','e6','c4']),b=game('b',['d4','d5','c4','e6','Nf3']);
  const fen=a.moves.at(-1).after;
  assert.equal(positionHistory([a,b],fen.replace(/\d+ \d+$/,'12 55')).games,2);
  assert.equal(positionHistory([a,b],fen.replace('KQkq','-')).games,0);
  assert.equal(positionHistory([a,b],fen.replace(' b ',' w ')).games,0);
});

test('empty history is explicit and match preview is bounded without truncating counts',()=>{
  const empty=positionHistory([],new Chess().fen());assert.equal(empty.games,0);assert.equal(empty.percent,null);
  const games=Array.from({length:25},(_,i)=>({...game(String(i),[]),end:i}));
  const all=positionHistory(games,new Chess().fen());assert.equal(all.games,25);assert.equal(all.occurrences,25);assert.equal(all.matches.length,20);assert.equal(all.matches[0].gameId,'24');
  all.matches[0].opponent='<img src=x>';const html=positionHistoryHTML(all);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/#game\/24\/0/);
});

test('lookup counts only games belonging to the selected profile',async()=>{
  const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false});app.store.saveProfile('tester');app.store.saveProfile('other');
  for(const profile of ['tester','other'])app.store.importGame({uuid:profile,pgn:`[White "${profile}"]\n[Black "opponent"]\n\n1. Nf3 Nf6 2. Ng1 Ng8 *`},profile);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try{
    const root='http://127.0.0.1:'+app.server.address().port;
    for(const profile of ['tester','other']){
      const r=await fetch(root+'/api/opening-position?profile='+profile,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fen:new Chess().fen()})}),data=await r.json();
      assert.equal(r.status,200);assert.equal(data.personal.games,1);assert.equal(data.personal.occurrences,2);assert.ok(data.personal.matches.every(m=>m.gameId.startsWith(profile+':')));
    }
  }finally{await app.close();}
});
