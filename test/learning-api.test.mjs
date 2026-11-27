import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../app/server.mjs';

test('learning HTTP flow isolates profiles, tracks assistance and hides future solutions',async()=>{
  const app=createApplication({filename:':memory:',runJobs:false});
  app.runner.enqueuePuzzles=()=>({id:'preparation-job',status:'queued'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+app.server.address().port;
  const call=async(path,profile='tester',body)=>{const r=await fetch(root+path+'?profile='+profile,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  try{
    app.store.saveProfile('tester');app.store.saveProfile('other');
    const {game}=app.store.importGame({uuid:'learning-http',time_class:'rapid',pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 e5 *'},'tester');
    assert.equal((await call('/api/learning')).data.cycle,null);
    const started=await call('/api/learning/start','tester',{format:'rapid',focus:'safety'});assert.equal(started.status,201);
    assert.equal((await call('/api/learning','other')).data.cycle,null);
    const task={id:'task',gameId:game.id,ply:1,fen:game.initialFen,color:'w',format:'rapid',focus:'safety',solution:['e2e4','e7e5'],fullLine:['e2e4','e7e5','g1f3'],motifs:[]};
    app.store.db.prepare('INSERT INTO puzzles(id,game_id,profile,ply,data,due_at) VALUES(?,?,?,?,?,?)').run('task',game.id,'tester',1,JSON.stringify(task),new Date(Date.now()-1000).toISOString());
    const list=(await call('/api/puzzles')).data;assert.deepEqual(list.queue,['task']);assert.equal(list.puzzles[0].solution,undefined);assert.equal(list.puzzles[0].fullLine,undefined);
    const run=(await call('/api/puzzles/task/start','tester',{})).data.runId;
    assert.equal((await call('/api/puzzles/task/solution','other',{runId:run})).status,400);
    await call('/api/puzzles/task/hint','tester',{runId:run});
    const solved=(await call('/api/puzzles/task/attempt','tester',{runId:run,moves:['e2e4'],reflection:'Проверил ответ e5'})).data;
    assert.equal(solved.complete,true);assert.equal(solved.clean,false);assert.equal(solved.interval,0);
    const after=(await call('/api/puzzles')).data;assert.equal(after.today.completed,1);assert.equal(after.today.clean,0);assert.deepEqual(after.queue,[]);
    await call('/api/puzzles/task/attempt','tester',{runId:run,moves:['e2e4']});
    assert.equal((await call('/api/puzzles')).data.attempts.n,1);
  }finally{await app.close();}
});
