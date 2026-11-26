import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { Store } from '../app/database.mjs';
import { analytics,selectGames } from '../app/analytics.mjs';
import { normalizeGame,moveQuality,whiteScore,expectation,boardFeatures,tacticalHints,sustainedAdvantage,FORMULA_VERSION,isPrematureDraw } from '../app/domain.mjs';
import { nextPuzzleReview,puzzleCandidate } from '../app/training.mjs';
import { UciEngine } from '../app/engine.mjs';

const pgn=result=>`[White "tester"]\n[Black "other"]\n[Result "${result}"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 ${result}`;
function insert(store,id,extra={}){return store.importGame({uuid:id,pgn:pgn('1-0'),end_time:1000+Number(id.replace(/\D/g,'')),time_class:'rapid',time_control:'300',...extra},'tester').game;}
function analysis(game,values,source='verified'){
 let own=0;return {source,preset:'quick',createdAt:new Date().toISOString(),moves:game.moves.map(m=>({...m,motifs:[],accuracy:90,category:'good',loss:0,before:{kind:'cp',value:m.color==='w'?values[own++]??0:0},scoreAfter:{kind:'cp',value:0}}))};
}
function fixture(){const s=new Store(':memory:');s.saveProfile('tester');return s;}

test('quality is bounded, color symmetric, and unknown scores never become excellent moves',()=>{
 for(let i=-1000;i<=1000;i+=25){
  const w=moveQuality({kind:'cp',value:i},{kind:'cp',value:i-175},{color:'w',uci:'e2e4'},'d2d4');
  const b=moveQuality({kind:'cp',value:-i},{kind:'cp',value:-i+175},{color:'b',uci:'e7e5'},'d7d5');
  assert.equal(w.loss,175);assert.equal(w.accuracy,b.accuracy);assert.ok(w.accuracy>=0&&w.accuracy<=100);
 }
 assert.equal(moveQuality({kind:'cp',value:NaN},{kind:'cp',value:0},{color:'w'},null).category,'unknown');
 assert.equal(moveQuality({kind:'cp',value:0},{kind:'cp',value:0},{color:'w'},undefined).isBest,false);
 const best=moveQuality({kind:'mate',value:1,winner:'w'},{kind:'cp',value:500},{color:'w',uci:'e2e4'},'e2e4');
 assert.equal(best.missedMate,false);assert.equal(best.accuracy,100);
});

test('score bounds reverse with black POV and cannot enter exact arithmetic',()=>{
 const s=whiteScore({type:'cp',value:100,bound:'lowerbound'},'4k3/8/8/8/8/8/8/4K3 b - - 0 1');
 assert.equal(s.value,-100);assert.equal(s.bound,'upperbound');assert.equal(expectation(s),null);
 assert.equal(whiteScore({type:'garbage',value:1},new Chess().fen()),null);
});

test('date-only PGN supplies no fabricated session start or hour',()=>{
 const s=fixture();try{
  const g=insert(s,'1',{end_time:undefined,pgn:'[White "tester"]\n[Black "other"]\n[Date "2026.07.01"]\n\n1. e4 e5 *'});
  assert.equal(g.start,null);assert.equal(g.duration,null);assert.equal(g.endPrecision,'day');
  const r=analytics(s,'tester');assert.equal(r.sessions.length,0);assert.equal(r.heatmap.length,0);assert.equal(r.summary.streakExcluded,1);
  const invalid=normalizeGame({pgn:'[White "tester"]\n[Black "other"]\n[Date "2026.02.31"]\n\n1. e4 *'},'tester');assert.equal(invalid.end,null);
 }finally{s.close();}
});

test('clock arithmetic rejects malformed clocks and does not invent initial time for SetUp',()=>{
 const g=normalizeGame({pgn:'[White "tester"]\n[Black "other"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 20"]\n[TimeControl "300+2"]\n\n20... Kf7 {[%clk 0:02:00]} 21. e4 {[%clk 0:01:40]} Kg6 {[%clk 0:01:59]} *'},'tester');
 assert.equal(g.moves[0].spent,null);assert.equal(g.moves[1].spent,null);assert.equal(g.moves[2].spent,3);
 const invalid=normalizeGame({pgn:'[White "tester"]\n[Black "other"]\n[TimeControl "300"]\n\n1. e4 {[%clk 0:75:00]} *'},'tester');assert.equal(invalid.moves[0].clock,null);
});

test('rating differences require both ratings',()=>{
 const s=fixture();try{insert(s,'1',{white:{username:'tester'},black:{username:'other',rating:1000}});
  assert.equal(selectGames(s,'tester',{minDifference:'-99999'}).games.length,0);
  assert.equal(selectGames(s,'tester',{maxDifference:'99999'}).games.length,0);
  assert.equal(analytics(s,'tester').differenceBands[0].key,'Неизвестно');
 }finally{s.close();}
});

