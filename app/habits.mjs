import { Chess } from 'chess.js';
import { randomUUID } from 'node:crypto';
import { centipawnLoss } from './skill-profile.mjs';
import { timeControl } from './domain.mjs';
import { opponentKind } from './opponent-kind.mjs';
import { selectGames } from './analytics.mjs';

export const HABITS={
  capture:{title:'Проверять ответные взятия',hypothesis:'Возможно, при выборе хода вы не всегда проверяете ответные взятия.',action:'Перед ходом перечислите взятия соперника и проверьте итоговый материал.',unit:'позиций с проверяемым ответом движка'},
  time:{title:'Ошибки при запасе времени',hypothesis:'Одной нехваткой времени эти ошибки не объясняются. Проверьте, помогает ли пауза перед решением.',action:'При запасе времени выберите два хода-кандидата и проверьте сильнейший ответ на каждый.',unit:'ходов с запасом не менее 60 секунд'},
  conversion:{title:'Сохранение устойчивого перевеса',hypothesis:'Возможно, при перевесе вы недооцениваете контригру соперника.',action:'Перед активным ходом при перевесе проверьте угрозы королю и незащищённым фигурам.',unit:'ходов при устойчивом перевесе +2…+5'},
};
const cp=(s,c)=>s?.kind==='cp'&&!s.bound&&Number.isFinite(s.value)?s.value*(c==='w'?1:-1):null;
const round=n=>Math.round(n*10)/10;
const material=(b,c)=>b.board().flat().filter(Boolean).reduce((n,p)=>n+({p:1,n:3,b:3,r:5,q:9,k:0}[p.type])*(p.color===c?1:-1),0);

function captureProof(game,a,m){
  const p=a.positions?.[m.ply],line=p?.lines?.[0];
  if(!line||p.score?.bound||!Number.isFinite(line.depth)||line.depth<8||line.bound||line.score?.bound||!Array.isArray(line.pv)||line.pv.length<3||line.pv[0]!==p.bestMove)return null;
  try{
    const board=new Chess(m.after),before=material(new Chess(m.fen),m.color),played=[];
    for(const uci of line.pv.slice(0,6))played.push(board.move(uci));
    const first=played[0],loss=before-material(board,m.color);
    return {matches:Boolean(first.captured&&first.captured!=='p'&&loss>=2),evidence:`Ответ движка: ${played.map(p=>p.san).join(' ')}. Материальный баланс в конце линии хуже исходного на ${round(loss)}.`};
  }catch{return null;}
}

const entryCache=new WeakMap();
export function habitEntries(games,analyses,kind,format,preset){
  const entries=[];
  for(const game of games){
    if(game.timeClass!==format||game.opponentType==='bot'||opponentKind(game).type==='bot')continue;
    const a=analyses.get(game.id);if(a?.source!=='verified'||a.preset!==preset)continue;
    let cached=entryCache.get(a);if(!cached){cached=new Map();entryCache.set(a,cached);}const cacheKey=kind+'|'+game.id+'|'+format;
    if(cached.has(cacheKey)){entries.push(...cached.get(cacheKey));continue;}const start=entries.length;
    const own=a.moves.filter(m=>m.color===game.color);
    for(let i=0;i<own.length;i++){
      const move=own[i],before=cp(move.before,move.color),after=cp(move.scoreAfter,move.color),loss=centipawnLoss(move);
      if(before===null||after===null||Math.abs(before)>500||loss===null)continue;
      let eligible=false,matches=loss>=150,evidence='';
      if(kind==='capture'){
        const proof=captureProof(game,a,move);eligible=Boolean(proof);matches=matches&&Boolean(proof?.matches);evidence=proof?.evidence??'';
      }else if(kind==='time'){
        const tc=timeControl(game.timeControl),clockBefore=Number.isFinite(move.clock)&&Number.isFinite(move.spent)&&tc?move.clock+move.spent-tc.increment:null;
        eligible=game.timeClass!=='daily'&&clockBefore!==null&&clockBefore>=60;
        evidence=eligible?`До хода: ${round(clockBefore)} с. На ход: ${round(move.spent)} с. Потеря оценки: ${round(loss/100)} пешки.`:'';
      }else if(kind==='conversion'){
        const previous=own.slice(Math.max(0,i-2),i+1);
        eligible=previous.length===3&&previous.every((m,j)=>cp(m.before,m.color)>=200&&cp(m.before,m.color)<=500&&(j===0||m.ply===previous[j-1].ply+2));
        matches=matches&&after<200;evidence=`До: ${round(before/100)}, после: ${round(after/100)} пешки. Перевес ≥+2 сохранялся перед тремя последовательными своими ходами.`;
      }
      if(eligible)entries.push({game,move,loss,matches,evidence});
    }
    cached.set(cacheKey,entries.slice(start));
  }
  return entries;
}
export function habitMeasure(entries){
  const errors=entries.filter(e=>e.matches),games=new Set(entries.map(e=>e.game.id));
  return {evaluated:entries.length,games:games.size,errors:errors.length,affectedGames:new Set(errors.map(e=>e.game.id)).size,rate:entries.length?round(100*errors.length/entries.length):null};
}
export function habitReport(selection,filter={}){
  if(['phase','category','motif','result','reason'].some(k=>filter[k]))return {priorities:[],note:'Для выводов о привычках сбросьте фильтры результата и отдельных ходов.'};
  const priorities=[],{games,analyses}=selection,groups=new Set();
  for(const g of games){const a=analyses.get(g.id);if(a?.source==='verified'&&['quick','standard','deep'].includes(a.preset))groups.add(g.timeClass+'|'+a.preset);}
  for(const group of groups){const [format,preset]=group.split('|'),cohort=games.filter(g=>Number.isFinite(g.end)&&g.endPrecision!=='day'&&g.timeClass===format&&analyses.get(g.id)?.source==='verified'&&analyses.get(g.id)?.preset===preset&&g.opponentType!=='bot'&&opponentKind(g).type!=='bot').slice(-100);
    for(const kind of Object.keys(HABITS)){
      const entries=habitEntries(cohort,analyses,kind,format,preset),stats=habitMeasure(entries);
      if(stats.errors<3||stats.affectedGames<3||stats.evaluated<30)continue;
      const errors=entries.filter(e=>e.matches).sort((a,b)=>b.loss-a.loss);
      const perGame=new Map();for(const e of errors)perGame.set(e.game.id,Math.max(perGame.get(e.game.id)??0,Math.min(300,e.loss)));
      priorities.push({key:kind+'|'+format+'|'+preset,kind,format,preset,...HABITS[kind],...stats,confidence:stats.affectedGames>=8&&stats.evaluated>=100?'Устойчивая повторяемость':'Предварительный вывод',impact:[...perGame.values()].reduce((a,b)=>a+b,0),examples:errors.slice(0,3).map(e=>({gameId:e.game.id,ply:e.move.ply,san:e.move.san,opponent:e.game.opponent,evidence:e.evidence})),refs:errors.slice(0,30).map(e=>({gameId:e.game.id,ply:e.move.ply}))});
    }
  }
  priorities.sort((a,b)=>b.impact-a.impact||b.affectedGames-a.affectedGames||a.key.localeCompare(b.key));
  const seen=new Set(),unique=priorities.filter(p=>{if(seen.has(p.kind))return false;seen.add(p.kind);return true;});
  return {priorities:unique.slice(0,3),note:'Только подтверждённые оценки Stockfish без границ; боты исключены. Формат и режим анализа сравниваются отдельно. Причина ошибки остаётся гипотезой.'};
}

