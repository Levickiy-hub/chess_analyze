import test from 'node:test';
import assert from 'node:assert/strict';
import { UciEngine, analyzeGame } from '../app/engine.mjs';
import { Store } from '../app/database.mjs';
import { normalizeGame } from '../app/domain.mjs';
import { Chess } from 'chess.js';

test('real UCI engine returns score, PV and terminates; 1-ply analysis includes final position',async()=>{
 const engine=new UciEngine({threads:1,hash:16});
 try{const result=await engine.analyze(new Chess().fen(),{depth:4,movetime:100,nodes:5000,multiPV:2});assert.equal(result.score.pov,'white');assert.ok(result.bestMove);assert.ok(result.lines[0].pv.length);assert.match(result.engine,/Stockfish/);
  const controller=new AbortController(),pending=engine.analyze(new Chess().fen(),{depth:50,movetime:5000,nodes:10000000,signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(()=>pending,/остановлен/);assert.equal(engine.child,null);
 }finally{engine.close();}
 assert.equal(engine.child,null);
 const s=new Store(':memory:');s.saveProfile('tester');const game=normalizeGame({pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 *'},'tester');
 try{const a=await analyzeGame(game,s,{hash:16,limits:{depth:4,movetime:80,nodes:5000}});assert.equal(a.positions.length,2);assert.equal(a.moves.length,1);assert.ok(a.moves[0].scoreAfter);assert.equal(a.source,'verified');}finally{s.close();}
},{timeout:30000});

test('50-move claim does not erase an available mate, while 75 moves are automatic',async()=>{
 const engine=new UciEngine({hash:16});
 try{
  const position='7k/8/6K1/8/8/8/P7/1Q6 w - - 100 1';
  const result=await engine.analyze(position,{depth:5,movetime:300,nodes:20000});
  assert.ok(result.bestMove);assert.ok(result.score.kind==='mate'&&result.score.winner==='w'||result.score.kind==='cp'&&result.score.value>0);
  const draw=await engine.analyze(position.replace('100 1','150 1'));assert.equal(draw.score.value,0);assert.equal(draw.depth,0);
 }finally{engine.close();}
},{timeout:30000});
