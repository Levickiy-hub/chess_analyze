import { Chess } from 'chess.js';
import { expectation } from './domain.mjs';

export function puzzleCandidate(result,move) {
  const best=result.lines?.[0],second=result.lines?.[1];
  if(!best?.pv?.length||!second?.pv?.length||best.bound||second.bound||best.depth<8||best.depth!==second.depth||best.pv[0]!==result.bestMove||best.pv[0]===move.uci||best.pv[0]===second.pv[0])return null;
  const a=expectation(best.score,move.color),b=expectation(second.score,move.color);
  if(a===null||b===null||a-b<.04)return null;
  const solution=best.pv.slice(0,8);
  try{
    const board=new Chess(move.fen);if(board.turn()!==move.color)return null;
    for(const uci of solution)board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
    const alternative=new Chess(move.fen),uci=second.pv[0];alternative.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
  }catch{return null;}
  return {solution,gap:a-b,depth:best.depth,score:best.score,playerMoves:Math.ceil(solution.length/2)};
}

export function nextPuzzleReview(interval,dueAt,now=Date.now()) {
  const days=Number.isFinite(interval)&&interval>0?Math.min(90,interval):0;
  const due=Date.parse(dueAt);
  if(days&&Number.isFinite(due)&&due>now)return {interval:days,dueAt};
  const next=days?Math.min(90,days*2):1;
  return {interval:next,dueAt:new Date(now+next*86400000).toISOString()};
}
