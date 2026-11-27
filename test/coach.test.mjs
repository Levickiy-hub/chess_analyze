import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../app/database.mjs';
import { finishAnalysis } from '../app/domain.mjs';
import { selectGames } from '../app/analytics.mjs';
import { coachReport, explainMove } from '../app/coach.mjs';
import { createApplication } from '../app/server.mjs';
import { coachHTML, explanationHTML } from '../public/coach-view.mjs';

function seed(store,n=6,source='verified',format='rapid') {
  store.saveProfile('tester');
  const games=[];
  for(let i=0;i<n;i++) {
    const {game}=store.importGame({uuid:source+format+i,pgn:'[White "tester"]\n[Black "opponent"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1',time_class:format,end_time:1000+i},'tester');
    const cp=value=>({score:{kind:'cp',value}});
    const positions=[{...cp(100),bestMove:'e2e4',depth:12,lines:[{pv:['e2e4','e7e5','g1f3']}]},cp(-100),cp(-100),{score:{kind:'mate',value:-1,winner:'b'}},{score:{kind:'mate',value:0,winner:'b'}}];
    const analysis=finishAnalysis(game,positions,{source,preset:'quick'});
    store.putAnalysis(game.id,analysis);games.push({...game,analysis});
  }
  return games;
}
function report(store,filter={}) {return coachReport(selectGames(store,'tester',filter),filter);}

test('coach finds repeated own mistakes, links real plies and preserves coverage',()=>{
  const store=new Store(':memory:');
  try {
    seed(store);const r=report(store);
    assert.equal(r.coverage.used,6);assert.equal(r.evaluated,12);assert.equal(r.errors,12);
    assert.ok(r.patterns.some(p=>p.id==='opening'&&p.games===6&&p.count===12&&p.denominator===12));
    for(const p of r.patterns) for(const e of p.examples) assert.equal(store.game(e.gameId).moves[e.ply-1].san,e.san);
    assert.equal(r.plan.length,7);assert.ok(r.plan.every(d=>d.minutes===15));
    assert.match(r.exportText,/FEN|fen/);assert.match(r.exportText,/не придумывай/);
    assert.equal(store.jobs('tester').length,0);
    const b=report(store,{color:'b'});assert.equal(b.evaluated,0);assert.equal(b.patterns.length,0);assert.equal(b.coverage.total,0);
    const filtered=report(store,{category:'blunder'});assert.ok(filtered.warnings.some(w=>w.includes('знаменатель')));
  } finally {store.close();}
});

test('coach does not turn repeated errors in a single game into a general pattern',()=>{
  const store=new Store(':memory:');try {seed(store,1);const r=report(store);assert.equal(r.patterns.length,0);assert.ok(r.examples.length);assert.equal(r.progress.length,0);}finally{store.close();}
});

test('coach respects recovered opt-out and separates sources and formats in progress',()=>{
  const store=new Store(':memory:');try {
    seed(store,20);seed(store,20,'recovered');seed(store,20,'verified','blitz');
    const included=report(store,{includeRecovered:'true'});assert.equal(included.progress.length,3);assert.ok(included.warnings.some(w=>w.includes('предварительная')));
    const excluded=report(store,{includeRecovered:'false',format:'rapid'});assert.equal(excluded.coverage.recovered,20);assert.equal(excluded.coverage.used,20);assert.equal(excluded.progress.length,1);assert.equal(excluded.progress[0].source,'verified');assert.equal(excluded.progress[0].previous.games,10);
  }finally{store.close();}
});

test('move explanations replay saved legal moves and reject fabricated or broken PV',()=>{
  const store=new Store(':memory:');try {
    const [game]=seed(store,1);const e=explainMove(game,game.analysis,1);
    assert.equal(e.best,'e4');assert.deepEqual(e.variation,['e4','e5','Nf3']);assert.equal(e.depth,12);
    const mate=explainMove(game,game.analysis,3);assert.ok(mate.observations.some(s=>s.includes('мат королю')));
    game.analysis.moves[0].bestMove='e2e5';game.analysis.moves[0].pv=[{pv:['e2e5']}];
    const corrupt=explainMove(game,game.analysis,1);assert.equal(corrupt.best,null);assert.deepEqual(corrupt.variation,[]);
    assert.equal(explainMove(game,null,1).available,false);
    assert.equal(explainMove(game,game.analysis,999).available,false);
  }finally{store.close();}
});

test('coach UI escapes imported names and commentary',()=>{
  const store=new Store(':memory:');try {
    seed(store);const r=report(store);r.examples[0].opponent='<img src=x onerror=alert(1)>';r.patterns[0].title='<script>bad</script>';
    const html=coachHTML(r,[1]);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.match(html,/data-coach-day="1" checked/);
    assert.match(explanationHTML({available:false,text:'<script>'}),/&lt;script&gt;/);
  }finally{store.close();}
});

test('coach HTTP endpoints isolate profiles, validate plies and create no jobs',async()=>{
  const app=createApplication({filename:':memory:',runJobs:false});
  const [game]=seed(app.store);app.store.saveProfile('another');
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const get=async route=>{const r=await fetch(base+route);return {status:r.status,body:await r.json()};};
  try {
    const path='/api/games/'+encodeURIComponent(game.id)+'/explanation';
    assert.equal((await get(path+'?profile=tester&ply=1')).body.best,'e4');
    assert.equal((await get(path+'?profile=another&ply=1')).status,404);
    assert.equal((await get(path+'?profile=tester&ply=0')).status,400);
    assert.equal((await get('/api/coach?profile=tester')).body.coverage.used,6);
    assert.equal((await get('/api/coach?profile=another')).body.coverage.total,0);
    assert.equal((await get('/api/coach?profile=tester&format=blitz')).body.evaluated,0);
    assert.equal(app.store.jobs('tester').length,0);
  }finally{await app.close();}
});
