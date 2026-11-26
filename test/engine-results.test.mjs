import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { UciEngine, analyzeGame, analyzeClassifiablePosition } from '../app/engine.mjs';
import { normalizeGame } from '../app/domain.mjs';

async function search(messages,{multiPV=1,fen=new Chess().fen()}={}){
  const engine=new UciEngine();engine.init=async()=>{};engine.send=()=>{};
  try{
    const pending=engine.analyze(fen,{multiPV});
    await new Promise(resolve=>setImmediate(resolve));
    for(const message of messages)engine.line(message);
    return await pending;
  }finally{engine.close();}
}

test('unfinished deeper bounds do not replace a completed exact score or its PV',async()=>{
  const r=await search(['info depth 10 score cp 30 nodes 1000 pv e2e4 e7e5','info depth 11 score cp 70 lowerbound nodes 2000 pv e2e4 c7c5','bestmove e2e4']);
  assert.equal(r.score.value,30);assert.equal(r.score.bound,undefined);
  assert.equal(r.depth,10);assert.deepEqual(r.lines[0].pv,['e2e4','e7e5']);
  assert.equal(r.resultVersion,'uci-exact-v1');
});

test('an exact score for another root move is never attributed to bestmove',async()=>{
  const r=await search(['info depth 10 score cp 30 pv e2e4 e7e5','info depth 11 score cp 70 lowerbound pv d2d4 d7d5','bestmove d2d4']);
  assert.equal(r.bestMove,'d2d4');assert.equal(r.score.value,70);
  assert.equal(r.score.bound,'lowerbound');assert.equal(r.depth,11);
});

test('MultiPV returns a completed iteration with distinct moves and matching depths',async()=>{
  const r=await search([
    'info depth 9 multipv 1 score cp 30 pv e2e4 e7e5',
    'info depth 9 multipv 2 score cp 20 pv d2d4 d7d5',
    'info depth 9 multipv 3 score cp 10 pv g1f3 d7d5',
    'info depth 10 multipv 1 score cp 40 pv e2e4 c7c5',
    'info depth 10 multipv 2 score cp 35 upperbound pv d2d4 g8f6',
    'bestmove e2e4',
  ],{multiPV:3});
  assert.equal(r.depth,9);assert.equal(r.lines.length,3);
  assert.ok(r.lines.every(l=>l.depth===9&&!l.score.bound));
  assert.equal(new Set(r.lines.map(l=>l.pv[0])).size,3);
});

test('bounds without a completed score stay bounds with correct black POV',async()=>{
  const board=new Chess();board.move('e4');
  const r=await search(['info depth 8 score cp 25 lowerbound pv e7e5','bestmove e7e5'],{fen:board.fen()});
  assert.equal(r.score.value,-25);assert.equal(r.score.bound,'upperbound');
});

test('an interrupted MultiPV rank change cannot duplicate a root move',async()=>{
  const r=await search([
    'info depth 9 multipv 1 score cp 30 pv e2e4',
    'info depth 9 multipv 2 score cp 20 pv d2d4',
    'info depth 9 multipv 1 score cp 40 pv d2d4',
    'bestmove d2d4',
  ],{multiPV:2});
  assert.equal(r.score.value,40);assert.equal(r.lines.length,1);
});

test('reanalysis refreshes bounded cache entries even from the corrected parser',async()=>{
  const game=normalizeGame({pgn:'[White "tester"]\n[Black "other"]\n\n1. e4 *'},'tester');
  const oldInit=UciEngine.prototype.init,oldSend=UciEngine.prototype.send;
  let calls=0,writes=0,reads=0;
  UciEngine.prototype.init=async()=>{};
  UciEngine.prototype.send=function(command){if(command.startsWith('go ')){
    calls++;this.line('info depth 8 score cp 20 pv e2e4');this.line('bestmove e2e4');
  }};
  const store={cache:()=>++reads===1?{resultVersion:'uci-exact-v1',score:{kind:'cp',value:70},lines:[{bound:'lowerbound'}]}:{score:{kind:'cp',value:20},depth:8,bestMove:'e7e5',lines:[]},cachePut:()=>writes++};
  try{const r=await analyzeGame(game,store);assert.equal(calls,1);assert.equal(writes,1);assert.equal(reads,2);assert.equal(r.moves[0].category,'best');}
  finally{UciEngine.prototype.init=oldInit;UciEngine.prototype.send=oldSend;}
});

test('a bestmove with only a bound gets a targeted deeper search with full history',async()=>{
  const calls=[],options={depth:12,movetime:300,nodes:30000,initialFen:new Chess().fen(),moves:['e2e4'],signal:new AbortController().signal};
  const engine={analyze:async(fen,limits)=>{calls.push(limits);return calls.length===1?{score:{kind:'cp',value:70,bound:'lowerbound'},lines:[]}:{score:{kind:'cp',value:50},lines:[]};}};
  const result=await analyzeClassifiablePosition(engine,'test-fen',options);
  assert.equal(result.scoreAttempts,2);assert.equal(result.score.bound,undefined);assert.equal(calls.length,2);
  assert.ok(calls[1].movetime>=1500);assert.ok(calls[1].depth>=18);
  assert.equal(calls[1].initialFen,options.initialFen);assert.equal(calls[1].moves,options.moves);assert.equal(calls[1].signal,options.signal);
});

test('exact and terminal scores need no retry; exhausted bounds stay unknown',async()=>{
  let calls=0;const engine={analyze:async()=>{calls++;return {score:{kind:'cp',value:0},lines:[]};}};
  const exact=await analyzeClassifiablePosition(engine,'test',{});assert.equal(calls,1);assert.equal(exact.scoreAttempts,1);
  const bounded={analyze:async()=>({score:{kind:'cp',value:70,bound:'upperbound'},lines:[]})};
  const result=await analyzeClassifiablePosition(bounded,'test',{});assert.equal(result.scoreAttempts,3);assert.equal(result.score.bound,'upperbound');assert.match(result.warning,/граница/);
});

test('cancellation between score attempts prevents another search',async()=>{
  const controller=new AbortController();let calls=0;
  const engine={analyze:async()=>{calls++;controller.abort();return {score:{kind:'cp',value:70,bound:'lowerbound'}};}};
  await assert.rejects(analyzeClassifiablePosition(engine,'test',{signal:controller.signal}),/остановлен/);assert.equal(calls,1);
});
