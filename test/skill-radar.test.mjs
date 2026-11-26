import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../app/database.mjs';
import { analytics } from '../app/analytics.mjs';
import { radarGeometry,skillRadar,skillCards } from '../public/skill-radar.mjs';

function fixture(results=['1-0','1-0','1-0'],before=0) {
 const store=new Store(':memory:');store.saveProfile('tester');
 results.forEach((result,i)=>{
  const {game}=store.importGame({uuid:'skill-'+i,pgn:`[White "tester"]\n[Black "opponent"]\n[Result "${result}"]\n\n1. e4 e5 2. Nf3 Nc6 ${result}`},'tester');
  store.putAnalysis(game.id,{source:'verified',preset:'quick',createdAt:new Date().toISOString(),moves:game.moves.map(m=>({...m,accuracy:80,loss:0,probabilityLoss:0,category:'good',motifs:[],before:{kind:'cp',value:before},scoreAfter:{kind:'cp',value:before}}))});
 });return store;
}
test('profile has exactly eight ordered axes, formulas and evaluated sample counts',()=>{
 const store=fixture();try {
  const r=analytics(store,'tester');assert.deepEqual(r.skills.map(s=>s.key),['opening','tactics','attack','defense','endgame','time','position','conversion']);
  const opening=r.skills[0];assert.equal(opening.n,6);assert.equal(opening.value,null);assert.equal(opening.index,100);assert.equal(opening.unit,'ходов');
  assert.ok(r.skills.every(s=>s.formula&&s.selection));assert.equal(r.skillProfile.minMoves,30);assert.equal(r.skills.find(s=>s.key==='time').value,null);
  assert.equal(r.skills.find(s=>s.key==='conversion').value,null);
 }finally{store.close();}
});
test('missing quality never counts toward minimum sample and provenance follows contributing moves',()=>{
 const store=fixture();try {
  for(const game of store.games('tester')) {
   const a=store.analysis(game.id);a.id=undefined;a.source='recovered';a.moves[0].accuracy=null;a.moves[0].scoreAfter=null;store.db.prepare('DELETE FROM analyses WHERE game_id=?').run(game.id);store.putAnalysis(game.id,a);
  }
  const r=analytics(store,'tester',{includeRecovered:'true'}),opening=r.skills[0];
  assert.equal(opening.n,3);assert.equal(opening.value,null);assert.equal(opening.provisional,true);
  const excluded=analytics(store,'tester',{includeRecovered:'false'});assert.equal(excluded.skills[0].n,0);assert.equal(excluded.skills[0].provisional,false);
 }finally{store.close();}
});
test('conversion uses only known results and counts draws as non-wins',()=>{
 const store=fixture(['1-0','1-0','1/2-1/2','0-1','0-1','*'],300);try {
  store.setSettings({minSample:3});const conversion=analytics(store,'tester').skills.find(s=>s.key==='conversion');
  assert.equal(conversion.n,5);assert.equal(conversion.value,40);assert.equal(conversion.unit,'партий');
 }finally{store.close();}
});
test('radar represents zero, full score and gaps without fabricated zero vertices',()=>{
 const input=[{key:'opening',value:100},{key:'attack',value:0},{key:'defense',value:50}];
 const points=radarGeometry(input);assert.equal(points[0].position.x,400);assert.equal(points[0].position.y,100);assert.equal(points[1].position,null);assert.equal(points[2].position.x,400);assert.equal(points[2].position.y,300);
 const html=skillRadar(input);assert.ok(!html.includes('class="radar-area"'));assert.match(html,/radar-missing/);assert.ok(!html.includes('NaN'));assert.match(html,/Атака: 0/);
 const complete=points.map(p=>({key:p.key,value:75}));assert.match(skillRadar(complete),/class="radar-area"/);
 assert.match(skillRadar([]),/0 из 8/);
});
test('radar and formula cards escape external strings',()=>{
 const input=[{key:'opening',label:'<script>bad</script>',value:75,n:5,minSample:5,selection:'<img src=x>',formula:'A < B'}];
 assert.ok(!skillRadar(input).includes('<script>'));const cards=skillCards(input);assert.ok(!cards.includes('<img src=x>'));assert.match(cards,/A &lt; B/);
});

test('time reason is visible in card and accessible radar marker',()=>{
 const skills=[{key:'time',label:'Игра в цейтноте',value:null,n:0,games:0,unit:'ходов',minSample:30,unavailableReason:{title:'Цейтнот не наблюдался',message:'В группе нет ходов <30 секунд.',hint:'Расширьте историю.'}}];
 const card=skillCards(skills);assert.match(card,/Цейтнот не наблюдался/);assert.match(card,/Расширьте историю/);assert.match(card,/&lt;30/);
 assert.match(skillRadar(skills),/В группе нет ходов &lt;30 секунд/);
});
