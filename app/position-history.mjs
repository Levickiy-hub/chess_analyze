import { setupPosition } from './setup-position.mjs';
const key=fen=>typeof fen==='string'?fen.split(' ').slice(0,4).join(' '):null;

export function positionHistory(games,fen){
  const target=key(setupPosition(fen)),matches=[];let occurrences=0;
  for(const game of games){
    const plies=[];
    if(key(game.initialFen)===target)plies.push(0);
    for(const [i,move] of game.moves.entries())if(key(move.after)===target)plies.push(move.ply??i+1);
    if(!plies.length)continue;
    occurrences+=plies.length;
    matches.push({gameId:game.id,opponent:game.opponent,format:game.timeClass,date:game.end,plies});
  }
  matches.sort((a,b)=>(Number.isFinite(b.date)?b.date:-Infinity)-(Number.isFinite(a.date)?a.date:-Infinity)||a.gameId.localeCompare(b.gameId));
  return {games:matches.length,totalGames:games.length,occurrences,percent:games.length?Math.round(1000*matches.length/games.length)/10:null,matches:matches.slice(0,20)};
}
