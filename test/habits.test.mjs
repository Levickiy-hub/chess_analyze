import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { Store } from '../app/database.mjs';
import { habitEntries, habitMeasure, habitReport, startHabit, habitTrainingReport, habitCandidates } from '../app/habits.mjs';
import { JobRunner } from '../app/jobs.mjs';
import { habitCardsHTML, habitTrainingHTML } from '../public/habit-view.mjs';
import { createApplication } from '../app/server.mjs';
import { UciEngine } from '../app/engine.mjs';

function fixture(store,id,{end=1782864000,error=true,event='Live Chess',preset='quick',format='rapid',base=0,after=-500}={}){
  const board=new Chess();for(const m of ['e4','e5','Qh5','Nc6','Qxe5+','Nxe5'])board.move(m);
  for(let i=0;i<10;i++)for(const m of ['Nf3','Nf6','Ng1','Ng8'])board.move(m);
  const pgn=board.pgn().replace('[Event "?"]',`[Event "${event}"]`).replace('[White "?"]','[White "tester"]').replace('[Black "?"]','[Black "opponent"]');
  const result=store.importGame({uuid:id,pgn,time_class:format,time_control:'600',end_time:end},'tester');if(result.error)throw Error(result.error);
  const game=result.game,score=v=>({kind:'cp',value:v,pov:'white'});
  const moves=game.moves.map(m=>({...m,clock:100,spent:2,before:score(base),scoreAfter:score(base),isBest:false,accuracy:100,category:'good',loss:0}));
  if(error)Object.assign(moves[4],{scoreAfter:score(after),accuracy:30,category:'blunder',loss:base-after});
  const positions=Array.from({length:moves.length+1},()=>null);
  for(const m of moves){const b=new Chess(m.after),pv=[];for(let n=0;n<3;n++){const legal=b.moves({verbose:true}),next=legal.find(x=>!x.captured)??legal[0];if(!next)break;pv.push(b.move(next.lan).lan);}positions[m.ply]={score:score(0),bestMove:pv[0],lines:[{depth:12,score:score(0),pv}]};}
  positions[5]={score:score(after),bestMove:'c6e5',lines:[{depth:12,score:score(after),pv:['c6e5','g1f3','e5c6']}]};
  const analysis={version:'fixture',source:'verified',preset,createdAt:new Date().toISOString(),positions,moves};store.putAnalysis(game.id,analysis);return {game,analysis};
}
function setup(count=5){const s=new Store(':memory:');s.saveProfile('tester');for(let i=0;i<count;i++)fixture(s,'old-'+i);return s;}
const selection=s=>({games:s.games('tester'),analyses:s.analyses('tester'),settings:s.settings()});

test('habit conclusions require multiple games and separate format, preset and verified provenance',()=>{
  const s=setup();try{
    const report=habitReport(selection(s));assert.ok(report.priorities.some(p=>p.kind==='capture'));assert.ok(report.priorities.some(p=>p.kind==='time'));
    assert.equal(new Set(report.priorities.map(p=>p.kind)).size,report.priorities.length);
    for(const p of report.priorities){assert.equal(p.affectedGames,5);assert.equal(p.examples.length,3);assert.ok(p.evaluated>=30);assert.ok(p.hypothesis);assert.ok(p.action);}
    assert.equal(habitReport({...selection(s),games:s.games('tester').slice(0,2)}).priorities.length,0);
    assert.equal(habitReport(selection(s),{category:'blunder'}).priorities.length,0);
    const cloned=new Map([...s.analyses('tester')].map(([id,a])=>[id,{...a,source:'recovered'}]));assert.equal(habitReport({...selection(s),analyses:cloned}).priorities.length,0);
    assert.equal(habitEntries(s.games('tester'),s.analyses('tester'),'time','blitz','quick').length,0);
  }finally{s.close();}
});

