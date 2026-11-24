import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeGame, recoverLegacy } from './domain.mjs';

export const DEFAULT_SETTINGS={timezone:'Europe/Moscow',sessionGap:45,minSample:5,preset:'quick',autoAnalyze:false,includeRecovered:true,hash:32};
export class Store {
  constructor(filename) {
    this.revision=0;this.gameCache=new Map();this.analysisCache=new Map();
    if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(username TEXT PRIMARY KEY,data TEXT NOT NULL,last_sync TEXT);
      CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,profile TEXT NOT NULL REFERENCES profiles(username),external_id TEXT NOT NULL,end_time INTEGER,format TEXT,color TEXT,outcome TEXT,opening TEXT,rating INTEGER,opponent_rating INTEGER,pgn_hash TEXT,data TEXT NOT NULL, UNIQUE(profile,external_id));
      CREATE INDEX IF NOT EXISTS games_profile_time ON games(profile,end_time DESC);
      CREATE INDEX IF NOT EXISTS games_format_time ON games(profile,format,end_time);
      CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id),source TEXT NOT NULL,created_at TEXT NOT NULL,preset TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS analyses_game ON analyses(game_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,profile TEXT NOT NULL REFERENCES profiles(username),status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created_at);
      CREATE TABLE IF NOT EXISTS http_cache(url TEXT PRIMARY KEY,etag TEXT,last_modified TEXT,fetched_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS puzzles(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id),profile TEXT NOT NULL,ply INTEGER NOT NULL,data TEXT NOT NULL,due_at TEXT NOT NULL,interval_days REAL NOT NULL DEFAULT 0, UNIQUE(game_id,ply));
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,puzzle_id TEXT NOT NULL REFERENCES puzzles(id),created_at TEXT NOT NULL,correct INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantine(id TEXT PRIMARY KEY,profile TEXT NOT NULL,error TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS position_cache(key TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  refresh(){const version=this.db.prepare('PRAGMA data_version').get().data_version;if(this.dataVersion!==undefined&&version!==this.dataVersion){this.gameCache.clear();this.analysisCache.clear();this.revision++;}this.dataVersion=version;}
  settings(){return {...DEFAULT_SETTINGS,...JSON.parse(this.db.prepare("SELECT value FROM metadata WHERE key='settings'").get()?.value??'{}')};}
  setSettings(patch){const settings={...this.settings(),...patch};this.db.prepare("INSERT OR REPLACE INTO metadata VALUES('settings',?)").run(JSON.stringify(settings));this.revision++;return settings;}
  profile(name){const row=this.db.prepare('SELECT * FROM profiles WHERE username=?').get(name);return row?{username:name,...JSON.parse(row.data),lastSync:row.last_sync}:null;}
  profiles(){return this.db.prepare('SELECT username FROM profiles ORDER BY username').all().map(r=>({...this.profile(r.username),games:this.db.prepare('SELECT count(*) n FROM games WHERE profile=?').get(r.username).n}));}
  saveProfile(name,data={}){const previous=this.profile(name)??{};this.db.prepare('INSERT INTO profiles(username,data) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET data=excluded.data').run(name,JSON.stringify({...previous,...data,username:name}));return this.profile(name);}
  importGame(raw,name){
    try {
      const game=normalizeGame(raw,name);game.externalId=game.id;game.id=name+':'+game.id;
      const old=this.db.prepare('SELECT pgn_hash FROM games WHERE id=?').get(game.id);
      // Import normalisation is deterministic; never overwrite saved analysis merely for a repeated HTTP snapshot.
      const hash=raw.pgn;
      this.transaction(()=>{
        this.db.prepare(`INSERT INTO games(id,profile,external_id,end_time,format,color,outcome,opening,rating,opponent_rating,pgn_hash,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET end_time=excluded.end_time,format=excluded.format,color=excluded.color,outcome=excluded.outcome,opening=excluded.opening,rating=excluded.rating,opponent_rating=excluded.opponent_rating,pgn_hash=excluded.pgn_hash,data=excluded.data`).run(game.id,name,game.externalId,game.end,game.timeClass,game.color,game.outcome,game.opening,game.rating,game.opponentRating,hash,JSON.stringify(game));
        if(old&&old.pgn_hash!==hash)this.db.prepare('DELETE FROM analyses WHERE game_id=?').run(game.id);
      });
      this.gameCache.delete(name);this.analysisCache.delete(name);this.revision++;
      return {game,inserted:!old};
    }catch(error){this.db.prepare('INSERT INTO quarantine VALUES(?,?,?,?,?)').run(randomUUID(),name,error.message,JSON.stringify(raw),new Date().toISOString());return {error:error.message};}
  }
  game(id,withAnalysis=true){const row=this.db.prepare('SELECT data FROM games WHERE id=?').get(id);if(!row)return null;const game=JSON.parse(row.data);if(withAnalysis)game.analysis=this.analysis(id);return game;}
  analysis(id,verifiedOnly=false){const row=this.db.prepare(`SELECT data FROM analyses WHERE game_id=? ${verifiedOnly?"AND source='verified'":''} ORDER BY CASE source WHEN 'verified' THEN 0 ELSE 1 END,created_at DESC LIMIT 1`).get(id);return row?JSON.parse(row.data):null;}
  putAnalysis(id,data){data.id??=randomUUID();this.db.prepare('INSERT INTO analyses(id,game_id,source,created_at,preset,data) VALUES(?,?,?,?,?,?)').run(data.id,id,data.source,data.createdAt,data.preset,JSON.stringify(data));this.analysisCache.clear();this.revision++;}
  games(profile){this.refresh();if(!this.gameCache.has(profile))this.gameCache.set(profile,this.db.prepare('SELECT data FROM games WHERE profile=? ORDER BY end_time,id').all(profile).map(r=>JSON.parse(r.data)));return this.gameCache.get(profile);}
  analyses(profile){this.refresh();if(!this.analysisCache.has(profile)){const rows=this.db.prepare(`SELECT a.game_id,a.data FROM analyses a JOIN games g ON g.id=a.game_id WHERE g.profile=? ORDER BY CASE a.source WHEN 'verified' THEN 1 ELSE 0 END,a.created_at`).all(profile);this.analysisCache.set(profile,new Map(rows.map(r=>[r.game_id,JSON.parse(r.data)])));}return this.analysisCache.get(profile);}
  job(id){const r=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);return r?{...r,data:JSON.parse(r.data)}:null;}
  jobs(profile){return this.db.prepare('SELECT id FROM jobs WHERE profile=? ORDER BY created_at DESC LIMIT 50').all(profile).map(r=>this.job(r.id));}
  createJob(kind,profile,data){const id=randomUUID(),now=new Date().toISOString();this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?)').run(id,kind,profile,'queued',now,now,JSON.stringify(data));return this.job(id);}
  updateJob(id,status,data){this.db.prepare('UPDATE jobs SET status=?,updated_at=?,data=? WHERE id=?').run(status,new Date().toISOString(),JSON.stringify(data),id);return this.job(id);}
  cache(key){const row=this.db.prepare('SELECT data FROM position_cache WHERE key=?').get(key);return row?JSON.parse(row.data):null;}
  cachePut(key,data){this.db.prepare('INSERT OR REPLACE INTO position_cache VALUES(?,?,?)').run(key,JSON.stringify(data),new Date().toISOString());}
  bootstrap(root){
    if(this.db.prepare("SELECT value FROM metadata WHERE key='bootstrap'").get())return;
    let games=0,recovered=0;
    const base=path.join(root,'games');
    if(fs.existsSync(base))for(const entry of fs.readdirSync(base,{withFileTypes:true})){
      if(!entry.isDirectory())continue;this.saveProfile(entry.name,{local:true});
      for(const file of fs.readdirSync(path.join(base,entry.name)).filter(f=>/^\d{4}-\d{2}\.json$/.test(f))){
        const raw=JSON.parse(fs.readFileSync(path.join(base,entry.name,file),'utf8'));
        const legacyPath=path.join(root,'analysis',entry.name,file.slice(0,-5),'analysis.json');
        const legacy=fs.existsSync(legacyPath)?new Map(JSON.parse(fs.readFileSync(legacyPath,'utf8')).map(g=>[g.pgn,g])):new Map();
        for(const data of raw){const result=this.importGame(data,entry.name);if(result.error)continue;games++;if(legacy.has(data.pgn)){this.putAnalysis(result.game.id,recoverLegacy(result.game,legacy.get(data.pgn)));recovered++;}}
      }
    }
    this.db.prepare("INSERT INTO metadata VALUES('bootstrap',?)").run(JSON.stringify({games,recovered,at:new Date().toISOString()}));
    console.log(`Импортировано локально: ${games} партий; восстановлено оценок: ${recovered}. Исходные файлы сохранены.`);
  }
  close(){this.db.close();}
}
