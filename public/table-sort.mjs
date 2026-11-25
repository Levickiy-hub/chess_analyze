const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const missing = value => value === null || value === undefined || typeof value === 'number' && !Number.isFinite(value);

export function compareSortValues(a, b, direction = 'asc') {
  if (missing(a) || missing(b)) return missing(a) === missing(b) ? 0 : missing(a) ? 1 : -1;
  let result;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      result = compareSortValues(a[i], b[i]);
      if (result) break;
    }
    result ??= 0;
  } else result = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
  return direction === 'desc' ? -result : result;
}

export function parseSortValue(text) {
  const value = String(text ?? '').trim().replace(/\u2212/g, '-');
  if (!value || /^[-—–−]+$/.test(value)) return null;
  const normalized = value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (/^[+-]?\d+(?:\.\d+)?%?$/.test(normalized)) return Number(normalized.replace('%', ''));
  const duration = /^([+-]?\d+(?:\.\d+)?)(мс|ms|с|сек|s|мин|m|ч|h)$/i.exec(normalized);
  if (duration) return Number(duration[1]) * ({ мс: .001, ms: .001, с: 1, сек: 1, s: 1, мин: 60, m: 60, ч: 3600, h: 3600 })[duration[2].toLowerCase()];
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (clock) return clock[3] ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : Number(clock[1]) * 60 + Number(clock[2]);
  const tuple = /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+$/.test(normalized);
  if (tuple) return normalized.split('/').map(Number);
  if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(normalized)) return Date.parse(normalized.length === 7 ? normalized + '-01T00:00:00Z' : normalized + 'T00:00:00Z');
  const range = /^([+-]?\d+(?:\.\d+)?)(?:[–—-][+-]?\d+(?:\.\d+)?|\+)(?:с|s)?$/.exec(normalized);
  if (range) return Number(range[1]);
  return value;
}

function cellValue(cell) {
  if (!cell) return null;
  if (cell.hasAttribute('data-sort-value')) return cell.dataset.sortType === 'text' ? cell.dataset.sortValue : parseSortValue(cell.dataset.sortValue);
  const copy = cell.cloneNode(true);
  for (const secondary of copy.querySelectorAll('.secondary-text, .sort-indicator')) secondary.remove();
  return parseSortValue(copy.textContent);
}

export function createTableSorter({ onRemoteSort = async () => {} } = {}) {
  const preferences = new Map(), originalOrder = new WeakMap();
  const headers = table => [...table.tHead.rows[0].cells];
  function updateHeaders(table, column, direction) {
    headers(table).forEach((header, index) => {
      const active = index === column;
      header.setAttribute('aria-sort', active ? direction === 'asc' ? 'ascending' : 'descending' : 'none');
      const button = header.querySelector('[data-table-sort]');
      if (button) {
        const next = active && direction === 'asc' ? 'по убыванию' : 'по возрастанию';
        button.title = `${header.dataset.sortLabel}: ${next}`;
        button.setAttribute('aria-label', `Сортировать: ${header.dataset.sortLabel}, ${next}`);
      }
    });
  }
  function sortLocal(table, column, direction) {
    const rows = [...table.tBodies[0].rows].map(row => ({ row, value: cellValue(row.cells[column]) }));
    rows.sort((a, b) => compareSortValues(a.value, b.value, direction) || originalOrder.get(a.row) - originalOrder.get(b.row));
    table.tBodies[0].append(...rows.map(item => item.row));
    updateHeaders(table, column, direction);
  }
  function enhance(root) {
    for (const table of root.querySelectorAll('table')) {
      if (!table.tHead?.rows[0] || !table.tBodies[0] || table.dataset.sortPrepared) continue;
      const columns = headers(table);
      const title = table.closest('.card')?.querySelector('h2')?.textContent ?? '';
      const key = [location.hash.split('/')[0], title, columns.map(h => h.textContent).join('|')].join('::');
      table.dataset.sortKey = key;
      table.dataset.sortPrepared = 'true';
      [...table.tBodies[0].rows].forEach((row, index) => originalOrder.set(row, index));
      const remoteKeys = table.dataset.serverSort?.split(',');
      columns.forEach((header, index) => {
        const text = header.textContent.trim();
        header.scope = 'col';
        if (/^(Пример|Продолжить|Действия)$/i.test(text) || remoteKeys && !remoteKeys[index]) return;
        header.dataset.sortLabel = text;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'table-sort-button'; button.dataset.tableSort = String(index);
        const label = document.createElement('span'); label.textContent = text;
        const indicator = document.createElement('span'); indicator.className = 'sort-indicator'; indicator.setAttribute('aria-hidden', 'true');
        button.append(label, indicator); header.replaceChildren(button);
      });
      if (remoteKeys) updateHeaders(table, remoteKeys.indexOf(table.dataset.sortColumn), table.dataset.sortDirection ?? 'desc');
      else {
        const saved = preferences.get(key);
        if (saved) sortLocal(table, saved.column, saved.direction);
        else updateHeaders(table, -1, 'asc');
      }
    }
  }
  async function handleClick(event) {
    const button = event.target.closest('[data-table-sort]');
    if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const table = button.closest('table'), column = Number(button.dataset.tableSort);
    const direction = button.closest('th').getAttribute('aria-sort') === 'ascending' ? 'desc' : 'asc';
    const remoteKeys = table.dataset.serverSort?.split(',');
    if (remoteKeys) {
      const buttons = [...table.querySelectorAll('[data-table-sort]')];
      buttons.forEach(b => b.disabled = true);
      try { await onRemoteSort(remoteKeys[column], direction); }
      finally { buttons.forEach(b => b.disabled = false); }
    } else {
      preferences.set(table.dataset.sortKey, { column, direction });
      sortLocal(table, column, direction);
    }
  }
  return { enhance, handleClick };
}
