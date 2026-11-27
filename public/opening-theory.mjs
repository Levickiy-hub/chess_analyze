const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function theoryBadge(move){return move?'<span class="quality-icon move-quality-icon quality-book" role="img" aria-label="Теоретический" title="Теоретический ход">📖</span>':'';}
export function theoryMoveHTML(theory,ply){
  if(!theory||!ply)return '';
  const match=theory.moves[ply-1];
  return match?`<p>${theoryBadge(match)} <strong>${esc(match.eco)} · ${esc(match.name)}</strong></p>`:'<p class="subtle">Вне справочника дебютов. Само по себе это не ошибка.</p>';
}
export function theorySummaryHTML(theory,moves){
  if(!theory)return '';
  const jump=(ply,title)=>{
    const m=moves[ply-1];return m?`<button class="button ghost small" data-review-ply="${m.ply}">${title}: ${esc(m.fullmove+(m.color==='w'?'.':'…')+' '+m.san)}</button>`:'';
  };
  return `<details class="opening-theory-summary"><summary>📖 Дебютный справочник · ${theory.bookMoves} полуходов</summary><div class="section-actions">${theory.lastBookPly?jump(theory.lastBookPly,'Последний справочный ход'):''}${theory.firstOutsidePly?jump(theory.firstOutsidePly,'Первый выход из справочника'):''}</div><p class="method">Учтены перестановки ходов. База не охватывает всю теорию; выход из неё не означает ошибку или новинку. Оценка Stockfish независима.</p><p class="subtle">База: <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noopener">Lichess chess-openings</a> · CC0 · ${esc(theory.source.lines)} линий · версия ${esc(theory.source.commit.slice(0,8))}.</p></details>`;
}
