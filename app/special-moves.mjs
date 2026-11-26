import { Chess } from 'chess.js';

export const SPECIAL_VERSION='special-v2';
const values={p:1,n:3,b:3,r:5,q:9,k:0};
const exact=p=>p?.score&&!p.score.bound&&(p.depth>=10||p.depth===0&&p.bestMove===null);
const pov=(score,color)=>score?.kind==='cp'&&Number.isFinite(score.value)&&!score.bound?score.value*(color==='w'?1:-1):score?.kind==='mate'&&!score.bound&&['w','b'].includes(score.winner)?(score.winner===color?100000:-100000):null;
const balance=(board,color)=>board.board().flat().filter(Boolean).reduce((sum,p)=>sum+values[p.type]*(p.color===color?1:-1),0);
const play=(board,uci)=>board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
const limits=(game,color)=>{
  const rating=color===game.color?game.rating:game.opponentRating;
  return Number.isFinite(rating)&&rating<1000?{material:1,loss:50}:Number.isFinite(rating)&&rating<1600?{material:2,loss:30}:{material:3,loss:15};
};

// Conservative candidate: the moved minor/major piece is taken by the best
// reply, and the material deficit persists through at least four reply plies.
export function sacrificeCandidate(game,positions,i){
  const m=game.moves[i],before=positions?.[i],after=positions?.[i+1];
  if(!m||!['n','b','r','q'].includes(m.piece)||!exact(before)||!exact(after))return null;
  const a=pov(before.score,m.color),b=pov(after.score,m.color),threshold=limits(game,m.color);
  if(a===null||b===null||b< -50||Math.max(0,a-b)>threshold.loss)return null;
  const pv=after.lines?.[0]?.pv;
  if(!pv?.length||pv[0].slice(2,4)!==m.to)return null;
  try{
    const original=new Chess(m.fen);if(original.moves().length<2)return null;
    const board=new Chess(m.after),initial=balance(original,m.color),line=[];
    for(const uci of pv.slice(0,6)){
      const reply=play(board,uci);line.push(reply.lan);
      if(line.length===1&&(!reply.captured||values[reply.captured]<3))return null;
      // A sacrifice must survive the immediate recapture, exchange or promotion.
      if(balance(board,m.color)>initial-threshold.material)return null;
      if(board.isCheckmate()||board.isStalemate()||board.isInsufficientMaterial())break;
    }
    const terminal=board.isCheckmate()||board.isStalemate()||board.isInsufficientMaterial();
    if(line.length<4&&!terminal)return null;
    return {materialLoss:initial-balance(board,m.color),minimumMaterial:threshold.material,line,after:b,allowedLoss:threshold.loss};
  }catch{return null;}
}

function alternatives(position,color,played,fen){
  if(!position?.lines?.length)return null;
  const lines=position.lines;
  if(lines.length<2||lines.some(l=>l.bound||l.score?.bound||l.depth<10||l.depth!==lines[0].depth))return null;
  if(new Set(lines.map(l=>l.pv?.[0])).size!==lines.length)return null;
  try{for(const line of lines){if(!line.pv?.length)return null;const board=new Chess(fen);for(const uci of line.pv)play(board,uci);}}catch{return null;}
  const other=lines.filter(l=>l.pv?.[0]!==played).map(l=>pov(l.score,color));
  if(!other.length||other.some(v=>v===null))return null;
  return {alternative:Math.max(...other),played:pov(lines.find(l=>l.pv[0]===played)?.score,color),best:pov(lines[0].score,color)};
}

export function annotateSpecialMoves(analysis,game){
  if(!analysis||!game||analysis.specialVersion===SPECIAL_VERSION)return analysis;
  if(analysis.source!=='verified')return {...analysis,specialVersion:SPECIAL_VERSION};
  let pending=0,candidates=0;
  const positions=analysis.positions;
  const moves=analysis.moves.map((saved,i)=>{
    const baseCategory=saved.baseCategory??saved.category,move={...saved,category:baseCategory,baseCategory};
    const original=game.moves[i],before=positions?.[i],after=positions?.[i+1];
    if(!original||baseCategory==='unknown')return move;
    const candidate=['best','excellent','good'].includes(baseCategory)?sacrificeCandidate(game,positions,i):null,evidence=analysis.specialEvidence?.[i]??before;
    let brilliant=null,rescue=null,brilliantPending=false;
    if(candidate){
      candidates++;const comparison=alternatives(evidence,original.color,original.uci,original.fen);
      if(comparison===null){pending++;brilliantPending=true;}
      else {
        const {best,played,alternative}=comparison,afterScore=pov(after.score,original.color);
        if(best!==null&&played!==null&&best-played<=candidate.allowedLoss&&afterScore!==null&&best-afterScore<=candidate.allowedLoss&&alternative<=150)
          brilliant={...candidate,alternative,depth:evidence.lines[0].depth};
      }
    }
    // The opponent's intervening error creates the chance. The player's move
    // gets credit only for finding and preserving that chance.
    const previous=positions?.[i-1];
    if(i>=1&&['best','excellent','good'].includes(baseCategory)&&exact(previous)&&exact(before)&&exact(after)){
      const lost=pov(previous.score,original.color),chance=pov(before.score,original.color),kept=pov(after.score,original.color);
      if(lost!==null&&chance!==null&&kept!==null&&lost<=-200&&chance>=-50&&kept>=-50&&chance-kept<=limits(game,original.color).loss)
        rescue={previous:lost,before:chance,after:kept,opponentPly:original.ply-1};
    }
    return {...move,category:brilliant?'brilliant':rescue?'rescue':baseCategory,special:{brilliant,rescue,brilliantPending}};
  });
  return {...analysis,moves,specialVersion:SPECIAL_VERSION,specialCoverage:{candidates,pending}};
}
