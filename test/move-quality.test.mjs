import test from 'node:test';
import assert from 'node:assert/strict';
import { moveQualityData, moveQualityHTML } from '../public/move-quality.mjs';
import { Store } from '../app/database.mjs';
import { analytics } from '../app/analytics.mjs';

test('quality distribution uses classified own moves and excludes unknown categories',()=>{
  const r={summary:{accuracy:81.4},categories:{best:32,excellent:22,good:24,inaccuracy:11,mistake:7,blunder:4,unknown:20}};
  const data=moveQualityData(r);
  assert.equal(data.classified,100);assert.equal(data.unknown,20);assert.equal(data.accuracy,81.4);
  assert.equal(data.rows.find(row=>row.key==='best').percent,32);assert.equal(data.rows.find(row=>row.key==='best').width,100);
  assert.equal(data.rows.find(row=>row.key==='excellent').width,68.75);
  assert.equal(data.rows.reduce((sum,row)=>sum+row.percent,0),100);
  const html=moveQualityHTML(r);assert.match(html,/81,4/);assert.match(html,/Без категории.*20/);
  assert.match(html,/quality-brilliant/);
});

test('empty or unknown-only samples do not fabricate accuracy or category percentages',()=>{
  for(const report of [{},{summary:{accuracy:90},categories:{unknown:10}}]){
    const data=moveQualityData(report);assert.equal(data.classified,0);assert.equal(data.accuracy,null);
    assert.ok(data.rows.every(row=>row.percent===null&&row.width===0));
    const html=moveQualityHTML(report);assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/Пока нет классифицированных/);
  }
});

test('zero accuracy is preserved and untrusted numeric values cannot enter markup',()=>{
  assert.equal(moveQualityData({summary:{accuracy:0},categories:{blunder:2}}).accuracy,0);
  const report={summary:{accuracy:'<img>'},categories:{best:'<img>',excellent:-1,good:Infinity,mistake:2}};
  const data=moveQualityData(report);assert.equal(data.classified,2);assert.equal(data.accuracy,null);
  assert.doesNotMatch(moveQualityHTML(report),/<img|NaN|Infinity/);
});

test('rare brilliant moves never display a misleading zero percent',()=>{
  const html=moveQualityHTML({summary:{accuracy:80},categories:{brilliant:1,best:10000}});
  assert.match(html,/&lt;0,1%/);
});

test('real analytics supplies only the player moves and honors category filters',()=>{
  const store=new Store(':memory:');store.saveProfile('tester');
  try{
    const {game}=store.importGame({uuid:'quality',time_class:'rapid',pgn:'[White "tester"]\n[Black "opponent"]\n\n1. e4 e5 2. Nf3 Nc6 *'},'tester');
    store.putAnalysis(game.id,{source:'verified',preset:'quick',createdAt:new Date().toISOString(),moves:game.moves.map(m=>({...m,accuracy:m.color==='w'?80:0,loss:0,category:m.color==='w'?(m.ply===1?'best':'good'):'blunder',motifs:[]}))});
    const data=moveQualityData(analytics(store,'tester'));
    assert.equal(data.classified,2);assert.equal(data.accuracy,80);
    assert.equal(data.rows.find(r=>r.key==='best').percent,50);
    assert.equal(data.rows.find(r=>r.key==='blunder').count,0);
    const filtered=moveQualityData(analytics(store,'tester',{category:'best'}));
    assert.equal(filtered.classified,1);assert.equal(filtered.rows.find(row=>row.key==='best').percent,100);
  }finally{store.close();}
});
