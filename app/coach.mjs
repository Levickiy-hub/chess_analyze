import { Chess } from 'chess.js';
import { PHASES } from './analytics.mjs';

const error = m => ['mistake', 'blunder'].includes(m.category);
const round = n => Math.round(n * 10) / 10;
const pieces = {p:'пешку',n:'коня',b:'слона',r:'ладью',q:'ферзя'};
const sourceNote = source => source === 'verified' ? 'Сохранённый анализ Stockfish. Оценка зависит от глубины поиска.' : 'Историческая оценка: глубина и параметры поиска неизвестны; вывод предварительный.';

// Explain only facts present in the saved analysis. Geometric hints are not causes.
export function explainMove(game, analysis, ply) {
  const move = analysis?.moves?.find(m => m.ply === ply), original = game.moves.find(m => m.ply === ply);
  if (!move || !original) return {available:false, text:'Для этого хода нет сохранённого анализа. Запустите анализ партии в удобное время.'};
  const observations = [], next = game.moves.find(m => m.ply === ply + 1);
  if (move.missedMate) observations.push('До хода движок находил форсированный мат в пользу сделавшей ход стороны; после хода такой мат в сохранённом поиске не найден.');
  if (move.scoreAfter?.kind === 'mate' && move.scoreAfter.winner !== move.color) observations.push('После хода движок находит форсированный мат королю сделавшей ход стороны.');
  if (next?.captured) observations.push(`В партии соперник следующим ходом ${next.san} взял ${pieces[next.captured] ?? 'фигуру'}. Само взятие ещё не доказывает ошибку или отсутствие компенсации.`);
  const hanging = move.features?.[move.color]?.hanging ?? [];
  if (hanging.length) observations.push(`Перед ходом под атакой без защиты находились фигуры на ${hanging.map(p => p.square).join(', ')}. Это признак позиции, а не установленная причина ошибки.`);
  if (Number.isFinite(move.loss)) observations.push(`Потеря оценки с точки зрения сделавшей ход стороны: ${round(move.loss / 100)} пешки по методике приложения.`);
  let best = null, variation = [];
  try {
    const board = new Chess(original.fen), uci = move.bestMove;
    if (uci && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) best = board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]}).san;
    const line = move.pv?.[0]?.pv ?? [];
    if (line[0] === uci) {
      const replay = new Chess(original.fen);
      for (const step of line.slice(0,8)) variation.push(replay.move({from:step.slice(0,2),to:step.slice(2,4),promotion:step[4]}).san);
    }
  } catch { variation = []; }
  if (!observations.length) observations.push('Для этого хода нет достаточно данных, чтобы назвать конкретную причину. Сравните угрозы в сыгранном и предложенном вариантах.');
  const advice = move.missedMate ? 'Сначала проверьте все шахи и ответы соперника. Повторите позицию без подсказки.' : 'Перед ходом проверьте шахи, взятия и угрозы обеих сторон; затем сравните свой выбор с вариантом движка.';
  return {available:true,gameId:game.id,ply,san:original.san,color:move.color,source:analysis.source,depth:move.depth??null,fen:original.fen,before:move.before??null,after:move.scoreAfter??null,best,variation,observations,advice,note:sourceNote(analysis.source)};
}

