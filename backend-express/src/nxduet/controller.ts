import type { RequestHandler } from 'express';
import type { DuetService } from './service.js';
import { composeDuet } from './compositor.js';

export function duetController(service:DuetService){
  const owner=(locals:Record<string,any>)=>locals.duetAccountId as string;
  const list:RequestHandler=async(req,res)=>{res.json(await service.list(owner(res.locals),req.query.offset));};
  const create:RequestHandler=async(req,res)=>{res.status(202).json(await service.create(res.locals.duetIdentity,req.body,req.get('Idempotency-Key')));};
  const get:RequestHandler=async(req,res)=>{res.json(await service.get(owner(res.locals),String(req.params.id)));};
  const patch:RequestHandler=async(req,res)=>{res.json(await service.patch(owner(res.locals),String(req.params.id),req.body));};
  const remove:RequestHandler=async(req,res)=>{await service.remove(owner(res.locals),String(req.params.id));res.sendStatus(204);};
  const image:RequestHandler=async(req,res)=>{res.type('png').send(await service.image(owner(res.locals),String(req.params.id),req.query.slot));};
  const compose:RequestHandler=async(req,res)=>{
    const account=owner(res.locals),id=String(req.params.id),row=await service.owned(account,id,true);
    const captures=Array.isArray(req.files)?req.files:[];
    let placement:unknown;try{placement=JSON.parse(req.body.placement);}catch{placement=null;}
    const info=await service.frame!.load(),output=await composeDuet(captures,await service.overlays(account,row.id),placement,service.frame!,info);
    await service.owned(account,id,true);
    res.attachment('nxduet-photo-strip.png').type('png').send(output);
  };
  return {list,create,get,patch,remove,image,compose};
}
