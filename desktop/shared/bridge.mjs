import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { newId } from './journal.mjs';
export class Bridge {
  constructor(command, args) {
    this.pending = new Map();
    this.child = spawn(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.child.stderr.resume();
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => { this.dead=true; this.fail(); });
    createInterface({input:this.child.stdout}).on('line', line => {
      try { const r=JSON.parse(line), p=this.pending.get(r.id); if (!p || r.version!==1) return;
        clearTimeout(p.timer); this.pending.delete(r.id); r.ok ? p.resolve(r.result) : p.reject(new Error(r.error?.code || 'ADAPTER_ERROR'));
      } catch { this.fail(); }
    });
  }
  fail() { for(const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('ADAPTER_UNAVAILABLE')); } this.pending.clear(); }
  call(method, params={}) {
    if(this.dead) return Promise.reject(new Error('ADAPTER_UNAVAILABLE'));
    return new Promise((resolve,reject)=> { const id=newId(); const timer=setTimeout(()=> { this.pending.delete(id); reject(new Error('ADAPTER_TIMEOUT')); },15000);
      this.pending.set(id,{resolve,reject,timer}); this.child.stdin.write(JSON.stringify({version:1,id,method,params})+'\n',e=>{if(e)this.fail();});
    });
  }
  close() { this.dead=true; this.fail(); this.child.kill(); }
}
