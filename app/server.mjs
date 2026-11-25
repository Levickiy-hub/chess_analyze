import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { backup } from 'node:sqlite';
import { Chess } from 'chess.js';
import { Store } from './database.mjs';
import { JobRunner } from './jobs.mjs';
import { analytics, selectGames } from './analytics.mjs';
import { username } from './domain.mjs';
import { UciEngine, PRESETS } from './engine.mjs';
import { GAME_SORT_KEYS, gameListRow, sortGameRows } from './game-list.mjs';
import { coachReport, explainMove } from './coach.mjs';

export const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let text='',size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new Error('Размер запроса превышает 8 MB.');text+=chunk;}try{return JSON.parse(text||'{}');}catch{throw new Error('Некорректный JSON.');}}

export function createApplication({filename=path.join(ROOT,'data','chess.sqlite'),bootstrap=true,runJobs=true}={}){
  const store=new Store(filename);if(bootstrap)store.bootstrap(ROOT);const runner=new JobRunner(store);if(runJobs)runner.start();
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
        else {delete game.raw;json(res,200,game);}return;
      }
      if(route==='/api/import'&&req.method==='POST'){
        const input=await body(req);if(typeof input.pgn!=='string')throw new Error('Нужен текст PGN.');const pgns=input.pgn.split(/\n\s*\n(?=\[Event )/).filter(x=>x.trim());let imported=0;const errors=[];
        for(const pgn of pgns){const result=store.importGame({pgn},profile);if(result.error)errors.push(result.error);else if(result.inserted)imported++;}json(res,200,{imported,errors});return;
      }
      if(route==='/api/jobs'&&req.method==='GET'){json(res,200,store.jobs(profile));return;}
      if(route==='/api/jobs'&&req.method==='POST'){
        const input=await body(req);let job;
        if(input.kind==='sync')job=runner.enqueueSync(profile);
        else if(input.kind==='puzzles')job=runner.enqueuePuzzles(profile);
        else if(input.kind==='analysis'){
          const ids=Array.isArray(input.gameIds)?input.gameIds:selectGames(store,profile,query).games.map(g=>g.id);
          if(ids.length>100000)throw new Error('Не более 100 000 партий в задании.');job=runner.enqueueAnalysis(profile,ids,{preset:input.preset??store.settings().preset,mode:input.mode??'pending'});
        }else throw new Error('Неизвестный тип задания.');json(res,201,job);return;
      }
      const jobMatch=/^\/api\/jobs\/([^/]+)\/(pause|resume|cancel|retry)$/.exec(route);
      if(jobMatch&&req.method==='POST'){if(store.job(jobMatch[1])?.profile!==profile)throw new Error('Задание не найдено.');json(res,200,runner.action(jobMatch[1],jobMatch[2]));return;}
      if(route==='/api/position'&&req.method==='POST'){
        if(positionBusy){json(res,429,{error:'Дождитесь текущего анализа позиции.'});return;}const input=await body(req),board=new Chess(input.fen);positionBusy=true;positionEngine=new UciEngine({hash:store.settings().hash});
        try{json(res,200,await positionEngine.analyze(board.fen(),{...(PRESETS[input.preset]??PRESETS.standard),multiPV:3}));}finally{positionEngine.close();positionEngine=null;positionBusy=false;}return;
      }
      if(route==='/api/puzzles'&&req.method==='GET'){
        const rows=store.db.prepare(`SELECT id,data,due_at,interval_days FROM puzzles WHERE profile=? ORDER BY due_at LIMIT 100`).all(profile);
        json(res,200,{puzzles:rows.map(r=>{const p=JSON.parse(r.data);delete p.solution;delete p.alternatives;return {...p,dueAt:r.due_at,interval:r.interval_days};}),attempts:store.db.prepare('SELECT count(*) n,sum(correct) correct FROM attempts a JOIN puzzles p ON p.id=a.puzzle_id WHERE p.profile=?').get(profile)});return;
      }
      const puzzleMatch=/^\/api\/puzzles\/([^/]+)\/(attempt|hint|solution)$/.exec(route);
      if(puzzleMatch&&req.method==='POST'){
        const row=store.db.prepare('SELECT * FROM puzzles WHERE id=? AND profile=?').get(puzzleMatch[1],profile);if(!row)throw new Error('Задача не найдена.');const puzzle=JSON.parse(row.data),input=await body(req);
        if(puzzleMatch[2]==='hint'){const prefix=Array.isArray(input.moves)?input.moves:[];if(!prefix.every((m,i)=>m===puzzle.solution[i]))throw new Error('Неверное начало решения.');json(res,200,{from:puzzle.solution[Math.min(prefix.length,puzzle.solution.length-1)].slice(0,2),motifs:puzzle.motifs});return;}
        if(puzzleMatch[2]==='solution'){json(res,200,{solution:puzzle.solution});return;}
        const moves=Array.isArray(input.moves)?input.moves:[],correct=moves.length>0&&moves.every((move,i)=>move===puzzle.solution[i]);
        if(!correct){store.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?)').run(randomUUID(),row.id,new Date().toISOString(),0,JSON.stringify({moves}));store.db.prepare('UPDATE puzzles SET due_at=?,interval_days=0 WHERE id=?').run(new Date(Date.now()+10*60000).toISOString(),row.id);json(res,200,{correct:false,complete:false});return;}
        const reply=puzzle.solution[moves.length]??null,next=[...moves,...(reply?[reply]:[])],complete=next.length>=puzzle.solution.length;
        if(complete){const interval=row.interval_days?Math.min(90,row.interval_days*2):1;store.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?)').run(randomUUID(),row.id,new Date().toISOString(),1,JSON.stringify({moves}));store.db.prepare('UPDATE puzzles SET due_at=?,interval_days=? WHERE id=?').run(new Date(Date.now()+interval*86400000).toISOString(),interval,row.id);}
        json(res,200,{correct:true,complete,reply,moves:next});return;
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
