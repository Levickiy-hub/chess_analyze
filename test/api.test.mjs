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
  const initial='4k3/8/8/8/8/8/8/4K3 w - - 0 1',fen='4k3/8/8/8/8/8/8/5K2 b - - 1 1';
  const position=await call('/api/position?profile=tester','POST',{fen,initialFen:initial,moves:['e1f1']});assert.equal(position.status,200);assert.equal(position.body.score.value,0);
  assert.equal((await call('/api/position?profile=tester','POST',{fen,initialFen:initial,moves:[]})).status,400);
  assert.equal((await call('/api/games/'+encodeURIComponent(list.games[0].id)+'?profile=tester')).body.analysis,null);
  const puzzle={id:'p1',fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',color:'w',solution:['e2e4','e7e5','g1f3','b8c6'],alternatives:[],motifs:[]};
  app.store.db.prepare('INSERT INTO puzzles(id,game_id,profile,ply,data,due_at) VALUES(?,?,?,?,?,?)').run('p1',list.games[0].id,'tester',1,JSON.stringify(puzzle),new Date().toISOString());
  const puzzles=(await call('/api/puzzles?profile=tester')).body;assert.equal(puzzles.puzzles[0].solution,undefined);
  const run=(await call('/api/puzzles/p1/start?profile=tester','POST',{})).body.runId;
  assert.equal((await call('/api/puzzles/p1/attempt?profile=tester','POST',{runId:run,moves:['d2d4']})).body.correct,false);
  const first=(await call('/api/puzzles/p1/attempt?profile=tester','POST',{runId:run,moves:['e2e4']})).body;assert.equal(first.correct,true);assert.equal(first.complete,false);assert.equal(first.reply,'e7e5');
  const final=(await call('/api/puzzles/p1/attempt?profile=tester','POST',{runId:run,moves:['e2e4','e7e5','g1f3']})).body;assert.equal(final.complete,true);assert.equal(final.clean,false);
  assert.equal((await call('/api/puzzles?profile=tester')).body.attempts.correct,0);
  const scheduled=app.store.db.prepare('SELECT interval_days,due_at FROM puzzles WHERE id=?').get('p1');
  await call('/api/puzzles/p1/attempt?profile=tester','POST',{runId:run,moves:['e2e4','e7e5','g1f3']});
  assert.deepEqual(app.store.db.prepare('SELECT interval_days,due_at FROM puzzles WHERE id=?').get('p1'),scheduled);
  const repeated=(await call('/api/puzzles?profile=tester')).body;assert.equal(repeated.attempts.solved,0);assert.equal(repeated.attempts.n,1);assert.equal(repeated.total,1);
  const nextRun=(await call('/api/puzzles/p1/start?profile=tester','POST',{})).body.runId;
  assert.equal((await call('/api/puzzles/p1/attempt?profile=tester','POST',{runId:nextRun,moves:['e2e4','e7e5','g1f3']})).status,400);
  assert.equal((await call('/api/puzzles/p1/attempt?profile=another','POST',{runId:nextRun,moves:['e2e4']})).status,400);
  assert.equal((await call('/api/puzzles/p1/hint?profile=another','POST',{runId:nextRun})).status,400);
 }finally{await app.close();}
},{timeout:15000});

test('game header sorts are applied globally before HTTP pagination',async()=>{
 const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false});
 app.store.saveProfile('sort_tester');
 for(let i=0;i<30;i++){
  const pgn='[White "sort_tester"]\n[Black "opponent"]\n\n1. e4 e5 *';
  const {game}=app.store.importGame({uuid:'sort-'+String(i).padStart(2,'0'),pgn,end_time:1000+i,white:{username:'sort_tester',rating:1000-i},black:{username:'opponent'},time_class:'rapid'},'sort_tester');
  if(i<29)app.store.putAnalysis(game.id,{source:'verified',preset:'quick',createdAt:new Date().toISOString(),moves:[{color:'w',accuracy:i},{color:'b',accuracy:100}]});
 }
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 try{
  const query=async extra=>(await fetch(base+'/api/games?profile=sort_tester&limit=10&'+extra,{signal:AbortSignal.timeout(5000)})).json();
  const first=await query('sort=accuracy&direction=desc');assert.equal(first.games[0].accuracy,28);assert.equal(first.sort,'accuracy');
  const second=await query('sort=accuracy&direction=desc&page=2');assert.equal(second.games[0].accuracy,18);
  const third=await query('sort=accuracy&direction=desc&page=3');assert.equal(third.games.at(-1).accuracy,null);
  const asc=await query('sort=rating&direction=asc');assert.equal(asc.games[0].rating,971);
  const latest=await query('sort=date&direction=desc');assert.equal(latest.games[0].end,1029);
 }finally{await app.close();}
});
