import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGame } from '../app/domain.mjs';
import { openingTheory } from '../app/opening-theory.mjs';
import { theoryBadge, theoryMoveHTML, theorySummaryHTML } from '../public/opening-theory.mjs';
import { createApplication } from '../app/server.mjs';

const game=pgn=>normalizeGame({pgn:'[White "tester"]\n[Black "other"]\n\n'+pgn+' *'},'tester');

test('opening reference marks known moves without needing Stockfish or changing game data',()=>{
  const g=game('1. e4 e5 2. Nf3 Nc6 3. Bb5'),before=JSON.stringify(g),theory=openingTheory(g);
  assert.equal(theory.bookMoves,5);assert.equal(theory.lastBookPly,5);assert.equal(theory.firstOutsidePly,null);
  assert.ok(theory.moves.every(m=>m.eco&&m.name));assert.equal(theory.source.lines,3865);
  assert.equal(JSON.stringify(g),before);assert.equal(g.analysis,undefined);
});

test('position lookup recognizes transpositions and ignores move counters but respects castling rights',()=>{
  const a=openingTheory(game('1. d4 d5 2. c4 e6 3. Nf3 Nf6'));
  const b=openingTheory(game('1. Nf3 d5 2. d4 e6 3. c4 Nf6'));
  assert.ok(a.moves[5]);assert.deepEqual(a.moves[5],b.moves[5]);
  const g=game('1. e4');g.moves[0].fen=g.moves[0].fen.replace('0 1','42 80');assert.ok(openingTheory(g).moves[0]);
  g.moves[0].fen=g.moves[0].fen.replace('KQkq','-');assert.equal(openingTheory(g).moves[0],null);
});

test('an unlisted move is not assigned an error or a theoretical novelty',()=>{
  const g=game('1. e4 e5 2. Ke2 Ke7 3. Ke1 Ke8'),t=openingTheory(g);
  assert.ok(t.firstOutsidePly);assert.equal(t.moves.at(-1),null);
  const html=theoryMoveHTML(t,6);assert.match(html,/Вне справочника/);assert.match(html,/не ошибка/);
  assert.equal(g.moves.at(-1).category,undefined);
  const custom={...g,initialFen:g.moves[1].fen};assert.equal(openingTheory(custom).firstOutsidePly,null);
});

test('theory UI preserves separate quality and escapes source text',()=>{
  const g=game('1. e4 e5 2. Nf3'),t=openingTheory(g);
  t.moves[0].name='<img src=x onerror=alert(1)>';
  assert.doesNotMatch(theoryMoveHTML(t,1),/<img/);assert.match(theoryMoveHTML(t,1),/&lt;img/);
  assert.match(theorySummaryHTML(t,g.moves),/data-review-ply="3"/);
  assert.equal(theoryBadge(null),'');assert.match(theoryBadge(t.moves[0]),/Теоретический/);
});

test('game HTTP response includes theory for existing saved games and enforces profile isolation',async()=>{
  const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try{
    app.store.saveProfile('tester');app.store.saveProfile('other');
    const {game:g}=app.store.importGame({pgn:'[White "tester"]\n[Black "other"]\n\n1. e4 e5 *'},'tester');
    const root='http://127.0.0.1:'+app.server.address().port+'/api/games/'+encodeURIComponent(g.id);
    const r=await fetch(root+'?profile=tester'),body=await r.json();
    assert.equal(r.status,200);assert.equal(body.theory.bookMoves,2);assert.equal(body.analysis,null);
    assert.equal((await fetch(root+'?profile=other')).status,404);
    assert.equal(JSON.parse(app.store.db.prepare('SELECT data FROM games WHERE id=?').get(g.id).data).theory,undefined);
  }finally{await app.close();}
});
