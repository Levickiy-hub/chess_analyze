import { annotateSpecialMoves } from './special-moves.mjs';
import { Chess } from 'chess.js';
import { createHash } from 'node:crypto';
import { identifyOpening } from './openings.mjs';
import { opponentKind } from './opponent-kind.mjs';

export const FORMULA_VERSION = 'personal-v3';
export const NORMALIZATION_VERSION = 2;
export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const mean = values => { const v=values.filter(Number.isFinite); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; };
export const median = values => { const v=values.filter(Number.isFinite).sort((a,b)=>a-b),n=v.length;return n?(n%2?v[Math.floor(n/2)]:(v[n/2-1]+v[n/2])/2):null; };
export function username(value) {
  const name=String(value??'').trim().toLowerCase();
  if(!/^[a-z0-9_-]{2,50}$/.test(name)) throw new Error('Username: от 2 до 50 латинских букв, цифр, _ или -.');
  return name;
}
export const digest = text => createHash('sha256').update(text).digest('hex');
export function timeControl(value) {
  const m=/^(\d+)(?:\+(\d+))?$/.exec(value??'');
  if(!m)return null;const base=Number(m[1]),increment=Number(m[2]??0);
  return Number.isSafeInteger(base)&&Number.isSafeInteger(increment)&&base+increment>0?{base,increment}:null;
}
const seconds = text => { const parts=text.split(':').map(Number); return parts.length===3&&parts.every(Number.isFinite)&&parts[0]>=0&&parts[1]>=0&&parts[1]<60&&parts[2]>=0&&parts[2]<60?parts[0]*3600+parts[1]*60+parts[2]:null; };
function parseDate(date,time='00:00:00') {
  const day=String(date??'').replaceAll('.','-');if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}:\d{2}$/.test(time)||seconds(time)===null||Number(time.slice(0,2))>=24)return null;
  const ms=Date.parse(day+'T'+time+'Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===day?Math.floor(ms/1000):null;
}
function clockMoves(moves,control,initialFen) {
  const tc=timeControl(control),standard=initialFen===new Chess().fen(),previous={w:standard?tc?.base??null:null,b:standard?tc?.base??null:null};
  return moves.map(move=>{
    const clk=/\[%clk\s+(\d+:\d+:\d+(?:\.\d+)?)\]/.exec(move.comment??''),clock=clk?seconds(clk[1]):null;
    const t=clock!==null&&previous[move.color]!==null&&tc?previous[move.color]+tc.increment-clock:null;
    previous[move.color]=clock;
    return {...move,clock,spent:t!==null&&t>=-.1?Math.max(0,t):null};
  });
}
// Refresh cheap derived fields on read; raw PGN and engine results stay untouched.
export function upgradeSavedGame(game) {
  const kind=opponentKind(game);game={...game,opponentType:kind.type,opponentTypeReason:kind.reason};
  if(game.normalizationVersion===NORMALIZATION_VERSION)return game;
  const h=game.headers??{},raw=game.raw??{},date=h.EndDate??h.UTCDate??h.Date,endTime=h.EndTime??h.UTCTime;
  const end=Number.isFinite(raw.end_time)?raw.end_time:parseDate(date,endTime??'00:00:00');
  const startTime=h.UTCTime??h.StartTime,start=startTime?parseDate(h.UTCDate??h.Date,startTime):null;
  const rankPieces=(fen,color)=>{
    const rank=fen?.split(' ')[0]?.split('/')[color==='w'?7:0]??'';let file=0,count=0;
    for(const c of rank){if(/[1-8]/.test(c)){file+=Number(c);continue;}if(c===(color==='w'?'N':'n')&&[1,6].includes(file)||c===(color==='w'?'B':'b')&&[2,5].includes(file))count++;file++;}return count;
  };
  const moves=clockMoves(game.moves,game.timeControl,game.initialFen).map(m=>({...m,features:{...m.features,...Object.fromEntries(['w','b'].map(c=>[c,{...m.features?.[c],undeveloped:rankPieces(m.fen,c)}]))}}));
  return {...game,normalizationVersion:NORMALIZATION_VERSION,end,start,endPrecision:end===null?'unknown':Number.isFinite(raw.end_time)||endTime?'second':'day',duration:Number.isFinite(end)&&Number.isFinite(start)&&end>=start?end-start:null,moves};
}
export function boardFeatures(fen) {
  const chess=new Chess(fen), pieces=chess.board().flat().filter(Boolean), features={};
  for(const color of ['w','b']) {
    const own=pieces.filter(p=>p.color===color), pawns=own.filter(p=>p.type==='p'), files=pawns.map(p=>p.square.charCodeAt(0)-97);
    const nonPawn=own.filter(p=>!['p','k'].includes(p.type)).reduce((s,p)=>s+VALUES[p.type],0);
    const isolated=pawns.filter(p=>!files.some(f=>Math.abs(f-(p.square.charCodeAt(0)-97))===1)).length;
    const doubled=Array.from(new Set(files)).reduce((s,f)=>s+Math.max(0,files.filter(x=>x===f).length-1),0);
    const passed=pawns.filter(p=>!pieces.some(q=>q.type==='p'&&q.color!==color&&Math.abs(q.square.charCodeAt(0)-p.square.charCodeAt(0))<=1&&(color==='w'?q.square[1]>p.square[1]:q.square[1]<p.square[1]))).length;
    const king=own.find(p=>p.type==='k'); const kingFile=king.square.charCodeAt(0)-97,kingRank=Number(king.square[1]);
    let kingDanger=0; for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++){const f=kingFile+x,r=kingRank+y;if(f>=0&&f<8&&r>=1&&r<=8&&chess.isAttacked(String.fromCharCode(97+f)+r,color==='w'?'b':'w'))kingDanger++;}
    const hanging=own.filter(p=>p.type!=='k'&&chess.isAttacked(p.square,color==='w'?'b':'w')&&!chess.isAttacked(p.square,color)).map(p=>({square:p.square,piece:p.type,value:VALUES[p.type]}));
    const home=color==='w'?'1':'8';
    const undeveloped=own.filter(p=>p.type==='n'&&['b'+home,'g'+home].includes(p.square)||p.type==='b'&&['c'+home,'f'+home].includes(p.square)).length;
    const center=['d4','e4','d5','e5'].filter(s=>chess.isAttacked(s,color)).length;
    features[color]={material:own.reduce((s,p)=>s+VALUES[p.type],0),nonPawn,isolated,doubled,passed,bishopPair:own.filter(p=>p.type==='b').length>=2,kingDanger,hanging,undeveloped,center};
  }
  const nonPawn=features.w.nonPawn+features.b.nonPawn;
  const queens=pieces.filter(p=>p.type==='q').length;
  const fullmove=Number(fen.split(' ')[5]);
  const phase=nonPawn<=20||(!queens&&nonPawn<=26)?'endgame':fullmove<=12&&nonPawn>=44?'opening':'middlegame';
  const types=new Set(pieces.filter(p=>!['p','k'].includes(p.type)).map(p=>p.type));
  let ending=null;
  if(phase==='endgame') {
    ending=types.size===0?'pawn':types.size===1?({r:'rook',q:'queen',b:'bishop',n:'knight'}[[...types][0]]):'mixed';
    const bishops=pieces.filter(p=>p.type==='b');
    if(ending==='bishop'&&bishops.length===2&&bishops[0].color!==bishops[1].color){const colors=bishops.map(p=>(p.square.charCodeAt(0)+Number(p.square[1]))%2);ending=colors[0]===colors[1]?'same-bishops':'opposite-bishops';}
  }
  return {...features,phase,ending,pieceCount:pieces.length};
}

