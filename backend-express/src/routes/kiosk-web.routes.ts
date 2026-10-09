import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {CustomerAccountService} from '../services/customer-account.service.js';
import {accountCookie} from '../services/customer-credentials.service.js';
import {AppError} from '../lib/errors.js';
export const bootstrapKioskEmail='firzadillah0192@gmail.com';
export const kioskAccessCookie='photobooth_kiosk_access';
export const kioskProof=(cookie:string)=>'kiosk-google:'+createHash('sha256').update(cookie).digest('hex');
export function kioskWebAccess(accounts:CustomerAccountService){
 const router=Router();
 router.post('/login/google',rateLimit({windowMs:60000,limit:20,standardHeaders:false,legacyHeaders:false}),async(req,res)=>{
  const input=z.object({id_token:z.string().min(20).max(16384)}).strict().parse(req.body);
  // CustomerAccountService.google verifies Google signature, audience and verified email.
  const result=await accounts.google(input.id_token,req.cookies??{});
  if(result.account.email?.trim().toLowerCase()!==bootstrapKioskEmail)throw new AppError(403,'KIOSK_FORBIDDEN','This account does not have kiosk access.');
  const options={path:'/',httpOnly:true,secure:accounts.config.cookieSecure,sameSite:'lax' as const,maxAge:accounts.config.sessionDays*86400000};
  res.cookie(accountCookie,result.cookie,options);
  res.cookie(kioskAccessCookie,accounts.signer.sign(kioskProof(result.cookie)),{...options,path:'/api/kiosk'});
  res.json({allowed:true});
 });
 router.post('/logout',async(req,res)=>{await accounts.logout(req.cookies??{});res.clearCookie(accountCookie,{path:'/'});res.clearCookie(kioskAccessCookie,{path:'/api/kiosk'});res.json({allowed:false});});
 router.use(async(req,res,next)=>{
  const cookie=req.cookies?.[accountCookie];
  if(!accounts.signer.unsign(cookie))throw new AppError(401,'AUTHENTICATION_REQUIRED','Sign in to enter kiosk.');
  const identity=await accounts.resolve(req.cookies??{});
  if(!identity.account)throw new AppError(401,'AUTHENTICATION_REQUIRED','Sign in to enter kiosk.');
  if(identity.account.email.trim().toLowerCase()!==bootstrapKioskEmail)throw new AppError(403,'KIOSK_FORBIDDEN','This account does not have kiosk access.');
  if(accounts.signer.unsign(req.cookies?.[kioskAccessCookie])!==kioskProof(cookie))throw new AppError(403,'KIOSK_GOOGLE_REQUIRED','Sign in with Google to authorize kiosk.');
  res.locals.kioskAccountId=identity.account.id;
  next();
 });
 router.get('/access',(_req,res)=>res.json({allowed:true,analytics_id:'phbo-account:'+res.locals.kioskAccountId}));
 return router;
}
