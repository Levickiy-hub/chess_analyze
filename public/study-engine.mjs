export class StudyEngine {
  constructor(request,onChange,{delay=350}={}){this.request=request;this.onChange=onChange;this.delay=delay;this.cache=new Map();this.key=null;this.serial=0;this.disposed=false;}
  cancel(){clearTimeout(this.timer);this.controller?.abort();this.controller=null;this.serial++;this.busy=false;this.pending=false;}
  dispose(){this.cancel();this.disposed=true;}
  position(study,auto){
    const key=study.line.id+':'+study.ply;if(this.key===key)return;
    this.cancel();this.key=key;this.payload={initialFen:study.line.moves[0].fen,moves:study.line.moves.slice(0,study.ply).map(m=>m.uci),fen:study.board().fen()};
    this.result=this.cache.get(key)??null;this.error=null;
    if(auto&&!this.result)this.schedule();
  }
  schedule(attempt=0){this.pending=true;this.timer=setTimeout(()=>{this.pending=false;void this.analyze('quick',attempt);},this.delay*(attempt+1));}
  async analyze(preset='quick',attempt=0){
    if(this.disposed||!this.payload)return;
    this.cancel();const token=this.serial,key=this.key,controller=new AbortController();this.controller=controller;this.busy=true;this.error=null;this.onChange();
    try{
      const result=await this.request({...this.payload,preset},controller.signal);
      if(this.disposed||token!==this.serial||this.key!==key)return;
      this.result=result;this.cache.set(key,result);
    }catch(error){
      if(this.disposed||token!==this.serial)return;
      if(error.name!=='AbortError'){
        if(error.status===429&&attempt<3)this.schedule(attempt+1);
        else this.error=error.message;
      }
    }finally{if(!this.disposed&&token===this.serial){this.controller=null;this.busy=false;this.onChange();}}
  }
}
