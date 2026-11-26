import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../app/database.mjs';
import { JobRunner } from '../app/jobs.mjs';

test('persistent jobs survive restart and cached reads see external SQLite commits',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chess-storage-')),file=path.join(dir,'test.sqlite');let a,b;
 try{
  a=new Store(file);a.saveProfile('tester');assert.equal(a.games('tester').length,0);b=new Store(file);
  const r=b.importGame({pgn:'[White "tester"]\n[Black "other"]\n\n1. e4 e5 *'},'tester');assert.ok(r.game);assert.equal(a.games('tester').length,1);
  const job=a.createJob('analysis','tester',{gameIds:[r.game.id],index:0,done:0,errors:[]});a.updateJob(job.id,'running',job.data);a.close();a=null;b.close();b=null;
  a=new Store(file);const runner=new JobRunner(a);assert.equal(a.job(job.id).status,'queued');assert.deepEqual(a.job(job.id).data.gameIds,[r.game.id]);await runner.stop();
 }finally{a?.close();b?.close();for(const name of fs.readdirSync(dir))fs.rmSync(path.join(dir,name),{force:true});fs.rmdirSync(dir);}
});