test('conversion checks actual consecutive moves, independent of the displayed move filter',()=>{
 const s=fixture();try{
  const a=insert(s,'1'),b=insert(s,'2'),aa=analysis(a,[300,0,300]),bb=analysis(b,[300,300,0]);
  aa.moves.filter(m=>m.color==='w').forEach((m,i)=>m.category=i===1?'best':'blunder');
  bb.moves.filter(m=>m.color==='w').forEach((m,i)=>m.category=i===2?'blunder':'best');
  s.putAnalysis(a.id,aa);s.putAnalysis(b.id,bb);
  const r=analytics(s,'tester',{category:'blunder'}).conversion.find(x=>x.threshold===200);
  assert.equal(r.games,1);assert.deepEqual(r.gameIds,[b.id]);
  assert.equal(sustainedAdvantage([{color:'w',ply:1,before:{kind:'cp',value:300}},{color:'w',ply:5,before:{kind:'cp',value:300}}],'w'),false);
 }finally{s.close();}
});

test('session rating uses rated endpoints and result context survives filters',()=>{
 const s=fixture();try{
  [999,1000,1020,9000].forEach((rating,i)=>insert(s,String(i+1),{pgn:pgn(i%2?'1-0':'0-1'),rated:i===1||i===2,white:{username:'tester',rating},black:{username:'other',rating:1000}}));
  assert.equal(analytics(s,'tester').sessions[0].ratingChange,20);
  const r=analytics(s,'tester',{result:'win'});assert.equal(r.afterResult.find(x=>x.after==='loss').games,2);assert.equal(r.sessionPosition[0].games,0);assert.equal(r.sessionPosition[1].games,1);
 }finally{s.close();}
});

test('draw on time versus insufficient material is not a loss on time',()=>{
 const s=fixture();try{
  insert(s,'1',{pgn:pgn('1/2-1/2'),white:{username:'tester',result:'timevsinsufficient'},black:{username:'other'}});
  insert(s,'2',{pgn:pgn('0-1'),white:{username:'tester',result:'timeout'},black:{username:'other'}});
  assert.equal(analytics(s,'tester').time.timeouts,1);
 }finally{s.close();}
});

test('missing accuracy cannot trigger a time recommendation; daily clocks are excluded',()=>{
 const s=fixture();try{
  const g=insert(s,'1'),a=analysis(g,[]),own=a.moves[0];
  a.moves=[...Array.from({length:6},()=>({...own,clock:20,accuracy:null})),...Array.from({length:6},()=>({...own,clock:120,accuracy:95}))];s.putAnalysis(g.id,a);
  assert.ok(!analytics(s,'tester').recommendations.some(r=>r.id.startsWith('time-')));
  const daily=insert(s,'2',{time_class:'daily',time_control:'1/86400'}),da=analysis(daily,[]);da.moves.forEach(m=>{m.clock=10;m.spent=5;});s.putAnalysis(daily.id,da);
  const r=analytics(s,'tester',{format:'daily'});assert.equal(r.time.pressure.moves,0);assert.equal(r.time.clockMoves,0);assert.equal(r.skills.find(x=>x.key==='time').unavailableReason.code,'not_live');
 }finally{s.close();}
});

test('king attacks do not create a false knight fork; home squares match piece types',()=>{
 const c=new Chess('7k/8/8/2qr4/4K3/8/8/N7 w - - 0 1'),m=c.move('Nb3');
 assert.ok(!tacticalHints({...m,features:boardFeatures(m.before)}).includes('fork-candidate'));
 assert.equal(boardFeatures('4k3/8/8/8/8/8/8/1BN1K3 w - - 0 1').w.undeveloped,0);
});

test('old saved analysis is repaired on read without overwriting PGN or engine positions',()=>{
 const s=fixture();try{
  const g=insert(s,'1'),a=analysis(g,[]);a.version='personal-v2';a.moves[0].before={kind:'mate',value:1,winner:'w'};a.moves[0].bestMove=a.moves[0].uci;a.moves[0].missedMate=true;s.putAnalysis(g.id,a);
  const updated=s.analysis(g.id);assert.equal(updated.version,FORMULA_VERSION);assert.equal(updated.moves[0].missedMate,false);
  const stored=JSON.parse(s.db.prepare('SELECT data FROM analyses WHERE id=?').get(a.id).data);assert.equal(stored.version,'personal-v2');assert.equal(stored.moves[0].missedMate,true);assert.equal(s.game(g.id).pgn,g.pgn);
 }finally{s.close();}
});

test('ambiguous old zero evaluations and bound scores are excluded during lazy upgrade',()=>{
 const s=fixture();try{
  const game=insert(s,'1',{pgn:'[White "tester"]\n[Black "other"]\n[SetUp "1"]\n[FEN "7k/8/6K1/8/8/8/P7/1Q6 w - - 100 1"]\n\n1. a3 *'});
  const a=analysis(game,[]);a.version='personal-v2';a.positions=[{depth:0,bestMove:null,score:{kind:'cp',value:0},lines:[]},{depth:12,score:{kind:'cp',value:200},lines:[{bound:'lowerbound'}]}];s.putAnalysis(game.id,a);
  const fixed=s.analysis(game.id);assert.equal(fixed.invalidatedPositions,1);assert.equal(fixed.moves[0].accuracy,null);assert.equal(fixed.positions[1].score.bound,'upperbound');
 }finally{s.close();}
});

