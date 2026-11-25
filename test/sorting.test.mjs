import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSortValues, parseSortValue } from '../public/table-sort.mjs';
import { gameListRow, sortGameRows, GAME_SORT_KEYS } from '../app/game-list.mjs';

test('localized numeric columns sort numerically, with missing values always last', () => {
  const values = ['100', '2', '1\u202f568', '−3,5', '—', '10,2%', ''];
  const ascending = [...values].sort((a, b) => compareSortValues(parseSortValue(a), parseSortValue(b)));
  const descending = [...values].sort((a, b) => compareSortValues(parseSortValue(a), parseSortValue(b), 'desc'));
  assert.deepEqual(ascending.slice(0, 5), ['−3,5', '2', '10,2%', '100', '1\u202f568']);
  assert.deepEqual(descending.slice(0, 5), ['1\u202f568', '100', '10,2%', '2', '−3,5']);
  assert.deepEqual(ascending.slice(5), ['—', '']);
  assert.deepEqual(descending.slice(5), ['—', '']);
});
test('duration units, clocks, month boundaries and numeric ranges keep their meaning', () => {
  assert.equal(parseSortValue('1,2 ч'), 4320);
  assert.equal(parseSortValue('70 мин'), 4200);
  assert.equal(parseSortValue('300 ms'), .3);
  assert.equal(parseSortValue('1:02'), 62);
  assert.equal(parseSortValue('1:02:03'), 3723);
  assert.ok(parseSortValue('2026-07') < parseSortValue('2026-10'));
  assert.ok(parseSortValue('2025-12') < parseSortValue('2026-01'));
  assert.equal(parseSortValue('10–20 с'), 10);
  assert.equal(parseSortValue('30+'), 30);
  assert.equal(compareSortValues(parseSortValue('2 / 1 / 4'), parseSortValue('10 / 0 / 0')) < 0, true);
  assert.ok(compareSortValues('Игрок 2', 'Игрок 10') < 0);
});
test('game quality sorting covers every page and keeps missing analyses last', () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ id: String(i).padStart(2, '0'), accuracy: i === 30 ? null : i, rating: i === 30 ? null : i, end: i }));
  const sorted = sortGameRows(rows, 'accuracy', 'desc');
  assert.equal(sorted[0].accuracy, 29);
  assert.equal(sorted.slice(25)[0].accuracy, 4);
  assert.equal(sorted.at(-1).accuracy, null);
  assert.equal(sortGameRows(rows, 'accuracy', 'asc').at(-1).accuracy, null);
  assert.equal(rows[0].accuracy, 0, 'input must not be mutated');
  assert.ok(GAME_SORT_KEYS.includes('color') && GAME_SORT_KEYS.includes('status'));
});
test('game text columns use visible labels and equal values have a stable ID tie-break', () => {
  const rows = [{ id: 'b', color: 'b', status: 'pending', result: 'win' }, { id: 'a', color: 'w', status: 'verified', result: 'draw' }, { id: 'c', color: 'w', status: 'recovered', result: 'loss' }];
  assert.deepEqual(sortGameRows(rows, 'color', 'asc').map(r => r.id), ['a', 'c', 'b']);
  assert.deepEqual(sortGameRows(rows, 'status', 'asc').map(r => r.id), ['c', 'a', 'b']);
  assert.deepEqual(sortGameRows(rows, 'result', 'asc').map(r => r.id), ['a', 'b', 'c']);
});
test('list accuracy is calculated only from finite values of the selected player', () => {
  const row = gameListRow({ id: 'one', color: 'w' }, { source: 'verified', moves: [{ color: 'w', accuracy: 80 }, { color: 'b', accuracy: 1 }, { color: 'w', accuracy: null }, { color: 'w', accuracy: undefined }, { color: 'w', accuracy: 100 }] });
  assert.equal(row.accuracy, 90);
  assert.equal(gameListRow({ id: 'none', color: 'w' }, null).accuracy, null);
});
