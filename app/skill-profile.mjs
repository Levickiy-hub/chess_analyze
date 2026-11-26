import { expectation, sustainedAdvantage } from './domain.mjs';
// Descriptive indices, not calibrated estimates of playing strength.
const round=n=>Number.isFinite(n)?Math.round(n*100)/100:null;
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const ownCP=(s,color)=>s?.kind==='cp'&&Number.isFinite(s.value)?s.value*(color==='w'?1:-1):null;
const bands={balanced:{label:'Равные позиции · −2…+2',accept:cp=>cp>=-200&&cp<=200},ahead:{label:'Лучшие позиции · +2…+5',accept:cp=>cp>200&&cp<=500},behind:{label:'Худшие позиции · −5…−2',accept:cp=>cp>=-500&&cp< -200}};
export function centipawnLoss(m) {
 if(expectation(m.before,m.color)===null||expectation(m.scoreAfter,m.color)===null)return null;
 if(m.isBest)return 0;
 if(m.before.kind==='mate')return m.before.winner===m.color?(m.scoreAfter.kind==='mate'&&m.scoreAfter.winner===m.color?0:300):null;
 if(m.scoreAfter.kind==='mate')return m.scoreAfter.winner===m.color?0:300;
 const before=ownCP(m.before,m.color),after=ownCP(m.scoreAfter,m.color);
 return before===null||after===null?null:Math.max(0,before-after);
}
const specs=[
 ['opening','Дебют',m=>m.features?.phase==='opening','Ходы дебюта по определению стадии приложения.'],
 ['tactics','Тактическая осторожность',m=>tactical(m),'До хода хотя бы у одной стороны есть атакованная незащищённая фигура (по геометрическим признакам). Это не тест всей тактики.'],
 ['attack','Сохранение атаки',m=>(m.features?.[m.color==='w'?'b':'w']?.kingDanger??0)>=3,'До хода атакованы не менее трёх полей в зоне короля соперника. Сыгранный шах не используется как критерий отбора.'],
 ['defense','Защита',m=>{const cp=ownCP(m.before,m.color);return cp!==null&&cp< -50||(m.features?.[m.color]?.kingDanger??0)>=3;},'До хода оценка хуже −0,5 пешки или атакованы ≥3 полей в зоне своего короля; применяется выбранный диапазон оценок.'],
 ['endgame','Эндшпиль',m=>m.features?.phase==='endgame','Ходы эндшпиля по материалу. Равные и уже решённые окончания не смешиваются.'],
 ['time','Игра в цейтноте',m=>m.format!=='daily'&&m.clockEligible!==false&&Number.isFinite(m.clock)&&m.clock<30,'Известный остаток после хода <30 секунд в поддерживаемом live-контроле. Это качество решений в цейтноте, а не оценка всего управления временем.'],
 ['position','Позиционная аккуратность',m=>m.features?.phase==='middlegame'&&!tactical(m)&&(m.features?.w?.kingDanger??0)<3&&(m.features?.b?.kingDanger??0)<3,'Миттельшпиль без отмеченных незащищённых фигур и без ≥3 атакованных полей вокруг короля любой стороны. Эвристика, не доказательство отсутствия тактики.']
];
function tactical(m){return ['w','b'].some(c=>(m.features?.[c]?.hanging??[]).length>0);}
function measure(items) {
 const groups=new Map();
 for(const x of items){if(!groups.has(x.gameId))groups.set(x.gameId,[]);groups.get(x.gameId).push(x.loss);}
 const gameScores=[...groups.values()].map(losses=>100*(1-mean(losses.map(x=>Math.min(300,x)))/300));
 return {n:items.length,games:groups.size,index:round(mean(gameScores)),acpl:round(mean(items.map(x=>x.loss))),cappedLoss:round(mean(items.map(x=>Math.min(300,x.loss)))),errors:items.filter(x=>x.loss>=150).length,blunders:items.filter(x=>x.loss>=300).length,errorRate:round(items.length?100*items.filter(x=>x.loss>=150).length/items.length:null),blunderRate:round(items.length?100*items.filter(x=>x.loss>=300).length/items.length:null)};
}

