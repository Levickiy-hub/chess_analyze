import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { openingStudy, studyLine } from '../app/opening-study.mjs';
import { OpeningStudy, openingStudyHTML } from '../public/opening-study.mjs';
import { normalizeGame } from '../app/domain.mjs';
import { createApplication } from '../app/server.mjs';

const game=normalizeGame({pgn:'[White "tester"]\n[Black "other"]\n\n1. e4 e5 2. Ke2 Ke7 3. Ke1 Ke8 *'},'tester');

test('next variant follows the full search order beyond the first 100 choices and stops at the end',()=>{
  const first=openingStudy([],{q:'Caro-Kann',order:'deep'});
  assert.ok(first.total>100);assert.equal(first.nextLineId,first.choices[1].id);
  const hundredth=openingStudy([],{q:'Caro-Kann',order:'deep',line:first.choices[99].id});
  assert.ok(hundredth.nextLineId);assert.ok(!first.choices.some(l=>l.id===hundredth.nextLineId));
  const single=openingStudy([],{q:first.selected.pgn,line:first.selected.id});
  const lastId=single.choices.at(-1).id;
  assert.equal(openingStudy([],{q:first.selected.pgn,line:lastId}).nextLineId,null);
});

test('catalogue searches ECO and names, includes legal full lines and sorts by length',()=>{
  const data=openingStudy([game],{q:'C60',order:'deep'});
  assert.ok(data.total>0);assert.ok(data.choices.every(c=>c.eco==='C60'));
  assert.ok(data.choices.every((l,i)=>!i||l.plies<=data.choices[i-1].plies));
  const line=studyLine(data.selected.id),b=new Chess();
  for(const m of line.moves){assert.equal(b.fen(),m.fen);assert.equal(b.move(m.uci).san,m.san);assert.equal(b.fen(),m.after);}
  assert.equal(b.fen(),line.finalFen);
  assert.ok(openingStudy([],{q:'Sicilian'}).total>0);
  assert.equal(openingStudy([],{q:'does-not-exist-123'}).selected,null);
  assert.throws(()=>studyLine('../../file'),/не найден/);
});

test('personal report links actual early deviations and does not classify them as errors',()=>{
  const data=openingStudy([game]);assert.equal(data.games,1);assert.ok(data.deviations.length);
  const d=data.deviations[0];assert.equal(d.san,game.moves[d.ply-1].san);
  assert.equal(d.playerColor,game.color);assert.equal(d.gameId,game.id);
  assert.match(openingStudyHTML(data),/не список ошибок/);
  assert.equal(openingStudy([]).deviations.length,0);
});

test('practice plays opponent moves for either color, counts mistakes and clears hints on success',()=>{
  const line=openingStudy([],{q:'C60'}).selected;
  for(const color of ['w','b']){
    const s=new OpeningStudy(line,Chess,{color,practice:true});
    assert.equal(s.line.moves[s.ply].color,color);
    const expected=line.moves[s.ply],wrong=s.board().moves({verbose:true}).find(m=>m.lan!==expected.uci);
    assert.equal(s.attempt(wrong.from,wrong.to,wrong.promotion),false);assert.equal(s.mistakes,1);
    s.showHint();assert.equal(s.hint,expected.from);assert.equal(s.assisted,true);
    let own=0;
    while(!s.complete){const m=line.moves[s.ply];assert.equal(m.color,color);assert.ok(s.attempt(m.from,m.to,m.uci[4]));own++;assert.equal(s.hint,null);}
    assert.equal(s.correct,own);assert.equal(s.ply,line.moves.length);assert.equal(s.board().fen(),line.finalFen);
    const end=s.ply;s.attempt('a1','a2');assert.equal(s.ply,end);
  }
});

test('browsing clamps position and cannot change memorization progress',()=>{
  const line=openingStudy([],{q:'C60'}).selected,s=new OpeningStudy(line,Chess);
  s.go(999);assert.equal(s.ply,line.moves.length);s.go(-1);assert.equal(s.ply,0);
  assert.equal(s.attempt('e2','e4'),false);
  const practice=new OpeningStudy(line,Chess,{practice:true});practice.go(999);assert.equal(practice.ply,0);
});

test('study HTTP report obeys profile selection and returns only legal named catalogue IDs',async()=>{
  const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try{
    app.store.saveProfile('tester');app.store.saveProfile('other');app.store.importGame({pgn:game.pgn},'tester');
    const root='http://127.0.0.1:'+app.server.address().port+'/api/opening-study';
    const get=async q=>{const r=await fetch(root+'?'+q);return {status:r.status,data:await r.json()};};
    const a=await get('profile=tester&q=C60');assert.equal(a.status,200);assert.equal(a.data.games,1);
    assert.equal((await get('profile=other')).data.deviations.length,0);
    assert.equal((await get('profile=tester&line=bad')).status,400);
    const select=await get('profile=tester&line='+a.data.selected.id);assert.equal(select.data.selected.id,a.data.selected.id);
  }finally{await app.close();}
});
