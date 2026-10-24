import {Router} from 'express';
import {AppError} from '../lib/errors.js';
import type {CustomerAccountService} from '../services/customer-account.service.js';
import type {GenerationWebhookService} from '../services/generation-webhook.service.js';
export function generationWebhookRoutes(service:GenerationWebhookService,accounts:Pick<CustomerAccountService,'resolve'>){
 const r=Router();const owner=async(cookies:Record<string,unknown>|undefined)=>{const identity=await accounts.resolve(cookies??{});if(!identity.account)throw new AppError(401,'AUTH_REQUIRED','Sign in to manage webhooks.');return identity.account.id;};
 r.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 r.get('/:key/webhook',async(req,res)=>res.json(await service.get(await owner(req.cookies),req.params.key)));
 r.put('/:key/webhook',async(req,res)=>res.json(await service.save(await owner(req.cookies),req.params.key,req.body)));
 r.post('/:key/webhook/rotate-secret',async(req,res)=>res.json(await service.rotate(await owner(req.cookies),req.params.key)));
 r.get('/:key/webhook/deliveries',async(req,res)=>res.json(await service.history(await owner(req.cookies),req.params.key,req.query)));
 r.get('/:key/webhook/deliveries/:id/attempts',async(req,res)=>res.json(await service.attempts(await owner(req.cookies),req.params.key,req.params.id)));
 r.post('/:key/webhook/deliveries/:id/retry',async(req,res)=>res.status(202).json(await service.retry(await owner(req.cookies),req.params.key,req.params.id)));
 return r;
}
