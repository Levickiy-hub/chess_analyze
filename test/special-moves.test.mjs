import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGame, finishAnalysis, upgradeSavedAnalysis } from '../app/domain.mjs';
import { annotateSpecialMoves, sacrificeCandidate } from '../app/special-moves.mjs';
import { Store } from '../app/database.mjs';
import { analytics } from '../app/analytics.mjs';
import { moveQualityData } from '../public/move-quality.mjs';
const cp=value=>({kind:'cp',value,pov:'white'});
const position=(value,pv,lines=[])=>({score:cp(value),depth:12,bestMove:pv[0],lines:[{score:cp(value),depth:12,pv},...lines]});
function fixture(){
  const fen='6k1/5ppp/8/8/8/3B4/8/3Q2K1 w - - 0 1';
  const game=normalizeGame({pgn:`[White "tester"]\n[Black "opponent"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n1. Bxh7+ *`},'tester');game.rating=1200;
  const positions=[position(50,['d3h7'],[{score:cp(0),depth:12,pv:['d1e2']}]),position(40,['g8h7','d1h5','h7g8','h5g4','f7f5','g4g5'])];
  return {game,positions};
}
const analyze=({game,positions},extra={})=>finishAnalysis(game,positions,{source:'verified',...extra});

test('verified sound sacrifice earns !! and retains base quality and replayable proof',()=>{
  const f=fixture(),a=analyze(f),m=a.moves[0];
  assert.equal(m.category,'brilliant');assert.equal(m.baseCategory,'best');
  assert.equal(m.accuracy,100);assert.equal(m.isBest,true);
  assert.equal(m.special.brilliant.materialLoss,2);assert.equal(m.special.brilliant.alternative,0);
  assert.deepEqual(upgradeSavedAnalysis(a,f.game),a);
});

test('a sacrifice needs exact comparable alternatives and a satisfactory resulting position',()=>{
  for(const mutate of [
    f=>{f.positions[0].lines.length=1;},
    f=>{f.positions[0].lines[1].score=cp(200);},
    f=>{f.positions[0].lines[1].score.bound='upperbound';},
    f=>{f.positions[0].lines[1].depth=9;},
    f=>{f.positions[0].lines[1].pv=['d1e5'];},
    f=>{f.positions[0].lines[0].pv=['d1e1'];},
    f=>{f.positions[1].score=cp(-100);},
    f=>{f.positions[1].score.bound='upperbound';},
    f=>{f.positions[1].depth=8;},
  ]){const f=fixture();mutate(f);assert.notEqual(analyze(f).moves[0].category,'brilliant');}
});

test('rating controls material threshold without inventing a rating when missing',()=>{
  const f=fixture();f.game.rating=900;assert.equal(analyze(f).moves[0].category,'brilliant');
  f.game.rating=1800;assert.notEqual(analyze(f).moves[0].category,'brilliant');
  f.game.rating=null;assert.notEqual(analyze(f).moves[0].category,'brilliant');
});

test('short or illegal variations never prove a sacrifice',()=>{
  const f=fixture();f.positions[1].lines[0].pv=['g8h7'];assert.equal(sacrificeCandidate(f.game,f.positions,0),null);
  f.positions[1].lines[0].pv=['g8h7','d1e5','h7g8','e5g4'];assert.equal(sacrificeCandidate(f.game,f.positions,0),null);
});

test('a recapture or equal exchange is not a persistent sacrifice',()=>{
  const game=normalizeGame({pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 *'},'tester');game.rating=900;
  const positions=game.moves.map(()=>position(30,['a2a3']));
  positions[6]=position(30,['b5c6']);positions[7]=position(30,['d7c6','d2d4','e5d4','d1d4']);
  assert.equal(sacrificeCandidate(game,positions,6),null);
});

test('rescue credits using an opponent error, not a jump caused by the player search',()=>{
  const game=normalizeGame({pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 *'},'tester');
  const positions=[position(-200,['e2e4']),position(-250,['e7e5']),position(0,['g1f3']),position(-10,['b8c6'])];
  const a=finishAnalysis(game,positions,{source:'verified'});
  assert.equal(a.moves[2].category,'rescue');assert.equal(a.moves[2].special.rescue.opponentPly,2);
  positions[2].score=cp(-250);
  assert.notEqual(finishAnalysis(game,positions,{source:'verified'}).moves[2].category,'rescue');
});

test('rescue is color symmetric and requires preserving the available chance',()=>{
  const game=normalizeGame({pgn:'[White "opponent"]\n[Black "tester"]\n\n1. e4 e5 *'},'tester');
  const positions=[position(250,['e2e4']),position(0,['e7e5']),position(10,['g1f3'])];
  assert.equal(finishAnalysis(game,positions,{source:'verified'}).moves[1].category,'rescue');
  positions[2].score=cp(150);
  assert.notEqual(finishAnalysis(game,positions,{source:'verified'}).moves[1].category,'rescue');
});

test('historical imports do not receive special marks; missing comparisons remain pending',()=>{
  const f=fixture();assert.notEqual(analyze(f,{source:'recovered'}).moves[0].category,'brilliant');
  f.positions[0].lines.length=1;
  const a=analyze(f);assert.equal(a.moves[0].special.brilliantPending,true);assert.equal(a.specialCoverage.pending,1);
  assert.equal(a.moves[0].category,'best');
});

test('a brilliant rescue has both proofs but is counted once in the category chart',()=>{
  const store=new Store(':memory:');store.saveProfile('tester');
  try{
    const {game}=store.importGame({uuid:'both',pgn:'[White "tester"]\n[Black "opponent"]\n[WhiteElo "1200"]\n[SetUp "1"]\n[FEN "7k/5ppp/8/8/8/3B4/8/4Q1K1 w - - 0 1"]\n\n1. Qd1 Kg8 2. Bxh7+ *'},'tester');
    const f=fixture(),a=finishAnalysis(game,[position(-250,['e1d1']),position(-250,['h8g8']),...f.positions],{source:'verified',preset:'quick'});
    const m=a.moves[2];assert.equal(m.category,'brilliant');assert.ok(m.special.brilliant);assert.ok(m.special.rescue);
    store.putAnalysis(game.id,a);
    const r=analytics(store,'tester');assert.equal(r.specialMoves.brilliant.count,1);assert.equal(r.specialMoves.rescue.count,0);
    assert.equal(r.categories.brilliant,1);assert.equal(r.categories.rescue??0,0);assert.equal(moveQualityData(r).classified,2);
    const filtered=analytics(store,'tester',{category:'brilliant'});assert.equal(filtered.summary.moves,1);
  }finally{store.close();}
});
