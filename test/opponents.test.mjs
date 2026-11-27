import test from 'node:test';
import assert from 'node:assert/strict';
import { opponentRatings, strongestOpponent } from '../app/opponents.mjs';
import { analytics } from '../app/analytics.mjs';
import { Store } from '../app/database.mjs';
import { opponentKind } from '../app/opponent-kind.mjs';
import { normalizeGame, upgradeSavedGame } from '../app/domain.mjs';

const games=[
  {id:'a',opponent:'rival',opponentRating:1400,timeClass:'rapid',end:100,outcome:'loss'},
  {id:'b',opponent:'rival',opponentRating:1500,timeClass:'rapid',end:200,outcome:'win'},
  {id:'c',opponent:'rival',opponentRating:900,timeClass:'blitz',end:300,outcome:'draw'},
];

test('coach metadata identifies bots in old and newly imported games without guessing from usernames',()=>{
  const pgn='[Event "Play vs Coach"]\n[White "tester"]\n[Black "Coach-David"]\n[BlackElo "2000"]\n\n1. e4 e5 *';
  const g=normalizeGame({pgn},'tester');assert.equal(g.opponentType,'bot');
  const old={...g};delete old.opponentType;delete old.opponentTypeReason;
  assert.equal(upgradeSavedGame(old).opponentType,'bot');
  assert.equal(opponentKind({opponent:'bot-fan',rated:false,headers:{Event:'Live Chess'}}).type,'unknown');
  assert.equal(opponentKind({color:'b',headers:{WhiteType:'program'}}).type,'bot');
  assert.equal(opponentKind({color:'w',headers:{WhiteType:'program'}}).type,'unknown');
});

test('confirmed bots remain in personal meetings but cannot win the strongest opponent card',()=>{
  const coach={...games[0],id:'coach',opponent:'Coach-David',opponentRating:2000,headers:{Event:'Play vs Coach'}};
  assert.equal(strongestOpponent([...games,coach]).gameId,'b');
  assert.equal(strongestOpponent([coach]),null);assert.equal(opponentRatings([coach]).botGames,1);
});

test('latest opponent rating is a dated observation and ranges stay separate by format',()=>{
  const r=opponentRatings([games[2],games[0],games[1]]);
  assert.equal(r.latest,900);assert.equal(r.format,'blitz');assert.equal(r.gameId,'c');
  assert.deepEqual(r.formats.find(f=>f.format==='rapid'),{format:'rapid',min:1400,max:1500});
  assert.deepEqual(r.formats.find(f=>f.format==='blitz'),{format:'blitz',min:900,max:900});
});

test('missing latest ratings and unknown dates never reuse an older rating as the latest',()=>{
  assert.equal(opponentRatings([...games,{...games[2],id:'d',end:400,opponentRating:null}]).latest,null);
  assert.equal(opponentRatings([{...games[0],end:null}]).latest,null);
  assert.equal(opponentRatings([...games,{...games[0],end:null,opponentRating:2000}]).latest,900);
});

test('strongest opponent is the maximum known positive rating, with an actual game and outcome',()=>{
  const r=strongestOpponent([...games,{...games[0],opponentRating:NaN}]);
  assert.equal(r.rating,1500);assert.equal(r.gameId,'b');assert.equal(r.outcome,'win');assert.equal(r.format,'rapid');
  assert.equal(strongestOpponent([]),null);assert.equal(strongestOpponent([{...games[0],opponentRating:0}]),null);
});

test('opponent cards and personal meeting ratings follow the same analytics filters',()=>{
  const s=new Store(':memory:');s.saveProfile('tester');
  try{
    for(const [i,g] of games.entries())s.importGame({uuid:g.id,pgn:'[White "tester"]\n[Black "rival"]\n\n1. e4 e5 *',white:{username:'tester',rating:1000,result:'win'},black:{username:'rival',rating:g.opponentRating,result:'resigned'},time_class:g.timeClass,end_time:1782864000+i},'tester');
    const all=analytics(s,'tester');assert.equal(all.strongestOpponent.rating,1500);assert.equal(all.opponents[0].ratings.latest,900);assert.equal(all.strongestDefeatedOpponent,null);
    const rapid=analytics(s,'tester',{format:'rapid'});assert.equal(rapid.opponents[0].ratings.latest,1500);assert.equal(rapid.opponents[0].games,2);
    const empty=analytics(s,'tester',{format:'bullet'});assert.equal(empty.strongestOpponent,null);assert.equal(empty.strongestDefeatedOpponent,null);assert.equal(empty.opponents.length,0);
  }finally{s.close();}
});

test('strongest defeated opponent ignores losses, draws and bot wins and follows result filters',()=>{
  const s=new Store(':memory:');s.saveProfile('tester');
  try{
    const results=[['win',1200,false],['loss',1800,false],['draw',1600,false],['win',2000,true]];
    results.forEach(([result,rating,bot],i)=>{
      const pgnResult=result==='win'?'1-0':result==='loss'?'0-1':'1/2-1/2';
      s.importGame({uuid:'result-'+i,pgn:`[Event "${bot?'Play vs Coach':'Live Chess'}"]\n[White "tester"]\n[Black "opponent${i}"]\n[Result "${pgnResult}"]\n\n1. e4 e5 ${pgnResult}`,white:{username:'tester',rating:1000},black:{username:'opponent'+i,rating},time_class:'rapid',end_time:1782864000+i},'tester');
    });
    const report=analytics(s,'tester');assert.equal(report.strongestOpponent.rating,1800);assert.equal(report.strongestDefeatedOpponent.rating,1200);assert.equal(report.strongestDefeatedOpponent.outcome,'win');
    assert.equal(analytics(s,'tester',{result:'loss'}).strongestDefeatedOpponent,null);
  }finally{s.close();}
});
