import { theoryBadge, theoryMoveHTML, theorySummaryHTML } from './opening-theory.mjs';
import { navigationContext, navigationHTML } from './navigation.mjs';
import { learningViewHTML } from './learning-view.mjs';
import { Chess } from '/vendor/chess.js';
import { createTableSorter } from './table-sort.mjs';
import { coachHTML, explanationHTML } from './coach-view.mjs';
import { skillRadar, skillCards, skillProfileControls } from './skill-radar.mjs';
import { openingTreeDiagram, openingMoveLabel } from './opening-tree.mjs';
import { moveQualityHTML } from './move-quality.mjs';
import { ReviewTree } from './review-tree.mjs';
import { bindBoardDrag, dropMoves } from './board-drag.mjs';

const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (value, digits = 0) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const percent = value => value === null || value === undefined ? '—' : fmt(value, 1) + '%';
const score = value => value === null || value === undefined ? '—' : fmt(value, 1);
const hours = value => value === null || value === undefined ? '—' : fmt(value / 3600, 1) + ' ч';
const duration = value => value === null || value === undefined ? '—' : value >= 3600 ? hours(value) : fmt(value / 60) + ' мин';
const clock = value => value === null || value === undefined ? '—' : `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
const labels = { win: 'Победа', loss: 'Поражение', draw: 'Ничья', unknown: 'Неизвестно', brilliant: '!! Блестящий', rescue: 'Спасение', verified: 'Новый анализ', recovered: 'Исторические оценки', pending: 'Ожидает анализа', best: 'Лучший', excellent: 'Отличный', good: 'Хороший', inaccuracy: 'Неточность', mistake: 'Ошибка', blunder: 'Зевок', opening: 'Дебют', middlegame: 'Миттельшпиль', endgame: 'Эндшпиль', pawn: 'Пешечный', rook: 'Ладейный', queen: 'Ферзевый', bishop: 'Слоновый', knight: 'Коневой', 'same-bishops': 'Одноцветные слоны', 'opposite-bishops': 'Разноцветные слоны', mixed: 'Смешанный', quick: 'Быстрый', standard: 'Стандартный', deep: 'Глубокий', queued: 'В очереди', running: 'Выполняется', paused: 'Пауза', completed: 'Завершено', failed: 'Ошибка', cancelled: 'Отменено', interrupted: 'Прервано', 'hanging-piece': 'Незащищённая фигура', 'material-loss': 'Ответное взятие фигуры', 'fork-candidate': 'Кандидат вилки', 'pin-candidate': 'Кандидат связки', 'favorable-capture': 'Выгодное взятие', check: 'Шах', checkmate: 'Мат', isolated: 'Изолированные пешки', doubled: 'Сдвоенные пешки', passed: 'Проходные пешки', kingDanger: 'Атаки на поля у короля', center: 'Контролируемые центральные поля', undeveloped: 'Неразвитые лёгкие фигуры' };
const label = value => labels[value] ?? value;
const pill = (value, text) => `<span class="pill ${esc(value)}">${esc(text ?? label(value))}</span>`;
const linkGame = (id, ply, text = 'Открыть партию') => `<a href="#game/${encodeURIComponent(id)}${ply ? '/' + ply : ''}">${esc(text)}</a>`;
let navigationMemory = {};
try { const saved = JSON.parse(localStorage.getItem('chess-navigation') ?? '{}'); if(saved && typeof saved === 'object' && !Array.isArray(saved)) navigationMemory = saved; } catch {}
const state = { boot: null, profile: localStorage.getItem('chess-profile') ?? '', filters: JSON.parse(localStorage.getItem('chess-filters') ?? '{}'), report: null, page: 1, sort: 'date', direction: 'desc', treePath: [], review: null, puzzle: null, sequence: 0, jobs: [] };
const tableSorter = createTableSorter({ onRemoteSort: async (key, direction) => {
  state.sort = key; state.direction = direction; state.page = 1;
  try { await render(); } catch (error) { toast(error.message); }
} });
const date = (time, full = false) => time ? new Intl.DateTimeFormat('ru-RU', { timeZone: state.boot?.settings.timezone ?? 'Europe/Moscow', day: 'numeric', month: 'short', ...(full ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }) }).format(new Date(time * 1000)) : '—';
async function api(route, { method = 'GET', body, filters = false, signal } = {}) {
  const url = new URL(route, location.origin); if (state.profile) url.searchParams.set('profile', state.profile);
  if (filters) for (const [k, v] of Object.entries(state.filters)) if (v !== '') url.searchParams.set(k, v);
  const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal });
  const result = await response.json(); if (!response.ok) { const error=new Error(result.error ?? 'Ошибка запроса');error.status=response.status;throw error; } return result;
}
let toastTimer; function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 6000); }
function showError(error) { $('#content').innerHTML = `<div class="error-panel"><h2>Не удалось получить данные</h2><p>${esc(error.message)}</p><button class="button secondary" data-action="reload">Повторить</button></div>`; }
const empty = (text = 'В этой выборке пока нет данных.') => `<div class="empty">${esc(text)}</div>`;
const progress = (value) => `<div class="progress-track"><span data-width="${Math.max(0, Math.min(100, value ?? 0))}"></span></div>`;
function decorate() { for (const element of $$('[data-width]')) element.style.width = element.dataset.width + '%'; tableSorter.enhance($('#content')); }
const metric = (title, value, foot, symbol = '') => `<article class="card"><span class="metric-symbol">${symbol}</span><div class="metric-label">${title}</div><div class="metric-value mono">${value}</div><div class="metric-foot">${foot}</div></article>`;
function section(title, content, note = '') { return `<section class="card"><div class="card-head"><h2>${title}</h2>${note ? `<small>${note}</small>` : ''}</div>${content}</section>`; }
function table(headers, rows, { remote = false } = {}) { return rows.length ? `<div class="table-wrap"><table${remote ? ` data-server-sort="date,opponent,color,rating,result,format,accuracy,status" data-sort-column="${esc(state.sort)}" data-sort-direction="${esc(state.direction)}"` : ''}><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : empty(); }
function resultBar(g) { return `<div class="result-bar"><span class="wins" data-width="${100 * g.wins / (g.games || 1)}"></span><span class="draws" data-width="${100 * g.draws / (g.games || 1)}"></span><span class="losses" data-width="${100 * g.losses / (g.games || 1)}"></span></div>`; }
function lineChart(points, { height = 210, color = '', unit = '', labels: pointLabels = [], gameIds = [], zero = false } = {}) {
  const valid = points.filter(Number.isFinite); if (!valid.length) return empty('Нет оценённых точек для графика.');
  const width = 640, left = 42, right = 16, top = 16, bottom = 32; let min = Math.min(...valid), max = Math.max(...valid); if (zero) { min = Math.min(min, 0); max = Math.max(max, 0); } if (min === max) { min -= 1; max += 1; } const pad = (max - min) * .12; min -= pad; max += pad;
  const x = i => left + (width - left - right) * (points.length === 1 ? .5 : i / (points.length - 1)), y = v => top + (height - top - bottom) * (1 - (v - min) / (max - min));
  let path = '', started = false; for (let i = 0; i < points.length; i++) { if (!Number.isFinite(points[i])) { started = false; continue; } path += (started ? ' L' : ' M') + x(i).toFixed(2) + ',' + y(points[i]).toFixed(2); started = true; }
  const grid = Array.from({ length: 4 }, (_, i) => { const v = min + (max - min) * i / 3; return `<line class="gridline" x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 8}" y="${y(v) + 3}" text-anchor="end">${fmt(v, max - min > 20 ? 0 : 1)}${unit}</text>`; }).join('');
  const dots = points.map((v, i) => Number.isFinite(v) ? `<circle class="point" data-point-index="${i}" cx="${x(i)}" cy="${y(v)}" r="${points.length > 100 ? 1.7 : 3}" ${gameIds[i] ? `data-game="${esc(gameIds[i])}" tabindex="0" role="link" aria-label="Открыть партию"` : ''}><title>${esc(pointLabels[i] ?? 'Точка ' + (i + 1))}: ${fmt(v, 1)}${unit}</title></circle>` : '').join('');
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((x, i, a) => a.indexOf(x) === i).map(i => `<text x="${x(i)}" y="${height - 5}" text-anchor="middle">${esc(pointLabels[i] ?? i + 1)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="График изменения показателя">${grid}<path class="line ${color}" d="${path}"/>${dots}${ticks}</svg>`;
}
function recommendations(items, limit = 10) { return items.slice(0, limit).map(r => `<article class="recommendation"><span class="rec-icon">✧</span><div><h3>${esc(r.title)}</h3><p>${esc(r.reason)}</p><p>${esc(r.action)}</p>${r.gameIds[0] ? linkGame(r.gameIds[0], null, 'Разобрать пример') : '<a href="#settings">Настроить анализ</a>'}</div></article>`).join(''); }
function heatmap(r) { const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']; let html = '<small></small>' + Array.from({ length: 8 }, (_, i) => `<small>${String(i * 3).padStart(2, '0')}:00</small>`).join(''); for (let d = 1; d <= 7; d++) { const day = d % 7; html += `<small>${days[day]}</small>`; for (let h = 0; h < 24; h += 3) { const cell = r.heatmap.find(x => x.key === day + ':' + h), level = !cell ? 0 : cell.games < state.boot.settings.minSample ? 1 : Math.max(1, Math.min(4, Math.ceil(cell.winRate / 25))); html += `<button class="heat level-${level}" data-heat-day="${day}" title="${days[day]}, ${h}–${h + 3}: ${cell ? cell.games + ' партий, побед ' + percent(cell.winRate) : 'нет партий'}" aria-label="Партии ${days[day]}, ${h}–${h + 3}" data-heat-hour="${h}"></button>`; } } return `<div class="heatmap">${html}</div><p class="subtle">${esc(r.timezone)} · Время окончания live-партий · Ячейка — три часа · Яркость — доля побед; минимум ${state.boot.settings.minSample} партий для вывода</p>`; }
function criticalTable(rows, limit = 12) { return table(['Партия', 'Ход', 'Стадия', 'Потеря, cp', 'Качество'], rows.slice(0, limit).map(m => `<tr data-game="${esc(m.gameId)}" data-ply="${m.ply}"><td>${esc(m.opponent)}<span class="secondary-text">${date(m.date)}</span></td><td>${esc(m.san)}<span class="secondary-text">полуход ${m.ply}</span></td><td>${esc(label(m.phase))}</td><td>${fmt(m.loss, 1)}</td><td>${pill(m.category)}</td></tr>`)); }

function specialMovesHTML(r){
  const stats=r.specialMoves;if(!stats)return '';
  return `<div class="special-move-examples">${['brilliant','rescue'].map(key=>`<div><strong>${esc(label(key))}: ${fmt(stats[key]?.count??0)}</strong><div class="section-actions">${(stats[key]?.examples??[]).map(m=>linkGame(m.gameId,m.ply,esc(m.san+' · '+m.opponent))).join('')}</div></div>`).join('')}${stats.pending?`<p class="method">Жертв, для которых не хватает сравнения альтернатив: ${fmt(stats.pending)}. Для проверки запустите повторный анализ соответствующих партий.</p>`:''}<details class="method"><summary>Как определяются особые ходы</summary><p>Блестящий (!!): после хода позиция не хуже −0,5 пешки; движок подтверждает взятие сыгранной фигуры и жертву, сохраняющуюся на следующих 4–6 полуходах своего варианта. Проверяются два продолжения одной глубины от 10: без сыгранного хода оценка не выше +1,5. Допуск потери оценки и минимальная жертва зависят от рейтинга: до 1000 — 50 cp / 1 пешка; 1000–1599 — 30 cp / 2 пешки; от 1600 или неизвестный рейтинг — 15 cp / 3 пешки.</p><p>Спасение: до ошибки соперника оценка была не выше −2 пешек, после неё появилась возможность удержать не хуже −0,5; игрок нашёл лучший или близкий к нему ход и сохранил эту оценку. Источник — только новый анализ Stockfish с оценками без границ. Жертвы, которые движок не принимает в основном варианте, пока не отмечаются. Если ход подходит под обе отметки, в распределении он считается один раз как блестящий.</p></details></div>`;
}
function specialMoveDetails(move){
  const special=move?.special;if(!special)return '';
  return (special.brilliant?`<p class="method"><strong>!! Обоснованная жертва.</strong> Потеря материала: ${fmt(special.brilliant.materialLoss)} пешки. Лучшее другое продолжение: ${fmt(special.brilliant.alternative/100,2)} с точки зрения сделавшего ход. Проверка: ${esc(pvSAN(move.after,special.brilliant.line))}.</p>`:'')+(special.rescue?`<p class="method"><strong>Спасение позиции.</strong> После ошибки соперника: ${fmt(special.rescue.previous/100,2)} → ${fmt(special.rescue.before/100,2)}; после сыгранного хода: ${fmt(special.rescue.after/100,2)}. Оценки с точки зрения сделавшего ход.</p>`:'')+(special.brilliantPending?'<p class="method">Обнаружена возможная жертва. Для отметки !! требуется повторный анализ со сравнением альтернатив.</p>':'');
}

function dashboard(r) {
  const s = r.summary, profile = state.boot.profiles.find(p => p.username === state.profile), rating = r.ratings.find(x => x.format === 'rapid') ?? r.ratings[0], official = profile?.stats?.['chess_' + rating?.format]?.last?.rating;
  return `<div class="grid four">${metric('Партий в выборке', fmt(s.games), `${fmt(s.activeDays)} активных дней`, '▤')}${metric('Рейтинг · ' + esc(rating?.format ?? 'нет формата'), fmt(official ?? rating?.currentObserved), official ? 'По Chess.com stats' : 'Наблюдаемый до последней партии', '⌁')}${metric('Победы', percent(s.winRate), `${fmt(s.wins)} побед · ${fmt(s.draws)} ничьих`, '◈')}${metric('Качество ходов', score(s.accuracy) + '<small> / 100</small>', `${fmt(s.evaluated)} ходов · собственная методика`, '◎')}</div>
  <div class="grid wide">${section('Динамика рейтинга', rating ? lineChart(rating.series.map(p => p.rating), { labels: rating.series.map(p => date(p.time)), gameIds: rating.series.map(p => p.gameId) }) : empty('Импортируйте рейтинговые партии.'), esc(rating?.format ?? ''))}${section('Игра белыми и чёрными', r.colors.map(c => `<div class="color-summary"><span class="color-piece ${c.key === 'b' ? 'black' : ''}">${c.key === 'w' ? '♔' : '♚'}</span><div><div class="color-name">${c.key === 'w' ? 'Белые' : 'Чёрные'}</div><small>${fmt(c.games)} партий · качество ${score(c.accuracy)}</small></div><div class="big">${percent(c.winRate)}</div></div>${resultBar(c)}`).join('') + `<div class="legend"><span>Победы</span><span class="gray">Ничьи</span><span class="red">Поражения</span></div>`)}</div>
  <div class="grid wide">${section('Ваш дебютный репертуар', openingTable(r.openings.slice(0, 5)), '<a href="#openings">Все дебюты</a>')}${section('Качество по стадиям', r.phases.map(p => `<div class="row-label"><span>${p.label}</span><strong>${score(p.accuracy)} <small class="subtle">/100</small></strong></div>${progress(p.accuracy)}<div class="subtle">${fmt(p.evaluated)} оценённых ходов</div>`).join(''))}</div>
  <div class="grid two">${section('На чём сосредоточиться', recommendations(r.recommendations, 2))}${section('Когда вы играете лучше', heatmap(r))}</div>
  <div class="grid four">${metric('Средняя длина партии', fmt(s.averageMoves, 1) + '<small> хода</small>', `${fmt(s.plies)} полуходов всего`)}${metric('Время за игрой', hours(s.totalSeconds), `Продолжительность известна для ${s.durationCoverage} партий`)}${metric('Лучшая серия побед', fmt(s.bestWinStreak), `${Object.values(state.filters).some(v => v !== '') ? 'По выбранным фильтрам' : 'Вся загруженная история'} · без поражений: ${s.bestUnbeatenStreak}${s.streakExcluded ? ' · без точного времени исключено: '+s.streakExcluded : ''}`)}${metric('Средняя потеря', fmt(s.acpl, 1) + '<small> cp</small>', 'По вашим ходам, включая нули')}</div>
  ${section('Качество ходов',moveQualityHTML(r)+specialMovesHTML(r))}`;
}
function openingTable(rows) { return table(['Дебют', 'Партий', 'Победы', 'Качество'], rows.map(o => `<tr><td class="table-title"><button class="button ghost small" data-opening="${esc(o.key.split(' · ').at(-1))}">${esc(o.key)}</button></td><td>${o.games}</td><td>${percent(o.winRate)}</td><td>${score(o.openingAccuracy ?? o.accuracy)}</td></tr>`)); }
function ratingView(r) { return r.ratings.map(x => section('Рейтинг · ' + esc(x.format), `<div class="stat-strip"><div><strong>${fmt(x.currentObserved)}</strong><small>Последнее наблюдение до партии</small></div><div><strong>${fmt(x.max)}</strong><small>Максимум в выборке</small></div><div><strong>${fmt(x.change)}</strong><small>Изменение между наблюдениями</small></div></div>${lineChart(x.series.map(p => p.rating), { labels: x.series.map(p => date(p.time)), gameIds: x.series.map(p => p.gameId) })}${table(['Месяц', 'Партий', 'Средний рейтинг', 'Изменение'], x.monthly.map(m => `<tr><td>${m.month}</td><td>${m.games}</td><td>${fmt(m.average)}</td><td>${fmt(m.change)}</td></tr>`))}`)).join('<br>') || empty('В выборке нет рейтинговых партий.'); }
function openingsView(r) { return `<div class="grid wide">${section('Результативность дебютов', openingTable(r.openings))}${section('Что показывает репертуар', '<p class="method">Названия и ECO берутся из исходных партий, при отсутствии тегов — из ограниченного локального справочника. Полное знание дебютной теории не предполагается. Дерево показывает ваши реально сыгранные варианты.</p><a class="button secondary" href="#tree">Открыть дерево</a>')}</div>${section('Качество дебюта и первые ошибки', table(['Дебют', 'Первый типичный сбой, ход', 'Среднее время, с', 'Оценка после 10-го, cp'], r.openings.map(o => `<tr><td class="table-title">${esc(o.key)}</td><td>${fmt(o.firstError, 1)}</td><td>${fmt(o.thinking, 1)}</td><td>${fmt(o.checkpoints.find(x => x.move === 10)?.evaluation)}</td></tr>`)))}`; }
function treeView(r) {
  let node=r.tree;const valid=[],labels=[];
  for(const key of state.treePath){if(!node.children[key])break;valid.push(key);node=node.children[key];labels.push(openingMoveLabel(node.san,valid.length));}
  state.treePath=valid;
  const items=Object.entries(node.children).sort((a,b)=>b[1].games-a[1].games),depth=state.treeDepth??2,branches=state.treeBranches??2;
  const controls=`<div class="opening-tree-controls"><div class="section-actions"><button class="button ghost small" data-action="tree-root">Начало</button><button class="button secondary small" data-action="tree-back" ${valid.length?'':'disabled'}>Назад</button><span class="subtle">${node.games} партий · ${valid.length} полуходов</span></div><label>Глубина схемы <select id="tree-depth" aria-label="Глубина схемы">${[1,2,3].map(n=>`<option value="${n}" ${n===depth?'selected':''}>${n} ${n===1?'полуход':'полухода'}</option>`).join('')}</select></label><label>Ветвей на узел <select id="tree-branches" aria-label="Ветвей на узел">${[2,3,4].map(n=>`<option value="${n}" ${n===branches?'selected':''}>${n}</option>`).join('')}</select></label></div>`;
  const breadcrumbs=`<nav class="opening-breadcrumbs" aria-label="Выбранная дебютная линия"><button class="button ghost small" data-tree-path="">Начало</button>${labels.map((label,i)=>`<span aria-hidden="true">›</span><button class="button ghost small" data-tree-path="${esc(valid.slice(0,i+1).join(' '))}">${esc(label)}</button>`).join('')}</nav>`;
  return `${section('Персональное дерево дебютов',controls+breadcrumbs+openingTreeDiagram(node,{path:valid,depth,branches})+'<p class="method">Нажмите на ход, чтобы раскрыть его продолжения и увидеть позицию. На схеме показаны самые частые ветви; все следующие ходы выбранной позиции — в таблице ниже. Процент побед относится к вашему профилю, зелёный — выше 50%, красный — ниже 50%. Ничьи и неизвестные результаты не считаются победами.</p>')}<br><div class="grid two">${section('Все продолжения выбранной позиции',`<div id="tree-continuations">${table(['Следующий ход','Партий','Победы','Продолжить'],items.map(([uci,n])=>`<tr><td><strong>${esc(openingMoveLabel(n.san,valid.length+1))}</strong></td><td>${n.games}</td><td>${percent(100*n.wins/n.games)}</td><td><button class="button secondary small" data-tree="${esc(uci)}">Открыть ветвь</button></td></tr>`))}</div>`)}${section('Позиция варианта','<div id="tree-board" class="mini-board"></div><p class="method">До 24 полуходов. Учитываются выбранный профиль и фильтры. Ветви соответствуют порядку ходов; транспозиции не объединяются.</p>')}</div>`;
}
function stagesView(r) { return `<div class="grid three">${r.phases.map(p => section(p.label, `<div class="metric-value">${score(p.accuracy)}<small> / 100</small></div><p class="subtle">${p.games} партий · ${p.evaluated} оценённых ходов</p>${progress(p.accuracy)}<div class="stat-strip"><div><strong>${fmt(p.acpl, 1)}</strong><small>ACPL</small></div><div><strong>${fmt(p.errorsPer100, 1)}</strong><small>Ошибок на 100 ходов</small></div></div><button class="button secondary small" data-phase="${p.key}">Показать партии</button>`)).join('')}</div><div class="grid two">${section('Реализация преимущества', table(['Устойчивый перевес', 'Партий', 'Победы', 'Ничьи', 'Поражения'], r.conversion.map(c => `<tr><td>+${fmt(c.threshold / 100, 1)}</td><td>${c.games}</td><td>${percent(c.winRate)}</td><td>${c.draws}</td><td>${c.losses}</td></tr>`)) + '<p class="subtle">Порог сохранялся не менее двух ваших последовательных ходов.</p>')}${section('Упущенные возможности', `<div class="stat-strip"><div><strong>${r.missedMates.length}</strong><small>Упущенных форсированных матов</small></div><div><strong>${r.comebacks.wins}</strong><small>Побед после позиции −3 или хуже</small></div></div>${criticalTable(r.missedMates, 6)}`)}</div>${section('Критические моменты', criticalTable(r.critical))}`; }
function endingsView(r) { return `${section('Как вы играете окончания', table(['Тип', 'Партий', 'Победы', 'Качество', 'ACPL', 'Ходов'], r.endings.map(e => `<tr><td>${esc(label(e.key))}</td><td>${e.games}</td><td>${percent(e.winRate)}</td><td>${score(e.accuracy)}</td><td>${fmt(e.acpl, 1)}</td><td>${e.evaluated}</td></tr>`)))}<br>${section('О границах анализа', '<p class="method">Тип окончания определяется оставшимися фигурами, а качество — ходами в эндшпиле. Это оценка Stockfish и структурная классификация, а не доказательство теоретического результата. Таблицы Syzygy здесь не подключены.</p>')}`; }
function tacticsView(r) { return `<div class="grid two">${section('Тактические ситуации · эвристики', table(['Признак', 'Позиций', 'С ошибкой', 'Пример'], r.motifs.map(m => `<tr><td>${esc(label(m.key))}</td><td>${m.count}</td><td>${m.errors}</td><td>${m.examples[0] ? linkGame(m.examples[0].gameId, m.examples[0].ply, 'Разобрать') : ''}</td></tr>`)))}${section('Качество ходов',moveQualityHTML(r)+specialMovesHTML(r))}</div><p class="method">Вилка и связка отмечаются как геометрические кандидаты. Метка не доказывает причину ошибки и требует просмотра позиции и продолжения.</p>${section('Ошибки для разбора', criticalTable(r.critical, 30))}`; }
function positionsView(r) { return `${section('Позиционная структура', table(['Признак', 'Среднее на позицию', 'Оценено ходов', 'Качество при наличии', 'Пример'], r.positional.map(p => `<tr><td>${esc(label(p.key))}</td><td>${fmt(p.average, 2)}</td><td>${p.qualityWhenPresent.evaluated}</td><td>${score(p.qualityWhenPresent.accuracy)}</td><td>${p.examples[0] ? linkGame(p.examples[0].gameId, p.examples[0].ply, 'Позиция') : ''}</td></tr>`)))}<p class="method">Счётчики описывают доску: наличие изолированной пешки само по себе не ошибка. Связь качества со структурой — наблюдение, без утверждения причинности.</p>`; }
function timeView(r) { return `<div class="grid four">${metric('Среднее время на ход', fmt(r.time.mean, 1) + '<small> с</small>', `${r.time.clockMoves} ходов с отметками`)}${metric('Медиана', fmt(r.time.median, 1) + '<small> с</small>', 'По известному времени обдумывания')}${metric('Поражения по времени', r.time.timeouts, 'По исходным кодам завершения')}${metric('Остаток в конце', clock(r.time.remaining), 'Последний известный clock игрока')}</div><div class="grid two">${section('Время обдумывания и качество', lineChart(r.time.buckets.map(b => b.accuracy), { labels: r.time.buckets.map(b => b.label + ' с') }) + table(['На ход', 'Ходов', 'Качество', 'Ошибок'], r.time.buckets.map(b => `<tr><td>${b.label} с</td><td>${b.evaluated}</td><td>${score(b.accuracy)}</td><td>${b.mistakes}</td></tr>`)))}${section('Игра в цейтноте', `<div class="stat-strip"><div><strong>${score(r.time.pressure.accuracy)}</strong><small>Качество при остатке &lt;30 с</small></div><div><strong>${score(r.time.enough.accuracy)}</strong><small>При остатке ≥60 с</small></div></div><p class="method">Фиксированные пороги служат ориентиром. Для корректного сравнения выберите один контроль времени; инкремент учитывается, отсутствующие clock не подменяются нулём.</p>`)}</div>`; }
function sessionsView(r) { return `<div class="grid two">${section('Качество в течение сессии', lineChart(r.sessionPosition.map(s => s.accuracy), { labels: r.sessionPosition.map(s => 'Партия ' + s.position) }))}${section('После предыдущего результата', table(['После', 'Следующих партий', 'Победы', 'Качество'], r.afterResult.map(s => `<tr><td>${esc(label(s.after))}</td><td>${s.games}</td><td>${percent(s.winRate)}</td><td>${score(s.accuracy)}</td></tr>`)) + '<p class="method">Только live-партии. Пауза более ' + state.boot.settings.sessionGap + ' минут начинает новую сессию. Контекст сессии и предыдущий результат берутся из полной live-истории; статистика — по выбранным партиям. Статистические связи не определяют тильт или усталость.</p>')}</div>${section('Сессии', table(['Начало', 'Длительность', 'Партий', 'Победы', 'Качество', 'Пример'], r.sessions.slice().reverse().map(s => `<tr><td data-sort-value="${s.start ?? ''}">${date(s.start, true)}</td><td data-sort-value="${s.duration ?? ''}">${duration(s.duration)}</td><td>${s.games}</td><td>${percent(s.winRate)}</td><td>${score(s.accuracy)}</td><td>${linkGame(s.gameIds[0])}</td></tr>`)))}<br>${section('Время суток и день недели', heatmap(r))}`; }
function opponentsView(r) { const group = (name, rows) => section(name, table(['Группа', 'Партий', 'Победы', 'Качество'], rows.map(o => `<tr><td>${esc(o.key)}</td><td>${o.games}</td><td>${percent(o.winRate)}</td><td>${score(o.accuracy)}</td></tr>`))); return `<div class="grid two">${group('По рейтингу соперника', r.ratingBands)}${group('По разнице рейтингов', r.differenceBands)}</div>${section('Личные встречи', table(['Соперник', 'Встреч', 'Победы / ничьи / поражения', 'Победы', 'Качество'], r.opponents.map(o => `<tr><td><button class="button ghost small" data-opponent="${esc(o.key)}">${esc(o.key)}</button></td><td>${o.games}</td><td>${o.wins} / ${o.draws} / ${o.losses}</td><td>${percent(o.winRate)}</td><td>${score(o.accuracy)}</td></tr>`)))}`; }
function skillsView(r) { return `${section('Профиль игровых решений', `${skillProfileControls(r.skillProfile,r.timezone)}${skillRadar(r.skills)}<p class="method">Зелёный контур — условные индексы сохранения оценки. 100 означает отсутствие потерь в выбранной выборке, а не мастерство на 100%. Реализация показывает долю побед после перевеса. Площадь и средний балл радара не используются.</p>${skillCards(r.skills)}${(r.skillProfile?.notes??[]).map(note=>`<p class="method">${esc(note)}</p>`).join('')}<p class="method">Для каждой игровой оси требуется не менее ${r.skillProfile?.minMoves??30} оценённых ходов в ${r.skillProfile?.minGames??5} разных партиях. Формулы v2 отличаются от прежнего среднего качества; старые баллы напрямую с ними не сравниваются. Пересчёт использует готовые оценки и не запускает Stockfish.</p>`)}<br>${section('Сравнение периодов', `<p class="method">Для сравнения общих показателей выберите начальную и конечную даты в фильтрах.</p><button class="button secondary" data-action="compare">Сравнить с предыдущим периодом</button><div id="comparison"></div>`)}`; }

function recommendationsView(r) { return section('Персональный план развития', '<p><a class="button" href="#coach">Открыть персонального тренера</a></p>' + recommendations(r.recommendations) + `<p class="method">Рекомендации строятся локальными правилами по этой выборке. Данные не отправляются в ИИ. Эффективность можно оценивать сравнением сопоставимых периодов в профиле навыков.</p>`); }

function coachPlanKey() {
  const now = new Date(), local = new Date(now.toLocaleString('en-US', {timeZone:state.boot.settings.timezone}));
  local.setDate(local.getDate() - (local.getDay() + 6) % 7);
  const week = `${local.getFullYear()}-${local.getMonth()+1}-${local.getDate()}`;
  return 'chess-coach-plan:' + JSON.stringify([state.profile, Object.entries(state.filters).sort(([a],[b])=>a.localeCompare(b)), week]);
}
function coachCompleted() { try { const values=JSON.parse(localStorage.getItem(coachPlanKey())??'[]'); return Array.isArray(values)?values:[]; } catch { return []; } }
async function coachView() {
  const report = await api('/api/coach', {filters:true});
  return {report,html:coachHTML(report,coachCompleted())};
}
async function copyCoachReport() {
  if (!state.coach) return;
  try { await navigator.clipboard.writeText(state.coach.exportText); toast('Отчёт скопирован. Вставьте его в выбранный чат.'); }
  catch {
    $('#modal-content').innerHTML = '<h2>Отчёт для нейросети</h2><p>Выделите и скопируйте текст. Данные не отправляются автоматически.</p><textarea id="coach-export-text" class="coach-export" readonly aria-label="Текст отчёта"></textarea>';
    $('#coach-export-text').value = state.coach.exportText; $('#modal').showModal(); $('#coach-export-text').focus(); $('#coach-export-text').select();
  }
}

async function gamesView() { const params = new URLSearchParams({ page: state.page, sort: state.sort, direction: state.direction }); const data = await api('/api/games?' + params, { filters: true }); return section('История партий', `<div class="section-actions"><label class="subtle">Сортировка <select id="game-sort"><option value="date">По дате</option><option value="rating">По рейтингу</option><option value="opponent">По сопернику</option><option value="moves">По длине</option><option value="color">По цвету</option><option value="result">По результату</option><option value="format">По формату</option><option value="accuracy">По качеству</option><option value="status">По статусу анализа</option><option value="opponentRating">По рейтингу соперника</option><option value="opening">По дебюту</option></select></label><button class="button ghost small" data-action="sort-direction">${state.direction === 'desc' ? 'По убыванию' : 'По возрастанию'}</button></div><br>${table(['Дата', 'Соперник', 'Цвет', 'Рейтинг', 'Результат', 'Формат', 'Качество', 'Статус'], data.games.map(g => `<tr data-game="${esc(g.id)}"><td>${date(g.end)}</td><td>${esc(g.opponent)}<span class="secondary-text">${g.opponentRating ?? '—'} · ${esc(g.opening).slice(0, 65)}</span></td><td>${g.color === 'w' ? '♔ Белые' : '♚ Чёрные'}</td><td>${g.rating ?? '—'}</td><td>${pill(g.result)}</td><td>${esc(g.format)}<span class="secondary-text">${esc(g.control)} · ${fmt(Math.ceil(g.plies / 2))} хода</span></td><td>${score(g.accuracy)}</td><td>${pill(g.status)}</td></tr>`), { remote: true })}<div class="pagination"><span>${data.total} партий · страница ${data.page} из ${Math.max(1, Math.ceil(data.total / data.limit))}</span><div class="section-actions"><button class="button secondary small" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Назад</button><button class="button secondary small" data-page="${data.page + 1}" ${data.page * data.limit >= data.total ? 'disabled' : ''}>Далее</button></div></div>`); }

function jobHTML(job) { const d = job.data, kind = { analysis: 'Анализ партий', sync: 'Синхронизация Chess.com', puzzles: d.mode==='random'?'Пополнение случайных задач':'Генерация задач' }[job.kind], done = d.done ?? 0, total = d.total ?? 0, processed = job.kind === 'analysis' ? done + (d.failed ?? 0) : done; return `<article class="job-row"><div class="job-title"><strong>${kind} ${d.preset ? '· ' + esc(label(d.preset)) : ''}</strong>${pill(job.status)}</div>${progress(total ? 100 * processed / total : 0)}<p class="subtle">${done} / ${total || '…'} · ошибок ${d.failed ?? 0}${job.status === 'running' && d.plies ? ` · позиция ${d.ply}/${d.plies}` : ''}${job.kind === 'sync' ? ` · добавлено ${d.imported ?? 0}` : ''}</p><div class="job-actions">${['running', 'queued'].includes(job.status) ? `<button class="button secondary small" data-job="${job.id}" data-job-action="pause">Пауза</button>` : ''}${['paused', 'failed', 'interrupted'].includes(job.status) ? `<button class="button small" data-job="${job.id}" data-job-action="resume">Продолжить</button>` : ''}${['completed', 'failed'].includes(job.status) && d.failed && job.kind === 'analysis' ? `<button class="button secondary small" data-job="${job.id}" data-job-action="retry">Повторить ошибки</button>` : ''}${['running', 'queued', 'paused'].includes(job.status) ? `<button class="button ghost small" data-job="${job.id}" data-job-action="cancel">Отменить</button>` : ''}</div>${job.kind==='puzzles'?`<p class="subtle">Подготовлено упражнений: ${d.created??0}</p>`:''}${d.note?`<p class="method">${esc(d.note)}</p>`:''}${d.errors?.length ? `<div class="job-errors">${d.errors.slice(-3).map(e => esc(e.message)).join('<br>')}</div>` : ''}</article>`; }
async function settingsView() { const s = state.boot.settings; state.jobs = await api('/api/jobs'); return `<div class="grid two">${section('Импорт и фоновый анализ', `<p class="method">Синхронизация проходит по всем доступным месяцам. Анализ работает в одном фоне с лимитом CPU; при перезапуске задания восстанавливаются из SQLite.</p><div class="section-actions"><button class="button" data-action="sync">Импортировать всю историю</button><button class="button secondary" data-action="analyze">Анализировать необработанные</button><button class="button ghost" data-action="reanalyze">Повторный анализ выборки</button></div><br><h3>Добавить профиль</h3><form id="add-profile" class="section-actions"><input name="username" placeholder="Chess.com username" required minlength="2" maxlength="50"><button class="button secondary">Подключить</button></form><br><h3>Импортировать PGN</h3><input type="file" id="pgn-file" accept=".pgn,.txt"><p class="subtle">Партийные теги White/Black должны содержать выбранный username.</p><div id="jobs">${state.jobs.map(jobHTML).join('') || empty('Заданий пока нет.')}</div>`)}${section('Параметры приложения', `<form id="settings-form" class="form-grid"><label class="field">Часовой пояс<input name="timezone" value="${esc(s.timezone)}" required></label><label class="field">Пауза между сессиями, мин<input name="sessionGap" type="number" min="5" max="240" value="${s.sessionGap}"></label><label class="field">Минимальная выборка<input name="minSample" type="number" min="3" max="1000" value="${s.minSample}"></label><label class="field">Режим Stockfish<select name="preset">${Object.keys(state.boot.presets).map(k => `<option value="${k}" ${k === s.preset ? 'selected' : ''}>${label(k)}</option>`).join('')}</select></label><label class="field">Hash, MiB<input name="hash" type="number" min="16" max="256" value="${s.hash}"></label><label class="field checkbox"><input name="autoAnalyze" type="checkbox" ${s.autoAnalyze ? 'checked' : ''}>Анализировать новые партии после синхронизации</label><label class="field checkbox"><input name="includeRecovered" type="checkbox" ${s.includeRecovered ? 'checked' : ''}>Учитывать исторические оценки с пометкой</label><button class="button">Сохранить настройки</button></form><br><button class="button secondary" data-action="backup">Создать резервную копию базы</button>`)}</div>${section('Как считаются показатели', `<dl class="method">${Object.entries(state.report?.methodology ?? {}).filter(([k]) => k !== 'version').map(([k, v]) => `<dt>${esc(({ accuracy: 'Качество ходов', acpl: 'ACPL', phases: 'Стадии', motifs: 'Мотивы', rating: 'Рейтинг', sessions: 'Сессии', time: 'Время' })[k] ?? k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`)}<br>${section('Параметры режимов', table(['Режим', 'Макс. глубина', 'Лимит на позицию', 'Лимит узлов'], Object.entries(state.boot.presets).map(([k, v]) => `<tr><td>${esc(label(k))}</td><td>${v.depth}</td><td>${v.movetime} ms</td><td>${fmt(v.nodes)}</td></tr>`)) + '<p class="method">Поиск заканчивается при достижении любого лимита; фактическая глубина сохраняется. Старые файлы games/ и analysis/ приложение не перезаписывает.</p>')}`; }

function renderFilters() {
  const f = state.filters; const select = (key, title, values) => `<select name="${key}" aria-label="${title}"><option value="">${title}</option>${values.map(([value, text]) => `<option value="${value}" ${f[key] === value ? 'selected' : ''}>${text}</option>`).join('')}</select>`;
  $('#filters').innerHTML = `<label class="filter-label">С <input type="date" name="from" value="${esc(f.from)}" aria-label="Начало периода"></label><label class="filter-label">по <input type="date" name="to" value="${esc(f.to)}" aria-label="Конец периода"></label>${select('format', 'Все форматы', [['rapid', 'Рапид'], ['blitz', 'Блиц'], ['bullet', 'Пуля'], ['daily', 'Заочные']])}${select('color', 'Оба цвета', [['w', 'Белые'], ['b', 'Чёрные']])}${select('result', 'Все результаты', [['win', 'Победы'], ['draw', 'Ничьи'], ['loss', 'Поражения']])}<button type="button" class="button ghost small" data-action="more-filters">Ещё фильтры</button><button type="button" class="button ghost small" data-action="reset-filters">Сбросить</button><div class="filter-more">${select('status', 'Любой анализ', [['verified', 'Новый анализ'], ['recovered', 'Исторические оценки'], ['pending', 'Без нового анализа']])}${select('phase', 'Любая стадия', [['opening', 'Дебют'], ['middlegame', 'Миттельшпиль'], ['endgame', 'Эндшпиль']])}${select('category', 'Любой ход', [['brilliant', '!! Блестящий'], ['rescue', 'Спасение'], ['best', 'Лучший'], ['inaccuracy', 'Неточность'], ['mistake', 'Ошибка'], ['blunder', 'Зевок']])}${select('rated', 'Все партии', [['true', 'Рейтинговые'], ['false', 'Нерейтинговые']])}${[['opponent', 'Соперник'], ['opening', 'Дебют / ECO'], ['control', 'Контроль, например 600+5'], ['minRating', 'Ваш рейтинг от'], ['maxRating', 'Ваш рейтинг до'], ['minOpponent', 'Рейтинг соперника от'], ['maxOpponent', 'Рейтинг соперника до'], ['minDifference', 'Разница рейтингов от'], ['maxDifference', 'Разница рейтингов до']].map(([key, text]) => `<input name="${key}" value="${esc(f[key])}" placeholder="${text}" aria-label="${text}">`).join('')}</div>`;
}
function saveFilters() { localStorage.setItem('chess-filters', JSON.stringify(state.filters)); state.page = 1; }
async function loadBoot() { state.boot = await api('/api/bootstrap'); if (!state.boot.profiles.some(p => p.username === state.profile)) state.profile = state.boot.profiles[0]?.username ?? ''; $('#profile').innerHTML = state.boot.profiles.map(p => `<option value="${esc(p.username)}" ${p.username === state.profile ? 'selected' : ''}>${esc(p.username)}</option>`).join('') || '<option>Добавьте профиль</option>'; }

async function render() {
  cancelReviewSearch(state.review);
  const sequence = ++state.sequence, parts = location.hash.slice(1).split('/'), view = parts[0] || 'dashboard';
  const {group,page,isGame} = navigationContext(view);
  if(!isGame&&group.pages.some(([key])=>key===view)){navigationMemory[group.id]=view;try{localStorage.setItem('chess-navigation',JSON.stringify(navigationMemory));}catch{}}
  const navigation = navigationHTML(view,navigationMemory);
  $('#navigation').innerHTML = navigation.sidebar;
  $('#section-navigation').innerHTML = navigation.tabs;
  $('#section-navigation').hidden = !navigation.tabs;
  $('#breadcrumb').textContent = group.title + ' / ' + page;
  $('#page-head').innerHTML = `<div class="page-title"><div><div class="eyebrow">${isGame ? 'РАЗБОР ПАРТИИ' : 'ВАША ШАХМАТНАЯ ИСТОРИЯ'}</div><h1>${isGame ? 'Каждый ход имеет значение' : esc(page)}</h1><p class="subtitle">${isGame ? 'Позиции, оценки и варианты на одной доске.' : 'Смотрите на игру целиком. Находите закономерности. Становитесь сильнее.'}</p></div>${!isGame && view !== 'settings' ? '<div class="section-actions"><button class="button ghost" data-action="reload">Обновить показатели</button><a class="button secondary" href="#settings">Управление анализом</a></div>' : ''}</div>`;
  renderFilters(); $('#filters').hidden = isGame || view === 'training'; $('#content').innerHTML = '<div class="loading">Считаем показатели по вашим партиям…</div>';
  try {
    if (!state.profile && view !== 'settings') { $('#coverage').innerHTML = ''; $('#content').innerHTML = empty('Добавьте профиль в разделе «Анализ и настройки».'); return; }
    if (isGame) { $('#coverage').innerHTML = ''; await reviewView(decodeURIComponent(parts[1] ?? ''), Number(parts[2]) || 0); return; }
    if (view === 'coach') {
      const coach = await coachView(); if(sequence!==state.sequence)return;
      state.coach=coach.report;state.lastReportAt=Date.now();
      $('#coverage').innerHTML = `<div class="notice neutral"><span>Тренер использует готовые оценки из <strong>${coach.report.coverage.used}</strong> партий выбранной истории. Покрытие и ограничения — внизу отчёта.</span><a href="#settings">Методика</a></div>`;
      $('#content').innerHTML=coach.html;decorate();return;
    }
    if(view==='training'){const html=await trainingView();if(sequence!==state.sequence)return;$('#coverage').innerHTML='';$('#content').innerHTML=html;decorate();mountPuzzleBoards();paintTrainingJobs();return;}
    const report = state.profile ? await api('/api/analytics', { filters: true }) : null; if (sequence !== state.sequence) return;
    state.report = report;
    state.lastReportAt = Date.now();
    const r = state.report;
    $('#coverage').innerHTML = r ? `<div class="notice ${r.coverage.estimated ? '' : 'neutral'}"><span>${r.coverage.estimated ? '<strong>Предварительные показатели.</strong> ' + r.coverage.recovered + ' партий используют исторические оценки с исправленными формулами; исходные параметры неизвестны.' : 'Показатели рассчитаны по выбранной истории.'} Новый анализ: <strong>${r.coverage.verified}</strong> из ${r.sample} партий.${r.coverage.missing ? ' Без оценок: ' + r.coverage.missing + '.' : ''}${r.coverage.boundedMoves ? ' Граничные оценки исключены из качества: ' + r.coverage.boundedMoves + ' ваших ходов.' : ''}${r.coverage.invalidatedPositions ? ' Старых сомнительных нулевых оценок: ' + r.coverage.invalidatedPositions + '.' : ''}</span><a href="#settings">${r.coverage.estimated ? 'Запустить новый анализ' : 'Методика'}</a></div>` : '';
    const views = { dashboard, rating: ratingView, openings: openingsView, tree: treeView, stages: stagesView, endings: endingsView, tactics: tacticsView, positions: positionsView, time: timeView, sessions: sessionsView, opponents: opponentsView, skills: skillsView, recommendations: recommendationsView };
    let html; if (view === 'games') html = await gamesView(); else if (view === 'settings') html = await settingsView(); else if (view === 'training') html = await trainingView(); else html = r ? (views[view] ?? dashboard)(r) : empty();
    if (sequence !== state.sequence) return; state.coach=null; $('#content').innerHTML = html; decorate();
    if (view === 'games') $('#game-sort').value = state.sort;
    if (view === 'tree') { let node = r.tree; for (const key of state.treePath) node = node.children[key]; drawBoard($('#tree-board'), node.fen ?? new Chess().fen(), { interactive: false }); const viewport=$('.opening-tree-scroll');if(viewport)viewport.scrollLeft=(viewport.scrollWidth-viewport.clientWidth)/2; }
    if (view === 'training') { mountPuzzleBoards();paintTrainingJobs(); }
  } catch (error) { if (sequence === state.sequence) showError(error); }
}

async function startJob(kind, extra = {}) { const job = await api('/api/jobs', { method: 'POST', body: { kind, ...extra }, filters: true }); toast('Задание создано: ' + ({ analysis: 'анализ партий', sync: 'синхронизация', puzzles: 'генерация задач' })[kind]); await pollJobs(); return job; }
async function pollJobs() { if (!state.profile) return; try { const previous = state.jobs; state.jobs = await api('/api/jobs'); const active = state.jobs.find(j => j.status === 'running'); $('#job-status').textContent = active ? `${active.kind === 'analysis' ? 'Stockfish' : active.kind==='puzzles'?'Позиции':'Импорт'}: ${active.data.done ?? 0}/${active.data.total || '…'}` : 'Stockfish готов'; paintTrainingJobs();if(location.hash==='#training'&&!state.puzzle&&state.training?.nextDue&&Date.parse(state.training.nextDue)<=Date.now()){await render();return;} if ($('#jobs')) { $('#jobs').innerHTML = state.jobs.map(jobHTML).join('') || empty('Заданий пока нет.'); decorate(); } if (previous.length && state.jobs.some(j => j.status === 'completed' && previous.find(p => p.id === j.id)?.status !== 'completed')) { toast('Фоновое задание завершено. Данные обновлены.'); await loadBoot(); if (!location.hash.startsWith('#game') && !state.puzzle) await render(); } } catch { } }

document.addEventListener('click', event => { void tableSorter.handleClick(event).catch(error => toast(error.message)); });
document.addEventListener('click', async event => {
  const target = event.target.closest('button,a,[data-game],[data-puzzle],[data-review-ply]'); if (!target) return;
  try {
    if (target.dataset.game) { location.hash = 'game/' + encodeURIComponent(target.dataset.game) + (target.dataset.ply ? '/' + target.dataset.ply : ''); return; }
    if (target.dataset.page) { state.page = Number(target.dataset.page); await render(); return; }
    if (target.dataset.opening) { state.filters.opening = target.dataset.opening; saveFilters(); location.hash = 'games'; await render(); return; }
    if (target.dataset.opponent) { state.filters.opponent = target.dataset.opponent; saveFilters(); location.hash = 'games'; await render(); return; }
    if (target.dataset.phase) { state.filters.phase = target.dataset.phase; saveFilters(); location.hash = 'games'; await render(); return; }
    if (target.dataset.treePath!==undefined||target.dataset.treeAll!==undefined) { state.treePath=(target.dataset.treePath??target.dataset.treeAll).split(' ').filter(Boolean);await render();if(target.dataset.treeAll!==undefined)$('#tree-continuations')?.scrollIntoView({block:'center'});return; }
    if (target.dataset.tree) { state.treePath.push(target.dataset.tree); await render(); return; }
    if (target.dataset.heatDay) { state.filters.weekday = target.dataset.heatDay; state.filters.hourFrom = target.dataset.heatHour; delete state.filters.hour; saveFilters(); location.hash = 'games'; await render(); return; }
    if (target.dataset.job) { await api(`/api/jobs/${target.dataset.job}/${target.dataset.jobAction}`, { method: 'POST', body: {} }); await pollJobs(); return; }
    const action = target.dataset.action;
    if (target.dataset.coachJump) { document.getElementById(target.dataset.coachJump)?.scrollIntoView({behavior:'smooth',block:'start'}); return; }
    if (action === 'coach-export') { await copyCoachReport(); return; }
    if (action === 'reload') { await loadBoot(); await render(); }
    if (action === 'more-filters') $('.filter-more').classList.toggle('open');
    if (action === 'reset-filters') { state.filters = {}; saveFilters(); await render(); }
    if (action === 'sync') { await startJob('sync'); if (location.hash === '#settings') await render(); }
    if (action === 'analyze' || action === 'reanalyze') { await startJob('analysis', { mode: action === 'reanalyze' ? 'all' : 'pending' }); if (location.hash === '#settings') await render(); }
    if (action === 'sort-direction') { state.direction = state.direction === 'desc' ? 'asc' : 'desc'; await render(); }
    if (action === 'tree-root') { state.treePath = []; await render(); }
    if (action === 'tree-back') { state.treePath.pop(); await render(); }
    if (action === 'backup') { const r = await api('/api/backup', { method: 'POST', body: {} }); toast('Копия сохранена: ' + r.file); }
    if (action === 'compare') await comparePeriods();
    await reviewAction(event, target);
    await trainingAction(event, target);
  } catch (error) { toast(error.message); }
});
document.addEventListener('change', async event => {
  try {
    if(['tree-depth','tree-branches'].includes(event.target.id)){state[event.target.id==='tree-depth'?'treeDepth':'treeBranches']=Number(event.target.value);await render();return;}
    if (event.target.id === 'skill-window' || event.target.id === 'skill-band') { state.filters[event.target.id === 'skill-window' ? 'skillWindow' : 'skillBand'] = event.target.value; saveFilters(); await render(); return; }
    if (event.target.dataset.coachDay) { const completed=new Set(coachCompleted()),day=Number(event.target.dataset.coachDay); if(event.target.checked)completed.add(day);else completed.delete(day);localStorage.setItem(coachPlanKey(),JSON.stringify([...completed])); }
    if (event.target.closest('#filters')) { const data = new FormData($('#filters')); state.filters = { ...state.filters, ...Object.fromEntries(data) }; for (const key of Object.keys(state.filters)) if (state.filters[key] === '') delete state.filters[key]; saveFilters(); await render(); }
    if (event.target.id === 'game-sort') { state.sort = event.target.value; await render(); }
    if (event.target.id === 'pgn-file') { const file = event.target.files[0]; if (file) { const result = await api('/api/import', { method: 'POST', body: { pgn: await file.text() } }); toast(`Импортировано ${result.imported}. ${result.errors.slice(0, 2).join('; ')}`); await loadBoot(); await render(); } }
  } catch (error) { toast(error.message); }
});
document.addEventListener('submit', async event => {
  if (!['settings-form', 'add-profile'].includes(event.target.id)) return; event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target));
    if (event.target.id === 'settings-form') { for (const k of ['sessionGap', 'minSample', 'hash']) data[k] = Number(data[k]); for (const k of ['autoAnalyze', 'includeRecovered']) data[k] = event.target.elements[k].checked; await api('/api/settings', { method: 'PATCH', body: data }); toast('Настройки сохранены.'); }
    else { await api('/api/profiles', { method: 'POST', body: data }); state.profile = data.username.toLowerCase().trim(); toast('Профиль добавлен. Началась проверка и синхронизация.'); }
    await loadBoot(); await render();
  } catch (error) { toast(error.message); }
});
$('#profile').addEventListener('change', async event => { state.profile = event.target.value; localStorage.setItem('chess-profile', state.profile); state.jobs = []; state.treePath = []; await render(); });
$('#sync').addEventListener('click', async () => { try { await startJob('sync'); } catch (error) { toast(error.message); } });
$('#menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#close-modal').addEventListener('click', () => $('#modal').close());
window.addEventListener('hashchange', () => { $('.sidebar').classList.remove('open'); state.puzzle = null; void render(); });

async function comparePeriods() {
  const from = state.filters.from, to = state.filters.to; if (!from || !to) { toast('Задайте начало и конец периода.'); return; }
  const start = Date.parse(from), end = Date.parse(to), length = end - start + 86400000, previousFrom = new Date(start - length).toISOString().slice(0, 10), previousTo = new Date(start - 86400000).toISOString().slice(0, 10);
  if (length <= 0) { toast('Конец периода должен быть позже начала.'); return; }
  const params = new URLSearchParams({ ...state.filters, from: previousFrom, to: previousTo }), previous = await api('/api/analytics?' + params);
  $('#comparison').innerHTML = table(['Показатель', 'Предыдущий период', 'Выбранный период'], [['Партий', previous.sample, state.report.sample], ['Качество', score(previous.summary.accuracy), score(state.report.summary.accuracy)], ['ACPL', score(previous.summary.acpl), score(state.report.summary.acpl)], ['Победы', percent(previous.summary.winRate), percent(state.report.summary.winRate)]].map(row => `<tr>${row.map(x => `<td>${x}</td>`).join('')}</tr>`)) + `<p class="subtle">Предыдущий период: ${previousFrom} — ${previousTo}. Сопоставимость зависит от режима анализа и покрытия.</p>`;
  decorate();
}

// Board and training controllers are declared below; all HTML interpolations escape external values.
const GLYPHS = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
function drawBoard(container, fen, { orientation = 'w', interactive = false, selected = null, last = null, best = null, legal = [], onSquare = null, onMove = null } = {}) {
  if (!container) return; const chess = new Chess(fen), files = orientation === 'w' ? 'abcdefgh' : 'hgfedcba', ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const squares = ranks.flatMap((rank, row) => [...files].map((file, col) => {
    const square = file + rank, p = chess.get(square), classes = ['square', ((file.charCodeAt(0) - 97) + rank) % 2 === 1 ? 'dark' : '', p ? (p.color === 'w' ? 'white-piece' : 'black-piece') : '', last?.includes(square) ? 'last' : '', selected === square ? 'selected' : '', legal.includes(square) ? 'legal' : ''];
    return `<button type="button" class="${classes.join(' ')}" data-square="${square}" aria-label="${square}${p ? ' ' + p.color + ' ' + p.type : ''}" ${interactive ? '' : 'tabindex="-1"'}>${p ? `<span class="piece-token" aria-hidden="true">${GLYPHS[p.color][p.type]}</span>` : ''}${col === 0 || row === 7 ? `<small>${col === 0 ? rank : ''}${row === 7 ? file : ''}</small>` : ''}</button>`;
  })).join('');
  let arrow = ''; if (best && /^[a-h][1-8][a-h][1-8]/.test(best)) {
    const xy = square => ({ x: [...files].indexOf(square[0]) * 100 + 50, y: ranks.indexOf(Number(square[1])) * 100 + 50 }); const a = xy(best.slice(0, 2)), b = xy(best.slice(2, 4));
    arrow = `<svg class="board-arrows" viewBox="0 0 800 800" aria-hidden="true"><defs><marker id="arrow-head" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0 L4 2 L0 4 Z" fill="#ddf876"/></marker></defs><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ddf876" stroke-width="15" stroke-opacity=".82" marker-end="url(#arrow-head)"/></svg>`;
  }
  bindBoardDrag(container,{Chess,fen,interactive,onMove});
  container.innerHTML = `<div class="board-wrap"><div class="board ${interactive?'board-interactive':''}" role="group" aria-label="Шахматная доска">${squares}</div>${arrow}</div>`;
  container.onclick = event => { const square = event.target.closest('[data-square]')?.dataset.square; if (square && interactive) onSquare?.(square); };
}
const evalText = s => !s ? 'Нет оценки' : (s.bound === 'lowerbound' ? '≥' : s.bound === 'upperbound' ? '≤' : '') + (s.kind === 'mate' ? `${s.winner === 'w' ? '+' : '−'}M${Math.abs(s.value)}` : `${s.value >= 0 ? '+' : ''}${fmt(s.value / 100, 2)}`);
function pvSAN(fen, pv) { try { const c = new Chess(fen); return pv.map(uci => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' }).san).join(' '); } catch { return pv.join(' '); } }
function cancelReviewSearch(s) {
  if (!s) return; clearTimeout(s.autoTimer);s.autoTimer=null;s.autoPending=false;s.searchError=null; s.requestToken=(s.requestToken??0)+1; s.controller?.abort(); s.controller=null; s.busy=false;
}
function reviewKey(game) { return 'chess-variations:' + game.id; }
function reviewSignature(game) { return game.initialFen+'|'+game.moves.map(m=>m.uci).join(' '); }
function saveReviewTree(s) {
  try { localStorage.setItem(reviewKey(s.game),JSON.stringify({...s.tree.serialize(),signature:reviewSignature(s.game)})); }
  catch { if(!s.saveFailed)toast('Не удалось сохранить варианты в браузере. Их можно скопировать в PGN.');s.saveFailed=true; }
}
async function reviewView(id, ply = 0) {
  const sequence=state.sequence,game = await api('/api/games/' + encodeURIComponent(id));
  if(sequence!==state.sequence)return;
  const tree=new ReviewTree(game,Chess,ply);
  try { const saved=JSON.parse(localStorage.getItem(reviewKey(game))??'null');if(saved?.signature===reviewSignature(game))tree.restore(saved); } catch { toast('Сохранённые варианты не удалось восстановить. Исходная партия доступна.'); }
  const s=state.review={game,tree,orientation:game.color,selected:null,sandbox:false,origin:tree.cursor,cache:new Map(),requestToken:0,busy:false,auto:localStorage.getItem('chess-review-auto')!=='false'};
  $('#content').innerHTML = `<div class="review"><section><div id="player-top" class="player-line"></div><div id="review-board"></div><div id="player-bottom" class="player-line"></div><div class="board-controls"><button class="icon-button" data-review="start" aria-label="Начало линии">|‹</button><button class="icon-button" data-review="prev" aria-label="Предыдущий ход">‹</button><button class="icon-button" data-review="next" aria-label="Следующий ход">›</button><button class="icon-button" data-review="end" aria-label="Конец линии">›|</button><button class="button secondary small" data-review="flip">Повернуть</button><button class="button secondary small" data-review="error">Следующая ошибка партии</button></div><div id="branch-note"></div><div id="review-play-controls"></div><p class="subtle">Перетащите фигуру на нужное поле или нажмите фигуру и поле назначения — можно играть за обе стороны. Стрелки ← / → листают текущую линию. Варианты сохраняются в этом браузере отдельно от исходной партии. Авторасчёт оценивает позицию после каждого хода в быстром режиме; кнопка «Оценить позицию» использует режим из настроек.</p><div class="section-actions"><button class="button secondary small" data-review="position">Оценить позицию · 3 варианта</button><button class="button small" data-review="analyze">Анализировать исходную партию</button><a class="button ghost small" href="/api/games/${encodeURIComponent(id)}/pgn?profile=${encodeURIComponent(state.profile)}">PGN исходной партии</a>${game.url && /^https:\/\/(www\.)?chess\.com\//.test(game.url)?`<a class="button ghost small" href="${esc(game.url)}" target="_blank" rel="noopener">Chess.com</a>`:''}</div><div id="review-branches"></div></section><section class="card"><div class="card-head"><h2>${esc(game.opponent)} · ${pill(game.outcome)}</h2>${pill(game.analysis?.source??'pending')}</div><p class="subtle">${date(game.end,true)} · ${esc(game.timeClass)} ${esc(game.timeControl)} · ${esc(game.opening)}</p>${theorySummaryHTML(game.theory,game.moves)}<div id="eval-info"></div><p class="subtle">График и список ходов — исходная партия. Свои линии смотрите в блоке «Ваши варианты».</p><div id="review-chart"></div><div class="move-list" id="move-list"></div><div id="move-info" class="move-info"></div><div id="variations"></div></section></div>`;
  const analysis=game.analysis;
  $('#review-chart').innerHTML=lineChart(Array.from({length:game.plies+1},(_,i)=>{const score=analysis?.positions[i]?.score;return score?.kind==='cp'&&!score.bound?score.value/100:null;}),{height:145,zero:true,labels:Array.from({length:game.plies+1},(_,i)=>String(i)),unit:''});
  for(const point of $$('#review-chart .point')){point.dataset.reviewPly=point.dataset.pointIndex;point.setAttribute('tabindex','0');}
  $('#move-list').innerHTML=game.moves.map((m,i)=>`<button class="move-button${game.theory?.moves[i]?' has-book':''}" data-review-ply="${i+1}"><span class="number">${m.fullmove}${m.color==='w'?'.':'…'}</span>${esc(m.san)}<small>${theoryBadge(game.theory?.moves[i])}${analysis?.moves[i]?pill(analysis.moves[i].category):''}</small></button>`).join('');
  scheduleReviewAnalysis(s);paintReview();
}
function scheduleReviewAnalysis(s,attempt=0) {
  clearTimeout(s.autoTimer);s.autoTimer=null;s.autoPending=false;
  if(state.review!==s||!s.auto||s.busy||s.tree.status().terminal||s.cache.has(s.tree.cursor))return;
  const id=s.tree.cursor;
  s.searchError=null;s.autoPending=true;
  s.autoTimer=setTimeout(()=>{s.autoTimer=null;s.autoPending=false;if(state.review===s&&s.auto&&s.tree.cursor===id)void searchReview(s,{automatic:true,attempt});},350);
}
function reviewPosition(s) { const node=s.tree.current;return s.cache.get(node.id)??(node.original?s.game.analysis?.positions[node.mainPly]:null); }
function reviewBranchesHTML(s) {
  const leaves=s.tree.leaves(),limit=s.branchLimit??30;
  return `<section class="review-branches"><h3>Ваши варианты ${leaves.length?'· '+leaves.length:''}</h3>${leaves.length?leaves.slice(-limit).reverse().map((leaf,i)=>{
    const origin=s.tree.origin(leaf.id),line=s.tree.path(leaf.id).slice(origin.mainPly);
    return `<div class="review-branch-line"><small>Ветка ${i+1} · после ${origin.mainPly} полуходов партии</small><div class="branch-moves"><button class="button ghost small" data-review-node="${origin.id}">До варианта</button>${line.slice(0,60).map(n=>`<button class="branch-move ${n.id===s.tree.cursor?'active':''}" data-review-node="${n.id}">${n.fullmove}${n.color==='w'?'.':'…'} ${esc(n.san)}</button>`).join('')}${line.length>60?`<button class="button ghost small" data-review-node="${leaf.id}">Конец ветки</button>`:''}</div></div>`;
  }).join('')+(leaves.length>limit?'<button class="button ghost small" data-review="more-branches">Показать ещё варианты</button>':''):'<p class="subtle">Выберите позицию партии и попробуйте другой ход. Здесь появится отдельная ветка.</p>'}</section>`;
}
function paintReview() {
  const s=state.review;if(!s||!$('#review-board'))return;
  const {game,tree}=s,node=tree.current,board=tree.board(),status=tree.status(board),position=reviewPosition(s),fen=node.fen,branch=s.sandbox||!node.original,ply=node.original?node.mainPly:tree.origin().mainPly;
  const legal=s.selected&&!status.terminal?board.moves({square:s.selected,verbose:true}).map(m=>m.to):[];
  drawBoard($('#review-board'),fen,{orientation:s.orientation,interactive:!status.terminal,selected:s.selected,last:node.parent!==null?[node.from,node.to]:null,best:position?.bestMove,legal,onSquare:reviewSquare,onMove:reviewDrop});
  for(const [target,color] of [['#player-top',s.orientation==='w'?'b':'w'],['#player-bottom',s.orientation]]){
    const self=color===game.color,lastClock=branch?null:[...game.moves.slice(0,ply)].reverse().find(m=>m.color===color&&Number.isFinite(m.clock))?.clock;
    $(target).innerHTML=`<span class="color-piece ${color==='b'?'black':''}">${color==='w'?'♔':'♚'}</span><strong>${esc(self?state.profile:game.opponent)}</strong><small>${(self?game.rating:game.opponentRating)??'—'}</small><span class="clock">${branch?'Вариант':clock(lastClock)}</span>`;
  }
  const score=status.terminal?(board.isCheckmate()?{kind:'mate',value:0,winner:board.turn()==='w'?'b':'w'}:{kind:'cp',value:0}):position?.score;
  $('#eval-info').innerHTML=`<div class="eval-readout">${evalText(score)} <small class="subtle">с точки зрения белых${position?.depth?' · глубина '+position.depth:''}</small></div><div class="eval-meter"><span data-width="${score&&!score.bound?score.kind==='mate'?(score.winner==='w'?100:0):100/(1+Math.exp(-score.value/250)):50}"></span></div><p class="subtle" role="status">${esc(s.busy?'Stockfish анализирует позицию…':s.autoPending?'Готовится расчёт позиции…':status.text)}</p>`;
  if(s.searchError)$('#eval-info').innerHTML+=`<p class="method" role="status">${esc(s.searchError)} Можно повторить кнопкой «Оценить позицию».</p>`;
  const incomplete=game.analysis?.moves.filter(m=>m.category==='unknown').length??0;
  if(incomplete)$('#eval-info').innerHTML+=`<p class="method">В сохранённом анализе ${incomplete} ходов без категории: для оценки качества нужны оценки до и после без граничных значений. Нажмите «Анализировать исходную партию», чтобы пересчитать их; это отдельный расчёт от автооценки текущей позиции.</p>`;
  if(game.analysis?.invalidatedPositions)$('#eval-info').innerHTML+='<p class="method">Некоторые старые нулевые оценки по правилу 50 ходов исключены: для них требуется новый поиск.</p>';
  $('#review-play-controls').innerHTML=`<div class="section-actions review-play-controls"><button class="button secondary small" data-review="auto" aria-pressed="${s.auto}">Авторасчёт: ${s.auto?'включён':'выключен'}</button><button class="button ${branch?'secondary':''} small" data-review="branch">${branch?'Начать здесь ещё один вариант':'Проверить другой ход'}</button><button class="button secondary small" data-review="reply" ${s.busy||status.terminal?'disabled':''}>Ход Stockfish</button>${branch?'<button class="button ghost small" data-review="return">Вернуться к партии</button><button class="button ghost small" data-review="copy-variation">Скопировать PGN варианта</button>':''}${s.busy||s.autoPending?'<button class="button ghost small" data-review="stop">Остановить поиск</button>':''}</div>`;
  const selected=node.original?game.analysis?.moves[ply-1]:null;
  $('#move-info').innerHTML=branch?`<strong>Альтернативный вариант</strong><p>${node.parent!==null?esc(node.fullmove+(node.color==='w'?'.':'…')+' '+node.san):'Начальная позиция'}. Часы и категории ошибок исходной партии к этой ветке не применяются.</p>`:selected?`<strong>${esc(selected.fullmove+'. '+selected.san)}</strong> ${pill(selected.category)}<br>До: ${evalText(selected.before)} · После: ${evalText(selected.scoreAfter)}<br>Потеря: ${fmt(selected.loss,1)} cp · Качество: ${scoreText(selected.accuracy)} / 100<br>Лучший: ${esc(selected.bestMove??'—')} · ${esc(label(selected.features.phase))}<br>Обдумывание: ${fmt(selected.spent,1)} с · Остаток: ${clock(selected.clock)}`:'Начальная позиция. Выберите ход партии или сыграйте свой ход на доске.';
  if(!branch&&ply){if(!selected)$('#move-info').innerHTML=`<strong>${esc(game.moves[ply-1]?.san)}</strong><p class="subtle">Для оценки качества запустите анализ партии.</p>`;$('#move-info').innerHTML+=theoryMoveHTML(game.theory,ply);}
  if(!branch&&selected)$('#move-info').innerHTML+=specialMoveDetails(selected);
  if(!branch&&ply)$('#move-info').innerHTML+=`<p class="section-actions"><button class="button secondary small" data-review="replace">Заменить этот ход</button><button class="button ghost small" data-review="explain">Объяснить ход</button></p>${s.explanations?.[ply]?explanationHTML(s.explanations[ply]):''}`;
  $('#variations').innerHTML=(position?.lines??[]).map((line,i)=>({line,i})).filter(({line})=>line.pv?.length).map(({line,i})=>`<div class="variation"><strong>${i+1}. ${evalText(line.score)}</strong> · depth ${line.depth??'—'}<br>${esc(pvSAN(fen,line.pv))}<div class="section-actions"><button class="button ghost small" data-review="pv-first" data-review-line="${i}">Сыграть первый ход</button><button class="button ghost small" data-review="pv-line" data-review-line="${i}">Открыть линию</button></div></div>`).join('')||`<p class="subtle">${status.terminal?'Вариант завершён.':s.busy||s.autoPending?'Рассчитываются оценка и три лучших продолжения…':'Нажмите «Оценить позицию», чтобы получить оценку и продолжения Stockfish.'}</p>`;
  $('#branch-note').innerHTML=branch?`<div class="branch-note"><strong>Вы проверяете свой вариант.</strong> Исходная партия и её статистика сохраняются. Можно двигать обе стороны или нажимать «Ход Stockfish».</div>`:'';
  $('#review-branches').innerHTML=reviewBranchesHTML(s);
  for(const button of $$('#move-list [data-review-ply]'))button.classList.toggle('active',node.original&&Number(button.dataset.reviewPly)===ply);
  for(const button of $$('[data-review="position"]'))button.disabled=s.busy||status.terminal;
  decorate();
}
const scoreText=value=>score(value);
function reviewSquare(square) {
  const s=state.review;if(!s||s.tree.status().terminal)return;const board=s.tree.board();
  if(s.selected){const options=board.moves({square:s.selected,verbose:true}).filter(m=>m.to===square);if(options.length){const from=s.selected;if(options.some(m=>m.promotion)){showPromotion(piece=>{if(state.review===s)applyReviewMove(from,square,piece);});return;}applyReviewMove(from,square);return;}}
  s.selected=board.get(square)?.color===board.turn()?square:null;paintReview();
}
function reviewDrop(from,to){
  const s=state.review;if(!s)return;
  const id=s.tree.cursor,options=dropMoves(Chess,s.tree.current.fen,from,to);if(!options.length)return;
  if(options.some(m=>m.promotion)){showPromotion(piece=>{if(state.review===s&&s.tree.cursor===id)applyReviewMove(from,to,piece);});return;}
  applyReviewMove(from,to);
}

function showPromotion(onSelect) { $('#modal-content').innerHTML = '<h2>Превращение пешки</h2><div class="section-actions">' + ['q', 'r', 'b', 'n'].map(p => `<button class="button secondary" data-promotion="${p}">${({ q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь' })[p]}</button>`).join('') + '</div>'; $('#modal').showModal(); $('#modal-content').onclick = event => { const piece = event.target.closest('[data-promotion]')?.dataset.promotion; if (piece) { $('#modal').close(); onSelect(piece); $('#modal-content').onclick = null; } }; }
function applyReviewMove(from,to,promotion='q') {
  const s=state.review;if(!s)return;
  try{const origin=s.tree.cursor;s.tree.play({from,to,promotion});cancelReviewSearch(s);if(!s.sandbox)s.origin=origin;s.sandbox=true;s.selected=null;saveReviewTree(s);scheduleReviewAnalysis(s);paintReview();}catch(error){toast(error.message);}
}
async function searchReview(s,{reply=false,automatic=false,attempt=0}={}) {
  if(s.busy||s.tree.status().terminal)return;
  const id=s.tree.cursor,request=s.tree.request();
  let result=reply?reviewPosition(s):null;
  if(reply&&s.game.analysis?.source!=='verified'&&!s.cache.has(id))result=null;
  if(!result?.bestMove||!reply){
    cancelReviewSearch(s);s.searchError=null;const token=s.requestToken,controller=new AbortController();s.controller=controller;s.busy=true;paintReview();
    try{result=await api('/api/position',{method:'POST',body:{...request,preset:automatic?'quick':state.boot.settings.preset},signal:controller.signal});
      if(state.review!==s||s.requestToken!==token||s.tree.cursor!==id)return;s.cache.set(id,result);
    }catch(error){if(error.name!=='AbortError'&&state.review===s&&s.requestToken===token){
      if(automatic&&error.status===429&&attempt<5){s.busy=false;scheduleReviewAnalysis(s,attempt+1);}
      else {s.searchError=error.message;if(!automatic)toast(error.message);}
    }return;}
    finally{if(s.requestToken===token){s.busy=false;s.controller=null;if(state.review===s)paintReview();}}
  }
  if(state.review!==s||s.tree.cursor!==id)return;
  if(reply){if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(result.bestMove??'')){toast('Движок не нашёл продолжения.');return;}const origin=s.tree.cursor;s.tree.play(result.bestMove);if(!s.sandbox)s.origin=origin;s.sandbox=true;s.selected=null;saveReviewTree(s);scheduleReviewAnalysis(s);}
  paintReview();
}
async function copyReviewPGN(s) {
  const pgn=s.tree.pgn();try{await navigator.clipboard.writeText(pgn);toast('PGN текущего варианта скопирован.');}
  catch{$('#modal-content').innerHTML='<h2>PGN текущего варианта</h2><textarea id="variation-pgn" class="coach-export" readonly aria-label="PGN варианта"></textarea>';$('#variation-pgn').value=pgn;$('#modal').showModal();$('#variation-pgn').focus();$('#variation-pgn').select();}
}
async function reviewAction(event,target) {
  const s=state.review;if(!s||!$('#review-board'))return;
  if(target.dataset.reviewPly!==undefined){cancelReviewSearch(s);s.tree.goMain(Number(target.dataset.reviewPly));s.sandbox=false;s.selected=null;scheduleReviewAnalysis(s);paintReview();return;}
  if(target.dataset.reviewNode!==undefined){cancelReviewSearch(s);s.tree.go(Number(target.dataset.reviewNode));s.sandbox=!s.tree.current.original;s.origin=s.tree.origin().id;s.selected=null;scheduleReviewAnalysis(s);paintReview();return;}
  const action=target.dataset.review;if(!action)return;
  if(action==='auto'){cancelReviewSearch(s);s.auto=!s.auto;localStorage.setItem('chess-review-auto',String(s.auto));scheduleReviewAnalysis(s);paintReview();return;}
  if(action==='explain'){const ply=s.tree.current.mainPly;target.disabled=true;try{const explanation=await api('/api/games/'+encodeURIComponent(s.game.id)+'/explanation?ply='+ply);s.explanations??={};s.explanations[ply]=explanation;}finally{target.disabled=false;}if(state.review===s)paintReview();return;}
  if(action==='position'||action==='reply'){await searchReview(s,{reply:action==='reply'});return;}
  if(action==='copy-variation'){await copyReviewPGN(s);return;}
  if(['start','prev','next','end','return','error','branch','stop','pv-first','pv-line','replace'].includes(action))cancelReviewSearch(s);
  if(action==='more-branches')s.branchLimit=(s.branchLimit??30)+30;
  if(action==='replace'){s.tree.previous();s.origin=s.tree.cursor;s.sandbox=true;}
  if(action==='start')s.tree.go(0);
  if(action==='prev')s.tree.previous();
  if(action==='next')s.tree.next();
  if(action==='end')s.tree.end();
  if(action==='return'){s.tree.go(s.origin);s.tree.returnToGame();s.sandbox=false;}
  if(action==='branch'){s.sandbox=true;s.origin=s.tree.cursor;toast('Выберите фигуру и поле назначения. Для проверки ответа нажмите «Ход Stockfish».');}
  if(action==='error'){const ply=s.tree.origin().mainPly,errors=s.game.analysis?.moves.filter(m=>m.color===s.game.color&&['mistake','blunder'].includes(m.category))??[];s.tree.goMain((errors.find(m=>m.ply>ply)??errors[0])?.ply??ply);s.sandbox=false;}
  if(action==='flip')s.orientation=s.orientation==='w'?'b':'w';
  if(action==='pv-first'||action==='pv-line'){
    const line=reviewPosition(s)?.lines?.[Number(target.dataset.reviewLine)];if(!line?.pv?.length)return;
    if(!s.sandbox)s.origin=s.tree.cursor;s.sandbox=true;
    s.tree.playLine(line.pv.slice(0,action==='pv-first'?1:16));saveReviewTree(s);
  }
  if(action==='analyze'){await startJob('analysis',{gameIds:[s.game.id],mode:'all'});toast('Исходная партия добавлена в очередь анализа.');}
  s.selected=null;if(['start','prev','next','end','return','error','branch','pv-first','pv-line','replace'].includes(action))scheduleReviewAnalysis(s);paintReview();
}

document.addEventListener('keydown', event => {
  if ($('#modal').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if(['Enter',' '].includes(event.key)&&event.target.dataset.puzzle){event.preventDefault();void openPuzzle(event.target.dataset.puzzle,{mode:event.target.dataset.practiceMode??'cycle'});return;}
  if (state.review && $('#review-board') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const action = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'start', End: 'end' }[event.key]; void reviewAction(event, { dataset: { review: action } }); }
  if (['Enter', ' '].includes(event.key) && event.target.dataset.game) { event.preventDefault(); location.hash = 'game/' + encodeURIComponent(event.target.dataset.game); }
});

async function trainingView() {
  const sequence=state.sequence,profile=state.profile;const [data,report]=await Promise.all([api('/api/puzzles'),api('/api/learning')]);if(sequence!==state.sequence||profile!==state.profile)return '';state.training=data;state.learning=report;state.puzzle=null;
  return learningViewHTML(report,data);
}
function paintTrainingJobs(){if($('#training-generation'))$('#training-generation').innerHTML=state.jobs.filter(j=>j.kind==='puzzles'&&j.data.cycleId===state.learning?.cycle?.id&&(['queued','running','paused','failed'].includes(j.status)||j.status==='completed'&&!state.training?.total)).slice(0,2).map(jobHTML).join('');if($('#random-generation'))$('#random-generation').innerHTML=state.jobs.filter(j=>j.kind==='puzzles'&&j.data.mode==='random'&&(['queued','running','paused','failed'].includes(j.status)||j.status==='completed'&&!state.training?.random?.total)).slice(0,1).map(jobHTML).join('');}
function mountPuzzleBoards(){for(const p of state.training.puzzles)drawBoard($('#mini-'+p.id),p.fen,{orientation:p.color});for(const p of state.training.random?.puzzles??state.training.archive??[])drawBoard($('#mini-random-'+p.id),p.fen,{orientation:p.color});}
async function openRandomPuzzle(){
  if(state.randomLoading)return;state.randomLoading=true;
  try{
    const profile=state.profile;if(state.randomProfile!==profile){state.randomProfile=profile;state.randomSeen=[];}
    const result=await api('/api/puzzles/random?exclude='+encodeURIComponent((state.randomSeen??[]).slice(-100).join(',')));
    if(state.profile!==profile||!$('#puzzle-workspace'))return;
    if(!result.puzzle){toast('Набор пока пуст. Добавьте новые задачи.');return;}
    state.practiceSession=null;if(state.training?.random)state.training.random.total=result.total;if($('#random-total'))$('#random-total').textContent=fmt(result.total);
    await openPuzzle(result.puzzle.id,{mode:'random',puzzle:result.puzzle});
  }finally{state.randomLoading=false;}
}
async function openPuzzle(id,{mode='cycle',puzzle=null}={}){
  const p=puzzle??[...state.training.puzzles,...(state.training.random?.puzzles??state.training.archive??[])].find(p=>p.id===id);if(!p)return;
  const profile=state.profile,run=await api('/api/puzzles/'+id+'/start',{method:'POST',body:{mode}});if(state.profile!==profile||!$('#puzzle-workspace'))return;
  if(mode==='random'){if(state.randomProfile!==profile){state.randomProfile=profile;state.randomSeen=[];}if(state.randomSeen?.at(-1)!==p.id)state.randomSeen=[...(state.randomSeen??[]),p.id].slice(-100);}
  const board=new Chess(p.fen);for(const uci of run.moves)board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
  const s=state.puzzle={mode:run.mode??mode,data:p,board,moves:run.moves,runId:run.runId,profile,selected:null,complete:false,busy:false};
  const session=mode==='random'?null:state.practiceSession,index=session?.ids.indexOf(id)??-1;
  $('#puzzle-workspace').innerHTML=section(index>=0?`Занятие · позиция ${index+1} из ${session.ids.length}`:mode==='random'?'Случайная задача из ваших партий':'Практика на своей позиции',`<div class="review"><div id="training-board"></div><div><h3>${p.color==='w'?'Ход белых':'Ход чёрных'}</h3><p class="practice-question">Что угрожает соперник? Какие у него есть шахи и взятия после вашего хода?</p><p id="puzzle-feedback" class="method" role="status">${run.assisted||run.mistakes?(mode==='random'?'Продолжаем разбор. Уже были ошибка или подсказка.':'Продолжаем разбор. Уже были ошибка или подсказка; после завершения будет короткий повтор.'):'Сделайте лучший ход. Можно нажать фигуру и поле или перетащить её. Соперник ответит автоматически.'}</p><label class="practice-reflection">Моя проверка перед ходом (необязательно)<textarea id="practice-reflection" maxlength="1000" rows="2" placeholder="Самый опасный ответ соперника…"></textarea></label><div class="section-actions" id="practice-tools"><button class="button secondary small" data-action="puzzle-hint">${mode==='random'?'Подсказка':'Подсказка · короткий повтор'}</button><button class="button ghost small" data-action="puzzle-solution">Разобрать решение</button><button class="button ghost small" data-action="puzzle-reset">Начать заново</button></div><div id="puzzle-line" class="variation"></div><div id="puzzle-result"></div></div></div>`);
  paintPuzzle();$('#puzzle-workspace').scrollIntoView({behavior:'smooth',block:'start'});
}
function paintPuzzle(){
  const s=state.puzzle;if(!s||!$('#training-board'))return;const legal=s.selected?s.board.moves({square:s.selected,verbose:true}).map(m=>m.to):[];
  drawBoard($('#training-board'),s.board.fen(),{orientation:s.data.color,interactive:!s.complete&&!s.busy,selected:s.selected,legal,onMove:puzzleDrop,onSquare:async square=>{
    if(s.complete||s.busy)return;
    if(s.selected){const from=s.selected,options=s.board.moves({square:from,verbose:true}).filter(m=>m.to===square);if(options.length){if(options.some(m=>m.promotion))showPromotion(piece=>{if(state.puzzle===s)void attemptPuzzle(from,square,piece);});else await attemptPuzzle(from,square);return;}}
    s.selected=s.board.get(square)?.color===s.board.turn()?square:null;paintPuzzle();
  }});
  $('#puzzle-line').textContent=s.board.history().join(' ');for(const button of $$('#practice-tools button'))button.disabled=s.busy||s.complete;
}
function puzzleDrop(from,to){
  const s=state.puzzle;if(!s||s.busy||s.complete)return;const fen=s.board.fen(),options=dropMoves(Chess,fen,from,to);if(!options.length)return;
  if(options.some(m=>m.promotion)){showPromotion(piece=>{if(state.puzzle===s&&s.board.fen()===fen)void attemptPuzzle(from,to,piece);});return;}void attemptPuzzle(from,to);
}
function practiceFinished(s,result){
  s.complete=true;s.selected=null;
  $('#puzzle-feedback').textContent=s.mode==='random'?(result.clean?'Решено самостоятельно. Можно перейти к следующей случайной задаче.':'Позиция разобрана с помощью или после ошибки. Можно перейти к следующей случайной задаче.'):result.clean?(result.early?'Самостоятельно. Это ранний повтор — расписание не изменилось.':'Решено самостоятельно. Следующее повторение: '+new Date(result.dueAt).toLocaleString('ru-RU')):'Позиция разобрана с помощью или после ошибки. Повторите её через 10 минут.';
  $('#puzzle-result').innerHTML=`<p>${esc(result.review.reason)}</p>${result.review.mistake?`<p>В вашей партии: <strong>${esc(result.review.mistake.played)}</strong>${result.review.mistake.reply?', затем '+esc(result.review.mistake.reply):''}. Потеря по сохранённому анализу: ${fmt(result.review.mistake.loss/100,1)} пешки.</p>`:''}<p><strong>Проверенное продолжение:</strong> ${esc(pvSAN(s.data.fen,result.review.solution))}</p><p>${linkGame(s.data.gameId,s.data.ply,'Сравнить со своей партией')}</p><button class="button" data-action="${s.mode==='random'?'random-puzzle':'practice-next'}">${s.mode==='random'?'Следующая случайная задача':state.practiceSession&&state.practiceSession.ids.indexOf(s.data.id)<state.practiceSession.ids.length-1?'Следующая позиция':'Завершить занятие и посмотреть очередь'}</button>`;
  if(s.mode==='random')void api('/api/puzzles').then(data=>{if(state.profile!==s.profile)return;state.training.random=data.random;if($('#random-total'))$('#random-total').textContent=fmt(data.random.total);if($('#random-solved'))$('#random-solved').textContent=fmt(data.random.solved);}).catch(()=>{});
}
async function attemptPuzzle(from,to,promotion='q'){
  const s=state.puzzle;if(!s||s.complete||s.busy)return;s.busy=true;paintPuzzle();
  try{
    const candidate=new Chess(s.board.fen()),uci=candidate.move({from,to,promotion}).lan;
    const result=await api('/api/puzzles/'+s.data.id+'/attempt',{method:'POST',body:{runId:s.runId,moves:[...s.moves,uci],reflection:$('#practice-reflection')?.value??''}});
    if(state.puzzle!==s||state.profile!==s.profile)return;
    if(!result.correct){$('#puzzle-feedback').textContent='Это не проверенное лучшее продолжение. Проверьте ответ соперника и попробуйте ещё раз.'+(s.mode==='random'?'':' Будет назначен короткий повтор.');s.selected=null;return;}
    s.moves=result.moves;s.board=new Chess(s.data.fen);for(const move of s.moves)s.board.move({from:move.slice(0,2),to:move.slice(2,4),promotion:move[4]});
    if(result.complete)practiceFinished(s,result);else {s.selected=null;$('#puzzle-feedback').textContent='Верно. Найдите следующий ход.';}
  }catch(error){toast(error.message);}finally{s.busy=false;if(state.puzzle===s)paintPuzzle();}
}
async function trainingAction(event,target){
  const action=target.dataset.action;
  if(action==='random-puzzle'){await openRandomPuzzle();return;}
  if(action==='random-generate'){target.disabled=true;try{await startJob('puzzles',{mode:'random'});paintTrainingJobs();toast('Проверяем новые позиции для случайного набора.');}finally{target.disabled=false;}return;}
  if(action==='learning-start'||action==='learning-restart'){
    target.disabled=true;try{await api('/api/learning/start',{method:'POST',body:{format:$('#learning-format').value,focus:$('#learning-focus').value,restart:action==='learning-restart'}});await pollJobs();await render();toast('Цикл начат. Stockfish готовит первые позиции.');}finally{target.disabled=false;}return;
  }
  if(action==='learning-refresh'){state.puzzle=null;await render();return;}
  if(action==='practice-session'){
    const remaining=Math.max(0,(state.learning.cycle?.dailyGoal??3)-state.training.today.completed),ids=remaining?state.training.queue.slice(0,remaining):(state.training.repeatQueue??[]);if(!ids.length)return;
    state.practiceSession={ids};await openPuzzle(ids[0]);return;
  }
  if(action==='generate-puzzles'){await startJob('puzzles');paintTrainingJobs();toast('Готовим до 5 позиций из последних 100 партий.');return;}
  if(action==='practice-next'){
    const ids=state.practiceSession?.ids??[],index=ids.indexOf(state.puzzle?.data.id);state.puzzle=null;
    if(index>=0&&index+1<ids.length)await openPuzzle(ids[index+1]);else {state.practiceSession=null;await render();}return;
  }
  const card=target.closest('[data-puzzle]');if(card){state.practiceSession=null;await openPuzzle(card.dataset.puzzle,{mode:card.dataset.practiceMode??'cycle'});return;}
  const s=state.puzzle;if(!s||s.busy||s.complete||!['puzzle-reset','puzzle-hint','puzzle-solution'].includes(action))return;
  s.busy=true;paintPuzzle();try{
    const kind=action.slice(7),r=await api('/api/puzzles/'+s.data.id+'/'+kind,{method:'POST',body:{runId:s.runId,reflection:$('#practice-reflection')?.value??''}});
    if(state.puzzle!==s||state.profile!==s.profile)return;
    if(kind==='reset'){s.moves=[];s.board=new Chess(s.data.fen);s.selected=null;$('#puzzle-feedback').textContent='Позиция восстановлена. Уже использованные подсказки и ошибки сохраняются.';}
    if(kind==='hint')$('#puzzle-feedback').textContent='Обратите внимание на фигуру на '+r.from+(s.mode==='random'?'. Подсказка учтена в результате задачи.':'. Подсказка учтена: позиция вернётся через 10 минут.');
    if(kind==='solution')practiceFinished(s,r);
  }finally{s.busy=false;if(state.puzzle===s)paintPuzzle();}
}

async function refreshOnReturn() {
  if (document.hidden || !state.boot || Date.now() - (state.lastReportAt ?? 0) < 30000 || state.refreshing || location.hash.startsWith('#game') || location.hash === '#settings' || state.puzzle || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  state.refreshing = true;
  try { await loadBoot(); await render(); } catch (error) { toast(error.message); }
  finally { state.refreshing = false; }
}
window.addEventListener('focus', () => void refreshOnReturn());
document.addEventListener('visibilitychange', () => void refreshOnReturn());

try { await loadBoot(); await render(); await pollJobs(); setInterval(() => void pollJobs(), 3000); } catch (error) { showError(error); }
