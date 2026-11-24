import { mean, median, expectation } from './domain.mjs';

export const PHASES={opening:'Дебют',middlegame:'Миттельшпиль',endgame:'Эндшпиль'};
const resultScore=g=>g.outcome==='win'?1:g.outcome==='draw'?.5:g.outcome==='loss'?0:null;
const pct=(n,d)=>d?100*n/d:null;
const round=value=>Number.isFinite(value)?Math.round(value*100)/100:null;
function bucket(items,key){const m=new Map();for(const item of items){const k=key(item);if(!m.has(k))m.set(k,[]);m.get(k).push(item);}return [...m].map(([key,items])=>({key,items}));}
function quality(moves){const rated=moves.filter(m=>Number.isFinite(m.accuracy));return {moves:moves.length,evaluated:rated.length,accuracy:round(mean(rated.map(m=>m.accuracy))),acpl:round(mean(moves.map(m=>m.loss))),agreement:pct(rated.filter(m=>m.isBest).length,rated.length),mistakes:rated.filter(m=>['mistake','blunder'].includes(m.category)).length,blunders:rated.filter(m=>m.category==='blunder').length,errorsPer100:pct(rated.filter(m=>['mistake','blunder','inaccuracy'].includes(m.category)).length,rated.length)};}
function outcomes(games){const wins=games.filter(g=>g.outcome==='win').length,losses=games.filter(g=>g.outcome==='loss').length,draws=games.filter(g=>g.outcome==='draw').length,score=mean(games.map(resultScore));return {games:games.length,wins,losses,draws,unknown:games.length-wins-losses-draws,winRate:pct(wins,wins+losses+draws),score:score===null?null:score*100};}
export function localTime(seconds,timezone){if(!Number.isFinite(seconds))return null;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(seconds*1000));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};}

