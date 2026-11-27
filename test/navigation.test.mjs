import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV_GROUPS, navigationContext, navigationHTML, groupDestination } from '../public/navigation.mjs';

test('grouped navigation preserves every existing page URL exactly once',()=>{
  const existing=['dashboard','games','rating','openings','tree','theory','position','stages','endings','tactics','positions','time','sessions','opponents','skills','coach','training','settings'];
  const pages=NAV_GROUPS.flatMap(g=>g.pages.map(([key])=>key));
  assert.equal(NAV_GROUPS.length,7);
  assert.equal(new Set(pages).size,existing.length);
  assert.deepEqual(pages.slice().sort(),existing.slice().sort());
  for(const key of existing){
    const {group}=navigationContext(key),{sidebar,tabs}=navigationHTML(key);
    assert.equal((sidebar.match(/<a /g)??[]).length,7);
    assert.equal((sidebar.match(/aria-current="true"/g)??[]).length,1);
    if(group.pages.length>1){
      assert.match(tabs,new RegExp(`href="#${key}" class="active" aria-current="page"`));
      for(const [route] of group.pages)assert.ok(tabs.includes(`href="#${route}"`));
    }else{assert.equal(tabs,'');assert.ok(sidebar.includes(`href="#${key}"`));}
  }
});

test('remembered pages stay within their group and training always opens practice',()=>{
  const overview=NAV_GROUPS.find(g=>g.id==='overview'),practice=NAV_GROUPS.find(g=>g.id==='practice');
  assert.equal(groupDestination(overview,{overview:'skills'}),'skills');
  assert.equal(groupDestination(overview,{overview:'coach'}),'dashboard');
  assert.equal(groupDestination(overview,{overview:'"><script>'}),'dashboard');
  assert.equal(groupDestination(practice,{practice:'coach'}),'training');
  const direct=navigationHTML('coach',{practice:'coach'});
  assert.match(direct.tabs,/href="#coach" class="active"/);
  assert.match(direct.sidebar,/href="#training" class="active"/);
});

test('game review belongs to games without replacing the review with section tabs',()=>{
  assert.equal(navigationContext('game').group.id,'history');
  assert.equal(navigationContext('game').isGame,true);
  const html=navigationHTML('game',{history:'opponents'});
  assert.equal(html.tabs,'');
  assert.match(html.sidebar,/href="#opponents" class="active"/);
  assert.equal(navigationContext('missing').group.id,'overview');
});


test('old recommendations URL resolves to the personal coach after merging the screens',()=>{
  assert.equal(navigationContext('recommendations').page,'Персональный тренер');
  assert.match(navigationHTML('recommendations').tabs,/href="#coach" class="active"/);
});
