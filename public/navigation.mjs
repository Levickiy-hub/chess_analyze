export const NAV_GROUPS = [
  {id:'overview',icon:'◫',title:'Обзор',pages:[['dashboard','Дашборд'],['rating','Динамика рейтинга'],['skills','Профиль навыков']]},
  {id:'history',icon:'▤',title:'Партии',pages:[['games','История партий'],['sessions','Игровые сессии'],['opponents','Соперники']]},
  {id:'repertoire',icon:'♟',title:'Дебюты',pages:[['openings','Репертуар'],['tree','Дерево дебютов'],['theory','Изучение теории'],['position','Своя позиция']]},
  {id:'quality',icon:'◎',title:'Качество игры',pages:[['stages','Стадии и преимущество'],['tactics','Тактика'],['positions','Позиционная игра'],['endings','Эндшпили']]},
  {id:'clock',icon:'◴',title:'Время',pages:[['time','Управление временем']]},
  {id:'practice',icon:'◇',title:'Тренировки',pages:[['training','Практика'],['coach','Персональный тренер']]},
  {id:'settings',icon:'⚙',title:'Настройки',pages:[['settings','Анализ и настройки']]},
];

const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function navigationContext(view) {
  if(view==='recommendations')view='coach';
  const group = NAV_GROUPS.find(g=>g.pages.some(([key])=>key===view)) ?? NAV_GROUPS[0];
  if(view==='game')return {group:NAV_GROUPS[1],page:'Просмотр партии',isGame:true};
  return {group,page:group.pages.find(([key])=>key===view)?.[1]??group.pages[0][1],isGame:false};
}

export function groupDestination(group, remembered = {}) {
  // Practice always opens directly; other sections remember their last page.
  const saved = group.id==='practice'?null:remembered?.[group.id];
  return group.pages.some(([key])=>key===saved)?saved:group.pages[0][0];
}

export function navigationHTML(view, remembered = {}) {
  if(view==='recommendations')view='coach';
  const {group:active,isGame} = navigationContext(view);
  const sidebar = NAV_GROUPS.map(group=>`<a href="#${groupDestination(group,remembered)}" class="${group.id===active.id?'active':''}"${group.id===active.id?' aria-current="true"':''}><span class="nav-icon" aria-hidden="true">${group.icon}</span>${group.title}</a>`).join('');
  const tabs = !isGame&&active.pages.length>1?`<nav class="section-tabs" aria-label="${esc(active.title)}: подразделы">${active.pages.map(([key,title])=>`<a href="#${key}" class="${key===view?'active':''}"${key===view?' aria-current="page"':''}>${title}</a>`).join('')}</nav>`:'';
  return {sidebar,tabs};
}
