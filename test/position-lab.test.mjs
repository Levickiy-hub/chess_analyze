import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { PositionLab } from '../public/position-lab.mjs';
import { openingPosition } from '../app/opening-position.mjs';
import { setupPosition } from '../app/setup-position.mjs';
import { positionRequest } from '../app/position-request.mjs';
import { createApplication } from '../app/server.mjs';
const fen=moves=>{const b=new Chess();for(const m of moves)b.move(m);return b.fen();};

test('position lookup recognizes exact named positions and legal continuations without engine analysis',()=>{
  const start=openingPosition(new Chess().fen());assert.ok(start.continuations.some(m=>m.uci==='e2e4'));assert.ok(start.total>100);
  const spanish=openingPosition(fen(['e4','e5','Nf3','Nc6','Bb5']));assert.ok(spanish.named.some(l=>l.eco==='C60'));
  for(const m of spanish.continuations){const b=new Chess(spanish.fen);assert.equal(b.move(m.uci).san,m.san);}
  assert.equal(openingPosition('4k3/8/8/8/8/8/8/4K3 w - - 0 1').total,0);
});

test('lookup handles transpositions and counters but respects rights and side to move',()=>{
  const a=openingPosition(fen(['d4','d5','c4','e6','Nf3'])),b=openingPosition(fen(['Nf3','d5','d4','e6','c4']));
  assert.ok(a.total>0);assert.deepEqual(a.continuations,b.continuations);
  assert.equal(openingPosition(a.fen.replace(/\d+ \d+$/,'42 80')).total,a.total);
  assert.equal(openingPosition(new Chess().fen().replace('KQkq','-')).total,0);
  assert.equal(openingPosition(new Chess().fen().replace(' w ',' b ')).total,0);
});

test('invalid setup cannot reach Stockfish: kings, turn, castling and en passant are checked',()=>{
  for(const f of ['8/8/8/8/8/8/8/8 w - - 0 1','8/8/8/8/8/8/4k3/4K3 w - - 0 1','4k3/8/8/8/8/8/8/4K3 w - d6 0 1','4k3/8/8/8/8/8/4R3/4K3 w - - 0 1']){
    assert.throws(()=>setupPosition(f));assert.throws(()=>positionRequest({fen:f}));
  }
  assert.throws(()=>setupPosition('4k3/8/8/8/8/8/8/4K3 w K - 0 1'),/рокировки/);
  const ep=fen(['e4','a6','e5','d5']);assert.equal(setupPosition(ep),ep);
  assert.throws(()=>setupPosition(ep.replace(' d6 ',' d3 ')));
});

test('editor supports empty boards, moving either side and explicit rights without requiring legal intermediate setups',()=>{
  const p=new PositionLab(Chess);p.clear();assert.match(p.editorFen(),/^8\/8\/8\/8\/8\/8\/8\/8 /);
  p.place('e1',{color:'w',type:'k'});p.place('e8',{color:'b',type:'k'});p.place('h1',{color:'w',type:'r'});p.rights='K';assert.doesNotThrow(()=>setupPosition(p.editorFen()));
  p.moveEditor('h1','h2');assert.equal(p.rights,'-');p.place('d1',{color:'w',type:'k'});assert.equal(p.pieces.has('e1'),false);
  p.place('h2',null);assert.equal(p.pieces.has('h2'),false);
});

test('position experiments retain history and distinguish alternate branches at the same depth',()=>{
  const p=new PositionLab(Chess);p.start(new Chess().fen());p.play('e2','e4');const a=p.asStudy();
  assert.equal(positionRequest({initialFen:a.line.moves[0].fen,moves:a.line.moves.slice(0,a.ply).map(m=>m.uci),fen:a.board().fen()}).fen,p.current.fen());
  p.current.undo();p.play('d2','d4');const b=p.asStudy();assert.notEqual(a.line.id,b.line.id);
  const before=p.current.fen();assert.equal(p.playLine(['e7e5','a1a8']),false);assert.equal(p.current.fen(),before);
  assert.equal(p.playLine(['d7d5','c2c4']),true);assert.equal(p.current.history().length,3);
});

test('HTTP lookup validates FEN and does not create games or engine jobs',async()=>{
  const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false});app.store.saveProfile('tester');
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try{
    const root='http://127.0.0.1:'+app.server.address().port;
    const call=async fen=>{const r=await fetch(root+'/api/opening-position?profile=tester',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fen})});return {status:r.status,data:await r.json()};};
    assert.equal((await call(new Chess().fen())).status,200);assert.equal((await call('invalid')).status,400);
    assert.equal(app.store.games('tester').length,0);assert.equal(app.store.jobs('tester').length,0);
  }finally{await app.close();}
});
