import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
const VERSION=/^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
/**
 * Operator-initiated update: ask the server, download, verify size/hash, then hand over to the
 * installer. If a signer thumbprint is pinned (optional), the Authenticode signature must also match.
 * Nothing runs unless every check passes.
 */
export class Updater {
  constructor({client,bridge,dir,version,signer,sessionActive,launch}) {
    Object.assign(this,{client,bridge,dir,version,signer:(signer||'').toUpperCase(),sessionActive,launch});
  }
  async check() {
    if(!VERSION.test(this.version))throw new Error('INVALID_VERSION');
    const info=await this.client.check(this.version);
    return info.update_available?{available:true,version:info.version,notes:info.notes||'',size:info.size}:{available:false};
  }
  async install() {
    if(this.signer&&!/^[A-F0-9]{40}$/.test(this.signer))throw new Error('UPDATE_SIGNER_NOT_CONFIGURED');
    if(this.sessionActive())throw new Error('UPDATE_SESSION_ACTIVE');
    const info=await this.client.check(this.version);
    if(!info.update_available)throw new Error('UPDATE_NOT_AVAILABLE');
    if(!VERSION.test(info.version))throw new Error('UPDATE_MANIFEST_INVALID');
    await mkdir(this.dir,{recursive:true});
    const file=join(this.dir,`NXBooth-Setup-${info.version}.exe`);
    await rm(file,{force:true});
    await this.client.download(info,file);
    try {
      if(this.signer){
        const signature=await this.bridge.call('update.verify',{path:file});
        if(signature.status!=='Valid'||String(signature.thumbprint||'').toUpperCase()!==this.signer)throw new Error('UPDATE_SIGNATURE_INVALID');
      }
      if(this.sessionActive())throw new Error('UPDATE_SESSION_ACTIVE'); // a guest may have started during the download
    } catch(error) {
      await rm(file,{force:true});throw error;
    }
    await this.launch(file);
    return {launched:true,version:info.version};
  }
}
