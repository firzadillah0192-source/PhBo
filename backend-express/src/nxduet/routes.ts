import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type { CustomerAccountService } from '../services/customer-account.service.js';
import type { AdminAuthService } from '../services/admin-auth.service.js';
import type { DuetService } from './service.js';
import { duetController } from './controller.js';

export function duetRoutes(service:DuetService,accounts:CustomerAccountService,maximum:number){
  const router=Router(),c=duetController(service);
  router.use(async(req,res,next)=>{const identity=await accounts.resolve(req.cookies??{});res.locals.duetAccountId=accounts.requireAccount(identity).id;res.locals.duetIdentity=identity;next();});
  router.use(rateLimit({windowMs:60000,limit:120}));
  router.get('/templates',c.list);
  router.post('/templates',rateLimit({windowMs:60000,limit:10}),c.create);
  router.get('/templates/:id',c.get);router.patch('/templates/:id',c.patch);router.delete('/templates/:id',c.remove);
  router.get('/templates/:id/image',c.image);
  // Resolve ownership before allocating memory for camera uploads.
  router.post('/templates/:id/compose',rateLimit({windowMs:60000,limit:10}),async(req,res,next)=>{await service.owned(res.locals.duetAccountId,String(req.params.id),true);next();},multer({storage:multer.memoryStorage(),limits:{fileSize:maximum,files:3,fields:1,fieldSize:512}}).array('captures',3),c.compose);
  return router;
}
export function duetAdminRoutes(service:DuetService,auth:AdminAuthService){
  const router=Router();
  router.use(async(req,res,next)=>{const actor=await auth.resolve(req.cookies??{});auth.requireRole(actor,'operator');res.locals.duetActor=actor;next();});
  router.use(rateLimit({windowMs:60000,limit:120}));
  router.get('/templates',async(req,res)=>{res.json(await service.adminList(req.query));});
  router.get('/templates/:id/image',async(req,res)=>{res.type('png').send(await service.adminImage(String(req.params.id)));});
  router.post('/templates/:id/control',async(req,res)=>{res.json(await service.adminControl(res.locals.duetActor,String(req.params.id),req.body));});
  return router;
}
