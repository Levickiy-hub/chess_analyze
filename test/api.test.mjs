import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../app/server.mjs';

test('HTTP API: import, filter, isolation, settings validation, security',async()=>{
 const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
 const call=async(route,method='GET',data,headers={})=>{const r=await fetch(url+route,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};};
 try{
  assert.equal((await call('/api/health')).body.ok,true);
  assert.equal((await call('/api/profiles','POST',{username:'tester',sync:false})).status,201);
  const pgn='[White "tester"]\n[Black "opponent"]\n[Result "*"]\n\n1. e4 e5 *';
  assert.equal((await call('/api/import?profile=tester','POST',{pgn})).body.imported,1);
  assert.equal((await call('/api/import?profile=tester','POST',{pgn})).body.imported,0);
  const list=(await call('/api/games?profile=tester')).body;assert.equal(list.total,1);assert.equal(list.games[0].result,'unknown');
  assert.equal((await call('/api/games?profile=tester&color=b')).body.total,0);
  assert.equal((await call('/api/settings','PATCH',{hash:2000})).status,400);
  assert.equal((await call('/api/settings','PATCH',{timezone:'Europe/Moscow',minSample:10})).status,200);
  assert.equal((await call('/api/settings','PATCH',{hash:32},{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/profiles','POST',{username:'another',sync:false})).status,201);
  assert.equal((await call('/api/games/'+encodeURIComponent(list.games[0].id)+'?profile=another')).status,404);
  assert.equal((await call('/api/analytics?profile=tester')).body.summary.unknown,1);
  const puzzle={id:'p1',fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',color:'w',solution:['e2e4','e7e5','g1f3','b8c6'],alternatives:[],motifs:[]};
  app.store.db.prepare('INSERT INTO puzzles(id,game_id,profile,ply,data,due_at) VALUES(?,?,?,?,?,?)').run('p1',list.games[0].id,'tester',1,JSON.stringify(puzzle),new Date().toISOString());
  const puzzles=(await call('/api/puzzles?profile=tester')).body;assert.equal(puzzles.puzzles[0].solution,undefined);
  assert.equal((await call('/api/puzzles/p1/attempt?profile=tester','POST',{moves:['d2d4']})).body.correct,false);
  const first=(await call('/api/puzzles/p1/attempt?profile=tester','POST',{moves:['e2e4']})).body;assert.equal(first.correct,true);assert.equal(first.complete,false);assert.equal(first.reply,'e7e5');
  const final=(await call('/api/puzzles/p1/attempt?profile=tester','POST',{moves:['e2e4','e7e5','g1f3']})).body;assert.equal(final.complete,true);
  assert.equal((await call('/api/puzzles?profile=tester')).body.attempts.correct,1);
  assert.equal((await call('/api/puzzles/p1/attempt?profile=another','POST',{moves:['e2e4']})).status,400);
 }finally{await app.close();}
},{timeout:15000});
