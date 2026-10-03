import { Router } from 'express';
import multer from 'multer';
import type { NativeAdminServices } from '../controllers/admin.controller.js';
import { adminController } from '../controllers/admin.controller.js';
export function nativeAdminRoutes(services:NativeAdminServices,maximum:number){
  const router=Router(),c=adminController(services);
  // Authenticate before allocating upload memory.
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:maximum,files:1,fields:4}}).single('file');
  const authorizedUpload=async(req:Parameters<typeof upload>[0],res:Parameters<typeof upload>[1],next:Parameters<typeof upload>[2])=>{try{const actor=await services.auth.resolve(req.cookies||{},req.get('x-admin-token'));services.auth.requireRole(actor,'content_manager');upload(req,res,next);}catch(error){next(error);}};
  router.post('/login',c.login);router.post('/logout',c.logout);
  router.get('/experiences',c.experiences);router.post('/experiences',c.createExperience);router.post('/experiences/publish-ready',c.publish);
  router.patch('/experiences/:id',c.patchExperience);router.delete('/experiences/:id',c.deleteExperience);
  router.get('/templates',c.templates);router.post('/templates',c.createTemplate);router.patch('/templates/:id',c.patchTemplate);router.delete('/templates/:id',c.deleteTemplate);
  for(const [kind,purpose] of [['experience','thumbnail'],['template','image'],['template','preview']] as const){const path=`/${kind==='experience'?'experiences':'templates'}/:id/${purpose}`;
    router.get(path,c.asset(req=>services.catalog.asset(kind,String(req.params.id),purpose)));
    router.post(path,authorizedUpload,c.action('content_manager',(req,actor)=>services.catalog.replaceAsset(kind,String(req.params.id),purpose,req.file,actor)));
    if(purpose!=='image')router.delete(path,c.action('content_manager',(req,actor)=>services.catalog.removePreview(kind,String(req.params.id),actor),204));
  }
  router.get('/classic-layouts',c.layouts);router.post('/classic-layouts',c.createLayout);router.patch('/classic-layouts/:id',c.patchLayout);router.post('/classic-layouts/:id/frame',authorizedUpload,c.frame);
  router.get('/advanced/:kind',c.presets);router.post('/advanced/:kind',c.createPreset);router.patch('/advanced/:kind/:id',c.patchPreset);
  router.get('/preview-sources',c.sources);router.post('/preview-sources/:id',authorizedUpload,c.replaceSource);router.get('/preview-sources/:id/image',c.sourceImage);
  router.post('/experiences/:id/preview',c.preview);router.post('/preview-jobs/generate-missing',c.previewBatch);router.get('/preview-jobs/:id',c.previewJob);
  router.get('/overview',c.overview);router.get('/users',c.users);router.get('/users/:id',c.user);router.get('/users/:id/credits',c.credits);router.post('/users/:id/credits',c.adjust);router.get('/users/:id/generations',c.userGenerations);router.get('/users/:id/sessions',c.sessions);router.post('/users/:id/sessions/revoke',c.revokeSessions);router.get('/users/:id/audit',c.userAudit);router.patch('/users/:id/status',c.status);router.post('/users/:id/subscription',c.subscription);
  router.get('/credits/ledger',c.ledger);router.get('/plans',c.plans);router.post('/plans',c.createPlan);router.patch('/plans/:id',c.patchPlan);router.get('/subscriptions',c.subscriptions);
  router.get('/generations',c.generations);router.get('/generations/:id',c.generation);router.post('/result-claims/:id/revoke',c.revokeClaim);router.get('/audit',c.audit);router.get('/admin-users',c.adminUsers);router.post('/admin-users',c.createAdmin);router.patch('/admin-users/:id',c.patchAdmin);router.get('/settings',c.settings);
  router.get('/usage/overview',c.usageOverview);router.get('/usage/users',c.usageUsers);router.get('/usage/users/:id',c.usageUser);router.get('/usage/users/:id/credits',c.usageCredits);router.get('/usage/users/:id/generations',c.usageUserGenerations);router.get('/usage/generations',c.usageGenerations);router.get('/usage/generations/:id',c.usageGeneration);router.get('/usage/generations/:id/result/image',c.photo());router.get('/usage/generations/:id/result/download',c.photo(true));router.delete('/usage/generations/:id/result',c.deletePhoto);router.get('/usage/providers/overview',c.providerOverview);router.get('/usage/providers/accounts',c.providerAccounts);
  return router;
}
