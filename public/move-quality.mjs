const categories=[['brilliant','!!','Блестящий'],['rescue','↗','Спасение'],['best','★','Лучший'],['excellent','!','Отличный'],['good','✓','Хороший'],['inaccuracy','?!','Неточность'],['mistake','?','Ошибка'],['blunder','??','Зевок']];
export function moveQualityIcon(category){
  const [key,icon,label]=categories.find(([key])=>key===category)??['unknown','—','Неизвестно'];
  return `<span class="quality-icon move-quality-icon quality-${key}" role="img" aria-label="${label}" title="${label}">${icon}</span>`;
}
const number=(value,digits=0)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits}).format(value);
const share=value=>value>0&&value<.1?'&lt;0,1%':number(value,1)+'%';
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;

export function moveQualityData(report){
  const rows=categories.map(([key,icon,label])=>({key,icon,label,count:count(report.categories?.[key])}));
  const classified=rows.reduce((sum,row)=>sum+row.count,0),largest=Math.max(0,...rows.map(row=>row.count));
  const accuracy=report.summary?.accuracy;
  return {classified,unknown:count(report.categories?.unknown),accuracy:classified&&Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=100?accuracy:null,
    rows:rows.map(row=>({...row,percent:classified?100*row.count/classified:null,width:largest?100*row.count/largest:0}))};
}

export function moveQualityHTML(report){
  const data=moveQualityData(report);
  return `<div class="move-quality"><div class="quality-headline"><div><span>Средняя точность</span><strong class="quality-average">${data.accuracy===null?'—':number(data.accuracy,1)}${data.accuracy===null?'':'<small> / 100</small>'}</strong></div><div><span>Классифицировано ваших ходов</span><strong>${number(data.classified)}</strong></div></div>
    <div class="quality-distribution" role="list" aria-label="Распределение качества ваших ходов">${data.rows.map(row=>`<div class="quality-category quality-${row.key}" role="listitem"><span class="quality-icon" aria-hidden="true">${row.icon}</span><span class="quality-label">${row.label}</span><div class="quality-track" role="img" aria-label="${row.label}: ${number(row.count)} ходов, ${row.percent===null?'доля неизвестна':share(row.percent)}"><span data-width="${row.width}"></span></div><span class="quality-count">${number(row.count)}</span><strong class="quality-percent">${row.percent===null?'—':share(row.percent)}</strong></div>`).join('')}</div>
    ${!data.classified?'<p class="subtle">Пока нет классифицированных ходов. Запустите анализ партий или измените фильтры.</p>':''}
    <details class="method"><summary>Как читать показатели</summary><p>Доли — от ${number(data.classified)} классифицированных ходов; полосы масштабированы относительно самой частой категории.${data.unknown?' Без категории в сохранённом анализе: '+number(data.unknown)+' ходов; в доли они не включены.':''} Точность, «Блестящий» и «Спасение» рассчитаны по нашей методике и могут отличаться от Chess.com.</p></details></div>`;
}
