import { habitCandidates, HABITS } from './habits.mjs';
import { currentCycle, learningCandidates } from './learning.mjs';
import { analyzeGame, UciEngine, PRESETS } from './engine.mjs';
import { ChessCom } from './chesscom.mjs';
import { randomUUID } from 'node:crypto';
import { puzzleCandidate, randomPuzzleCandidates } from './training.mjs';

export class JobRunner {
  constructor(store){this.store=store;this.client=new ChessCom(store);this.active=null;this.stopping=false;this.timer=null;
    store.db.prepare("UPDATE jobs SET status='queued' WHERE status='running'").run();
  }
  start(){this.schedule();}
  schedule(){if(!this.stopping){clearTimeout(this.timer);this.timer=setTimeout(()=>this.tick(),100);this.timer.unref();}}
  enqueueAnalysis(profile,ids,{preset='quick',mode='pending'}={}){
    if(!PRESETS[preset])throw new Error('Неизвестный режим анализа.');
    const occupied=new Set(this.store.jobs(profile).filter(j=>['queued','running','paused'].includes(j.status)&&j.kind==='analysis').flatMap(j=>j.data.gameIds.slice(j.data.index??0)));
    const selected=[...new Set(ids)].filter(id=>{const g=this.store.game(id,false);if(!g||g.profile!==profile)return false;if(occupied.has(id))return false;const a=this.store.analysis(id,true);return mode==='all'||!a||a.preset!==preset;});
    if(!selected.length)throw new Error('Нет новых партий для анализа в выбранном режиме; уже поставленные задания не дублируются.');
    const job=this.store.createJob('analysis',profile,{gameIds:selected,index:0,total:selected.length,done:0,failed:0,errors:[],preset,ply:0,plies:0});this.schedule();return job;
  }
  enqueueSync(profile){const existing=this.store.jobs(profile).find(j=>j.kind==='sync'&&['running','queued','paused'].includes(j.status));if(existing)return existing;const job=this.store.createJob('sync',profile,{archiveIndex:0,total:0,done:0,imported:0,failed:0,errors:[]});this.schedule();return job;}
  enqueuePuzzles(profile,{mode='cycle',trainingId=null}={}){
    if(!['cycle','random','habit'].includes(mode))throw new Error('Неизвестный режим задач.');
    if(mode==='habit'&&!this.store.db.prepare('SELECT id FROM habit_training WHERE id=? AND profile=?').get(trainingId,profile))throw new Error('Тренировка не найдена.');
    const training=mode==='habit'?JSON.parse(this.store.db.prepare('SELECT data FROM habit_training WHERE id=? AND profile=?').get(trainingId,profile).data):null;
    const cycle=mode==='cycle'?currentCycle(this.store,profile):null;
    const old=this.store.jobs(profile).find(j=>j.kind==='puzzles'&&['running','queued'].includes(j.status)&&(j.data.mode??'cycle')===mode&&(mode!=='habit'||j.data.trainingId===trainingId)&&j.data.cycleId===(cycle?.id??null));if(old)return old;
    const job=this.store.createJob('puzzles',profile,{done:0,total:0,created:0,failed:0,errors:[],mode,trainingId,cycleId:cycle?.id??null,format:training?.format??cycle?.format??(mode==='random'?null:'rapid'),reason:training?HABITS[training.kind].action:null,focus:training?'habit-'+training.kind:mode==='random'?'random':cycle?.focus??'safety'});this.schedule();return job;
  }
  action(id,action){const job=this.store.job(id);if(!job)throw new Error('Задание не найдено.');
    if(action==='pause'&&['queued','running'].includes(job.status)){this.store.updateJob(id,'paused',job.data);if(this.active?.id===id)this.active.controller.abort();}
    else if(action==='resume'&&['paused','failed','interrupted'].includes(job.status)){this.store.updateJob(id,'queued',job.data);this.schedule();}
    else if(action==='retry'&&['completed','failed'].includes(job.status)&&job.kind==='analysis'){const ids=[...new Set(job.data.errors.map(e=>e.gameId).filter(Boolean))];return this.enqueueAnalysis(job.profile,ids,{preset:job.data.preset,mode:'all'});}
    else if(action==='cancel'&&['queued','running','paused'].includes(job.status)){this.store.updateJob(id,'cancelled',job.data);if(this.active?.id===id)this.active.controller.abort();}
    else throw new Error('Недопустимый переход состояния задания.');return this.store.job(id);
  }
  progress(job){if(this.store.job(job.id)?.status==='running')this.store.updateJob(job.id,'running',job.data);}
  async tick(){
    if(this.stopping||this.active)return;
    const row=this.store.transaction(()=>{const next=this.store.db.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get();if(next)this.store.db.prepare("UPDATE jobs SET status='running' WHERE id=? AND status='queued'").run(next.id);return next;});
    if(!row){this.schedule();return;}
    const job=this.store.job(row.id),controller=new AbortController();this.active={id:job.id,controller};this.store.updateJob(job.id,'running',job.data);
    try{
      if(job.kind==='analysis')await this.analysis(job,controller.signal);
      else if(job.kind==='sync')await this.sync(job,controller.signal);
      else if(job.kind==='puzzles')await this.puzzles(job,controller.signal);
      if(!controller.signal.aborted)this.store.updateJob(job.id,'completed',job.data);
    }catch(error){const current=this.store.job(job.id);if(current.status==='running'){job.data.errors??=[];job.data.errors.push({message:error.message,at:new Date().toISOString()});this.store.updateJob(job.id,this.stopping?'interrupted':'failed',job.data);}}
    finally{this.active=null;this.schedule();}
  }
  async analysis(job,signal){
    for(;job.data.index<job.data.gameIds.length;job.data.index++){
      if(signal.aborted)throw new Error('Анализ остановлен.');const id=job.data.gameIds[job.data.index];
      try{
        const game=this.store.game(id,false);if(!game)throw new Error('Партия не найдена.');job.data.currentGame=id;
        const result=await analyzeGame(game,this.store,{preset:job.data.preset,signal,hash:this.store.settings().hash,onProgress:(ply,total)=>{job.data.ply=ply;job.data.plies=total;this.progress(job);}});
        if(signal.aborted)throw new Error('Анализ остановлен.');this.store.putAnalysis(id,result);job.data.done++;
      }catch(error){if(signal.aborted)throw error;job.data.failed++;job.data.errors.push({gameId:id,message:error.message});}
      // Index is committed with the per-game result. Position cache checkpoints survive an interrupted game.
      const index=job.data.index;job.data.index++;this.progress(job);job.data.index=index;
    }
    const cycle=currentCycle(this.store,job.profile);
    if(cycle&&!signal.aborted){
      const ready=this.store.db.prepare('SELECT data,due_at FROM puzzles WHERE profile=?').all(job.profile).filter(row=>{const p=JSON.parse(row.data);return p.format===cycle.format&&p.focus===cycle.focus&&Date.parse(row.due_at)<=Date.now();}).length;
      if(ready<3)this.enqueuePuzzles(job.profile);
    }
  }
  async sync(job,signal){
    if(!job.data.archives){const details=await this.client.profile(job.profile,signal);this.store.saveProfile(job.profile,{...details,local:false});job.data.archives=await this.client.archives(job.profile,signal);job.data.total=job.data.archives.length;this.progress(job);}
    for(;job.data.archiveIndex<job.data.archives.length;job.data.archiveIndex++){
      const games=await this.client.month(job.data.archives[job.data.archiveIndex],signal);
      for(const raw of games){if(signal.aborted)throw new Error('Синхронизация остановлена.');const r=this.store.importGame(raw,job.profile);if(r.error){job.data.failed++;if(job.data.errors.length<50)job.data.errors.push({message:r.error,url:raw.url});}else if(r.inserted){job.data.imported++;}await new Promise(r=>setImmediate(r));}
      job.data.done=job.data.archiveIndex+1;const index=job.data.archiveIndex;job.data.archiveIndex++;this.progress(job);job.data.archiveIndex=index;
    }
    this.store.db.prepare('UPDATE profiles SET last_sync=? WHERE username=?').run(new Date().toISOString(),job.profile);
    if(this.store.settings().autoAnalyze){const pending=this.store.games(job.profile).filter(g=>!this.store.analysis(g.id,true)).map(g=>g.id);if(pending.length)this.enqueueAnalysis(job.profile,pending,{preset:this.store.settings().preset});}
  }
  async puzzles(job,signal){
    const cycle={id:job.data.cycleId,format:job.data.format??'rapid',focus:job.data.focus??'safety'};
    const habitMode=job.data.mode==='habit',randomMode=job.data.mode==='random'||habitMode,chosen=habitMode?habitCandidates(this.store,job.profile,job.data.trainingId):randomMode?randomPuzzleCandidates(this.store,job.profile):learningCandidates(this.store,job.profile,cycle);job.data.total=chosen.length;job.data.created??=0;
    const engine=new UciEngine({hash:this.store.settings().hash});
    try{for(const {game,move,loss} of chosen){
      if(signal.aborted)throw new Error('Генерация остановлена.');
      if(job.data.created>=5)break;
      if(habitMode){const existing=this.store.db.prepare('SELECT id FROM puzzles WHERE game_id=? AND ply=? AND profile=?').get(game.id,move.ply,job.profile);if(existing){this.store.db.prepare('INSERT OR IGNORE INTO habit_puzzles VALUES(?,?)').run(job.data.trainingId,existing.id);job.data.created++;job.data.done++;this.progress(job);continue;}}
      const result=await engine.analyze(move.fen,{depth:18,movetime:1500,nodes:200000,multiPV:2,initialFen:game.initialFen,moves:game.moves.slice(0,move.ply-1).map(m=>m.uci),signal});
      const candidate=puzzleCandidate(result,move);
      if(candidate){
        const id=randomUUID(),puzzle={id,gameId:game.id,ply:move.ply,fen:move.fen,color:move.color,...candidate,solution:candidate.solution.slice(0,2),fullLine:candidate.solution,playerMoves:1,mode:'critical-move',format:game.timeClass,focus:cycle.focus,pool:randomMode?'random':'cycle',cycleId:cycle.id,mistake:{played:move.san,reply:game.moves[move.ply]?.san??null,loss},reason:job.data.reason??(cycle.focus==='conversion'?'Сохраните перевес: проверьте контригру и сильнейший ответ соперника.':'Перед своим ходом проверьте шахи, взятия и угрозы соперника.'),alternatives:[],motifs:move.motifs,engine:result.engine,createdAt:new Date().toISOString()};
        this.store.db.prepare('INSERT OR IGNORE INTO puzzles(id,game_id,profile,ply,data,due_at) VALUES(?,?,?,?,?,?)').run(id,game.id,job.profile,move.ply,JSON.stringify(puzzle),new Date().toISOString());if(habitMode){const saved=this.store.db.prepare('SELECT id FROM puzzles WHERE game_id=? AND ply=?').get(game.id,move.ply);this.store.db.prepare('INSERT OR IGNORE INTO habit_puzzles VALUES(?,?)').run(job.data.trainingId,saved.id);}job.data.created++;
      }
      job.data.done++;this.progress(job);
    }job.data.total=job.data.done;if(!job.data.created)job.data.note=chosen.length?'Stockfish не подтвердил достаточно однозначного лучшего хода. Такие позиции не выдаются как задачи с единственным ответом.':randomMode?'Подходящих новых позиций пока нет. Загрузите и проанализируйте новые партии, чтобы пополнить случайный набор.':'Подходящих новых позиций пока нет. Проанализируйте новые партии выбранного формата или выберите другое направление.';this.progress(job);}finally{engine.close();}
  }
  async stop(){this.stopping=true;clearTimeout(this.timer);this.active?.controller.abort();for(let i=0;this.active&&i<100;i++)await new Promise(r=>setTimeout(r,50));}
}
