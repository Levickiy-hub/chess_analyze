import { fileURLToPath } from 'node:url';
import { Store } from '../app/database.mjs';
import { UciEngine, PRESETS, specialSearchLimits } from '../app/engine.mjs';
import { SPECIAL_VERSION, sacrificeCandidate, annotateSpecialMoves } from '../app/special-moves.mjs';
import { digest } from '../app/domain.mjs';

const args=process.argv.slice(2),profile=args[0];
if(!profile)throw new Error('Укажите имя профиля или --all. Пересчитываются только кандидаты в блестящие ходы.');
const store=new Store(fileURLToPath(new URL('../data/chess.sqlite',import.meta.url)));
const engine=new UciEngine({hash:store.settings().hash});
let checked=0,brilliant=0,pending=0;
try{
  const profiles=profile==='--all'?store.profiles().map(p=>p.username):[profile];
  for(const name of profiles){
    if(!store.profile(name))throw new Error('Неизвестный профиль: '+name);
    for(const [id,analysis] of store.analyses(name)){
      if(!analysis.specialCoverage?.pending)continue;
      const game=store.game(id,false),specialEvidence={...analysis.specialEvidence},hash=store.settings().hash;
      const options=specialSearchLimits(analysis.limits??PRESETS[analysis.preset]??PRESETS.quick);
      for(let i=0;i<game.moves.length;i++){
        if(!analysis.moves[i]?.special?.brilliantPending||!sacrificeCandidate(game,analysis.positions,i))continue;
        const moves=game.moves.slice(0,i).map(m=>m.uci),fen=game.moves[i].fen;
        const key=digest(JSON.stringify({special:SPECIAL_VERSION,options,hash,initialFen:game.initialFen,moves,fen}));
        let result=store.cache(key);
        if(!result){result=await engine.analyze(fen,{...options,initialFen:game.initialFen,moves,multiPV:2});store.cachePut(key,result);}
        specialEvidence[i]=result;checked++;
      }
      const refreshed=annotateSpecialMoves({...analysis,id:undefined,createdAt:new Date().toISOString(),specialVersion:undefined,specialEvidence,previousAnalysisId:analysis.id},game);
      store.putAnalysis(id,refreshed);
      brilliant+=refreshed.moves.filter(m=>m.special?.brilliant).length;pending+=refreshed.specialCoverage.pending;
      console.log(JSON.stringify({profile:name,game:id,checked,brilliant,pending}));
    }
  }
}finally{engine.close();store.close();}
