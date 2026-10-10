import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {newId} from './journal.mjs';
import {inspectImage} from './image.mjs';

export const WEB_KIOSK_ORIGIN='https://nxbooth.gennexbyte.com';
const notSubmitted=new Set(['PRINTER_NOT_CONNECTED','PRINTER_SELECTION_REQUIRED','PRINTER_MODEL_UNSUPPORTED','PRINT_4R_PAPER_UNAVAILABLE','PRINT_ENABLE_4R_BORDERLESS','PRINT_CLASSIC_SIZE_INVALID','PRINT_PROFILE_INVALID','PRINT_IMAGE_INVALID','INVALID_IMAGE']);
export class PrinterService {
  constructor({bridge,journal,assets}){Object.assign(this,{bridge,journal,assets});this.busy=false;}
  async status(){
    if(this.busy)return {printer:'BUSY',simulated:false,profiles:[]};
    const device=await this.bridge.call('devices.status');
    return device.simulated?{printer:'SIMULATED',simulated:true,profiles:['classic-two-strips-4r','photo-4r']}:
      {...device.printing,printer:device.printing?.printer||device.printer||'PRINTER_NOT_CONNECTED',simulated:false};
  }
  async submit({resultId,profile,base64}){
    if(typeof resultId!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(resultId)||!['classic-two-strips-4r','photo-4r'].includes(profile))throw new Error('PRINT_REQUEST_INVALID');
    if(this.busy)throw new Error('PRINT_BUSY');
    if(this.journal.prints('web:'+resultId).some(p=>p.status!=='REJECTED'))throw new Error('PRINT_ALREADY_SUBMITTED');
    if(typeof base64!=='string'||base64.length>22*1024*1024||base64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('INVALID_IMAGE');
    const bytes=Buffer.from(base64,'base64');const image=inspectImage(bytes);
    if(bytes.toString('base64')!==base64)throw new Error('INVALID_IMAGE');
    this.busy=true;
    const id=newId(),path=join(this.assets,id+(image.mime==='image/png'?'.png':'.jpg'));
    try{
      await writeFile(path,bytes,{flag:'wx',mode:0o600});
      await this.journal.print(id,'web:'+resultId,'SUBMITTING');
      try{
        const result=await this.bridge.call('printer.submit',{jobId:id,path,profile});
        if(!['ACCEPTED','SIMULATED'].includes(result.status))throw new Error('PRINT_STATUS_UNSUPPORTED');
        await this.journal.print(id,'web:'+resultId,result.status);
        return {jobId:id,status:result.status,simulated:result.status==='SIMULATED',printerName:result.printerName};
      }catch(error){await this.journal.print(id,'web:'+resultId,notSubmitted.has(error.message)?'REJECTED':'UNKNOWN');throw error;}
    }finally{this.busy=false;}
  }
  job(resultId){
    if(typeof resultId!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(resultId))throw new Error('PRINT_REQUEST_INVALID');
    return this.journal.prints('web:'+resultId).at(-1)||null;
  }
}

export async function startPrinterServer(service,{port=20253,origin=WEB_KIOSK_ORIGIN}={}){
  const token=randomBytes(32).toString('base64url');
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    // Strict Host/Origin checks reject DNS rebinding and unauthorized websites.
    const address=server.address();
    if(req.headers.host!==`127.0.0.1:${address.port}`||req.headers.origin!==origin){res.writeHead(403);res.end();return;}
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','GET, POST');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network','true');
      res.writeHead(204);res.end();return;
    }
    const supplied=Buffer.from(req.headers.authorization||''),wanted=Buffer.from('Bearer '+token);
    if(supplied.length!==wanted.length||!timingSafeEqual(supplied,wanted)){res.writeHead(401);res.end();return;}
    res.setHeader('Content-Type','application/json');
    try{
      let output;
      if(req.method==='GET'&&req.url==='/v1/status')output=await service.status();
      else if(req.method==='GET'&&/^\/v1\/jobs\/[a-zA-Z0-9_-]{1,128}$/.test(req.url))output=service.job(req.url.split('/').at(-1));
      else if(req.method==='POST'&&req.url==='/v1/print'){
        if(req.headers['content-type']!=='application/json')throw new Error('PRINT_REQUEST_INVALID');
        const chunks=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>23*1024*1024)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='base64,profile,resultId')throw new Error('PRINT_REQUEST_INVALID');
        output=await service.submit(input);
      }else{res.writeHead(404);res.end(JSON.stringify({error:{code:'METHOD_UNSUPPORTED'}}));return;}
      res.end(JSON.stringify({data:output}));
    }catch(error){
      const code=/^[A-Z0-9_]+$/.test(error.message)?error.message:'PRINT_REQUEST_FAILED';
      res.writeHead(400);res.end(JSON.stringify({error:{code}}));
    }
  });
  server.requestTimeout=120000;server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  // Pairing secret stays in process memory; only an unlocked local operator UI
  // may receive it. Never include it in logs, URLs, persistent browser storage.
  return {token,port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