export function selectGames(store,profile,filter={}){
  const settings=store.settings(),timezone=filter.timezone??settings.timezone,analyses=store.analyses(profile),all=store.games(profile);
  const games=all.filter(g=>{
    const date=localTime(g.end,timezone),a=analyses.get(g.id);
    if(filter.from&&(!date||date.date<filter.from)||filter.to&&(!date||date.date>filter.to))return false;
    for(const [key,prop] of [['color','color'],['format','timeClass'],['result','outcome'],['reason','reason']])if(filter[key]&&g[prop]!==filter[key])return false;
    if(filter.control&&g.timeControl!==filter.control)return false;
    if(filter.opponent&&!g.opponent.toLowerCase().includes(filter.opponent.toLowerCase()))return false;
    if(filter.opening&&!(g.opening+' '+g.eco).toLowerCase().includes(filter.opening.toLowerCase()))return false;
    if(filter.rated&&g.rated!==(filter.rated==='true'))return false;
    for(const [key,val] of [['minRating',g.rating],['minOpponent',g.opponentRating],['minDifference',g.opponentRating-g.rating]])if(filter[key]!==undefined&&filter[key]!==''&&(!Number.isFinite(val)||val<Number(filter[key])))return false;
    for(const [key,val] of [['maxRating',g.rating],['maxOpponent',g.opponentRating],['maxDifference',g.opponentRating-g.rating]])if(filter[key]!==undefined&&filter[key]!==''&&(!Number.isFinite(val)||val>Number(filter[key])))return false;
    if(filter.hour!==undefined&&filter.hour!==''&&date?.hour!==Number(filter.hour))return false;
    if(filter.hourFrom!==undefined&&filter.hourFrom!==''&&(!date||date.hour<Number(filter.hourFrom)||date.hour>=Number(filter.hourFrom)+3))return false;
    if(filter.weekday!==undefined&&filter.weekday!==''&&date?.weekday!==Number(filter.weekday))return false;
    if(filter.status&&((filter.status==='verified'&&a?.source!=='verified')||(filter.status==='recovered'&&a?.source!=='recovered')||(filter.status==='pending'&&a?.source==='verified')))return false;
    if(filter.version&&a?.version!==filter.version)return false;
    if(filter.phase&&!g.moves.some(m=>m.features.phase===filter.phase))return false;
    if(filter.category&&!a?.moves.some(m=>m.color===g.color&&m.category===filter.category))return false;
    if(filter.motif&&!a?.moves.some(m=>m.color===g.color&&m.motifs.includes(filter.motif)))return false;
    return true;
  });
  return {games,analyses,settings,timezone};
}
export function analytics(store,profile,filter={}){
  const {games,analyses,settings,timezone}=selectGames(store,profile,filter),minSample=settings.minSample;
  const includeRecovered=filter.includeRecovered===undefined?settings.includeRecovered:filter.includeRecovered==='true';
  const playerMoves=[],opponentMoves=[],byGame=new Map(),critical=[];
  let verified=0,recovered=0;
  for(const game of games){
    const a=analyses.get(game.id);if(a?.source==='verified')verified++;else if(a?.source==='recovered')recovered++;
    if(!a||(!includeRecovered&&a.source!=='verified'))continue;
    const own=[];
    for(const m of a.moves){
      const entry={...m,gameId:game.id,opponent:game.opponent,date:game.end,source:a.source,format:game.timeClass};
      if(m.color===game.color){
        if(filter.phase&&m.features.phase!==filter.phase||filter.category&&m.category!==filter.category||filter.motif&&!m.motifs.includes(filter.motif))continue;
        own.push(entry);playerMoves.push(entry);
        if(['blunder','mistake'].includes(m.category)||m.missedMate)critical.push({gameId:game.id,ply:m.ply,san:m.san,opponent:game.opponent,date:game.end,loss:m.loss,probabilityLoss:m.probabilityLoss,category:m.category,missedMate:m.missedMate,phase:m.features.phase,source:a.source});
      }else opponentMoves.push(entry);
    }
    byGame.set(game.id,own);
  }
  const basic=outcomes(games),q=quality(playerMoves);
  let bestWin=0,bestLoss=0,bestUnbeaten=0,win=0,loss=0,unbeaten=0;
  for(const g of games){win=g.outcome==='win'?win+1:0;loss=g.outcome==='loss'?loss+1:0;unbeaten=['win','draw'].includes(g.outcome)?unbeaten+1:0;bestWin=Math.max(bestWin,win);bestLoss=Math.max(bestLoss,loss);bestUnbeaten=Math.max(bestUnbeaten,unbeaten);}
  const ratings=bucket(games.filter(g=>g.rating!==null&&g.rated),g=>g.timeClass).map(({key,items})=>({format:key,min:Math.min(...items.map(g=>g.rating)),max:Math.max(...items.map(g=>g.rating)),currentObserved:items.at(-1)?.rating,change:items.at(-1).rating-items[0].rating,series:items.map(g=>({time:g.end,rating:g.rating,gameId:g.id})),monthly:bucket(items,g=>localTime(g.end,timezone)?.date.slice(0,7)).map(({key,items})=>({month:key,games:items.length,change:items.at(-1).rating-items[0].rating,average:mean(items.map(g=>g.rating))}))}));
  const groupStats=(items,key)=>bucket(items,key).map(({key,items})=>({key,...outcomes(items),...quality(items.flatMap(g=>byGame.get(g.id)??[])),gameIds:items.map(g=>g.id)}));
  const openings=groupStats(games,g=>(g.eco?g.eco+' · ':'')+g.opening).sort((a,b)=>b.games-a.games).map(row=>{
    const moves=row.gameIds.flatMap(id=>byGame.get(id)??[]).filter(m=>m.features.phase==='opening');
    return {...row,openingAccuracy:quality(moves).accuracy,firstError:median(row.gameIds.map(id=>(byGame.get(id)??[]).find(m=>m.features.phase==='opening'&&['mistake','blunder'].includes(m.category))?.fullmove)),thinking:mean(moves.map(m=>m.spent)),checkpoints:[5,10,15,20].map(n=>({move:n,evaluation:mean(row.gameIds.map(id=>{const g=games.find(g=>g.id===id),m=analyses.get(id)?.moves.find(m=>m.fullmove===n&&m.color===g.color);return m?.scoreAfter?.kind==='cp'?m.scoreAfter.value*(g.color==='w'?1:-1):null;}))}))};
  });
  const phases=Object.entries(PHASES).map(([key,label])=>({key,label,...quality(playerMoves.filter(m=>m.features.phase===key)),thinking:mean(playerMoves.filter(m=>m.features.phase===key).map(m=>m.spent)),games:new Set(playerMoves.filter(m=>m.features.phase===key).map(m=>m.gameId)).size}));
  const endings=groupStats(games.filter(g=>g.moves.some(m=>m.features.ending)),g=>[...g.moves].reverse().find(m=>m.features.ending)?.features.ending??'unknown');
  for(const row of endings){const moves=row.gameIds.flatMap(id=>byGame.get(id)??[]).filter(m=>m.features.phase==='endgame');Object.assign(row,quality(moves));}
  const conversion=[100,200,300,500,1000].map(threshold=>{
    const reached=games.filter(g=>{let consecutive=0;for(const m of byGame.get(g.id)??[]){const v=m.before?.kind==='cp'?m.before.value*(g.color==='w'?1:-1):m.before?.kind==='mate'&&m.before.winner===g.color?100000:-100000;consecutive=v>=threshold?consecutive+1:0;if(consecutive>=2)return true;}return false;});
    return {threshold,...outcomes(reached),gameIds:reached.map(g=>g.id)};
  });
  const comeback=games.filter(g=>(byGame.get(g.id)??[]).some(m=>m.before?.kind==='cp'&&m.before.value*(g.color==='w'?1:-1)<=-300));
  const timeMoves=playerMoves.filter(m=>Number.isFinite(m.spent));
  const timeGroups=[[0,1],[1,3],[3,5],[5,10],[10,20],[20,30],[30,Infinity]].map(([low,high])=>({label:high===Infinity?'30+':`${low}–${high}`, ...quality(timeMoves.filter(m=>m.spent>=low&&m.spent<high))}));
  const pressure=playerMoves.filter(m=>Number.isFinite(m.clock)&&m.clock<30),enough=playerMoves.filter(m=>Number.isFinite(m.clock)&&m.clock>=60);
  const sessions=[];let current=null;
  for(const game of games.filter(g=>g.timeClass!=='daily'&&g.end)){
    const start=game.start??game.end;
    if(!current||start-current.end>settings.sessionGap*60){current={id:game.id,start,end:game.end,items:[]};sessions.push(current);}current.items.push(game);current.end=Math.max(current.end,game.end);
  }
  const sessionRows=sessions.map(s=>({id:s.id,start:s.start,end:s.end,duration:s.end-s.start,...outcomes(s.items),...quality(s.items.flatMap(g=>byGame.get(g.id)??[])),ratingChange:s.items.filter(g=>g.rated).length>1&&new Set(s.items.filter(g=>g.rated).map(g=>g.timeClass)).size===1?s.items.at(-1).rating-s.items[0].rating:null,gameIds:s.items.map(g=>g.id)}));
  const sessionPosition=Array.from({length:Math.min(20,Math.max(0,...sessions.map(s=>s.items.length)))},(_,i)=>{const selected=sessions.map(s=>s.items[i]).filter(Boolean);return {position:i+1,...outcomes(selected),...quality(selected.flatMap(g=>byGame.get(g.id)??[]))};});
  const afterResult=['win','loss','draw'].map(outcome=>{const selected=sessions.flatMap(s=>s.items.filter((g,i)=>i>0&&s.items[i-1].outcome===outcome));return {after:outcome,...outcomes(selected),...quality(selected.flatMap(g=>byGame.get(g.id)??[]))};});
  const heatmap=bucket(games.filter(g=>g.end),g=>{const t=localTime(g.end,timezone);return t.weekday+':'+Math.floor(t.hour/3)*3;}).map(({key,items})=>({key,...outcomes(items)}));
  const opponents=groupStats(games,g=>g.opponent).sort((a,b)=>b.games-a.games);
  const ratingBands=groupStats(games,g=>g.opponentRating?`${Math.floor(g.opponentRating/200)*200}–${Math.floor(g.opponentRating/200)*200+199}`:'Неизвестно');
  const differenceBands=groupStats(games,g=>g.rating===null||g.opponentRating===null?'Неизвестно':g.opponentRating-g.rating<=-200?'Слабее на 200+':g.opponentRating-g.rating>=200?'Сильнее на 200+':'В пределах ±200');
  const motifs=bucket(playerMoves.flatMap(m=>m.motifs.map(motif=>({motif,move:m}))),x=>x.motif).map(({key,items})=>({key,count:items.length,errors:items.filter(x=>['mistake','blunder'].includes(x.move.category)).length,examples:items.slice(0,20).map(x=>({gameId:x.move.gameId,ply:x.move.ply}))}));
  const positional=['isolated','doubled','passed','kingDanger','center','undeveloped'].map(key=>({key,average:mean(games.flatMap(g=>g.moves.filter(m=>m.color===g.color).map(m=>m.features[g.color][key]))),qualityWhenPresent:quality(playerMoves.filter(m=>m.features[m.color][key]>0)),examples:playerMoves.filter(m=>m.features[m.color][key]>0).slice(0,20).map(m=>({gameId:m.gameId,ply:m.ply}))}));
  const tacticMoves=playerMoves.filter(m=>m.motifs.some(x=>['fork-candidate','pin-candidate','hanging-piece','material-loss'].includes(x)));
  const defense=playerMoves.filter(m=>expectation(m.before,m.color)!==null&&expectation(m.before,m.color)<.3);
  const attack=playerMoves.filter(m=>m.san.includes('+')||m.features[m.color==='w'?'b':'w'].kingDanger>=3);
  const positionalMoves=playerMoves.filter(m=>m.features.phase==='middlegame'&&!m.san.includes('+'));
  const skills=[...phases.map(p=>({key:p.key,label:p.label,value:p.accuracy,n:p.evaluated})),{key:'tactics',label:'Тактика · оценка в отмеченных позициях',value:quality(tacticMoves).accuracy,n:tacticMoves.length},{key:'position',label:'Позиционная игра · эвристика',value:quality(positionalMoves).accuracy,n:positionalMoves.length},{key:'attack',label:'Атака · эвристика',value:quality(attack).accuracy,n:attack.length},{key:'defense',label:'Защита',value:quality(defense).accuracy,n:defense.length},{key:'time',label:'Игра при малом времени',value:quality(pressure).accuracy,n:pressure.length},{key:'conversion',label:'Реализация +2',value:conversion[1].winRate,n:conversion[1].games}].map(s=>({...s,value:s.n>=minSample?s.value:null,provisional:recovered>0&&includeRecovered}));
  const recommendations=[];
  const weakest=[...phases].filter(p=>p.evaluated>=minSample).sort((a,b)=>a.accuracy-b.accuracy)[0];
  if(weakest)recommendations.push({id:'phase-'+weakest.key,title:'Уделите внимание: '+weakest.label.toLowerCase(),reason:`Собственный показатель качества ${round(weakest.accuracy)} / 100 на ${weakest.evaluated} оценённых ходах.`,action:'Разберите ошибки этой стадии и повторите позиции в тренировках.',priority:'high',filter:{phase:weakest.key},gameIds:[...new Set(critical.filter(m=>m.phase===weakest.key).map(m=>m.gameId))].slice(0,10)});
  const strongest=[...phases].filter(p=>p.evaluated>=minSample).sort((a,b)=>b.accuracy-a.accuracy)[0];
  if(strongest&&strongest.key!==weakest?.key)recommendations.push({id:'strength-'+strongest.key,title:'Относительная сильная сторона: '+strongest.label.toLowerCase(),reason:`В этой выборке показатель качества выше остальных стадий: ${round(strongest.accuracy)} / 100, ${strongest.evaluated} ходов.`,action:'Сохраняйте удачные приёмы; сравните с новым периодом при том же формате и режиме анализа.',priority:'low',filter:{phase:strongest.key},gameIds:games.filter(g=>(byGame.get(g.id)??[]).some(m=>m.features.phase===strongest.key)).slice(0,5).map(g=>g.id)});
  for(const opening of openings.filter(o=>o.games>=minSample&&o.winRate<45).slice(0,3))recommendations.push({id:'opening-'+opening.key,title:'Проверьте репертуар: '+opening.key,reason:`${opening.games} партий, побед ${round(opening.winRate)}%. Это наблюдение, не доказательство неудачного выбора дебюта.`,action:'Сравните первые ошибки и типичные ответы соперников.',priority:'medium',gameIds:opening.gameIds.slice(0,10),filter:{opening:opening.key.split(' · ').at(-1)}});
  if(pressure.length>=minSample&&quality(enough).accuracy-quality(pressure).accuracy>5)recommendations.push({id:'time',title:'Сохраните время к критическим позициям',reason:`Качество при остатке <30 с ниже на ${round(quality(enough).accuracy-quality(pressure).accuracy)} пунктов; ${pressure.length} ходов.`,action:'Сравните свои длинные обдумывания и ошибки в цейтноте.',priority:'high',gameIds:pressure.filter(m=>m.category==='blunder').slice(0,10).map(m=>m.gameId),filter:{}});
  const late=sessionPosition.filter(p=>p.position>=6&&p.evaluated>=minSample),early=sessionPosition.filter(p=>p.position<=3);
  if(late.length&&mean(early.map(p=>p.accuracy))-mean(late.map(p=>p.accuracy))>5)recommendations.push({id:'session',title:'Попробуйте перерыв в длинной сессии',reason:'В поздних партиях наблюдается снижение качества. Это статистическая связь, не определение усталости или тильта.',action:'Сравните результат после перерывов на следующем периоде.',priority:'medium',gameIds:sessionRows.filter(s=>s.games>=6).flatMap(s=>s.gameIds).slice(0,10),filter:{}});
  if(!recommendations.length)recommendations.push({id:'coverage',title:'Соберите сопоставимую выборку',reason:'Для надёжных персональных выводов нужны оценённые партии одного формата и достаточный размер выборки.',action:'Запустите анализ, затем сравните периоды по одному формату.',priority:'medium',gameIds:[],filter:{}});
  const tree={san:'Начальная позиция',games:0,wins:0,draws:0,children:{}};
  for(const g of games){let node=tree;node.games++;node.wins+=g.outcome==='win'?1:0;node.draws+=g.outcome==='draw'?1:0;for(const m of g.moves.slice(0,24)){node.children[m.uci]??={san:m.san,uci:m.uci,fen:m.after,games:0,wins:0,draws:0,children:{}};node=node.children[m.uci];node.games++;node.wins+=g.outcome==='win'?1:0;node.draws+=g.outcome==='draw'?1:0;}}
  const durations=games.map(g=>g.duration).filter(Number.isFinite);
  return {profile,timezone,filter,sample:games.length,coverage:{verified,recovered,missing:games.length-verified-recovered,includeRecovered,estimated:includeRecovered&&recovered>0},categories:Object.fromEntries(bucket(playerMoves,m=>m.category).map(x=>[x.key,x.items.length])),summary:{...basic,...q,plies:games.reduce((s,g)=>s+g.plies,0),averageMoves:mean(games.map(g=>Math.ceil(g.plies/2))),minMoves:games.length?Math.min(...games.map(g=>Math.ceil(g.plies/2))):null,maxMoves:games.length?Math.max(...games.map(g=>Math.ceil(g.plies/2))):null,totalSeconds:durations.length?durations.reduce((a,b)=>a+b,0):null,durationCoverage:durations.length,averageDuration:mean(durations),activeDays:new Set(games.map(g=>localTime(g.end,timezone)?.date).filter(Boolean)).size,bestWinStreak:bestWin,bestLossStreak:bestLoss,bestUnbeatenStreak:bestUnbeaten,opponentAccuracy:quality(opponentMoves).accuracy},formats:groupStats(games,g=>g.timeClass),colors:groupStats(games,g=>g.color),reasons:bucket(games,g=>g.outcome==='win'?g.opponentReason??g.reason:g.reason).map(({key,items})=>({key,...outcomes(items)})),ratings,openings,tree,phases,endings,conversion,comebacks:outcomes(comeback),missedMates:critical.filter(m=>m.missedMate),critical:critical.sort((a,b)=>(b.probabilityLoss??0)-(a.probabilityLoss??0)).slice(0,200),time:{clockMoves:timeMoves.length,mean:mean(timeMoves.map(m=>m.spent)),median:median(timeMoves.map(m=>m.spent)),buckets:timeGroups,pressure:quality(pressure),enough:quality(enough),remaining:mean(games.map(g=>[...g.moves].reverse().find(m=>m.color===g.color)?.clock)),timeouts:games.filter(g=>['timeout','timevsinsufficient'].includes(g.reason)).length},sessions:sessionRows,sessionPosition,afterResult,heatmap,opponents,ratingBands,differenceBands,motifs,positional,skills,recommendations,methodology:{version:'personal-v2',accuracy:'100 × exp(−4 × потеря модельного ожидаемого результата); P=1/(1+exp(−cp/250)), мат → 0/1. Не Chess.com accuracy и не калиброванный прогноз победы.',acpl:'Среднее max(0,оценка до − оценка после) с POV сделавшего ход; включены нули, матовые значения исключены. Совпадение с bestMove имеет loss=0.',phases:'Эндшпиль: суммарный непешечный материал ≤20, либо без ферзей ≤26; дебют: до 12 полного хода и материал ≥44; остальное — миттельшпиль. Эвристика.',motifs:'Кандидаты геометрических мотивов, не доказанная причина ошибки. Позиционные признаки — счётчики структуры доски.',rating:'История — наблюдаемый рейтинг до партий; не точная post-game история. Официальный current/best — из Chess.com stats отдельно.',sessions:'Только live-партии, разрыв > '+settings.sessionGap+' минут; daily исключены.',time:'Остаток предыдущего хода той же стороны + increment − новый остаток; неполные/неподдерживаемые time controls пропускаются.'}};
}
