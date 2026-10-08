import { spawnSync } from 'node:child_process';
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit',shell:process.platform==='win32'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);};
run('npm',['run','build']);
run(process.env.PHBO_DOTNET||'dotnet',['publish','native/KioskBridge','-c','Release','-r','win-x64','--self-contained','true','-o','native/publish/win-x64']);
run('npx',['electron-builder','--win','zip','--x64']);
