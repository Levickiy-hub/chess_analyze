import { randomUUID } from 'node:crypto';
import { nextPuzzleReview } from './training.mjs';
import { currentCycle } from './learning.mjs';

function puzzleRow(store,profile,id){const row=store.db.prepare('SELECT * FROM puzzles WHERE id=? AND profile=?').get(id,profile);if(!row)throw new Error('Задача не найдена.');return row;}
function runRow(store,profile,id,runId){
  const puzzle=puzzleRow(store,profile,id),run=store.db.prepare('SELECT * FROM practice_runs WHERE id=? AND puzzle_id=?').get(runId??'',id);
  if(!run)throw new Error('Сначала откройте упражнение.');return {puzzle,run,data:JSON.parse(run.data),task:JSON.parse(puzzle.data)};
}
function saveRun(store,run,data){store.db.prepare('UPDATE practice_runs SET data=? WHERE id=?').run(JSON.stringify(data),run.id);}
export function startPractice(store,profile,id,now=Date.now(),mode='cycle'){
  if(!['cycle','random'].includes(mode))throw new Error('Неизвестный режим практики.');
  const row=puzzleRow(store,profile,id),existing=store.db.prepare("SELECT * FROM practice_runs WHERE puzzle_id=? AND finished_at IS NULL AND coalesce(json_extract(data,'$.mode'),'cycle')=? ORDER BY started_at DESC LIMIT 1").get(id,mode);
  if(existing)return {runId:existing.id,...JSON.parse(existing.data)};
  const runId=randomUUID(),cycle=currentCycle(store,profile),task=JSON.parse(row.data),matches=cycle&&task.format===cycle.format&&task.focus===cycle.focus,data={mode,moves:[],mistakes:0,assisted:false,cycleId:mode==='cycle'&&matches?cycle.id:null};
  store.db.prepare('INSERT INTO practice_runs VALUES(?,?,?,?,?)').run(runId,row.id,new Date(now).toISOString(),null,JSON.stringify(data));return {runId,...data};
}
function finish(store,entry,{complete,reflection=''},now){
  const {puzzle,run,data,task}=entry;if(run.finished_at)return data.result;
  const clean=complete&&!data.assisted&&!data.mistakes,due=Date.parse(puzzle.due_at),early=Number.isFinite(due)&&due>now;
  const review=data.mode==='random'?{interval:puzzle.interval_days,dueAt:puzzle.due_at}:clean?(early?{interval:puzzle.interval_days,dueAt:puzzle.due_at}:nextPuzzleReview(puzzle.interval_days,puzzle.due_at,now)):{interval:0,dueAt:new Date(now+10*60000).toISOString()};
  data.reflection=typeof reflection==='string'?reflection.slice(0,1000):'';
  const result={mode:data.mode??'cycle',correct:complete,complete:true,clean,early,dueAt:review.dueAt,interval:review.interval,mistakes:data.mistakes,assisted:data.assisted,moves:data.moves,review:{solution:task.fullLine??task.solution,gameId:task.gameId,ply:task.ply,reason:task.reason??'Найдите сильнейший ответ соперника и сравните два продолжения.',mistake:task.mistake??null}};
  data.result=result;
  store.transaction(()=>{
    store.db.prepare('UPDATE practice_runs SET finished_at=?,data=? WHERE id=?').run(new Date(now).toISOString(),JSON.stringify(data),run.id);
    store.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?)').run(randomUUID(),puzzle.id,new Date(now).toISOString(),clean?1:0,JSON.stringify({mode:data.mode??'cycle',runId:run.id,clean,assisted:data.assisted,mistakes:data.mistakes,complete,reflection:data.reflection}));
    if(data.mode!=='random')store.db.prepare('UPDATE puzzles SET due_at=?,interval_days=? WHERE id=?').run(review.dueAt,review.interval,puzzle.id);
  });return result;
}
export function practiceAction(store,profile,id,action,input={},now=Date.now()){
  if(action==='start')return startPractice(store,profile,id,now,input.mode??'cycle');
  const entry=runRow(store,profile,id,input.runId),{puzzle,run,data,task}=entry;
  if(run.finished_at){if(['attempt','solution'].includes(action))return data.result;throw new Error('Упражнение уже завершено.');}
  if(action==='reset'){data.moves=[];saveRun(store,run,data);return {runId:run.id,...data};}
  if(action==='hint'){
    data.assisted=true;saveRun(store,run,data);
    return {from:task.solution[data.moves.length]?.slice(0,2),assisted:true};
  }
  if(action==='solution'){data.assisted=true;return finish(store,entry,{complete:false,reflection:input.reflection},now);}
  if(action!=='attempt')throw new Error('Неизвестное действие упражнения.');
  const moves=input.moves;
  if(!Array.isArray(moves)||moves.length!==data.moves.length+1||moves.length%2!==1||moves.length>task.solution.length||!data.moves.every((m,i)=>moves[i]===m)||moves.some(m=>typeof m!=='string'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)))throw new Error('Отправьте следующий ход текущего упражнения.');
  if(moves.at(-1)!==task.solution[data.moves.length]){
    data.mistakes++;saveRun(store,run,data);
    if(data.mode!=='random')store.db.prepare('UPDATE puzzles SET due_at=?,interval_days=0 WHERE id=?').run(new Date(now+10*60000).toISOString(),puzzle.id);
    return {correct:false,complete:false,mistakes:data.mistakes,assisted:data.assisted};
  }
  const reply=task.solution[moves.length]??null;data.moves=[...moves,...(reply?[reply]:[])];
  if(data.moves.length>=task.solution.length){const result=finish(store,entry,{complete:true,reflection:input.reflection},now);return {...result,reply};}
  saveRun(store,run,data);return {correct:true,complete:false,reply,moves:data.moves};
}
export function practiceDashboard(store,profile,now=Date.now(),randomLimit=100){
  const cycle=currentCycle(store,profile),rows=store.db.prepare('SELECT * FROM puzzles WHERE profile=? ORDER BY due_at,id').all(profile);
  const allTasks=rows.map(row=>{const p=JSON.parse(row.data),game=store.game(row.game_id,false);return {...p,format:p.format??game?.timeClass,dueAt:row.due_at,interval:row.interval_days,playerMoves:Math.ceil(p.solution.length/2)};});
  const matches=p=>p.pool!=='random'&&(!cycle||p.format===cycle.format&&p.focus===cycle.focus),tasks=allTasks.filter(matches),archive=allTasks.filter(p=>!matches(p));
  const active=new Set(store.db.prepare("SELECT r.puzzle_id FROM practice_runs r JOIN puzzles p ON p.id=r.puzzle_id WHERE p.profile=? AND r.finished_at IS NULL AND coalesce(json_extract(r.data,'$.mode'),'cycle')!='random'").all(profile).map(r=>r.puzzle_id));
  const due=tasks.filter(p=>Date.parse(p.dueAt)<=now||active.has(p.id)).sort((a,b)=>Number(active.has(b.id))-Number(active.has(a.id))||Date.parse(a.dueAt)-Date.parse(b.dueAt)),timezone=store.settings().timezone;
  const day=time=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
  const allRuns=store.db.prepare('SELECT r.* FROM practice_runs r JOIN puzzles p ON p.id=r.puzzle_id WHERE p.profile=? AND r.finished_at IS NOT NULL').all(profile).map(r=>({...r,data:JSON.parse(r.data)}));
  const runs=allRuns.filter(r=>(r.data.mode??'cycle')!=='random'&&(!cycle||r.data.cycleId===cycle.id)),randomRuns=allRuns.filter(r=>r.data.mode==='random');
  const today=runs.filter(r=>day(r.finished_at)===day(now)),completedIds=new Set(runs.map(r=>r.puzzle_id));
  const safe=p=>{const {solution,fullLine,alternatives,mistake,...publicData}=p;return publicData;};
  const randomTasks=allTasks;
  return {random:{total:randomTasks.length,puzzles:randomTasks.slice(0,randomLimit).map(safe),attempts:randomRuns.length,solved:new Set(randomRuns.filter(r=>r.data.result?.clean).map(r=>r.puzzle_id)).size},archive:archive.slice(0,100).map(safe),legacyAttempts:store.db.prepare("SELECT count(*) n FROM attempts a JOIN puzzles p ON p.id=a.puzzle_id WHERE p.profile=? AND json_extract(a.data,'$.runId') IS NULL").get(profile).n,total:tasks.length,puzzles:tasks.slice(0,100).map(safe),queue:due.slice(0,3).map(p=>p.id),repeatQueue:due.filter(p=>completedIds.has(p.id)||active.has(p.id)).slice(0,3).map(p=>p.id),due:due.length,new:due.filter(p=>p.interval===0).length,mastered:tasks.filter(p=>p.interval>=4).length,nextDue:tasks.filter(p=>Date.parse(p.dueAt)>now).map(p=>p.dueAt).sort()[0]??null,today:{completed:new Set(today.map(r=>r.puzzle_id)).size,clean:today.filter(r=>r.data.result?.clean).length},attempts:{n:runs.length,correct:runs.filter(r=>r.data.result?.clean).length,solved:new Set(runs.filter(r=>r.data.result?.clean).map(r=>r.puzzle_id)).size}};
}

export function randomPracticePuzzle(store,profile,exclude=[],random=Math.random){
  const dashboard=practiceDashboard(store,profile,Date.now(),Infinity),pool=dashboard.random.puzzles;
  const previous=Array.isArray(exclude)?exclude.filter(id=>typeof id==='string').slice(-100):[];
  const seen=new Set(previous);let available=pool.filter(p=>!seen.has(p.id));
  if(!available.length)available=pool.filter(p=>p.id!==previous.at(-1));
  if(!available.length)available=pool;
  return {total:pool.length,puzzle:available.length?available[Math.floor(random()*available.length)]:null};
}
