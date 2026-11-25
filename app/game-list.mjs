import { compareSortValues } from '../public/table-sort.mjs';

export const GAME_SORT_KEYS = ['date', 'opponent', 'color', 'rating', 'result', 'format', 'accuracy', 'status', 'moves', 'opponentRating', 'opening'];
const LABELS = { w: 'Белые', b: 'Чёрные', win: 'Победа', draw: 'Ничья', loss: 'Поражение', unknown: 'Неизвестно', verified: 'Новый анализ', recovered: 'Исторические оценки', pending: 'Ожидает анализа' };

export function gameListRow(game, analysis) {
  const moves = analysis?.moves.filter(m => m.color === game.color && Number.isFinite(m.accuracy)) ?? [];
  return { id: game.id, end: game.end, opponent: game.opponent, color: game.color, rating: game.rating, opponentRating: game.opponentRating, result: game.outcome, opening: game.opening, eco: game.eco, plies: game.plies, format: game.timeClass, control: game.timeControl, status: analysis?.source ?? 'pending', accuracy: moves.length ? moves.reduce((sum, m) => sum + m.accuracy, 0) / moves.length : null };
}

export function sortGameRows(rows, key = 'date', direction = 'desc') {
  key = GAME_SORT_KEYS.includes(key) ? key : 'date';
  const value = row => key === 'date' ? row.end : key === 'moves' ? row.plies : ['color', 'result', 'status'].includes(key) ? LABELS[row[key]] ?? row[key] : row[key];
  return [...rows].sort((a, b) => compareSortValues(value(a), value(b), direction) || compareSortValues(a.id, b.id));
}
