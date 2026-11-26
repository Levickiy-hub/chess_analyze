import { randomUUID } from 'node:crypto';
import { centipawnLoss } from './skill-profile.mjs';
import { sustainedAdvantage } from './domain.mjs';

const cp=(m)=>m.before?.kind==='cp'&&!m.before.bound?m.before.value*(m.color==='w'?1:-1):null;
const known=g=>['win','draw','loss'].includes(g.outcome);
export function learningSample(games,analyses){
  let evaluated=0,errors=0,blunders=0,own=0,analysed=0,reached=0,wins=0;
  for(const g of games){
    own+=g.moves.filter(m=>m.color===g.color).length;
    const a=analyses.get(g.id);if(a?.source!=='verified')continue;analysed++;
    for(const m of a.moves){if(m.color!==g.color)continue;const value=cp(m),loss=centipawnLoss(m);
      if(value===null||Math.abs(value)>200||loss===null)continue;
      evaluated++;errors+=loss>=150?1:0;blunders+=loss>=300?1:0;
    }
    if(known(g)&&sustainedAdvantage(a.moves,g.color,200)){reached++;wins+=g.outcome==='win'?1:0;}
  }
  return {games:games.length,analysed,ownMoves:own,evaluated,errors,blunders,errorRate:evaluated?100*errors/evaluated:null,reached,wins,conversion:reached?100*wins/reached:null};
}
export function currentCycle(store,profile){const row=store.db.prepare('SELECT * FROM learning_cycles WHERE profile=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(profile);return row?{id:row.id,startedAt:row.started_at,...JSON.parse(row.data)}:null;}
export function startLearning(store,profile,input={},now=Date.now()){
  if(input.restart!==undefined&&typeof input.restart!=='boolean')throw new Error('Неверный параметр нового цикла.');
  const previous=currentCycle(store,profile);if(previous&&!input.restart)return previous;
  const all=store.games(profile),formats=['rapid','blitz','bullet','daily'],format=input.format??(all.some(g=>g.timeClass==='rapid')?'rapid':all.find(g=>formats.includes(g.timeClass))?.timeClass??'rapid'),focus=input.focus??'safety';
  if(!formats.includes(format)||!['safety','conversion'].includes(focus))throw new Error('Выберите формат и направление занятий.');
  const games=all.filter(g=>g.timeClass===format).slice(-100),baseline=learningSample(games,store.analyses(profile));
  const id=randomUUID(),startedAt=new Date(now).toISOString(),data={version:'learning-v1',format,focus,baseline,baselineGameIds:games.map(g=>g.id),dailyGoal:3};
  store.db.prepare('INSERT INTO learning_cycles VALUES(?,?,?,?)').run(id,profile,startedAt,JSON.stringify(data));return {id,startedAt,...data};
}
export function learningReport(store,profile,now=Date.now()){
  const cycle=currentCycle(store,profile);if(!cycle)return {cycle:null};
  const all=store.games(profile).filter(g=>g.timeClass===cycle.format),analyses=store.analyses(profile);
  const games=all.filter(g=>Number.isFinite(g.end)&&g.endPrecision!=='day'&&g.end*1000>=Date.parse(cycle.startedAt)&&!cycle.baselineGameIds.includes(g.id));
  const progress=learningSample(games,analyses),baselineReady=cycle.baseline.analysed>=20&&cycle.baseline.evaluated>=100,ready=baselineReady&&progress.analysed>=20&&progress.evaluated>=100;
  return {cycle,progress,ready,baselineReady,change:ready?progress.errorRate-cycle.baseline.errorRate:null,neededGames:Math.max(0,20-progress.analysed),note:'Сравниваются свои ходы в позициях от −2 до +2 пешек, серьёзная ошибка — потеря от 1,5 пешки. Только новый анализ Stockfish и один формат. Новые партии должны быть сыграны после начала цикла. Разница частот сама по себе не доказывает влияние занятий.'};
}
export function learningCandidates(store,profile,cycle){
  const analyses=store.analyses(profile),candidates=[],seen=new Set();
  const games=store.games(profile).filter(g=>!cycle||g.timeClass===cycle.format).slice(-100).reverse();
  for(const game of games){
    const a=analyses.get(game.id);if(a?.source!=='verified')continue;
    for(const move of a.moves){
      const value=cp(move),loss=centipawnLoss(move);
      if(move.color!==game.color||value===null||loss===null||loss<150||!(cycle?.focus==='conversion'?value>=200&&value<=500:Math.abs(value)<=200))continue;
      if(store.db.prepare('SELECT id FROM puzzles WHERE game_id=? AND ply=?').get(game.id,move.ply))continue;
      candidates.push({game,move,loss});
    }
  }
  // Recent games first; one position per game in the first pass adds variety.
  const diverse=[],rest=[];
  for(const candidate of candidates){if(seen.has(candidate.game.id))rest.push(candidate);else {seen.add(candidate.game.id);diverse.push(candidate);}}
  return [...diverse,...rest].slice(0,30);
}
