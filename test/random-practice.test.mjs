import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../app/database.mjs';
import { startLearning } from '../app/learning.mjs';
import { practiceAction, practiceDashboard, randomPracticePuzzle } from '../app/practice.mjs';
import { randomPuzzleCandidates } from '../app/training.mjs';
import { JobRunner } from '../app/jobs.mjs';
import { finishAnalysis } from '../app/domain.mjs';
import { learningViewHTML } from '../public/learning-view.mjs';

const now=Date.parse('2026-11-26T12:00:00Z');
function setup(){
  const s=new Store(':memory:');s.saveProfile('tester');s.saveProfile('other');
  const {game}=s.importGame({uuid:'random',time_class:'rapid',pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 Nc6 *'},'tester');
  for(const [i,id] of ['legacy','cycle','free'].entries()){
    const p={id,gameId:game.id,ply:i+1,fen:game.moves[i].fen,color:game.moves[i].color,solution:game.moves.slice(i,i+2).map(m=>m.uci),fullLine:game.moves.slice(i).map(m=>m.uci),format:'rapid',motifs:[],...(id==='cycle'?{focus:'safety',pool:'cycle'}:id==='free'?{focus:'random',pool:'random'}:{})};
    s.db.prepare('INSERT INTO puzzles(id,game_id,profile,ply,data,due_at,interval_days) VALUES(?,?,?,?,?,?,?)').run(id,game.id,'tester',i+1,JSON.stringify(p),new Date(now+86400000).toISOString(),4);
  }
  startLearning(s,'tester',{format:'rapid'},now);return {s,game};
}

test('old and new random tasks are available independent of due date, without disclosing solutions',()=>{
  const {s}=setup();try{
    const data=practiceDashboard(s,'tester',now);assert.equal(data.random.total,3);assert.equal(data.total,1);
    const first=randomPracticePuzzle(s,'tester',[],()=>0).puzzle;assert.ok(first);assert.equal(first.solution,undefined);assert.equal(first.fullLine,undefined);
    const second=randomPracticePuzzle(s,'tester',[first.id],()=>0).puzzle;assert.notEqual(first.id,second.id);
    const next=randomPracticePuzzle(s,'tester',[first.id,second.id],()=>0).puzzle;assert.notEqual(second.id,next.id);
    assert.equal(randomPracticePuzzle(s,'other').puzzle,null);
  }finally{s.close();}
});

test('random mistakes, help and success never change cycle intervals or daily progress',()=>{
  const {s}=setup();try{
    const original=s.db.prepare('SELECT due_at,interval_days FROM puzzles WHERE id=?').get('legacy');
    const run=practiceAction(s,'tester','legacy','start',{mode:'random'},now).runId;
    practiceAction(s,'tester','legacy','attempt',{runId:run,moves:['d2d4']},now);
    practiceAction(s,'tester','legacy','hint',{runId:run},now);
    const result=practiceAction(s,'tester','legacy','attempt',{runId:run,moves:['e2e4']},now);assert.equal(result.mode,'random');assert.equal(result.clean,false);
    assert.deepEqual(s.db.prepare('SELECT due_at,interval_days FROM puzzles WHERE id=?').get('legacy'),original);
    const next=practiceAction(s,'tester','legacy','start',{mode:'random'},now).runId;
    assert.equal(practiceAction(s,'tester','legacy','attempt',{runId:next,moves:['e2e4']},now).clean,true);
    const data=practiceDashboard(s,'tester',now);assert.equal(data.random.attempts,2);assert.equal(data.random.solved,1);assert.equal(data.today.completed,0);assert.equal(data.attempts.n,0);
    assert.deepEqual(s.db.prepare('SELECT due_at,interval_days FROM puzzles WHERE id=?').get('legacy'),original);
    const borrowed=practiceAction(s,'tester','cycle','start',{mode:'random'},now).runId;
    const oldCycle=s.db.prepare('SELECT due_at,interval_days FROM puzzles WHERE id=?').get('cycle');
    practiceAction(s,'tester','cycle','attempt',{runId:borrowed,moves:['e7e5']},now);
    assert.deepEqual(s.db.prepare('SELECT due_at,interval_days FROM puzzles WHERE id=?').get('cycle'),oldCycle);assert.equal(practiceDashboard(s,'tester',now).today.completed,0);
    assert.throws(()=>practiceAction(s,'other','legacy','hint',{runId:run},now),/не найдена/);
  }finally{s.close();}
});

test('generation jobs deduplicate per mode and keep the random pool outside the active cycle',()=>{
  const {s}=setup(),runner=new JobRunner(s);runner.schedule=()=>{};
  try{
    const a=runner.enqueuePuzzles('tester',{mode:'random'}),b=runner.enqueuePuzzles('tester',{mode:'random'}),c=runner.enqueuePuzzles('tester');
    assert.equal(a.id,b.id);assert.notEqual(a.id,c.id);assert.equal(a.data.cycleId,null);assert.equal(a.data.focus,'random');
    assert.throws(()=>runner.enqueuePuzzles('tester',{mode:'bad'}),/режим/);
  }finally{s.close();}
});

test('new random candidates are own verified errors and never duplicate an existing position',()=>{
  const {s}=setup();try{
    const {game}=s.importGame({uuid:'new-random',time_class:'blitz',pgn:'[White "tester"]\n[Black "opponent"]\n\n1. d4 d5 *'},'tester');
    const p=v=>({score:{kind:'cp',value:v},depth:12,bestMove:'e2e4',lines:[]});
    s.putAnalysis(game.id,finishAnalysis(game,[p(0),p(-200),p(-200)],{source:'verified',preset:'quick'}));
    const candidates=randomPuzzleCandidates(s,'tester',()=>0);assert.equal(candidates.length,1);assert.equal(candidates[0].game.id,game.id);assert.equal(candidates[0].move.color,'w');
    assert.equal(randomPuzzleCandidates(s,'other').length,0);
  }finally{s.close();}
});

test('the random practice panel is visible even before a learning cycle is started',()=>{
  const html=learningViewHTML({cycle:null},{random:{total:2,solved:0,puzzles:[]}});
  assert.match(html,/Случайные задачи из моих партий/);assert.match(html,/data-action="random-puzzle"/);assert.match(html,/data-action="random-generate"/);assert.doesNotMatch(html,/Архив других упражнений/);
  assert.match(html,/id="puzzle-workspace"/);
});
