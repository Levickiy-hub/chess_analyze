import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillProfile,centipawnLoss } from '../app/skill-profile.mjs';

function data(count=200){
 const games=Array.from({length:count},(_,i)=>({id:'g'+i,end:i,profile:'tester',timeClass:'rapid',color:'w',outcome:'win'}));
 const moves=games.flatMap(g=>Array.from({length:10},(_,i)=>({gameId:g.id,ply:2*i+1,color:'w',before:{kind:'cp',value:0},scoreAfter:{kind:'cp',value:-150},source:'verified',features:{phase:'opening',w:{hanging:[],kingDanger:0},b:{hanging:[],kingDanger:0}}})));
 const analyses=new Map(games.map(g=>[g.id,{source:'verified',moves:moves.filter(m=>m.gameId===g.id)}]));
 return {games,playerMoves:moves,analyses,minSample:5,includeRecovered:false};
}
test('new profile uses raw evaluation loss, not saturated probability scores',()=>{
 assert.equal(centipawnLoss({color:'w',before:{kind:'cp',value:-800},scoreAfter:{kind:'cp',value:-1000}}),200);
 assert.equal(centipawnLoss({color:'b',before:{kind:'cp',value:100},scoreAfter:{kind:'cp',value:400}}),300);
 assert.equal(centipawnLoss({isBest:true}),null);
 assert.equal(centipawnLoss({isBest:true,color:'w',before:{kind:'cp',value:0},scoreAfter:{kind:'cp',value:-10}}),0);
 assert.equal(centipawnLoss({color:'w',before:{kind:'cp',value:0},scoreAfter:{kind:'mate',winner:'b'}}),300);
 const p=buildSkillProfile(data());assert.equal(p.window,'100');assert.equal(p.games,100);assert.equal(p.skills[0].value,50);assert.equal(p.skills[0].errorRate,100);assert.equal(p.skills[0].blunderRate,0);
 assert.equal(p.skills[0].previous.value,50);
});
test('equal, better, worse, and decided positions remain separate',()=>{
 const d=data(6);
 for(let i=0;i<d.playerMoves.length;i++){const m=d.playerMoves[i];m.before.value=i%3===0?-800:i%3===1?300:0;m.scoreAfter.value=m.before.value-150;}
 const p=buildSkillProfile(d),opening=p.skills[0];assert.equal(opening.n,20);assert.equal(opening.value,null);assert.equal(opening.bands.find(b=>b.key==='ahead').n,20);assert.equal(opening.bands.find(b=>b.key==='behind').n,0);
 assert.ok(!opening.bands.some(b=>b.n===60));
 const ahead=buildSkillProfile({...d,filter:{skillBand:'ahead'}});assert.equal(ahead.skills[0].n,20);
});
test('long games have the same index weight as short games',()=>{
 const d=data(6);d.playerMoves=d.playerMoves.filter(m=>m.gameId!=='g0');
 d.playerMoves.push({...data(1).playerMoves[0],gameId:'g0',before:{kind:'cp',value:0},scoreAfter:{kind:'cp',value:0}});
 const p=buildSkillProfile(d);assert.equal(p.skills[0].value,58.33);assert.equal(p.skills[0].games,6);
});
test('recent cohort and previous cohort never overlap and honor requested size',()=>{
 const d=data(120);for(const m of d.playerMoves){if(Number(m.gameId.slice(1))>=70)m.scoreAfter.value=0;}
 const p=buildSkillProfile({...d,filter:{skillWindow:'50'}});assert.equal(p.games,50);assert.equal(p.skills[0].value,100);assert.equal(p.skills[0].previous.value,50);
 const all=buildSkillProfile({...d,filter:{skillWindow:'all'}});assert.equal(all.games,120);assert.equal(all.skills[0].previous,null);
 const few=buildSkillProfile({...data(30),filter:{skillWindow:'50'}});assert.equal(few.skills[0].previous,null);
});
test('format is selected independently, without mixing daily and rapid',()=>{
 const d=data(200);for(let i=0;i<100;i++)d.games[i].timeClass='daily';
 const p=buildSkillProfile(d);assert.equal(p.format,'rapid');assert.equal(p.games,100);assert.equal(p.previousGames,0);
 const daily=buildSkillProfile({...d,filter:{format:'daily'}});assert.equal(daily.format,'daily');assert.equal(daily.games,100);
});
test('attack and tactical samples use pre-move features, not a played check or captured piece',()=>{
 const d=data(6);for(const m of d.playerMoves){m.san='Qh5+';m.motifs=['material-loss','fork-candidate'];}
 const p=buildSkillProfile(d);assert.equal(p.skills.find(s=>s.key==='attack').n,0);assert.equal(p.skills.find(s=>s.key==='tactics').n,0);
 for(const m of d.playerMoves)m.features.b.kingDanger=3;
 assert.equal(buildSkillProfile(d).skills.find(s=>s.key==='attack').n,60);
});

test('time explanation distinguishes missing clocks, no pressure, exclusions and small samples',()=>{
 const d=data(6),time=()=>buildSkillProfile(d).skills.find(s=>s.key==='time');
 assert.equal(time().unavailableReason.code,'no_clocks');
 for(const m of d.playerMoves)m.clock=46;
 assert.equal(time().unavailableReason.code,'no_pressure');assert.match(time().unavailableReason.message,/46 с/);assert.match(time().unavailableReason.message,/6 партий/);
 for(const m of d.playerMoves){m.clock=20;m.before.value=300;m.scoreAfter.value=150;}
 assert.equal(time().unavailableReason.code,'outside_band');assert.equal(time().unavailableReason.evaluatedMoves,60);
 for(const m of d.playerMoves){m.before.value=0;m.scoreAfter=null;}
 assert.equal(time().unavailableReason.code,'no_evaluations');
 for(const m of d.playerMoves)m.scoreAfter={kind:'cp',value:-150};
 assert.equal(time().unavailableReason,null);assert.equal(time().value,50);
 d.playerMoves=d.playerMoves.slice(0,10);
 assert.equal(time().unavailableReason.code,'small_sample');assert.match(time().unavailableReason.message,/10 ходов.*1 партиях/);
});

test('time message does not claim absence of pressure when saved clocks are partial',()=>{
 const d=data(6);d.playerMoves[0].clock=60;
 const reason=buildSkillProfile(d).skills.find(s=>s.key==='time').unavailableReason;
 assert.equal(reason.code,'no_pressure');assert.match(reason.message,/среди ходов с известными часами/);
});
