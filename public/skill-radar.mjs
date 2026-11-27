const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const axes=[['opening','Дебют'],['tactics','Тактика'],['attack','Атака'],['defense','Защита'],['endgame','Эндшпиль'],['time','Время'],['position','Позиционная игра'],['conversion','Реализация']];
const number=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Math.abs(value)<.05?0:value);
const pawnLoss=value=>Number.isFinite(value)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value/100):'—';
export function radarGeometry(skills) {
  return axes.map(([key,label],i)=>{
    const skill=skills.find(s=>s.key===key),value=Number.isFinite(skill?.value)?Math.max(0,Math.min(100,skill.value)):null;
    const angle=-Math.PI/2+i*Math.PI/4,point=radius=>({x:400+Math.cos(angle)*radius,y:300+Math.sin(angle)*radius});
    return {key,label,skill,value,point,position:value===null?null:point(value*2)};
  });
}
export function skillRadar(skills) {
  const points=radarGeometry(skills),xy=p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`,complete=points.every(p=>p.position),known=points.filter(p=>p.position);
  const rings=[20,40,60,80,100].map(value=>`<polygon class="radar-grid" points="${points.map(p=>xy(p.point(value*2))).join(' ')}"/><text class="radar-scale" x="408" y="${300-value*2+14}">${value}</text>`).join('');
  const lines=points.map(p=>{const edge=p.point(200);return `<line class="radar-grid" x1="400" y1="300" x2="${edge.x}" y2="${edge.y}"/>`;}).join('');
  const labels=points.map((p,i)=>{
    const pos=p.point(244),anchor=i===0||i===4?'middle':i<4?'start':'end';
    const text=p.key==='position'?'<tspan x="'+pos.x+'" dy="-7">Позиционная</tspan><tspan x="'+pos.x+'" dy="20">игра</tspan>':esc(p.label);
    return `<text class="radar-label" x="${pos.x}" y="${pos.y+5}" text-anchor="${anchor}">${text}</text>`;
  }).join('');
  const shape=complete?`<polygon class="radar-area" points="${points.map(p=>xy(p.position)).join(' ')}"/>`:points.map((p,i)=>{const next=points[(i+1)%8];return p.position&&next.position?`<line class="radar-stroke" x1="${p.position.x}" y1="${p.position.y}" x2="${next.position.x}" y2="${next.position.y}"/>`:'';}).join('');
  const dots=points.map(p=>{const pos=p.position??p.point(200),description=p.value===null?`${p.skill?.label??p.label}: ${p.skill?.unavailableReason?.message??'недостаточно данных'}`:`${p.skill?.label??p.label}: ${number(p.value)} из 100; ${p.skill?.n??0} ${p.skill?.unit??'наблюдений'}${p.skill?.provisional?'; предварительная оценка':''}`;return `<circle class="${p.position?'radar-point':'radar-missing'}" cx="${pos.x}" cy="${pos.y}" r="${p.position?6:5}" tabindex="0" aria-label="${esc(description)}"><title>${esc(description)}</title></circle>`;}).join('');
  const summary=points.map(p=>`${p.label}: ${p.value===null?'нет оценки':number(p.value)}`).join('; ');
  return `<div class="radar-scroll"><svg class="skill-radar" viewBox="0 0 800 590" role="img" aria-label="Профиль шахматиста: ${esc(summary)}"><title>Профиль шахматиста · шкала от 0 до 100</title><desc>Восемь характеристик по выбранным партиям. ${known.length} из 8 имеют достаточно данных. Пустые маркеры обозначают пропуски; они не равны нулю.</desc>${rings}${lines}${shape}${dots}${labels}</svg></div>${!complete?'<p class="radar-note">Пустой маркер — недостаточно данных. На таких осях контур разорван; пропуски не заменяются нулём.</p>':''}`;
}

export function skillCards(skills) {
  return `<div class="skill-cards">${axes.map(([key])=>skills.find(s=>s.key===key)).filter(Boolean).map(s=>`<article class="skill-card"><h3>${esc(s.label)}</h3><div class="skill-value">${Number.isFinite(s.value)?number(s.value)+'<small>/100</small>':`<span class="subtle">${esc(s.unavailableReason?.title??'Недостаточно данных')}</span>`}</div>${s.unavailableReason?`<p class="method">${esc(s.unavailableReason.message)}</p>${s.unavailableReason.hint?`<p class="subtle">${esc(s.unavailableReason.hint)}</p>`:''}`:''}<p class="subtle">${s.n} ${esc(s.unit??'наблюдений')}${s.unit==='ходов'?` в ${s.games??0} партиях`:''} · минимум ${s.minSample??'—'}${s.unit==='ходов'?` ходов и ${s.minGames??5} партий`:''}${s.provisional?' · предварительно':''}</p>
    ${s.unit==='ходов'?`<dl class="skill-facts"><div><dt>Средняя потеря</dt><dd>${pawnLoss(s.acpl)} пешки</dd></div><div><dt>Ошибок на 100 ходов</dt><dd>${s.errorRate===null?'—':number(s.errorRate)}</dd></div><div><dt>Зевков на 100 ходов</dt><dd>${s.blunderRate===null?'—':number(s.blunderRate)}</dd></div></dl>`:`<p>Побед после перевеса: ${s.wins??0} из ${s.n}.</p>`}
    ${Number.isFinite(s.previous?.value)&&Number.isFinite(s.value)?`<p class="skill-delta">Предыдущая группа: ${number(s.previous.value)} → ${number(s.value)} · ${s.value>=s.previous.value?'+':''}${number(s.value-s.previous.value)} п.</p>`:''}
    <details><summary>Формула и состав выборки</summary><p>${esc(s.selection)}</p><p>${esc(s.formula)}</p>${s.bands?.length?`<p>Раздельные показатели по оценке до хода:</p><ul>${s.bands.map(b=>`<li>${esc(b.label)}: ${b.n} ходов, ${b.games} партий; средняя потеря ${b.acpl===null?'—':number(b.acpl/100)} пешки; ошибок на 100 ходов: ${b.errorRate===null?'—':number(b.errorRate)}.</li>`).join('')}</ul><p>За пределами выбранного диапазона исключено ${s.excluded} оценённых ходов этой области.</p>`:''}</details>
    ${s.examples?.length?`<div class="coach-links">${s.examples.map((e,i)=>`<a href="#game/${encodeURIComponent(e.gameId)}${e.ply?'/'+e.ply:''}">${e.ply?'Ошибка':'Упущенный перевес'} ${i+1}${Number.isFinite(e.loss)?' · −'+number(e.loss/100)+' пешки':''}</a>`).join('')}</div>`:''}</article>`).join('')}</div>`;
}

export function skillProfileControls(p,timezone='Europe/Moscow') {
 if(!p)return '';
 const date=s=>Number.isFinite(s)?new Intl.DateTimeFormat('ru-RU',{timeZone:timezone,day:'numeric',month:'short',year:'numeric'}).format(new Date(s*1000)):'—';
 return `<div class="section-actions skill-controls"><label class="field">Партии для радара<select id="skill-window">${[['50','Последние 50'],['100','Последние 100'],['200','Последние 200'],['all','Вся выбранная история']].map(([v,label])=>`<option value="${v}" ${p.window===v?'selected':''}>${label}</option>`).join('')}</select></label><label class="field">Оценка до хода<select id="skill-band">${[['balanced','Равные: −2…+2'],['ahead','Лучшие: +2…+5'],['behind','Худшие: −5…−2']].map(([v,label])=>`<option value="${v}" ${p.band===v?'selected':''}>${label}</option>`).join('')}</select></label></div><p class="method"><strong>${esc(p.format??'Нет формата')}</strong> · ${p.games} партий в группе, с доступным анализом ${p.analysed} · ${esc(date(p.from))} — ${esc(date(p.to))} · ${esc(p.bandLabel)}. Без фильтра формата — рапид, если он есть. Сравнение — с предыдущей группой того же размера.</p>`;
}