export function normalizeGame(raw, profile) {
  if(!raw||typeof raw.pgn!=='string'||!raw.pgn.trim())throw new Error('PGN отсутствует.');
  if(raw.rules&&raw.rules!=='chess')throw new Error('Поддерживаются стандартные шахматы; разновидность '+raw.rules+' пропущена.');
  const chess=new Chess();chess.loadPgn(raw.pgn);const headers=chess.getHeaders();
  const name=username(profile),white=String(raw.white?.username??headers.White??'').toLowerCase(),black=String(raw.black?.username??headers.Black??'').toLowerCase();
  if(name!==white&&name!==black)throw new Error('Профиль не является участником партии.');
  const color=name===white?'w':'b',self=color==='w'?'white':'black',opp=color==='w'?'black':'white';
  const history=chess.history({verbose:true}), comments=new Map(chess.getComments().map(c=>[c.fen,c.comment]));
  const moves=history.map((m,i)=>{
    const comment=comments.get(m.after)??'';
    return {ply:i+1,fullmove:Number(m.before.split(' ')[5]),color:m.color,san:m.san,uci:m.lan,from:m.from,to:m.to,piece:m.piece,captured:m.captured??null,promotion:m.promotion??null,fen:m.before,after:m.after,clock:null,spent:null,comment,features:boardFeatures(m.before)};
  });
  const result=headers.Result;
  const outcome=result==='1/2-1/2'?'draw':result==='1-0'?(color==='w'?'win':'loss'):result==='0-1'?(color==='b'?'win':'loss'):'unknown';
  const openingUrl=raw.eco??headers.ECOUrl??'',slug=openingUrl.split('/').filter(Boolean).at(-1)??'';
  const reference=identifyOpening(moves);
  const opening=headers.Opening??(slug?decodeURIComponent(slug).replaceAll('-',' '):reference?.name??'Дебют не определён');
  return upgradeSavedGame({id:raw.uuid??digest(raw.url??raw.pgn).slice(0,32),profile:name,url:raw.url??headers.Link??null,pgn:raw.pgn,headers,color,opponent:raw[opp]?.username??headers[color==='w'?'Black':'White']??'?',rating:Number(raw[self]?.rating??headers[color==='w'?'WhiteElo':'BlackElo'])||null,opponentRating:Number(raw[opp]?.rating??headers[color==='w'?'BlackElo':'WhiteElo'])||null,outcome,reason:raw[self]?.result??headers.Termination??'unknown',opponentReason:raw[opp]?.result??null,end:null,start:null,duration:null,timeClass:raw.time_class??'unknown',timeControl:raw.time_control??headers.TimeControl??'?',rated:raw.rated===true,rules:'chess',opening,eco:headers.ECO??(slug?null:reference?.eco??null),initialFen:history[0]?.before??chess.fen(),finalFen:chess.fen(),plies:moves.length,moves,raw});
}

