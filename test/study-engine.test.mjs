import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { OpeningStudy } from '../public/opening-study.mjs';
import { StudyEngine } from '../public/study-engine.mjs';
import { openingStudy } from '../app/opening-study.mjs';
import { positionRequest } from '../app/position-request.mjs';

const session=()=>new OpeningStudy(openingStudy([],{q:'C60'}).selected,Chess);
const score=n=>({score:{kind:'cp',value:n},lines:[],depth:12});

test('study analysis sends legal complete history, caches it, and does not search during memorization',async()=>{
  const s=session(),calls=[],e=new StudyEngine(async(body)=>{calls.push(body);assert.equal(positionRequest(body).fen,s.board().fen());return score(25);},()=>{});
  try{
    s.go(4);e.position(s,false);assert.equal(calls.length,0);assert.equal(e.pending,false);
    await e.analyze('standard');assert.equal(e.result.score.value,25);assert.equal(calls[0].moves.length,4);assert.equal(calls[0].preset,'standard');
    s.go(5);e.position(s,false);assert.equal(e.result,null);
    s.go(4);e.position(s,true);assert.equal(e.result.score.value,25);assert.equal(e.pending,false);assert.equal(calls.length,1);
  }finally{e.dispose();}
});

test('a late response for a previous position cannot overwrite the current analysis',async()=>{
  const s=session(),pending=[],e=new StudyEngine((body,signal)=>new Promise(resolve=>pending.push({body,signal,resolve})),()=>{});
  try{
    e.position(s,false);const first=e.analyze();s.go(1);e.position(s,false);assert.equal(pending[0].signal.aborted,true);
    const second=e.analyze();pending[1].resolve(score(40));await second;
    pending[0].resolve(score(-90));await first;
    assert.equal(e.result.score.value,40);assert.equal(e.cache.size,1);
  }finally{e.dispose();}
});

test('leaving study cancels both scheduled and active analysis',async()=>{
  const s=session();let calls=0;
  const e=new StudyEngine(async()=>{calls++;return score(10);},()=>{}, {delay:10000});
  e.position(s,true);assert.equal(e.pending,true);e.dispose();assert.equal(e.pending,false);assert.equal(calls,0);
  await e.analyze();assert.equal(calls,0);
});
