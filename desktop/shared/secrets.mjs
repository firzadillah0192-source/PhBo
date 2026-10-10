import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
export class Secrets {
  constructor(root, encryption){this.root=root;this.encryption=encryption;this.persistent=!!encryption;this.memory=new Map();}
  async get(id){if(!this.encryption)return this.memory.get(id);try{return JSON.parse(this.encryption.decryptString(await readFile(join(this.root,id+'.secret'))));}catch(e){if(e.code==='ENOENT')return undefined;throw new Error('CREDENTIAL_RECOVERY_REQUIRED');}}
  async set(id,value){if(!/^[a-f0-9]{32}$/.test(id))throw new Error('INVALID_ID');if(!this.encryption){this.memory.set(id,value);return;}
    await mkdir(this.root,{recursive:true});const file=join(this.root,id+'.secret');await writeFile(file+'.tmp',this.encryption.encryptString(JSON.stringify(value)),{mode:0o600});await rename(file+'.tmp',file);
  }
}