export function coachReport(selection, filter = {}) {
  const {games, analyses, settings} = selection;
  const includeRecovered = filter.includeRecovered === undefined ? settings.includeRecovered : filter.includeRecovered === 'true';
  const records = [], all = [], counts = {verified:0,recovered:0,missing:0};
  for (const game of games) {
    const analysis = analyses.get(game.id);
    if (analysis?.source === 'verified') counts.verified++; else if (analysis?.source === 'recovered') counts.recovered++; else counts.missing++;
    if (!analysis || analysis.source !== 'verified' && !includeRecovered) continue;
    const moves = (analysis.moves ?? []).filter(m => m.color === game.color && Number.isFinite(m.accuracy)
      && (!filter.phase || m.features?.phase === filter.phase) && (!filter.category || m.category === filter.category)
      && (!filter.motif || m.motifs?.includes(filter.motif)));
    if (moves.length) records.push({game,analysis,moves});
    for (const move of moves) all.push({game,analysis,move});
  }
  const errors = all.filter(x => error(x.move)), min = settings.minSample, patterns = [];
  const add = (id,title,items,denominator,action,question) => {
    const affected = new Set(items.map(x=>x.game.id)).size;
    if (items.length < 3 || affected < 3 || denominator < min) return;
    patterns.push({id,title,count:items.length,games:affected,denominator,rate:round(100*items.length/denominator),action,question,examples:items.slice().sort((a,b)=>(b.move.probabilityLoss??0)-(a.move.probabilityLoss??0)).slice(0,3).map(x=>({gameId:x.game.id,ply:x.move.ply,san:x.move.san,opponent:x.game.opponent}))});
  };
  add('mate','Пропущенные матовые продолжения',errors.filter(x=>x.move.missedMate),all.length,'Решите позиции с пропущенным матом. Перед каждым ходом перечислите все шахи.','Какие шахи я не проверил?');
  for (const [phase,label] of Object.entries(PHASES)) {
    const subset = all.filter(x=>x.move.features?.phase===phase);
    add(phase,`Ошибки: ${label.toLowerCase()}`,subset.filter(x=>error(x.move)),subset.length,
      phase==='opening'?'Разберите первые ошибки в трёх партиях. Запишите угрозу соперника и безопасный способ завершить развитие.':phase==='endgame'?'Восстановите три позиции эндшпиля. Сначала оцените активность короля и фигур, затем рассчитайте ответ соперника.':'Разберите три критические позиции. Для каждой найдите два хода-кандидата и сильнейший ответ соперника.', 'Что я должен был проверить перед ходом?');
  }
  add('capture','Ошибки с ответным взятием фигуры',errors.filter(x=>{
    const next=x.game.moves.find(m=>m.ply===x.move.ply+1);return next?.captured && next.captured!=='p';
  }),all.length,'В примерах проверьте все взятия соперника после своего хода и оцените компенсацию. Ответное взятие само по себе не доказывает причину ошибки.','Какое ответное взятие нужно было рассчитать?');
  patterns.sort((a,b)=>(a.id==='mate'?-1:b.id==='mate'?1:b.count-a.count));
  const examples = errors.slice().sort((a,b)=>(b.move.probabilityLoss??0)-(a.move.probabilityLoss??0)).slice(0,12).map(x=>({...explainMove(x.game,x.analysis,x.move.ply),opponent:x.game.opponent,date:x.game.end,format:x.game.timeClass}));
  const priorities = patterns.slice(0,3);
  const plan = Array.from({length:7},(_,i)=>{
    const focus = priorities.length ? priorities[Math.floor(i/2)%priorities.length] : null;
    return {day:i+1,title:i===6?'Подведите итог недели':i%2?'Повторите без подсказки':'Разберите свои ошибки',minutes:15,
      task:i===6?'Повторите три позиции недели, запишите правило проверки перед ходом. После новых партий обновите отчёт и сравните частоту ошибок.':focus?`${focus.title}. ${i%2?'Вернитесь к тем же позициям через день. Найдите ход и ответ соперника, затем проверьте себя по разбору.':focus.action}`:records.length?'Выберите одну ошибку из примеров, рассчитайте продолжение и повторите позицию завтра.':'Сначала проанализируйте несколько партий одного формата. Готовые оценки будут использованы без дополнительного поиска.',examples:focus?.examples??examples.slice(0,3).map(x=>({gameId:x.gameId,ply:x.ply,san:x.san,opponent:x.opponent}))};
  });
  const progress = [];
  for (const format of new Set(records.map(x=>x.game.timeClass))) {
    for (const source of ['verified','recovered']) {
      const cohort = records.filter(x=>x.game.timeClass===format && x.analysis.source===source && Number.isFinite(x.game.end)).sort((a,b)=>a.game.end-b.game.end||a.game.id.localeCompare(b.game.id)).slice(-40);
      const size = Math.min(20,Math.floor(cohort.length/2));
      if (size < Math.max(3,min)) continue;
      const summarize = group => {const moves=group.flatMap(x=>x.moves);return {games:group.length,moves:moves.length,errors:moves.filter(error).length,rate:round(100*moves.filter(error).length/moves.length)};};
      const previous=summarize(cohort.slice(-size*2,-size)),recent=summarize(cohort.slice(-size));
      progress.push({format,source,previous,recent,change:round(100*recent.errors/recent.moves-100*previous.errors/previous.moves)});
    }
  }
  const warnings = ['Советы сформированы локальными правилами по сохранённым оценкам. Геометрические признаки и статистические связи не устанавливают причину ошибки.'];
  if (includeRecovered && records.some(x=>x.analysis.source==='recovered')) warnings.push('Часть выводов предварительная: включены исторические оценки с неизвестными параметрами.');
  if (new Set(records.map(x=>x.game.timeClass)).size>1) warnings.push('Выбрано несколько форматов. Для более точного плана выберите один формат в фильтрах.');
  if (filter.category || filter.phase || filter.motif) warnings.push('Фильтр ходов ограничивает знаменатель частоты ошибок; это не частота по всем ходам партий.');
  if (!patterns.length) warnings.push(`Повторяющийся паттерн показывается от трёх ошибок в трёх разных партиях и ${min} оценённых ходов. Данных пока недостаточно либо такой повторяемости нет.`);
  const report={version:'coach-v1',profile:filter.profile??games[0]?.profile??null,filter,coverage:{...counts,total:games.length,used:records.length,includeRecovered},evaluated:all.length,errors:errors.length,patterns,examples,plan,progress,warnings};
  return {...report,exportText:exportCoach(report)};
}

function exportCoach(r) {
  return ['Помоги разобрать мою шахматную игру и предложи упражнения. Используй только приведённые факты; не придумывай причины, варианты и статистику. При нехватке данных скажи об этом.',
    `Профиль: ${r.profile??'нет партий'}. Фильтры: ${JSON.stringify(r.filter)}.`,
    `Партий: ${r.coverage.total}; с новым анализом: ${r.coverage.verified}; с историческим: ${r.coverage.recovered}; использовано: ${r.coverage.used}. Оценённых своих ходов: ${r.evaluated}; ошибок и зевков: ${r.errors}.`,
    ...r.warnings,...r.patterns.map(p=>`${p.title}: ${p.count} ошибок в ${p.games} партиях; ${p.denominator} оценённых ходов в соответствующей выборке. ${p.action}`),
    ...r.examples.slice(0,6).map(e=>JSON.stringify({gameId:e.gameId,ply:e.ply,fen:e.fen,played:e.san,best:e.best,pvSAN:e.variation,before:e.before,after:e.after,depth:e.depth,source:e.source,facts:e.observations,note:e.note})),
    'Составь три приоритета на неделю. SAN-варианты выше взяты из сохранённого поиска; дополнительные варианты требуют проверки движком.'].join('\n\n');
}
