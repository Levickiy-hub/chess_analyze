import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files=['index.js',...fs.readdirSync('app').filter(f=>f.endsWith('.mjs')).map(f=>'app/'+f),'public/app.js'];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
console.log(`Синтаксис проверен: ${files.length} модулей.`);