function timeAvailability({cohort,analyses,moves,evaluated,stats,minMoves,minGames,window,band}) {
 const raw=cohort.flatMap(g=>(g.moves??analyses.get(g.id)?.moves??[]).filter(m=>m.color===g.color));
 const clocks=raw.filter(m=>Number.isFinite(m.clock)),pressure=clocks.filter(m=>m.clock<30);
 const eligible=m=>m.format!=='daily'&&m.clockEligible!==false&&Number.isFinite(m.clock)&&m.clock<30;
 const matched=moves.filter(eligible),rated=evaluated.filter(eligible);
 const minimum=clocks.length?round(clocks.reduce((min,m)=>Math.min(min,m.clock),Infinity)):null;
 const counts={ownMoves:raw.length,clockMoves:clocks.length,pressureMoves:pressure.length,matchedMoves:matched.length,evaluatedMoves:rated.length,selectedMoves:stats.n,selectedGames:stats.games,minimumClock:minimum};
 const make=(code,title,message,hint='')=>({code,title,message,hint,...counts});
 if(!cohort.length)return make('no_games','Нет партий','По выбранным фильтрам нет партий.','Измените период или фильтры.');
 if(cohort.every(g=>g.timeClass==='daily'))return make('not_live','Заочные партии','Для заочных партий оценка игры в цейтноте не рассчитывается.','Выберите рапид, блиц или пулю.');
 if(moves.length&&moves.every(m=>m.clockEligible===false))return make('unsupported_control','Контроль не поддерживается','В выбранных партиях нет поддерживаемого live-контроля времени.','Для этой оценки нужен контроль вида 300 или 300+2.');
 if(!clocks.length)return make('no_clocks','Нет данных часов','В выбранных партиях нет собственных ходов с сохранённым остатком времени.','Для этой оценки нужны партии с часами в PGN.');
 if(!pressure.length)return make('no_pressure','Цейтнот не наблюдался',`В выбранной группе из ${cohort.length} партий ${clocks.length===raw.length?'не было ходов':'среди ходов с известными часами нет ходов'} с остатком менее 30 секунд. Минимальный сохранённый остаток — ${minimum} с.`,window==='all'?'Отсутствие цейтнота не означает плохое управление временем.':'Можно выбрать «Вся выбранная история». Отсутствие цейтнота не означает плохое управление временем.');
 if(!matched.length)return make('not_in_analysis','Нет подходящего анализа',`В партиях есть ${pressure.length} ходов с остатком менее 30 секунд, но они не вошли в доступный анализ с текущими фильтрами.`,`Проверьте фильтры ходов и источник анализа.`);
 if(!rated.length)return make('no_evaluations','Нет оценок позиций',`Среди ${matched.length} ходов в цейтноте нет ходов с достаточными оценками до и после.`,`Для расчёта нужен анализ соответствующих позиций.`);
 if(!stats.n)return make('outside_band','Исключено диапазоном',`Есть ${rated.length} оценённых ходов в цейтноте, но ни один не попал в диапазон «${bands[band].label}».`,'Выберите другой диапазон оценки до хода или расширьте историю.');
 if(stats.n<minMoves||stats.games<minGames)return make('small_sample','Мало подходящих ходов',`В выбранном диапазоне найдено ${stats.n} ходов в цейтноте в ${stats.games} партиях. Для оценки требуется минимум ${minMoves} ходов в ${minGames} партиях.`,window==='all'?'Можно проверить другие диапазоны оценки до хода.':'Попробуйте выбрать 200 партий или «Вся выбранная история».');
 return null;
}
export function buildSkillProfile({games,analyses,playerMoves,minSample,includeRecovered,filter={}}) {
 const formats=[...new Set(games.map(g=>g.timeClass))];
 const format=filter.format|| (formats.includes('rapid')?'rapid':formats[0]??null);
 const window=['50','100','200','all'].includes(String(filter.skillWindow))?String(filter.skillWindow):'100';
 const band=bands[filter.skillBand]?filter.skillBand:'balanced';
 const pool=games.filter(g=>g.timeClass===format).slice().sort((a,b)=>(b.end??0)-(a.end??0)||a.id.localeCompare(b.id));
 const recent=window==='all'?pool:pool.slice(0,Number(window));
 const previous=window==='all'?[]:pool.slice(Number(window),2*Number(window));
 const minMoves=Math.max(30,minSample),minGames=5;
 const calculate=cohort=>{
  const ids=new Set(cohort.map(g=>g.id));
  const moves=playerMoves.filter(m=>ids.has(m.gameId));
  const all=moves.map(m=>({...m,loss:centipawnLoss(m)})).filter(m=>m.loss!==null);
  const make=(key,label,predicate,selection)=>{
   const context=all.filter(predicate),selected=context.filter(m=>bands[band].accept(ownCP(m.before,m.color)??Infinity)),stats=measure(selected);
   return {key,label,value:stats.n>=minMoves&&stats.games>=minGames?stats.index:null,...stats,unit:'ходов',minSample:minMoves,minGames,selection,
    unavailableReason:key==='time'?timeAvailability({cohort,analyses,moves,evaluated:all,stats,minMoves,minGames,window,band}):null,
    formula:'Для каждой партии: 100 × (1 − среднее min(потеря cp, 300) / 300). Индекс — среднее этих значений по партиям: длинные партии не имеют большего веса. Потеря = max(0, оценка до − после) с точки зрения игрока. Потеря мата или допущенный мат = 300 cp; лучший ход = 0. Это выбранная шкала потери до трёх пешек, не процент навыка и не рейтинг.',
    bands:Object.entries(bands).map(([key,b])=>({key,label:b.label,...measure(context.filter(m=>b.accept(ownCP(m.before,m.color)??Infinity)))})),
    excluded:context.length-selected.length,provisional:selected.some(m=>m.source==='recovered'),examples:selected.filter(m=>m.loss>=150).sort((a,b)=>b.loss-a.loss).slice(0,3).map(m=>({gameId:m.gameId,ply:m.ply,loss:m.loss}))};
  };
  const skills=specs.map(([key,label,predicate,selection])=>make(key,label,predicate,selection));
  const reached=[];
  if(!filter.phase&&!filter.category&&!filter.motif)for(const g of cohort){
   const a=analyses.get(g.id);if(!a||a.source!=='verified'&&!includeRecovered)continue;
   const has=sustainedAdvantage(a.moves??[],g.color,200);
   if(has&&['win','draw','loss'].includes(g.outcome))reached.push(g);
  }
  const wins=reached.filter(g=>g.outcome==='win').length;
  skills.push({key:'conversion',label:'Реализация преимущества',value:reached.length>=Math.max(5,minSample)?round(100*wins/reached.length):null,n:reached.length,games:reached.length,unit:'партий',minSample:Math.max(5,minSample),minGames:5,wins,selection:'Тот же период и формат: партии с известным результатом и перевесом ≥+2 до двух последовательных собственных ходов (либо мат в пользу игрока). Диапазон позиций радара не применяется. При фильтре отдельных ходов оценка реализации отключена.',formula:'100 × победы / (победы + ничьи + поражения) после устойчивого перевеса. Ничья не считается реализацией победы. Это доля побед, не индекс потери оценки.',provisional:reached.some(g=>analyses.get(g.id)?.source==='recovered'),bands:[],examples:reached.filter(g=>g.outcome!=='win').slice(0,3).map(g=>({gameId:g.id}))});
  return skills;
 };
 const skills=calculate(recent),previousSkills=previous.length===recent.length&&recent.length>0?calculate(previous):[];
 return {version:'skill-loss-v2',format,window,band,bandLabel:bands[band].label,games:recent.length,previousGames:previous.length,from:recent.at(-1)?.end??null,to:recent[0]?.end??null,
  minMoves,minGames,analysed:recent.filter(g=>{const a=analyses.get(g.id);return a&&(a.source==='verified'||includeRecovered);}).length,
  notes:['Индексы описывают сохранение оценки в выбранных ситуациях. Калибровки по рейтингу нет; более высокий рейтинг не обязан давать больший балл по каждой оси.','Разница сложности позиций, соперников и глубины поиска остаётся. Не сравнивайте разные диапазоны оценок и форматы.','Ошибки: потеря ≥150 cp; зевки: ≥300 cp (включая ошибки). Уже решённые позиции за пределами ±5 пешек исключены из игровых осей.',...(filter.category||filter.phase||filter.motif||filter.result?['Активен фильтр ходов, стадии или результата: профиль описывает только эту ограниченную выборку. Фильтр ошибок не подходит для оценки общей аккуратности.']:[])],
  skills:skills.map(s=>({...s,previous:previousSkills.find(p=>p.key===s.key)??null}))};
}
