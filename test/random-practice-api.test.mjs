import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../app/server.mjs';

test('random practice API picks private tasks, preserves schedules and passes refill mode to the queue',async()=>{
  const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false}),modes=[];
  app.runner.enqueuePuzzles=(profile,options={})=>{modes.push(options.mode??'cycle');return {id:'job',profile,mode:options.mode};};
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+app.server.address().port;
  const call=async(path,profile='tester',body)=>{const url=new URL(path,root);url.searchParams.set('profile',profile);const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  try{
    app.store.saveProfile('tester');app.store.saveProfile('other');
    const {game}=app.store.importGame({uuid:'random-http',time_class:'rapid',pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 Nc6 *'},'tester');
    for(let i=0;i<2;i++){
      const task={id:'r'+i,gameId:game.id,ply:i+1,fen:game.moves[i].fen,color:game.moves[i].color,solution:game.moves.slice(i,i+2).map(m=>m.uci),fullLine:game.moves.slice(i).map(m=>m.uci),motifs:[]};
      app.store.db.prepare('INSERT INTO puzzles(id,game_id,profile,ply,data,due_at,interval_days) VALUES(?,?,?,?,?,?,?)').run(task.id,game.id,'tester',i+1,JSON.stringify(task),new Date(Date.now()+86400000).toISOString(),4);
    }
    const first=(await call('/api/puzzles/random')).data;assert.equal(first.total,2);assert.equal(first.puzzle.solution,undefined);assert.equal(first.puzzle.fullLine,undefined);
    const second=(await call('/api/puzzles/random?exclude='+first.puzzle.id)).data;assert.notEqual(second.puzzle.id,first.puzzle.id);
    assert.equal((await call('/api/puzzles/random','other')).data.puzzle,null);
    const original=app.store.db.prepare('SELECT due_at,interval_days FROM puzzles WHERE id=?').get('r0');
    const run=(await call('/api/puzzles/r0/start','tester',{mode:'random'})).data;
    assert.equal(run.mode,'random');await call('/api/puzzles/r0/solution','tester',{runId:run.runId});
    assert.deepEqual(app.store.db.prepare('SELECT due_at,interval_days FROM puzzles WHERE id=?').get('r0'),original);
    assert.equal((await call('/api/puzzles')).data.random.attempts,1);
    await call('/api/jobs','tester',{kind:'puzzles',mode:'random'});assert.deepEqual(modes,['random']);
  }finally{await app.close();}
});