export function startHabit(store,profile,key,filter={},now=Date.now()){
  const report=habitReport(selectGames(store,profile,filter),filter),p=report.priorities.find(p=>p.key===key);
  if(!p)throw new Error('Для этого вывода сейчас недостаточно подтверждённых данных. Обновите отчёт.');
  const old=store.db.prepare('SELECT id,data FROM habit_training WHERE profile=? ORDER BY started_at DESC').all(profile).find(r=>JSON.parse(r.data).key===key);
  if(old)return {id:old.id,...JSON.parse(old.data)};
  const id=randomUUID(),startedAt=new Date(now).toISOString(),data={...p,startedAt,filter,baseline:{evaluated:p.evaluated,games:p.games,errors:p.errors,rate:p.rate},baselineIds:selectGames(store,profile,filter).games.map(g=>g.id)};
  store.db.prepare('INSERT INTO habit_training VALUES(?,?,?,?)').run(id,profile,startedAt,JSON.stringify(data));return {id,...data};
}
export function habitCandidates(store,profile,id){
  const row=store.db.prepare('SELECT data FROM habit_training WHERE id=? AND profile=?').get(id,profile);if(!row)throw new Error('Тренировка не найдена.');
  const t=JSON.parse(row.data),linked=new Set(store.db.prepare('SELECT p.game_id,p.ply FROM habit_puzzles h JOIN puzzles p ON p.id=h.puzzle_id WHERE h.training_id=?').all(id).map(p=>p.game_id+'|'+p.ply)),refs=new Set(t.refs.map(r=>r.gameId+'|'+r.ply));
  const {from,to,...filter}=t.filter,selection=selectGames(store,profile,filter);
  return habitEntries(selection.games,selection.analyses,t.kind,t.format,t.preset).filter(e=>e.matches&&(refs.has(e.game.id+'|'+e.move.ply)||Number.isFinite(e.game.end)&&e.game.endPrecision!=='day'&&e.game.end*1000>Date.parse(t.startedAt))&&!linked.has(e.game.id+'|'+e.move.ply)).sort((a,b)=>b.game.end-a.game.end||b.loss-a.loss).slice(0,30);
}
export function habitTrainingReport(store,profile,now=Date.now()){
  return store.db.prepare('SELECT id,data FROM habit_training WHERE profile=? ORDER BY started_at DESC').all(profile).map(row=>{
    const t=JSON.parse(row.data),{from,to,...filter}=t.filter,selection=selectGames(store,profile,filter);
    const games=selection.games.filter(g=>Number.isFinite(g.end)&&g.endPrecision!=='day'&&g.end*1000>Date.parse(t.startedAt)&&g.end*1000<=now&&!t.baselineIds.includes(g.id));
    const progress=habitMeasure(habitEntries(games,selection.analyses,t.kind,t.format,t.preset));
    const ready=t.baseline.games>=5&&t.baseline.evaluated>=30&&progress.games>=5&&progress.evaluated>=30;
    const puzzles=store.db.prepare('SELECT p.data FROM puzzles p JOIN habit_puzzles h ON h.puzzle_id=p.id WHERE h.training_id=? AND p.profile=? ORDER BY p.id').all(row.id,profile).map(r=>{const {solution,fullLine,alternatives,mistake,...p}=JSON.parse(r.data);return p;});
    return {id:row.id,title:t.title,kind:t.kind,format:t.format,preset:t.preset,startedAt:t.startedAt,baseline:t.baseline,progress,ready,change:ready?round(progress.rate-t.baseline.rate):null,puzzles};
  });
}
