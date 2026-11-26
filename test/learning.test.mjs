import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../app/database.mjs';
import { practiceAction, practiceDashboard } from '../app/practice.mjs';
import { startLearning, learningReport, learningSample, learningCandidates } from '../app/learning.mjs';
import { finishAnalysis } from '../app/domain.mjs';
const now=Date.parse('2026-11-26T12:00:00Z'),day=86400000;
function fixture(){
  const s=new Store(':memory:');s.saveProfile('tester');s.saveProfile('other');
  const {game}=s.importGame({uuid:'lesson',time_class:'rapid',end_time:now/1000-100,pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 Nc6 *'},'tester');
  const p={id:'p',gameId:game.id,ply:1,fen:game.initialFen,color:'w',solution:['e2e4','e7e5'],fullLine:['e2e4','e7e5','g1f3','b8c6'],format:'rapid',focus:'safety',motifs:[]};
  s.db.prepare('INSERT INTO puzzles(id,game_id,profile,ply,data,due_at) VALUES(?,?,?,?,?,?)').run('p',game.id,'tester',1,JSON.stringify(p),new Date(now-1000).toISOString());
  return {s,game};
}
const begin=s=>practiceAction(s,'tester','p','start',{},now).runId;
const solve=(s,runId,time=now)=>practiceAction(s,'tester','p','attempt',{runId,moves:['e2e4']},time);

test('independent practice schedules 1, 2, 4 days; completion is idempotent',()=>{
  const {s}=fixture();try{
    let run=begin(s),r=solve(s,run);assert.equal(r.clean,true);assert.equal(r.interval,1);
    solve(s,run);assert.equal(practiceDashboard(s,'tester',now).attempts.n,1);
    let t=now+day;run=practiceAction(s,'tester','p','start',{},t).runId;r=solve(s,run,t);assert.equal(r.interval,2);
    t+=2*day;run=practiceAction(s,'tester','p','start',{},t).runId;r=solve(s,run,t);assert.equal(r.interval,4);
    assert.equal(practiceDashboard(s,'tester',t).mastered,1);
  }finally{s.close();}
});

test('hints survive reset and reconnect and never count as independent success',()=>{
  const {s}=fixture();try{
    const run=begin(s);practiceAction(s,'tester','p','hint',{runId:run},now);
    practiceAction(s,'tester','p','reset',{runId:run},now);
    assert.equal(begin(s),run);
    const r=solve(s,run);assert.equal(r.clean,false);assert.equal(r.interval,0);assert.equal(Date.parse(r.dueAt),now+600000);
    assert.equal(practiceDashboard(s,'tester',now).attempts.correct,0);
  }finally{s.close();}
});

test('wrong attempts and viewing the solution cause a short repetition; early practice cannot advance it',()=>{
  const {s}=fixture();try{
    let run=begin(s);practiceAction(s,'tester','p','attempt',{runId:run,moves:['d2d4']},now);
    const r=solve(s,run);assert.equal(r.clean,false);
    run=begin(s);const early=solve(s,run);assert.equal(early.early,true);assert.equal(early.interval,0);assert.equal(early.dueAt,r.dueAt);
    run=begin(s);const shown=practiceAction(s,'tester','p','solution',{runId:run},now);assert.equal(shown.clean,false);assert.equal(shown.assisted,true);
    assert.deepEqual(shown.review.solution,['e2e4','e7e5','g1f3','b8c6']);
    assert.deepEqual(practiceDashboard(s,'tester',now+600001).repeatQueue,['p']);
  }finally{s.close();}
});

test('progress is available only for comparable sufficiently large new samples',()=>{
  const {s}=fixture();try{
    const before=[],after=[],analyses=new Map();
    for(let i=0;i<40;i++){
      const g={id:'comparison-'+i,timeClass:'rapid',color:'w',outcome:'win',end:(now+(i<20?-day:day))/1000,endPrecision:'second',moves:Array.from({length:5},()=>({color:'w'}))};
      (i<20?before:after).push(g);
      analyses.set(g.id,{source:'verified',moves:Array.from({length:5},(_,j)=>({ply:1+j*2,color:'w',before:{kind:'cp',value:0},scoreAfter:{kind:'cp',value:i<20&&j===0?-200:0}}))});
    }
    s.games=()=>before;s.analyses=()=>analyses;
    startLearning(s,'tester',{format:'rapid'},now);
    s.games=()=>[...before,...after];const r=learningReport(s,'tester',now+2*day);
    assert.equal(r.ready,true);assert.equal(r.cycle.baseline.errorRate,20);assert.equal(r.progress.errorRate,0);assert.equal(r.change,-20);
  }finally{s.close();}
});

test('queue hides solutions and future tasks; profiles and server-side prefixes are isolated',()=>{
  const {s}=fixture();try{
    const run=begin(s),dashboard=practiceDashboard(s,'tester',now);
    assert.equal(dashboard.puzzles[0].solution,undefined);assert.equal(dashboard.puzzles[0].fullLine,undefined);assert.deepEqual(dashboard.queue,['p']);
    assert.throws(()=>practiceAction(s,'other','p','hint',{runId:run},now),/не найдена/);
    assert.throws(()=>practiceAction(s,'tester','p','attempt',{runId:run,moves:['e2e4','e7e5','g1f3']},now),/следующий ход/);
    solve(s,run);assert.deepEqual(practiceDashboard(s,'tester',now).queue,[]);
  }finally{s.close();}
});

test('learning freezes baseline, excludes old imports, and requires enough new games for conclusions',()=>{
  const {s,game}=fixture();try{
    const cp=v=>({kind:'cp',value:v,pov:'white'}),positions=game.moves.map(()=>({score:cp(0),depth:12,lines:[]}));positions.push({score:cp(0),depth:12,lines:[]});
    positions[1].score=cp(-200);s.putAnalysis(game.id,finishAnalysis(game,positions,{source:'verified',preset:'quick'}));
    const cycle=startLearning(s,'tester',{format:'rapid'},now);assert.equal(cycle.baseline.errors,1);
    assert.equal(startLearning(s,'tester',{format:'blitz'},now).id,cycle.id);
    s.importGame({uuid:'imported-old',time_class:'rapid',end_time:now/1000-10,pgn:'[White "tester"]\n[Black "opponent"]\n\n1. d4 d5 *'},'tester');
    let r=learningReport(s,'tester',now);assert.equal(r.progress.games,0);assert.equal(r.ready,false);
    const {game:newGame}=s.importGame({uuid:'new',time_class:'rapid',end_time:now/1000+10,pgn:'[White "tester"]\n[Black "opponent"]\n\n1. d4 d5 *'},'tester');
    r=learningReport(s,'tester',now+100000);assert.equal(r.progress.games,1);assert.equal(r.progress.analysed,0);assert.equal(r.change,null);assert.deepEqual(r.cycle.baseline,cycle.baseline);
    assert.equal(learningReport(s,'other',now).cycle,null);assert.equal(r.baselineReady,false);
    assert.throws(()=>startLearning(s,'tester',{restart:'yes'},now),/параметр/);
    const next=startLearning(s,'tester',{restart:true,format:'rapid'},now+day);assert.notEqual(next.id,cycle.id);assert.equal(s.db.prepare('SELECT count(*) n FROM learning_cycles').get().n,2);
    assert.equal(learningCandidates(s,'tester',cycle)[0]?.game.id,undefined); // Existing puzzle is not duplicated.
  }finally{s.close();}
});

test('balanced position denominator excludes bounds, decided games and opponents',()=>{
  const g={id:'g',color:'w',moves:[{color:'w'},{color:'b'},{color:'w'},{color:'w'}],outcome:'loss'};
  const m=(value,loss,color='w')=>({color,before:{kind:'cp',value},scoreAfter:{kind:'cp',value:value-loss},isBest:false});
  const moves=[m(0,200),m(700,500),m(0,200,'b'),{...m(0,200),before:{kind:'cp',value:0,bound:'upperbound'}}];
  const r=learningSample([g],new Map([['g',{source:'verified',moves}]]));assert.equal(r.evaluated,1);assert.equal(r.errors,1);
});
