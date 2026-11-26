const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
export const openingMoveLabel=(san,ply)=>ply?`${Math.ceil(ply/2)}${ply%2?'.':'…'} ${san}`:'Начальная позиция';

export function openingTreeDiagram(root,{path=[],depth=2,branches=2}={}){
  depth=[1,2,3].includes(Number(depth))?Number(depth):2;
  branches=[2,3,4].includes(Number(branches))?Number(branches):2;
  const draw=(node,keys,level)=>{
    const children=Object.entries(node.children??{}).sort((a,b)=>b[1].games-a[1].games||a[0].localeCompare(b[0]));
    const rate=node.games?100*node.wins/node.games:null;
    const tone=keys.length&&rate!==null?(rate>50?'winning':rate<50?'losing':'neutral'):'neutral';
    const label=openingMoveLabel(node.san,keys.length),encoded=esc(keys.join(' '));
    const card=`<button type="button" class="opening-node ${tone} ${level===0?'current':''}" data-tree-path="${encoded}" ${level===0?'aria-current="step"':''} aria-label="${esc(label)} · ${number(node.games)} партий · ${rate===null?'нет результатов':number(rate)+'% побед'}"><strong>${esc(label)}</strong><span>${number(node.games)} партий</span><small>${rate===null?'—':number(rate)+'% побед'}</small></button>`;
    const more=children.length>branches&&level<depth?`<button type="button" class="opening-more" data-tree-all="${encoded}">Другие ходы: ${children.length-branches}</button>`:'';
    return `<li><div class="opening-node-wrap">${card}${more}</div>${level<depth&&children.length?`<ul>${children.slice(0,branches).map(([uci,child])=>draw(child,[...keys,uci],level+1)).join('')}</ul>`:''}</li>`;
  };
  if(!root?.games)return '<p class="empty">Нет партий для построения дерева по выбранным фильтрам.</p>';
  return `<div class="opening-tree-scroll" tabindex="0" role="region" aria-label="Графическое дерево дебютов. Прокручивайте по горизонтали, чтобы увидеть ветви."><div class="opening-tree"><ul>${draw(root,path,0)}</ul></div></div>`;
}
