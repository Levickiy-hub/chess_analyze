import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { digest, whiteScore, finishAnalysis, FORMULA_VERSION } from './domain.mjs';

export const PRESETS={quick:{depth:12,movetime:300,nodes:30000},standard:{depth:18,movetime:1500,nodes:200000},deep:{depth:24,movetime:5000,nodes:1000000}};
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
      current.lines[multipv-1]={score:whiteScore({type:score[1],value:Number(score[2])},current.fen),pv,depth:Number(/\bdepth (\d+)/.exec(line)?.[1]??0),nodes:Number(/\bnodes (\d+)/.exec(line)?.[1]??0),wdl:wdl?wdl.slice(1).map(Number):null,bound:/\b(lowerbound|upperbound)\b/.exec(line)?.[1]??null};
    }
    if(line.startsWith('bestmove ')){
      this.current=null;clearTimeout(current.timer);current.signal?.removeEventListener('abort',current.abort);
      const first=current.lines[0];
      if(!first?.score)current.reject(new Error('Stockfish не вернул оценку позиции.'));
      else current.resolve({score:first.score,bestMove:line.split(' ')[1],lines:current.lines.filter(Boolean),depth:first.depth,nodes:first.nodes,wdl:first.wdl,engine:this.name});
    }
  }
  fail(error){for(const w of this.waiters){clearTimeout(w.timer);w.reject(error);}this.waiters=[];if(this.current){const c=this.current;this.current=null;clearTimeout(c.timer);c.signal?.removeEventListener('abort',c.abort);c.reject(error);}}
  async analyze(fen,{initialFen=null,moves=[],signal,multiPV=1,...limits}={}){
    if(signal?.aborted)throw new Error('Операция остановлена.');await this.init();
    if(this.current)throw new Error('Движок занят.');
    const board=new Chess(fen);
    if(board.isGameOver())return {score:board.isCheckmate()?{kind:'mate',value:0,pov:'white',winner:board.turn()==='w'?'b':'w'}:{kind:'cp',value:0,pov:'white'},bestMove:null,lines:[],depth:0,nodes:0,wdl:null,engine:this.name};
    const {depth=12,movetime=300,nodes=30000}=limits;
    return new Promise((resolve,reject)=>{
      const current={fen,lines:[],resolve,reject,signal};
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
      const key=digest(JSON.stringify({build:'17.1-8e4d048',formula:FORMULA_VERSION,options,hash,initialFen:game.initialFen,history,fen}));
      let result=store.cache(key);
      if(!result){result=await engine.analyze(fen,{...options,initialFen:game.initialFen,moves:history,signal});store.cachePut(key,result);}
      positions.push(result);onProgress(i+1,game.moves.length+1);
      if(game.moves[i])history.push(game.moves[i].uci);
      await new Promise(resolve=>setImmediate(resolve));
    }
    return finishAnalysis(game,positions,{source:'verified',preset,engine:engine.name,limits:options,hash,threads:1});
  }finally{engine.close();}
}
