import { positionHistory } from './position-history.mjs';
import { openingPosition } from './opening-position.mjs';
import { habitReport, startHabit, habitTrainingReport, habitEntries } from './habits.mjs';
import { openingStudy } from './opening-study.mjs';
import { openingTheory } from './opening-theory.mjs';
import { startLearning, learningReport } from './learning.mjs';
import { practiceAction, practiceDashboard, randomPracticePuzzle } from './practice.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { backup } from 'node:sqlite';
import { Store } from './database.mjs';
import { JobRunner } from './jobs.mjs';
import { analytics, selectGames } from './analytics.mjs';
import { username } from './domain.mjs';
import { UciEngine, PRESETS } from './engine.mjs';
import { GAME_SORT_KEYS, gameListRow, sortGameRows } from './game-list.mjs';
import { coachReport, explainMove } from './coach.mjs';
import { positionRequest } from './position-request.mjs';

export const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let text='',size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new Error('Размер запроса превышает 8 MB.');text+=chunk;}try{return JSON.parse(text||'{}');}catch{throw new Error('Некорректный JSON.');}}

export function createApplication({filename=path.join(ROOT,'data','chess.sqlite'),runJobs=true}={}){
  const store=new Store(filename);const runner=new JobRunner(store);if(runJobs)runner.start();
  let reportCache=new Map(),positionBusy=false,positionEngine=null;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://images.chesscomfiles.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try{
      const host=req.headers.host??'';if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)){json(res,403,{error:'Допускается только локальный доступ.'});return;}
      const url=new URL(req.url,'http://'+host),route=url.pathname,query=Object.fromEntries(url.searchParams);
      if(req.method!=='GET'&&req.method!=='HEAD'){
        if(req.headers.origin&&req.headers.origin!=='http://'+host||req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'Запрос с другого сайта отклонён.'});return;}
        if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'Ожидается application/json.'});return;}
      }
      if(route==='/api/health'){json(res,200,{ok:true,version:'2.0.0'});return;}
      if(route==='/api/bootstrap'&&req.method==='GET'){json(res,200,{profiles:store.profiles(),settings:store.settings(),presets:PRESETS});return;}
      if(route==='/api/profiles'&&req.method==='POST'){const input=await body(req),name=username(input.username);store.saveProfile(name,{local:true});json(res,201,{profile:store.profile(name),job:input.sync===false?null:runner.enqueueSync(name)});return;}
      if(route==='/api/settings'&&req.method==='PATCH'){
        const input=await body(req),allowed={};
        if(input.timezone!==undefined){new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format();allowed.timezone=input.timezone;}
        for(const [key,min,max] of [['sessionGap',5,240],['minSample',3,1000],['hash',16,256]])if(input[key]!==undefined){if(!Number.isInteger(input[key])||input[key]<min||input[key]>max)throw new Error('Недопустимое значение '+key);allowed[key]=input[key];}
        if(input.preset!==undefined){if(!PRESETS[input.preset])throw new Error('Неизвестный режим.');allowed.preset=input.preset;}
        for(const key of ['includeRecovered','autoAnalyze'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new Error('Ожидается логическое значение '+key);allowed[key]=input[key];}
        json(res,200,store.setSettings(allowed));return;
      }
      if(route==='/api/backup'&&req.method==='POST'){
        const name='chess-'+new Date().toISOString().replaceAll(':','-')+'.sqlite',file=path.join(ROOT,'data','backups',name);fs.mkdirSync(path.dirname(file),{recursive:true});await backup(store.db,file);json(res,201,{file,name});return;
      }
      const profile=query.profile??store.profiles()[0]?.username;
      if(route.startsWith('/api/')&&!['/api/position'].includes(route)&&(!profile||!store.profile(profile)))throw new Error('Добавьте шахматный профиль.');
      if(route==='/api/opening-position'&&req.method==='POST'){const input=await body(req);const result=openingPosition(input.fen);result.personal=positionHistory(store.games(profile),result.fen);json(res,200,result);return;}
      if(route==='/api/opening-study'&&req.method==='GET'){
        json(res,200,openingStudy(selectGames(store,profile,query).games,{q:query.q,line:query.line??null,order:query.order}));return;
      }
      if(route==='/api/habits'&&req.method==='GET'){json(res,200,habitReport(selectGames(store,profile,query),query));return;}
      if(route==='/api/habits/training'&&req.method==='GET'){json(res,200,habitTrainingReport(store,profile));return;}
      const habitRefill=/^\/api\/habits\/([^/]+)\/refill$/.exec(route);
      if(habitRefill&&req.method==='POST'){json(res,201,runner.enqueuePuzzles(profile,{mode:'habit',trainingId:habitRefill[1]}));return;}
      if(route==='/api/habits/start'&&req.method==='POST'){
        const input=await body(req);if(typeof input.key!=='string'||!input.filter||typeof input.filter!=='object'||Array.isArray(input.filter))throw new Error('Выберите вывод тренера.');
        const training=startHabit(store,profile,input.key,input.filter),job=runner.enqueuePuzzles(profile,{mode:'habit',trainingId:training.id});json(res,201,{trainingId:training.id,job});return;
      }
      if(route==='/api/coach'&&req.method==='GET'){
        store.refresh();
        const key='coach:'+store.revision+':'+url.searchParams.toString();
        if(!reportCache.has(key)){if(reportCache.size>8)reportCache.clear();reportCache.set(key,coachReport(selectGames(store,profile,query),query));}
        json(res,200,reportCache.get(key));return;
      }
      const explanationMatch=/^\/api\/games\/([^/]+)\/explanation$/.exec(route);
      if(explanationMatch&&req.method==='GET'){
        const game=store.game(decodeURIComponent(explanationMatch[1]));
        if(!game||game.profile!==profile){json(res,404,{error:'Партия не найдена.'});return;}
        const ply=Number(query.ply);if(!Number.isInteger(ply)||ply<1||ply>game.plies)throw new Error('Выберите существующий ход партии.');
        json(res,200,explainMove(game,game.analysis,ply));return;
      }
      if(route==='/api/analytics'&&req.method==='GET'){
        store.refresh();
        const key=store.revision+':'+url.searchParams.toString();if(!reportCache.has(key)){if(reportCache.size>8)reportCache.clear();reportCache.set(key,analytics(store,profile,query));}json(res,200,reportCache.get(key));return;
      }
      if(route==='/api/games'&&req.method==='GET'){
        const {games,analyses}=selectGames(store,profile,query);
        const sort=GAME_SORT_KEYS.includes(query.sort)?query.sort:'date',direction=query.direction==='asc'?'asc':'desc';
        const rows=sortGameRows(games.map(game=>gameListRow(game,analyses.get(game.id))),sort,direction);
        const page=Math.max(1,Number(query.page)||1),limit=Math.min(100,Math.max(10,Number(query.limit)||25));
        json(res,200,{total:rows.length,page,limit,sort,direction,games:rows.slice((page-1)*limit,page*limit)});return;
      }
      const gameMatch=/^\/api\/games\/([^/]+)(?:\/(pgn|versions))?$/.exec(route);
      if(gameMatch&&req.method==='GET'){
        const game=store.game(decodeURIComponent(gameMatch[1]));if(!game||game.profile!==profile){json(res,404,{error:'Партия не найдена.'});return;}
        if(gameMatch[2]==='pgn'){res.writeHead(200,{'Content-Type':'application/x-chess-pgn; charset=utf-8','Content-Disposition':'attachment; filename="game.pgn"'});res.end(game.pgn);}
        else if(gameMatch[2]==='versions')json(res,200,store.db.prepare('SELECT id,source,preset,created_at FROM analyses WHERE game_id=? ORDER BY created_at DESC').all(game.id));
        else {delete game.raw;game.theory=openingTheory(game);const insights=habitReport(selectGames(store,profile,{format:game.timeClass}),{format:game.timeClass});game.habitTags=insights.priorities.flatMap(p=>habitEntries([game],store.analyses(profile),p.kind,p.format,p.preset).filter(e=>e.matches).map(e=>({ply:e.move.ply,title:p.title,key:p.key,evidence:e.evidence,format:p.format})));json(res,200,game);}return;
      }
      if(route==='/api/import'&&req.method==='POST'){
        const input=await body(req);if(typeof input.pgn!=='string')throw new Error('Нужен текст PGN.');const pgns=input.pgn.split(/\n\s*\n(?=\[Event )/).filter(x=>x.trim());let imported=0;const errors=[];
        for(const pgn of pgns){const result=store.importGame({pgn},profile);if(result.error)errors.push(result.error);else if(result.inserted)imported++;}json(res,200,{imported,errors});return;
      }
      if(route==='/api/jobs'&&req.method==='GET'){json(res,200,store.jobs(profile));return;}
      if(route==='/api/jobs'&&req.method==='POST'){
        const input=await body(req);let job;
        if(input.kind==='sync')job=runner.enqueueSync(profile);
        else if(input.kind==='puzzles')job=runner.enqueuePuzzles(profile,{mode:input.mode??'cycle'});
        else if(input.kind==='analysis'){
          const ids=Array.isArray(input.gameIds)?input.gameIds:selectGames(store,profile,query).games.map(g=>g.id);
          if(ids.length>100000)throw new Error('Не более 100 000 партий в задании.');job=runner.enqueueAnalysis(profile,ids,{preset:input.preset??store.settings().preset,mode:input.mode??'pending'});
        }else throw new Error('Неизвестный тип задания.');json(res,201,job);return;
      }
      const jobMatch=/^\/api\/jobs\/([^/]+)\/(pause|resume|cancel|retry)$/.exec(route);
      if(jobMatch&&req.method==='POST'){if(store.job(jobMatch[1])?.profile!==profile)throw new Error('Задание не найдено.');json(res,200,runner.action(jobMatch[1],jobMatch[2]));return;}
      if(route==='/api/position'&&req.method==='POST'){
        if(positionBusy){json(res,429,{error:'Дождитесь текущего анализа позиции.'});return;}const input=await body(req),position=positionRequest(input),controller=new AbortController();positionBusy=true;positionEngine=new UciEngine({hash:store.settings().hash});
        const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
        try{const {fen,...history}=position;const result=await positionEngine.analyze(fen,{...history,...(PRESETS[input.preset]??PRESETS.standard),multiPV:3,signal:controller.signal});if(!res.destroyed)json(res,200,result);}finally{res.removeListener('close',disconnect);positionEngine.close();positionEngine=null;positionBusy=false;}return;
      }
      if(route==='/api/learning'&&req.method==='GET'){json(res,200,learningReport(store,profile));return;}
      if(route==='/api/learning/start'&&req.method==='POST'){
        const input=await body(req),cycle=startLearning(store,profile,input),job=runner.enqueuePuzzles(profile);
        json(res,201,{cycle,job});return;
      }
      if(route==='/api/puzzles/random'&&req.method==='GET'){json(res,200,randomPracticePuzzle(store,profile,(query.exclude??'').split(',').filter(Boolean)));return;}
      if(route==='/api/puzzles'&&req.method==='GET'){json(res,200,practiceDashboard(store,profile));return;}
      const puzzleMatch=/^\/api\/puzzles\/([^/]+)\/(start|attempt|hint|solution|reset)$/.exec(route);
      if(puzzleMatch&&req.method==='POST'){
        json(res,200,practiceAction(store,profile,puzzleMatch[1],puzzleMatch[2],await body(req)));return;
      }
      if(route.startsWith('/api/')){json(res,404,{error:'Метод API не найден.'});return;}
      if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'Метод не поддерживается.'});return;}
      const file=route==='/vendor/chess.js'?path.join(ROOT,'node_modules/chess.js/dist/esm/chess.js'):path.join(ROOT,'public',route==='/'?'index.html':decodeURIComponent(route));
      const root=path.join(ROOT,'public');if(!file.startsWith(root+path.sep)&&route!=='/vendor/chess.js'){json(res,403,{error:'Недопустимый путь.'});return;}
      if(!fs.existsSync(file)||!fs.statSync(file).isFile()){json(res,404,{error:'Файл не найден.'});return;}
      res.writeHead(200,{'Content-Type':MIME[path.extname(file)]??'application/octet-stream','Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
    }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.end();}
  });
  return {server,store,runner,async close(){positionEngine?.close();await runner.stop();await new Promise(resolve=>server.listening?server.close(resolve):resolve());store.close();}};
}

export async function start(){
  const lock=path.join(ROOT,'data','app.lock');fs.mkdirSync(path.dirname(lock),{recursive:true});
  if(fs.existsSync(lock)){
    let alive=false;try{const pid=Number(fs.readFileSync(lock,'utf8'));if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);alive=true;}}catch(error){if(error.code==='EPERM')alive=true;}
    if(alive)throw new Error('Приложение уже запущено. Откройте существующий локальный адрес.');fs.unlinkSync(lock);
  }
  const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
  const release=()=>{try{if(fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}catch{}};
  process.once('exit',release);
  let app;try{app=createApplication();}catch(error){release();throw error;}
  const port=Number(process.env.PORT??3000);app.server.listen(port,'127.0.0.1',()=>console.log(`Персональная шахматная аналитика: http://127.0.0.1:${port}`));
  app.server.on('error',async error=>{console.error(error.message);process.exitCode=1;await app.close();release();});
  let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await app.close();release();});return app;
}