export function whiteScore(score,fen) {
  if(!score||!Number.isFinite(score.value))return null;
  const turn=fen.split(' ')[1],sign=turn==='w'?1:-1;
  const kind=score.kind??score.type;
  if(!['cp','mate'].includes(kind)||!['w','b'].includes(turn))return null;
  const bound=score.bound&&sign===-1?score.bound==='lowerbound'?'upperbound':'lowerbound':score.bound;
  return {kind,value:score.value*sign,pov:'white',...(bound?{bound}:{}),...(kind==='mate'?{winner:score.value>0?turn:turn==='w'?'b':'w'}:{})};
}
function positionBounds(position,fen) {
  const bound=position?.lines?.[0]?.bound;
  if(!position?.score||position.score.bound||!bound)return position;
  const normalized=fen.split(' ')[1]==='b'?bound==='lowerbound'?'upperbound':'lowerbound':bound;
  return {...position,score:{...position.score,bound:normalized}};
}
export function expectation(score,color='w') {
  if(!score||score.bound)return null;
  if(score.kind==='mate')return ['w','b'].includes(score.winner)?score.winner===color?1:0:null;
  if(score.kind!=='cp'||!Number.isFinite(score.value))return null;
  const x=score.value*(color==='w'?1:-1);
  return 1/(1+Math.exp(-x/250));
}
export function moveQuality(before,after,move,bestMove) {
  if(expectation(before,move.color)===null||expectation(after,move.color)===null)return {loss:null,probabilityLoss:null,accuracy:null,category:'unknown',missedMate:false,isBest:false};
  const sign=move.color==='w'?1:-1,isBest=Boolean(bestMove)&&move.uci===bestMove;
  const probabilityLoss=isBest?0:Math.max(0,expectation(before,move.color)-expectation(after,move.color));
  const loss=before.kind==='cp'&&after.kind==='cp'?(isBest?0:Math.max(0,(before.value-after.value)*sign)):null;
  const missedMate=!isBest&&before.kind==='mate'&&before.winner===move.color&&!(after.kind==='mate'&&after.winner===move.color);
  const category=isBest?'best':missedMate||probabilityLoss>=.3||(loss??0)>=300?'blunder':probabilityLoss>=.15||(loss??0)>=150?'mistake':probabilityLoss>=.05||(loss??0)>=50?'inaccuracy':(loss??0)<=10?'excellent':'good';
  return {loss,probabilityLoss,accuracy:100*Math.exp(-4*probabilityLoss),category,missedMate,isBest};
}

