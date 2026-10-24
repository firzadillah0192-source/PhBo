import { mkdir,readFile,writeFile,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { NativeObjectStorage } from '../services/native-object-storage.service.js';
import { idSchema } from './policy.js';

// Dedicated private namespace, independent of temporary upload/result retention.
export class DuetFiles {
  constructor(private readonly root:string,private readonly objects?:NativeObjectStorage){}
  path(id:string,kind:'source'|'overlay'){idSchema.parse(id);return this.objects?`minio://nxduet/${id}/${kind}.${kind==='source'?'jpg':'png'}`:join(this.root,id,`${kind}.${kind==='source'?'jpg':'png'}`);}
  private safe(id:string,path:string,kind:'source'|'overlay'){if(path!==this.path(id,kind))throw new Error('Invalid NXDuet asset reference');}
  async put(id:string,kind:'source'|'overlay',bytes:Buffer){const path=this.path(id,kind);if(this.objects)await this.objects.put(path,bytes,kind==='source'?'image/jpeg':'image/png');else{await mkdir(join(this.root,id),{recursive:true});await writeFile(path,bytes,{flag:'wx',mode:0o600});}return path;}
  async read(id:string,path:string,kind:'source'|'overlay'){this.safe(id,path,kind);return this.objects?this.objects.read(path):readFile(path);}
  async remove(id:string,path:string,kind:'source'|'overlay'){
    this.safe(id,path,kind);
    if(this.objects)await this.objects.remove(path);
    else try{await unlink(path);}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='ENOENT')throw error;}
  }
}
