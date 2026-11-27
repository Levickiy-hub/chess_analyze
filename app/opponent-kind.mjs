// Use explicit source metadata, never username fragments or rating/rated status.
export function opponentKind(game){
  const h=game.headers??{},side=game.color==='w'?'black':'white',player=game.raw?.[side];
  if(player?.is_bot===true||player?.title==='BOT')return {type:'bot',reason:'Явная отметка бота в исходных данных'};
  const playerType=h[game.color==='w'?'BlackType':'WhiteType'];
  if(/^(program|computer|engine|bot)$/i.test(playerType??''))return {type:'bot',reason:'PGN: '+(game.color==='w'?'BlackType':'WhiteType')+' = '+playerType};
  if(/^(Play vs Coach|Play vs Computer|Computer Chess)$/i.test(h.Event??''))return {type:'bot',reason:'PGN: Event = '+h.Event};
  for(const value of [game.url,h.Link]){
    try{const url=new URL(value);if(/^(www\.)?chess\.com$/i.test(url.hostname)&&/^\/game\/(computer|coach)\//i.test(url.pathname))return {type:'bot',reason:'Партия Chess.com против компьютера или тренера'};}catch{}
  }
  return {type:'unknown',reason:null};
}
