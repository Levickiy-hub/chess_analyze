import { opponentKind } from './opponent-kind.mjs';
const isBot=g=>g.opponentType==='bot'||opponentKind(g).type==='bot';
const validRating=g=>Number.isFinite(g.opponentRating)&&g.opponentRating>0;
const time=g=>Number.isFinite(g.end)?g.end:-Infinity;
const newest=(a,b)=>time(b)-time(a)||a.id.localeCompare(b.id);

export function opponentRatings(games){
  const dated=games.filter(g=>Number.isFinite(g.end)).sort(newest),last=dated[0];
  const formats=[...new Set(games.map(g=>g.timeClass))].map(format=>{
    const ratings=games.filter(g=>g.timeClass===format&&validRating(g)).map(g=>g.opponentRating);
    return {format,min:ratings.length?Math.min(...ratings):null,max:ratings.length?Math.max(...ratings):null};
  });
  return {latest:last&&validRating(last)?last.opponentRating:null,format:last?.timeClass??null,date:last?.end??null,gameId:last?.id??null,formats,botGames:games.filter(isBot).length};
}

export function strongestOpponent(games){
  const g=games.filter(g=>validRating(g)&&!isBot(g)).sort((a,b)=>b.opponentRating-a.opponentRating||newest(a,b))[0];
  return g?{name:g.opponent,rating:g.opponentRating,format:g.timeClass,gameId:g.id,date:g.end,outcome:g.outcome}:null;
}