test('thematic generation creates verified tasks, links them, and keeps the learning cycle untouched',async()=>{
  const s=setup(),old=UciEngine.prototype.analyze;
  UciEngine.prototype.analyze=async()=>({engine:'test',bestMove:'d2d4',score:{kind:'cp',value:50},lines:[{depth:18,score:{kind:'cp',value:50},pv:['d2d4','e5d4']},{depth:18,score:{kind:'cp',value:-100},pv:['h5f3','g8f6']}]});
  try{
    const p=habitReport(selection(s)).priorities.find(p=>p.kind==='time'),t=startHabit(s,'tester',p.key,{},1790000000000);
    const runner=new JobRunner(s);runner.schedule=()=>{};const job=runner.enqueuePuzzles('tester',{mode:'habit',trainingId:t.id});
    await runner.puzzles(job,new AbortController().signal);assert.equal(job.data.created,5);
    const tasks=s.db.prepare('SELECT data FROM puzzles').all().map(r=>JSON.parse(r.data));
    assert.equal(tasks.length,5);assert.ok(tasks.every(p=>p.pool==='random'&&p.focus==='habit-time'&&p.cycleId===null&&p.solution.length===2));
    assert.equal(s.db.prepare('SELECT count(*) n FROM learning_cycles').get().n,0);
    assert.equal(habitTrainingReport(s,'tester')[0].puzzles.length,5);
  }finally{UciEngine.prototype.analyze=old;s.close();}
});

test('capture proof rejects recapture compensation, illegal lines and bounded scores; bots are excluded',()=>{
  const s=setup(1);try{
    const g=s.games('tester')[0],a=s.analyses('tester').get(g.id);
    assert.equal(habitEntries([g],new Map([[g.id,a]]),'capture','rapid','quick').filter(e=>e.matches).length,1);
    for(const pv of [['c6e5','g1f3','a1a8'],['c6e5']]){
      const altered={...a,positions:a.positions.map((p,i)=>i===5?{...p,lines:[{...p.lines[0],pv}]}:p)};
      assert.equal(habitEntries([g],new Map([[g.id,altered]]),'capture','rapid','quick').filter(e=>e.matches).length,0);
    }
    const bounded={...a,moves:a.moves.map(m=>({...m,before:{...m.before,bound:'lowerbound'}}))};assert.equal(habitEntries([g],new Map([[g.id,bounded]]),'time','rapid','quick').length,0);
    assert.equal(habitEntries([{...g,opponentType:'bot'}],new Map([[g.id,a]]),'time','rapid','quick').length,0);
    const noCapture={...a,positions:a.positions.map((p,i)=>i===5?{...p,lines:[{...p.lines[0],pv:['g8f6','g1f3','f6g8']}]}:p)};assert.equal(habitEntries([g],new Map([[g.id,noCapture]]),'capture','rapid','quick').filter(e=>e.matches).length,0);
    const b=new Chess('4k3/8/8/8/8/2r5/2R5/4K3 w - - 0 1'),fen=b.fen();b.move('Kd1');
    const m={ply:1,color:'w',fen,after:b.fen(),before:{kind:'cp',value:0},scoreAfter:{kind:'cp',value:-200},isBest:false};
    const compensation={source:'verified',preset:'quick',moves:[m],positions:[null,{bestMove:'c3c2',lines:[{depth:12,pv:['c3c2','d1c2','e8e7']}]}]};
    assert.equal(habitEntries([{...g,id:'compensation'}],new Map([['compensation',compensation]]),'capture','rapid','quick').filter(e=>e.matches).length,0);
  }finally{s.close();}
});

test('time uses pre-move clock with increment; conversion requires three consecutive own advantages',()=>{
  const s=setup(1);try{
    const g=s.games('tester')[0],a=s.analyses('tester').get(g.id),timed={...a,moves:a.moves.map(m=>({...m,clock:55,spent:10}))};
    assert.equal(habitEntries([{...g,timeControl:'600+10'}],new Map([[g.id,timed]]),'time','rapid','quick').length,0);
    const t2={...timed,moves:timed.moves.map(m=>({...m}))};assert.ok(habitEntries([g],new Map([[g.id,t2]]),'time','rapid','quick').length>0);
    const ahead={...a,moves:a.moves.map(m=>({...m,before:{kind:'cp',value:300},scoreAfter:{kind:'cp',value:m.ply===5?100:300}}))};
    assert.equal(habitEntries([g],new Map([[g.id,ahead]]),'conversion','rapid','quick').filter(e=>e.matches).length,1);
    const gap={...ahead,moves:ahead.moves.filter(m=>m.ply!==3)};assert.equal(habitEntries([g],new Map([[g.id,gap]]),'conversion','rapid','quick').filter(e=>e.matches).length,0);
  }finally{s.close();}
});

