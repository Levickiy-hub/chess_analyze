export class OpeningStudy {
  constructor(line,Chess,{color='w',practice=false}={}){this.line=line;this.Chess=Chess;this.color=color;this.practice=practice;this.ply=0;this.correct=0;this.mistakes=0;this.assisted=false;this.selected=null;this.hint=null;this.message='';this.advanceOpponent();}
  get complete(){return this.ply===this.line.moves.length;}
  board(){return new this.Chess(this.ply?this.line.moves[this.ply-1].after:this.line.moves[0].fen);}
  advanceOpponent(){if(this.practice&&this.line.moves[this.ply]?.color!==this.color&&!this.complete)this.ply++;}
  go(ply){if(this.practice)return;this.ply=Math.max(0,Math.min(this.line.moves.length,ply));this.selected=null;this.hint=null;this.message='';}
  attempt(from,to,promotion='q'){
    if(!this.practice||this.complete)return false;
    const board=this.board();let move;try{move=board.move({from,to,promotion});}catch{return false;}
    if(!move)return false;
    if(move.lan!==this.line.moves[this.ply].uci){this.mistakes++;this.selected=null;this.message='В выбранном варианте другой ход. Попробуйте ещё раз; ваше продолжение не обязательно ошибочно.';return false;}
    this.correct++;this.ply++;this.hint=null;this.selected=null;this.advanceOpponent();this.message=this.complete?'Вариант пройден.':'Верно. Ваш следующий ход.';return true;
  }
  showHint(){if(this.complete)return;this.hint=this.line.moves[this.ply].from;this.assisted=true;this.message='Подсказка: фигура на '+this.hint+'.';}
}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function openingStudyHTML(data,{q='',order='personal'}={}){
  return `<section class="card"><form id="opening-study-search" class="section-actions"><label class="field">Дебют или ECO<input name="q" value="${esc(q)}" placeholder="Например, B12 или Sicilian"></label><label class="field">Порядок<select name="order"><option value="personal" ${order==='personal'?'selected':''}>Из моего репертуара</option><option value="deep" ${order==='deep'?'selected':''}>Длинные линии сначала</option></select></label><button class="button">Найти</button></form><p class="subtle">Найдено ${data.total} вариантов${data.total>100?' · показаны первые 100, уточните поиск':''}.</p>${data.choices.length?`<label class="field">Вариант<select id="opening-study-line">${data.choices.map(l=>`<option value="${esc(l.id)}" ${l.id===data.selected?.id?'selected':''}>${esc(l.eco+' · '+l.name)} · ${l.plies} полуходов${l.games?' · '+l.games+' ваших партий с этим ECO':''}</option>`).join('')}</select></label>`:'<p>Варианты не найдены. Попробуйте ECO или английское название.</p>'}</section>${data.selected?'<br><section class="card"><div id="opening-study-workspace"></div></section>':''}<br><section class="card"><h2>Где вы выходите из справочника</h2><p class="subtle">Первые выходы до 12-го хода · по выбранным фильтрам. Это позиции для изучения, а не список ошибок.</p>${data.deviations.length?data.deviations.map(d=>`<p><a href="#game/${encodeURIComponent(d.gameId)}/${d.ply}">${esc(d.opponent)} · ${d.fullmove}${d.color==='w'?'.':'…'} ${esc(d.san)}</a> <small class="subtle">${d.color===d.playerColor?'Ваш ход':'Ход соперника'} · ${esc(d.opening)}</small></p>`).join(''):'<p class="subtle">Ранних выходов в выбранных партиях нет.</p>'}</section>`;
}

export function studyMoveNote(move){
  if(!move)return 'Линия закончилась. Повторите её без подсказок или выберите другой ответ соперника.';
  const notes=[];
  if(move.san.startsWith('O-O'))notes.push('Рокировка: король уходит с центральной линии, ладья вступает в игру.');
  if(move.captured)notes.push('Взятие: проверьте ответное взятие и итоговый материал.');
  if(/[+#]/.test(move.san))notes.push('Шах: проверьте способы защиты соперника.');
  if(['n','b'].includes(move.piece)&&['1','8'].includes(move.from[1]))notes.push('Развитие лёгкой фигуры.');
  if(move.piece==='p'&&['d4','d5','e4','e5'].includes(move.to))notes.push('Пешка занимает центр.');
  return notes.join(' ')||'Сравните положение фигур до и после хода; проверьте угрозы соперника.';
}
