import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import type { PhotoFolderService } from '../services/photo-folder.service.js';
import type { NativeRateLimitService } from '../services/native-rate-limit.service.js';
const param=(value:unknown)=>String(value);
export function photoFolderRoutes(service:PhotoFolderService,accounts:CustomerAccountService,limiter?:NativeRateLimitService){
 const router=Router();
 router.use(['/account/photo-folders','/account/photos','/account/photo-folder-shares'],async(req,res,next)=>{const identity=await accounts.resolve(req.cookies??{});res.locals.folderAccountId=accounts.requireAccount(identity).id;next();});
 router.use(['/account/photo-folders','/account/photos','/account/photo-folder-shares'],limiter?.middleware('folder-management',120)||rateLimit({windowMs:60000,limit:120}));
 const owner=(res:{locals:Record<string,any>})=>res.locals.folderAccountId as string;
 router.get('/account/photo-folders',async(_req,res)=>{res.json(await service.list(owner(res)));});
 router.post('/account/photo-folders',async(req,res)=>{res.status(201).json(await service.create(owner(res),req.body));});
 router.put('/account/photo-folders/default',async(req,res)=>{res.json(await service.default(owner(res),req.body));});
 router.patch('/account/photo-folders/:id',async(req,res)=>{res.json(await service.rename(owner(res),param(req.params.id),req.body));});
 router.delete('/account/photo-folders/:id',async(req,res)=>{await service.remove(owner(res),param(req.params.id));res.sendStatus(204);});
 router.get('/account/photos',async(req,res)=>{res.json(await service.photos(owner(res),req.query));});
 router.put('/account/photos/:id/folder',async(req,res)=>{res.json(await service.move(owner(res),param(req.params.id),req.body));});
 router.get('/account/photo-folders/:id/shares',async(req,res)=>{res.json(await service.shares(owner(res),param(req.params.id)));});
 router.post('/account/photo-folders/:id/shares',async(req,res)=>{res.status(201).json(await service.createShare(owner(res),param(req.params.id),req.body));});
 router.delete('/account/photo-folder-shares/:id',async(req,res)=>{await service.revoke(owner(res),param(req.params.id));res.sendStatus(204);});
 // Never redirect public shares to owner-only delivery or long-lived signed URLs.
 router.use('/public/photo-folders',limiter?.middleware('folder-share',120)||rateLimit({windowMs:60000,limit:120}));
 router.use('/public/photo-folders',(_req,res,next)=>{res.set({'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});next();});
 router.get('/public/photo-folders/:token',async(req,res)=>{res.json(await service.shared(param(req.params.token),req.query));});
 for(const rendition of ['image','download'])router.get(`/public/photo-folders/:token/photos/:id/${rendition}`,async(req,res)=>{const result=await service.bytes(param(req.params.token),param(req.params.id));if(rendition==='download')res.attachment('nxbooth-photo.png');res.type(result.content_type).send(result.bytes);});
 return router;
}