export function tacticalHints(move,nextMove) {
  const hints=[],board=new Chess(move.after),opponent=move.color==='w'?'b':'w';
  if(move.san.includes('#'))hints.push('checkmate');
  if(move.san.includes('+'))hints.push('check');
  if(move.features[move.color].hanging.length)hints.push('hanging-piece');
  if(nextMove?.captured&&VALUES[nextMove.captured]>=3)hints.push('material-loss');
  if(move.captured&&VALUES[move.captured]>VALUES[move.piece])hints.push('favorable-capture');
  const mover=board.get(move.to);
  // Fork candidate: isolate the moved piece to compute its geometric attacks.
  if(mover&&mover.type!=='k') {
    const probe=new Chess(move.after);for(const p of probe.board().flat().filter(Boolean))if(p.color===move.color&&p.square!==move.to)probe.remove(p.square);
    const targets=board.board().flat().filter(p=>p&&p.color===opponent&&VALUES[p.type]>=3&&probe.isAttacked(p.square,move.color));
    if(targets.length>=2)hints.push('fork-candidate');
  }
  // Ray from a king through one own piece to an enemy sliding piece: absolute pin.
  const pieces=board.board().flat().filter(Boolean), king=pieces.find(p=>p.color===move.color&&p.type==='k');
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
    let seen=null;for(let k=1;k<8;k++){const x=king.square.charCodeAt(0)-97+dx*k,y=Number(king.square[1])+dy*k;if(x<0||x>7||y<1||y>8)break;const p=board.get(String.fromCharCode(97+x)+y);if(!p)continue;if(!seen&&p.color===move.color){seen=p;continue;}if(seen&&p.color!==move.color&&(p.type==='q'||(dx&&dy?p.type==='b':p.type==='r')))hints.push('pin-candidate');break;}
  }
  return [...new Set(hints)];
}

export function finishAnalysis(game,positions,metadata={}) {
  positions=positions.map((p,i)=>positionBounds(p,game.moves[i]?.fen??game.finalFen));
  const moves=game.moves.map((move,i)=>{
    const before=positions[i]??null,after=positions[i+1]??null;
    return {...move,before:before?.score??null,scoreAfter:after?.score??null,bestMove:before?.bestMove??null,pv:before?.lines??[],wdl:before?.wdl??null,depth:before?.depth??null,nodes:before?.nodes??null,...moveQuality(before?.score,after?.score,move,before?.bestMove),motifs:tacticalHints(move,game.moves[i+1])};
  });
  return annotateSpecialMoves({version:FORMULA_VERSION,createdAt:new Date().toISOString(),...metadata,positions,moves},game);
}

export function upgradeSavedAnalysis(analysis,game) {
  return annotateSpecialMoves(upgradeSavedAnalysisBase(analysis,game),game);
}
function upgradeSavedAnalysisBase(analysis,game) {
  if(!analysis||analysis.version!=='personal-v2'||!game)return analysis;
  const originals=new Map(game.moves.map(m=>[m.ply,m]));
  let invalidated=0;
  const positions=analysis.positions?.map((p,i)=>{const fen=game.moves[i]?.fen??game.finalFen;if(p&&isPrematureDraw(p,fen)){invalidated++;return {...p,score:null,warning:'Нельзя считать позицию автоматической ничьей только по правилу 50 ходов; требуется новый поиск.'};}return positionBounds(p,fen);});
  return {...analysis,previousVersion:analysis.version,version:FORMULA_VERSION,...(positions?{positions}:{}),invalidatedPositions:invalidated,moves:analysis.moves.map(m=>{
    const original=originals.get(m.ply),move=original?{...m,clock:original.clock,spent:original.spent,features:original.features}:{...m};
    if(positions?.[move.ply-1])move.before=positions[move.ply-1].score;
    if(positions?.[move.ply])move.scoreAfter=positions[move.ply].score;
    const motifs=move.motifs?.includes('fork-candidate')&&!tacticalHints(move,game.moves[move.ply]).includes('fork-candidate')?move.motifs.filter(x=>x!=='fork-candidate'):move.motifs;
    return {...move,...moveQuality(move.before,move.scoreAfter,move,move.bestMove),motifs:motifs??[]};
  })};
}

export function isPrematureDraw(result,fen) {
  const halfmove=Number(fen.split(' ')[4]);
  if(halfmove<100||halfmove>=150||result?.depth!==0||result.bestMove||result.score?.kind!=='cp'||result.score.value!==0)return false;
  const board=new Chess(fen);return !board.isStalemate()&&!board.isInsufficientMaterial()&&!board.isCheckmate();
}

export function ratingDifference(game) {
  return Number.isFinite(game.rating)&&Number.isFinite(game.opponentRating)?game.opponentRating-game.rating:null;
}

export function sustainedAdvantage(moves,color,threshold=200) {
  let consecutive=0,previousPly=null;
  for(const m of moves){if(m.color!==color)continue;
    if(!Number.isInteger(m.ply)){consecutive=0;previousPly=null;continue;}
    const good=!m.before?.bound&&(m.before?.kind==='cp'&&Number.isFinite(m.before.value)&&m.before.value*(color==='w'?1:-1)>=threshold||m.before?.kind==='mate'&&m.before.winner===color);
    if(Number.isInteger(m.ply)&&previousPly!==null&&m.ply!==previousPly+2)consecutive=0;
    consecutive=good?consecutive+1:0;previousPly=Number.isInteger(m.ply)?m.ply:null;
    if(consecutive>=2)return true;
  }return false;
}
