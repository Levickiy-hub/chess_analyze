import { analyzeGame, UciEngine, PRESETS } from './engine.mjs';
import { ChessCom } from './chesscom.mjs';
import { randomUUID } from 'node:crypto';
import { puzzleCandidate } from './training.mjs';

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
  enqueuePuzzles(profile){const old=this.store.jobs(profile).find(j=>j.kind==='puzzles'&&['running','queued'].includes(j.status));if(old)return old;const job=this.store.createJob('puzzles',profile,{done:0,total:10,failed:0,errors:[]});this.schedule();return job;}
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
    const analyses=this.store.analyses(job.profile),candidates=[];
    for(const game of this.store.games(job.profile)){
      const analysis=analyses.get(game.id);if(!analysis)continue;
      for(const move of analysis.moves)if(move.color===game.color&&['mistake','blunder'].includes(move.category)&&!this.store.db.prepare('SELECT id FROM puzzles WHERE game_id=? AND ply=?').get(game.id,move.ply))candidates.push({game,move});
    }
    candidates.sort((a,b)=>(b.move.probabilityLoss??0)-(a.move.probabilityLoss??0));
    const chosen=candidates.slice(0,10);job.data.total=chosen.length;const engine=new UciEngine({hash:this.store.settings().hash});
    try{for(const {game,move} of chosen){
      if(signal.aborted)throw new Error('Генерация остановлена.');
      const result=await engine.analyze(move.fen,{depth:18,movetime:1500,nodes:200000,multiPV:2,signal});
      const candidate=puzzleCandidate(result,move);
      if(candidate){
        const id=randomUUID(),puzzle={id,gameId:game.id,ply:move.ply,fen:move.fen,color:move.color,...candidate,alternatives:[],motifs:move.motifs,engine:result.engine,createdAt:new Date().toISOString()};
        this.store.db.prepare('INSERT OR IGNORE INTO puzzles(id,game_id,profile,ply,data,due_at) VALUES(?,?,?,?,?,?)').run(id,game.id,job.profile,move.ply,JSON.stringify(puzzle),new Date().toISOString());
      }
      job.data.done++;this.progress(job);
    }}finally{engine.close();}
  }
  async stop(){this.stopping=true;clearTimeout(this.timer);this.active?.controller.abort();for(let i=0;this.active&&i<100;i++)await new Promise(r=>setTimeout(r,50));}
}