test('remaining clock uses the last known value and jobs deduplicate repeated IDs',async()=>{
 const s=fixture();const {JobRunner}=await import('../app/jobs.mjs');const runner=new JobRunner(s);
 try{
  const game=insert(s,'1',{pgn:'[White "tester"]\n[Black "other"]\n[TimeControl "300"]\n\n1. e4 {[%clk 0:04:00]} e5 2. Nf3 *'});
  assert.equal(analytics(s,'tester').time.remaining,240);
  assert.equal(runner.enqueueAnalysis('tester',[game.id,game.id]).data.total,1);
 }finally{await runner.stop();s.close();}
});

test('puzzle comparison requires two distinct exact lines at equal depth',()=>{
 const move={fen:new Chess().fen(),color:'w',uci:'a2a3'},best={pv:['e2e4','e7e5'],depth:10,score:{kind:'cp',value:100}},second={pv:['d2d4'],depth:10,score:{kind:'cp',value:0}},r={bestMove:'e2e4',lines:[best,second]};
 assert.ok(puzzleCandidate(r,move));assert.equal(puzzleCandidate({...r,lines:[best]},move),null);
 assert.equal(puzzleCandidate({...r,lines:[best,{...second,depth:9}]},move),null);
 assert.equal(puzzleCandidate({...r,lines:[{...best,bound:'lowerbound'},second]},move),null);
 assert.equal(puzzleCandidate({...r,lines:[{...best,pv:['e2e5']},second]},move),null);
});

test('spaced repetition does not double intervals for early repeated solutions',()=>{
 const now=Date.parse('2026-11-26T12:00:00Z'),future='2026-11-27T12:00:00.000Z';
 assert.deepEqual(nextPuzzleReview(1,future,now),{interval:1,dueAt:future});
 assert.equal(nextPuzzleReview(1,future,now+86400000).interval,2);
 assert.equal(nextPuzzleReview(64,future,now+86400000).interval,90);
 assert.equal(nextPuzzleReview(0,future,now).interval,1);
});

test('coach rounds percentage-point change after subtracting unrounded rates',async()=>{
 const {coachReport}=await import('../app/coach.mjs'),games=[],analyses=new Map();
 for(let i=0;i<6;i++){
  const game=normalizeGame({uuid:'coach-'+i,pgn:pgn('1-0'),time_class:'rapid',end_time:1000+i},'tester');games.push(game);
  const own=game.moves.filter(m=>m.color==='w').slice(0,i<3?1:2);
  analyses.set(game.id,{source:'verified',moves:own.map((m,j)=>({...m,accuracy:90,category:(i===0||i===3)&&j===0?'blunder':'good',motifs:[]}))});
 }
 const r=coachReport({games,analyses,settings:{minSample:3,includeRecovered:false}});
 assert.equal(r.progress[0].previous.rate,33.3);assert.equal(r.progress[0].recent.rate,16.7);assert.equal(r.progress[0].change,-16.7);
});

test('optional 50-move claims are not reused as cached automatic zero scores',()=>{
 assert.equal(isPrematureDraw({depth:0,bestMove:null,score:{kind:'cp',value:0}},'7k/8/6K1/8/8/8/P7/1Q6 w - - 100 1'),true);
 assert.equal(isPrematureDraw({depth:0,bestMove:null,score:{kind:'cp',value:0}},'7k/8/6K1/8/8/8/P7/1Q6 w - - 150 1'),false);
});

test('fivefold repetition terminates without search while threefold is delegated to engine',async()=>{
 const moves=['g1f3','g8f6','f3g1','f6g8'],board=new Chess();
 const history=[...moves,...moves,...moves,...moves];for(const uci of history)board.move({from:uci.slice(0,2),to:uci.slice(2,4)});
 const engine=new UciEngine();try{const r=await engine.analyze(board.fen(),{initialFen:new Chess().fen(),moves:history});assert.equal(r.depth,0);assert.equal(r.score.value,0);assert.equal(engine.child,null);}finally{engine.close();}
 const three=new Chess();for(const uci of history.slice(0,8))three.move({from:uci.slice(0,2),to:uci.slice(2,4)});
 const mock=new UciEngine(),commands=[];mock.init=async()=>{};mock.send=command=>commands.push(command);
 try{const pending=mock.analyze(three.fen(),{initialFen:new Chess().fen(),moves:history.slice(0,8)});await new Promise(r=>setImmediate(r));mock.line('info depth 8 score cp 0 pv e2e4');mock.line('bestmove e2e4');assert.equal((await pending).depth,8);assert.ok(commands.some(c=>c.startsWith('go ')));}finally{mock.close();}
});
