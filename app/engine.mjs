import { sacrificeCandidate, SPECIAL_VERSION } from './special-moves.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { digest, whiteScore, finishAnalysis, isPrematureDraw } from './domain.mjs';

export const PRESETS={quick:{depth:12,movetime:300,nodes:30000},standard:{depth:18,movetime:1500,nodes:200000},deep:{depth:24,movetime:5000,nodes:1000000}};
export const specialSearchLimits=options=>({...options,depth:Math.max(14,options.depth),movetime:Math.max(1500,options.movetime),nodes:Math.max(300000,options.nodes)});
const RESULT_VERSION='uci-exact-v1';
export class UciEngine {
  constructor({hash=32,threads=1}={}){this.hash=hash;this.threads=threads;this.child=null;this.waiters=[];this.current=null;this.buffer='';this.name='Stockfish 17.1';this.closed=false;}
  send(command){if(!this.child||this.closed)throw new Error('Движок остановлен.');this.child.stdin.write(command+'\n');}
  wait(token,timeout=15000){return new Promise((resolve,reject)=>{const waiter={token,resolve,reject};waiter.timer=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(new Error('UCI timeout: '+token));this.close();},timeout);this.waiters.push(waiter);});}
  async init(){
    if(this.child)return;this.closed=false;
    const modulePath=new URL(import.meta.resolve('@se-oss/stockfish'));
    const script=fileURLToPath(new URL('stockfish-17.1-8e4d048.cjs',modulePath));
    this.child=spawn(process.execPath,[script],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.child.stdout.on('data',chunk=>{this.buffer+=chunk.toString();let end;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).trim();this.buffer=this.buffer.slice(end+1);this.line(line);}});
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',e=>this.fail(e));
    this.child.on('error',e=>this.fail(e));
    this.child.on('exit',()=>{this.fail(new Error('Процесс Stockfish завершился.'));this.child=null;});
    try{const ready=this.wait('uciok');this.send('uci');await ready;this.send(`setoption name Hash value ${this.hash}`);this.send(`setoption name Threads value ${this.threads}`);this.send('setoption name UCI_ShowWDL value true');const r=this.wait('readyok');this.send('isready');await r;}catch(error){this.close();throw error;}
  }
  line(line){
    if(line.startsWith('id name '))this.name=line.slice(8);
    for(const w of [...this.waiters])if(line===w.token){clearTimeout(w.timer);this.waiters.splice(this.waiters.indexOf(w),1);w.resolve();}
    const current=this.current;if(!current)return;
    if(line.startsWith('info ')&&/\bscore (cp|mate) -?\d+/.test(line)){
      const score=/\bscore (cp|mate) (-?\d+)/.exec(line),pv=/\bpv (.+)$/.exec(line)?.[1]?.split(' ')??[];
      const multipv=Number(/\bmultipv (\d+)/.exec(line)?.[1]??1);
      const wdl=/\bwdl (\d+) (\d+) (\d+)/.exec(line);
      const bound=/\b(lowerbound|upperbound)\b/.exec(line)?.[1]??null;
      const info={score:whiteScore({type:score[1],value:Number(score[2]),bound},current.fen),pv,depth:Number(/\bdepth (\d+)/.exec(line)?.[1]??0),nodes:Number(/\bnodes (\d+)/.exec(line)?.[1]??0),wdl:wdl?wdl.slice(1).map(Number):null,bound};
      current.lines[multipv-1]=info;
      // Aspiration-window failures are bounds, not completed scores. Keep exact
      // iterations separately so an interrupted deeper search cannot erase them.
      if(!bound&&pv.length){
        const iteration=current.exact.get(info.depth)??[];
        iteration[multipv-1]=info;current.exact.set(info.depth,iteration);
      }
    }
    if(line.startsWith('bestmove ')){
      this.current=null;clearTimeout(current.timer);current.signal?.removeEventListener('abort',current.abort);
      const bestMove=line.split(' ')[1];
      const iterations=[...current.exact.entries()].sort((a,b)=>b[0]-a[0]).map(([,lines])=>lines).filter(lines=>lines[0]?.pv[0]===bestMove);
      const complete=lines=>Array.from({length:current.multiPV},(_,i)=>lines[i]?.pv[0]).every(Boolean)&&new Set(lines.map(l=>l?.pv[0])).size===current.multiPV;
      const seen=new Set();
      const lines=(iterations.find(complete)??iterations[0]??current.lines).filter(info=>{
        const move=info?.pv[0];if(!move||seen.has(move))return false;seen.add(move);return true;
      });
      const first=lines[0];
      if(!first?.score)current.reject(new Error('Stockfish не вернул оценку позиции.'));
      else if(first.pv[0]!==bestMove)current.reject(new Error('Stockfish не вернул оценку для выбранного лучшего хода. Повторите поиск.'));
      else current.resolve({score:first.score,bestMove,lines,depth:first.depth,nodes:first.nodes,wdl:first.wdl,engine:this.name,resultVersion:RESULT_VERSION});
    }
  }
  fail(error){for(const w of this.waiters){clearTimeout(w.timer);w.reject(error);}this.waiters=[];if(this.current){const c=this.current;this.current=null;clearTimeout(c.timer);c.signal?.removeEventListener('abort',c.abort);c.reject(error);}}
  async analyze(fen,{initialFen=null,moves=[],signal,multiPV=1,...limits}={}){
    if(signal?.aborted)throw new Error('Операция остановлена.');
    if(this.current)throw new Error('Движок занят.');
    const board=new Chess(initialFen??fen),key=()=>board.fen().split(' ').slice(0,4).join(' '),repetitions=new Map([[key(),1]]);
    if(initialFen){for(const uci of moves){board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});repetitions.set(key(),(repetitions.get(key())??0)+1);}if(board.fen()!==new Chess(fen).fen())throw new Error('История ходов не соответствует позиции.');}
    const mate=board.isCheckmate();
    // Threefold/50-move claims are optional. Let Stockfish assess those positions.
    if(mate||board.isStalemate()||board.isInsufficientMaterial()||Number(board.fen().split(' ')[4])>=150||repetitions.get(key())>=5)return {score:mate?{kind:'mate',value:0,pov:'white',winner:board.turn()==='w'?'b':'w'}:{kind:'cp',value:0,pov:'white'},bestMove:null,lines:[],depth:0,nodes:0,wdl:null,engine:this.name};
    await this.init();if(signal?.aborted)throw new Error('Операция остановлена.');
    const {depth=12,movetime=300,nodes=30000}=limits;
    return new Promise((resolve,reject)=>{
      const current={fen,lines:[],exact:new Map(),multiPV:Math.min(3,Math.max(1,multiPV)),resolve,reject,signal};
      current.abort=()=>{this.fail(new Error('Операция остановлена.'));this.close();};
      current.timer=setTimeout(()=>{this.fail(new Error('Превышено время поиска Stockfish.'));this.close();},Math.max(15000,movetime+10000));
      this.current=current;signal?.addEventListener('abort',current.abort,{once:true});
      try{this.send(`setoption name MultiPV value ${Math.min(3,Math.max(1,multiPV))}`);this.send('position fen '+(initialFen??fen)+(moves.length?' moves '+moves.join(' '):''));this.send(`go depth ${depth} movetime ${movetime} nodes ${nodes}`);}catch(e){this.fail(e);this.close();}
    });
  }
  close(){this.closed=true;this.fail(new Error('Движок остановлен.'));const child=this.child;this.child=null;if(child){child.stdin.end('quit\n');child.kill();}}
}

