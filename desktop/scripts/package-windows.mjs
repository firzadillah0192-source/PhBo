import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit',shell:process.platform==='win32'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);};
run('npm',['run','build']);
run(process.env.PHBO_DOTNET||'dotnet',['publish','native/KioskBridge','-c','Release','-r','win-x64','--self-contained','true','-o','native/publish/win-x64']);
// Pin the self-signed installer certificate: the app only installs updates signed by this thumbprint.
const thumbprint=(process.env.PHBO_UPDATE_SIGNER_THUMBPRINT||'').replace(/\s/g,'').toUpperCase();
if(thumbprint&&!/^[A-F0-9]{40}$/.test(thumbprint)){console.error('PHBO_UPDATE_SIGNER_THUMBPRINT must be 40 hex characters.');process.exit(1);}
mkdirSync('native/publish',{recursive:true});
writeFileSync('native/publish/update-signer.json',JSON.stringify({thumbprint})+'\n');
run('npx',['electron-builder','--win','nsis','--x64']);
