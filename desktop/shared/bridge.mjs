import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { newId } from './journal.mjs';
export class Bridge {
  constructor(command, args, {onDiagnostic=()=>{}}={}) {
    this.diagnostic=value=>{try{onDiagnostic(value);}catch{}};
    this.pending = new Map();
    this.child = spawn(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
    createInterface({input:this.child.stderr}).on('line',line=>{
      if(line.length>4096)return;
      try{const r=JSON.parse(line);if(r.kind==='camera-diagnostic')this.diagnostic(r);}catch{}
    });
    this.child.on('error', () => {this.diagnostic({action:'adapter.process',status:'error',code:'ADAPTER_UNAVAILABLE'});this.dead=true;this.fail();});
    this.child.on('exit', () => { if(!this.dead)this.diagnostic({action:'adapter.process',status:'error',code:'ADAPTER_EXITED'});this.dead=true; this.fail(); });
    createInterface({input:this.child.stdout}).on('line', line => {
      try { const r=JSON.parse(line), p=this.pending.get(r.id); if (!p || r.version!==1) return;
        clearTimeout(p.timer); this.pending.delete(r.id); this.diagnostic({action:'adapter.'+p.method,status:r.ok?'ok':'error',code:r.ok?undefined:r.error?.code,ms:Date.now()-p.started}); r.ok ? p.resolve(r.result) : p.reject(new Error(r.error?.code || 'ADAPTER_ERROR'));
      } catch { this.fail(); }
    });
  }
  fail() { for(const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('ADAPTER_UNAVAILABLE')); } this.pending.clear(); }
  call(method, params={}) {
    if(this.dead) return Promise.reject(new Error('ADAPTER_UNAVAILABLE'));
    const started=Date.now();this.diagnostic({action:'adapter.'+method,status:'begin'});
    return new Promise((resolve,reject)=> { const id=newId(); const timer=setTimeout(()=> { this.pending.delete(id);this.diagnostic({action:'adapter.'+method,status:'error',code:'ADAPTER_TIMEOUT',ms:Date.now()-started}); reject(new Error('ADAPTER_TIMEOUT')); },['printer.submit','update.verify'].includes(method)?120000:['camera.probe','camera.capture'].includes(method)?110000:method==='camera.open'?60000:method==='camera.frame'?35000:15000);
      this.pending.set(id,{resolve,reject,timer,method,started}); this.child.stdin.write(JSON.stringify({version:1,id,method,params})+'\n',e=>{if(e)this.fail();});
    });
  }
  close() { this.dead=true; this.fail(); this.child.kill(); }
}