export async function analyzeGame(game,store,{preset='quick',signal,onProgress=()=>{},hash=32,limits=null}={}){
  const engine=new UciEngine({hash,threads:1}),options=limits??PRESETS[preset];if(!options)throw new Error('Неизвестный режим анализа.');
  const positions=[],history=[];
  try{
    for(let i=0;i<=game.moves.length;i++){
      if(signal?.aborted)throw new Error('Операция остановлена.');
      const fen=game.moves[i]?.fen??game.finalFen;
      // Search results do not depend on derived quality formulas; retain existing cache keys.
      const key=digest(JSON.stringify({build:'17.1-8e4d048',formula:'personal-v2',options,hash,initialFen:game.initialFen,history,fen}));
      let result=store.cache(key);
      if(result&&isPrematureDraw(result,fen))result=null;
      if(result&&result.resultVersion!==RESULT_VERSION&&(result.score?.bound||result.lines?.[0]?.bound))result=null;
      if(!result){result=await engine.analyze(fen,{...options,initialFen:game.initialFen,moves:history,signal});store.cachePut(key,result);}
      positions.push(result);onProgress(i+1,game.moves.length+1);
      if(game.moves[i])history.push(game.moves[i].uci);
      await new Promise(resolve=>setImmediate(resolve));
    }
    const specialEvidence={};
    for(let i=0;i<game.moves.length;i++){
      if(!sacrificeCandidate(game,positions,i))continue;
      if(signal?.aborted)throw new Error('Анализ остановлен.');
      const moves=game.moves.slice(0,i).map(m=>m.uci),fen=game.moves[i].fen;
      const probeOptions=specialSearchLimits(options);
      const key=digest(JSON.stringify({special:SPECIAL_VERSION,options:probeOptions,hash,initialFen:game.initialFen,moves,fen}));
      let result=store.cache(key);
      if(!result){result=await engine.analyze(fen,{...probeOptions,initialFen:game.initialFen,moves,multiPV:2,signal});store.cachePut(key,result);}
      specialEvidence[i]=result;
    }
    return finishAnalysis(game,positions,{source:'verified',preset,engine:engine.name,limits:options,hash,threads:1,specialEvidence});
  }finally{engine.close();}
}