test('training freezes baseline, reuses matching puzzles, isolates profiles and measures only future games',async()=>{
  const s=setup(),now=1790000000000;try{
    s.saveProfile('other');const p=habitReport(selection(s)).priorities.find(p=>p.kind==='time');
    const t=startHabit(s,'tester',p.key,{},now);assert.equal(startHabit(s,'tester',p.key,{},now+1000).id,t.id);
    const candidates=habitCandidates(s,'tester',t.id);assert.equal(candidates.length,5);assert.throws(()=>habitCandidates(s,'other',t.id),/не найдена/);
    for(const e of candidates){const task={id:'p-'+e.game.id,gameId:e.game.id,ply:e.move.ply,fen:e.move.fen,color:e.move.color,solution:['d2d4','e5d4'],fullLine:['d2d4','e5d4'],format:'rapid',pool:'cycle',focus:'safety'};s.db.prepare('INSERT INTO puzzles(id,game_id,profile,ply,data,due_at) VALUES(?,?,?,?,?,?)').run(task.id,e.game.id,'tester',e.move.ply,JSON.stringify(task),new Date(now).toISOString());}
    const runner=new JobRunner(s);runner.schedule=()=>{};const job=runner.enqueuePuzzles('tester',{mode:'habit',trainingId:t.id});assert.equal(runner.enqueuePuzzles('tester',{mode:'habit',trainingId:t.id}).id,job.id);
    await runner.puzzles(job,new AbortController().signal);assert.equal(job.data.created,5);
    const first=habitTrainingReport(s,'tester',now+1000)[0];assert.equal(first.puzzles.length,5);assert.ok(first.puzzles.every(p=>!p.solution&&!p.fullLine&&!p.mistake));assert.equal(first.progress.games,0);
    for(let i=0;i<5;i++)fixture(s,'future-'+i,{end:now/1000+100+i,error:false});
    fixture(s,'imported-late',{end:1782864000,error:false});fixture(s,'different-preset',{end:now/1000+120,error:true,preset:'deep'});
    const report=habitTrainingReport(s,'tester',now+200000)[0];assert.deepEqual(report.baseline,first.baseline);assert.equal(report.progress.games,5);assert.equal(report.progress.errors,0);assert.equal(report.ready,true);assert.ok(report.change<0);
    assert.equal(habitCandidates(s,'tester',t.id).length,0);assert.equal(habitTrainingReport(s,'other').length,0);
    assert.match(habitCardsHTML({priorities:[{...p,title:'<img src=x>'}]}),/&lt;img/);assert.match(habitTrainingHTML([report]),/data-habit-session/);
  }finally{s.close();}
});

test('habit HTTP flow recomputes conclusions, keeps task solutions private and rejects cross-profile refill',async()=>{
  const app=createApplication({filename:':memory:',bootstrap:false,runJobs:false});
  app.store.saveProfile('tester');app.store.saveProfile('other');for(let i=0;i<5;i++)fixture(app.store,'api-'+i);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const root='http://127.0.0.1:'+app.server.address().port;
  const call=async(path,profile='tester',body)=>{const r=await fetch(root+path+'?profile='+profile,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  try{
    const insights=(await call('/api/habits')).data;assert.ok(insights.priorities.length);
    const started=await call('/api/habits/start','tester',{key:insights.priorities[0].key,filter:{}});assert.equal(started.status,201);
    assert.equal((await call('/api/habits/'+started.data.trainingId+'/refill','other',{})).status,400);
    assert.equal((await call('/api/habits/start','tester',{key:'fabricated',filter:{}})).status,400);
    assert.equal((await call('/api/habits/training','other')).data.length,0);
    const g=app.store.games('tester')[0],review=(await call('/api/games/'+encodeURIComponent(g.id))).data;assert.ok(review.habitTags.some(t=>t.ply===5));
  }finally{await app.close();}
});
