import https from 'node:https';
import { username } from './domain.mjs';

export function secureJSON(url,{headers={},signal,allowedHosts=['api.chess.com']}={}){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!allowedHosts.includes(parsed.hostname)||parsed.port)throw new Error('Недопустимый URL внешнего сервиса.');
  return new Promise((resolve,reject)=>{
    const req=https.request(parsed,{method:'GET',rejectUnauthorized:true,headers:{Accept:'application/json','User-Agent':'PersonalChessAnalytics/2.0 (local personal chess study)',...headers},signal},res=>{
      let text='',bytes=0;res.setEncoding('utf8');
      res.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>32*1024*1024){req.destroy(new Error('Слишком большой ответ API.'));return;}text+=chunk;});
      res.on('error',reject);
      res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,data:res.statusCode===304?null:JSON.parse(text||'{}')});}catch{reject(new Error('API вернул некорректный JSON.'));}});
    });
    req.setTimeout(20000,()=>req.destroy(new Error('Истекло время ожидания API.')));req.on('error',reject);req.end();
  });
}
export class ChessCom {
  constructor(store,{request=secureJSON}={}){this.store=store;this.request=request;}
  async get(url,signal){
    const old=this.store.db.prepare('SELECT * FROM http_cache WHERE url=?').get(url),headers={};
    if(old?.etag)headers['If-None-Match']=old.etag;if(old?.last_modified)headers['If-Modified-Since']=old.last_modified;
    let error;
    for(let attempt=0;attempt<4;attempt++){
      if(signal?.aborted)throw new Error('Синхронизация остановлена.');
      try{
        const result=await this.request(url,{headers,signal});
        if(result.status===304&&old)return JSON.parse(old.data);
        if(result.status===404)throw Object.assign(new Error('Профиль или архив Chess.com не найден (404).'),{permanent:true});
        if(result.status===410)throw Object.assign(new Error('Данные Chess.com больше недоступны (410).'),{permanent:true});
        if(result.status!==200){const e=new Error('Chess.com HTTP '+result.status);e.permanent=result.status!==429&&result.status<500;e.retryAfter=Math.min(30000,Math.max(0,Number(result.headers['retry-after']??0)*1000));throw e;}
        this.store.db.prepare('INSERT OR REPLACE INTO http_cache VALUES(?,?,?,?,?)').run(url,result.headers.etag??null,result.headers['last-modified']??null,new Date().toISOString(),JSON.stringify(result.data));
        return result.data;
      }catch(e){error=e;if(e.permanent||signal?.aborted)throw e;if(attempt<3)await new Promise((resolve,reject)=>{let abort;const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},e.retryAfter||Math.min(8000,500*2**attempt));abort=()=>{clearTimeout(timer);reject(new Error('Синхронизация остановлена.'));};signal?.addEventListener('abort',abort,{once:true});});}
    }
    throw error;
  }
  async profile(name,signal){name=username(name);const base='https://api.chess.com/pub/player/'+encodeURIComponent(name);const profile=await this.get(base,signal);const stats=await this.get(base+'/stats',signal);return {profile,stats};}
  async archives(name,signal){const result=await this.get('https://api.chess.com/pub/player/'+encodeURIComponent(username(name))+'/games/archives',signal);if(!Array.isArray(result.archives)||result.archives.some(u=>!/^https:\/\/api\.chess\.com\/pub\/player\/[a-z0-9_-]+\/games\/\d{4}\/\d{2}$/i.test(u)))throw new Error('Некорректный список архивов.');return result.archives;}
  async month(url,signal){const result=await this.get(url,signal);if(!Array.isArray(result.games))throw new Error('Некорректный архив партий.');return result.games;}
}
