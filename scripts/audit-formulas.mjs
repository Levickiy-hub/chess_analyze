import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../app/database.mjs';
import { analytics } from '../app/analytics.mjs';
import { coachReport } from '../app/coach.mjs';
import { selectGames } from '../app/analytics.mjs';

const filename=path.resolve(process.argv[2]??'data/chess.sqlite');
if(!fs.existsSync(filename))throw new Error('База для проверки не найдена: '+filename);
const store=new Store(filename);
const output={checkedAt:new Date().toISOString(),profiles:[]};
function finiteTree(value,key='report'){
 if(typeof value==='number')assert.ok(Number.isFinite(value),'Non-finite value: '+key);
 else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))finiteTree(v,key+'.'+k);
}
try{
 for(const p of store.profiles()){
  const r=analytics(store,p.username),games=store.games(p.username),analyses=store.analyses(p.username);
  assert.equal(r.sample,games.length);
  assert.equal(r.summary.wins+r.summary.draws+r.summary.losses+r.summary.unknown,r.sample);
  for(const key of ['formats','colors','reasons','openings','opponents','ratingBands','differenceBands'])assert.equal(r[key].reduce((n,row)=>n+row.games,0),r.sample,key);
  assert.equal(r.phases.reduce((n,row)=>n+row.evaluated,0),r.summary.evaluated);
  assert.equal(r.time.buckets.reduce((n,row)=>n+row.moves,0),r.time.clockMoves);
  assert.equal(r.tree.games,r.sample);
  let previous=Infinity;
  for(const row of r.conversion){assert.ok(row.games<=previous);previous=row.games;assert.equal(row.wins+row.losses+row.draws+row.unknown,row.games);}
  function checkNode(node){assert.ok(node.wins+node.draws<=node.games);assert.ok(Object.values(node.children).reduce((n,c)=>n+c.games,0)<=node.games);for(const c of Object.values(node.children))checkNode(c);}
  checkNode(r.tree);finiteTree(r);
  for(const s of r.skills){if(s.value!==null){assert.ok(s.value>=0&&s.value<=100);assert.ok(s.n>=s.minSample);assert.ok(s.games>=s.minGames);}if(s.errors!==undefined)assert.ok(s.blunders<=s.errors&&s.errors<=s.n);}
  const coach=coachReport(selectGames(store,p.username));finiteTree(coach);for(const pattern of coach.patterns)assert.ok(pattern.count<=pattern.denominator);
  let gradesChanged=0,forksRemoved=0,invalidatedPositions=0;
  for(const [id,a] of analyses){const raw=JSON.parse(store.db.prepare('SELECT data FROM analyses WHERE id=?').get(a.id).data);invalidatedPositions+=a.invalidatedPositions??0;
   a.moves.forEach((m,i)=>{const old=raw.moves[i];if(old.category!==m.category||Boolean(old.missedMate)!==Boolean(m.missedMate))gradesChanged++;if(old.motifs?.includes('fork-candidate')&&!m.motifs.includes('fork-candidate'))forksRemoved++;});
  }
  output.profiles.push({profile:p.username,games:r.sample,verified:r.coverage.verified,recovered:r.coverage.recovered,evaluated:r.summary.evaluated,accuracy:r.summary.accuracy,acpl:r.summary.acpl,bestWinStreak:r.summary.bestWinStreak,sessionCount:r.sessions.length,gradesChanged,forksRemoved,invalidatedPositions,checks:'passed'});
 }
 if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output,null,2));
}finally{store.close();}
