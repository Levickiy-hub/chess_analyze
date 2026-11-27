import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { normalizeGame,whiteScore,moveQuality,finishAnalysis,boardFeatures,mean,expectation } from '../app/domain.mjs';
import { Store } from '../app/database.mjs';
import { analytics,selectGames,localTime } from '../app/analytics.mjs';
import { JobRunner } from '../app/jobs.mjs';
import { ChessCom } from '../app/chesscom.mjs';

const pgn='[Event "Test"]\n[White "tester"]\n[Black "opponent"]\n[Result "1-0"]\n[Date "2026.07.01"]\n[TimeControl "300+2"]\n\n1. e4 {[%clk 0:04:59]} e5 {[%clk 0:05:00]} 2. Nf3 {[%clk 0:04:58]} 1-0';
const raw={uuid:'game-1',pgn,rules:'chess',white:{username:'tester',rating:1000,result:'win'},black:{username:'opponent',rating:1100,result:'resigned'},rated:true,time_class:'rapid',time_control:'300+2',end_time:1782864000};
function fixture(){const s=new Store(':memory:');s.saveProfile('tester');const {game}=s.importGame(raw,'tester');return {s,game};}

test('PGN preserves true initial FEN, move colors, SAN and UCI',()=>{
 const g=normalizeGame({pgn:'[White "tester"]\n[Black "opponent"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 20"]\n\n20... Kf7 21. e4 *'},'tester');
 assert.equal(g.moves[0].color,'b');assert.equal(g.moves[0].fullmove,20);assert.equal(g.initialFen,'4k3/8/8/8/8/8/4P3/4K3 b - - 0 20');assert.equal(g.moves[0].uci,'e8f7');assert.equal(g.outcome,'unknown');
});
test('standard chess edge cases replay',()=>{for(const p of ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *','1. e4 a6 2. e5 d5 3. exd6 *','1. f3 e5 2. g4 Qh4# 0-1']){const g=normalizeGame({pgn:'[White "tester"]\n[Black "opponent"]\n\n'+p},'tester');const c=new Chess(g.initialFen);for(const m of g.moves){assert.equal(c.fen(),m.fen);c.move(m.san);assert.equal(c.fen(),m.after);}}});
test('clock uses same side and increment and never bridges missing values',()=>{
 const g=normalizeGame(raw,'tester');assert.equal(g.moves[0].spent,3);assert.equal(g.moves[1].spent,2);assert.equal(g.moves[2].spent,3);
 const missing=normalizeGame({...raw,pgn:pgn.replace(' {[%clk 0:04:59]}','')},'tester');assert.equal(missing.moves[2].spent,null);
});
test('username membership and variants are validated',()=>{assert.throws(()=>normalizeGame(raw,'stranger'),/участником/);assert.throws(()=>normalizeGame({...raw,rules:'chess960'},'tester'),/стандартные/);assert.throws(()=>normalizeGame({pgn:'not chess'},'tester'));});
test('POV normalization gives zero loss across alternating sides',()=>{
 const before=whiteScore({type:'cp',value:100},new Chess().fen()),after=whiteScore({type:'cp',value:-100},'8/8/8/8/8/8/8/8 b - - 0 1');
 assert.equal(before.value,after.value);assert.equal(moveQuality(before,after,{color:'w',uci:'e2e4'},'d2d4').loss,0);
 assert.equal(moveQuality({kind:'cp',value:-20},{kind:'cp',value:180},{color:'b',uci:'e7e5'},'c7c5').loss,200);
});
test('bestmove is zero despite search noise; missing score stays missing',()=>{
 assert.equal(moveQuality({kind:'cp',value:100},{kind:'cp',value:0},{color:'w',uci:'e2e4'},'e2e4').loss,0);
 assert.equal(moveQuality(null,null,{color:'w'},null).accuracy,null);
});
test('mate zero means side to move is mated, missed mate is an error',()=>{
 const score=whiteScore({type:'mate',value:0},'8/8/8/8/8/8/8/8 b - - 0 1');assert.equal(score.winner,'w');assert.equal(expectation(score,'w'),1);
 const q=moveQuality({kind:'mate',value:2,winner:'w'},{kind:'cp',value:20},{color:'w',uci:'e2e4'},'a2a4');assert.equal(q.missedMate,true);assert.equal(q.category,'blunder');assert.equal(q.loss,null);
});
test('phase depends on material rather than game fraction',()=>{
 assert.equal(boardFeatures(new Chess().fen()).phase,'opening');assert.equal(boardFeatures('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1').phase,'endgame');
});
test('reimport is idempotent; result and player metrics remain isolated',()=>{
 const {s,game}=fixture();assert.equal(s.importGame(raw,'tester').inserted,false);assert.equal(s.games('tester').length,1);
 const positions=game.moves.map(m=>({score:{kind:'cp',value:20,pov:'white'},bestMove:m.uci,depth:null,lines:[]}));s.putAnalysis(game.id,finishAnalysis(game,positions,{source:'recovered',preset:'unknown'}));
 const r=analytics(s,'tester');assert.equal(r.summary.games,1);assert.equal(r.summary.wins,1);assert.equal(r.summary.evaluated,1);assert.equal(r.summary.acpl,0);assert.equal(r.coverage.recovered,1);assert.equal(analytics(s,'tester',{includeRecovered:'false'}).summary.acpl,null);
 s.saveProfile('another');assert.equal(analytics(s,'another').sample,0);s.close();
});
test('filter colors, results, ratings, periods and empty samples',()=>{
 const {s}=fixture();assert.equal(selectGames(s,'tester',{color:'b'}).games.length,0);assert.equal(selectGames(s,'tester',{minOpponent:'1200'}).games.length,0);assert.equal(selectGames(s,'tester',{from:'2027-01-01'}).games.length,0);assert.equal(analytics(s,'tester',{format:'blitz'}).summary.score,null);assert.equal(mean([null,NaN]),null);s.close();
});
test('timezone affects day boundaries',()=>{assert.equal(localTime(Date.parse('2026-07-01T22:00:00Z')/1000,'Europe/Moscow').date,'2026-07-02');});
test('jobs deduplicate, pause, resume and recover running state',async()=>{
 const {s,game}=fixture(),runner=new JobRunner(s);const j=runner.enqueueAnalysis('tester',[game.id]);assert.throws(()=>runner.enqueueAnalysis('tester',[game.id]),/Нет новых/);runner.action(j.id,'pause');assert.equal(s.job(j.id).status,'paused');runner.action(j.id,'resume');assert.equal(s.job(j.id).status,'queued');runner.action(j.id,'cancel');assert.equal(s.job(j.id).status,'cancelled');
 s.updateJob(j.id,'running',j.data);const restarted=new JobRunner(s);assert.equal(s.job(j.id).status,'queued');await runner.stop();await restarted.stop();s.close();
});
test('API cache uses conditional headers and 304; malformed archives rejected',async()=>{
 const {s}=fixture();let calls=0,headers;
 const client=new ChessCom(s,{request:async(url,options)=>{calls++;headers=options.headers;return calls===1?{status:200,headers:{etag:'v1'},data:{archives:[]}}:{status:304,headers:{},data:null};}});
 assert.deepEqual(await client.archives('tester'),[]);assert.deepEqual(await client.archives('tester'),[]);assert.equal(headers['If-None-Match'],'v1');
 const invalid=new ChessCom(s,{request:async()=>({status:200,headers:{},data:{archives:['http://localhost/secret']}})});await assert.rejects(()=>invalid.archives('tester'),/Некорректный/);s.close();
});
test('permanent 404 does not retry',async()=>{const {s}=fixture();let calls=0;const c=new ChessCom(s,{request:async()=>{calls++;return {status:404,headers:{},data:{}};}});await assert.rejects(()=>c.archives('tester'),/404/);assert.equal(calls,1);s.close();});

test('winning streak grows from 6 to 11 after importing older archives, without engine analysis',()=>{
 const s=new Store(':memory:');s.saveProfile('tester');
 const insert=(id,end,win)=>s.importGame({...raw,uuid:id,end_time:end,pgn:raw.pgn.replaceAll('1-0',win?'1-0':'0-1'),white:{...raw.white,result:win?'win':'resigned'},black:{...raw.black,result:win?'resigned':'win'}},'tester');
 try {
  for(let i=0;i<6;i++)insert('recent-'+i,2000000000+i,true);
  assert.equal(analytics(s,'tester').summary.bestWinStreak,6);
  insert('separator',1999999999,false);
  for(let i=10;i>=0;i--)insert('historical-'+i,1900000000+i,true);
  assert.equal(analytics(s,'tester').summary.bestWinStreak,11);
  assert.equal(analytics(s,'tester',{from:'2033-01-01'}).summary.bestWinStreak,6);
  assert.equal(analytics(s,'tester').coverage.verified,0);
 } finally {s.close();}
});

test('sync worker visits every archive and a second sync does not duplicate games',async()=>{
 const {s}=fixture(),runner=new JobRunner(s),visited=[];
 runner.client={profile:async()=>({profile:{username:'tester'},stats:{}}),archives:async()=>['month-a','month-b'],month:async url=>{visited.push(url);return [{...raw,uuid:url}];}};
 try{
  const first=runner.enqueueSync('tester');await runner.tick();assert.equal(s.job(first.id).status,'completed');assert.deepEqual(visited,['month-a','month-b']);assert.equal(s.games('tester').length,3);assert.equal(s.job(first.id).data.archiveIndex,2);
  const second=runner.enqueueSync('tester');await runner.tick();assert.equal(s.job(second.id).status,'completed');assert.equal(s.job(second.id).data.imported,0);assert.equal(s.games('tester').length,3);
 }finally{await runner.stop();s.close();}
});
