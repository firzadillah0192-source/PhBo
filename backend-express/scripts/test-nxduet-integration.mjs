// Reproducible disposable test DB: no network, published ports, production env or volumes.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp,chmod,rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
const exec=promisify(execFile),socket=await mkdtemp('/tmp/nxduet-test-'),name='photobooth-nxduet-test-'+randomBytes(6).toString('hex')
let created=false
try{
  await chmod(socket,0o777)
  await exec('docker',['run','--rm','--detach','--pull','never','--name',name,'--network','none','--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql/data:rw,size=256m','--mount',`type=bind,source=${socket},target=/socket`,'-e','POSTGRES_DB=nxbooth_nxduet_test','-e','POSTGRES_USER=nxduet_test','-e','POSTGRES_PASSWORD=disposable-nxduet-only','postgres:16-alpine','-c','listen_addresses=','-c','unix_socket_directories=/var/run/postgresql,/socket'])
  created=true
  let ready=false
  for(let attempt=0;attempt<40;attempt++){
    try{await exec('docker',['exec',name,'pg_isready','-h','/socket','-U','nxduet_test','-d','nxbooth_nxduet_test']);ready=true;break}catch{await delay(500)}
  }
  if(!ready)throw new Error('Disposable PostgreSQL did not become ready')
  const database=`postgresql://nxduet_test:disposable-nxduet-only@localhost/nxbooth_nxduet_test?host=${socket}`
  const result=await exec(process.execPath,['--import','tsx','--test','test/nxduet.integration.ts'],{cwd:new URL('../',import.meta.url),env:{...process.env,NXDUET_TEST_DATABASE_URL:database},maxBuffer:2*1024*1024})
  process.stdout.write(result.stdout)
}catch(error){
  if(error.stdout)process.stdout.write(error.stdout)
  console.error('NXDuet isolated integration failed:',error.message)
  process.exitCode=1
}finally{
  if(created)await exec('docker',['stop','--time','3',name]).catch(()=>{})
  await rm(socket,{recursive:true,force:true})
}
