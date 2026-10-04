import type { HttpHandler } from '../types/http.js';
import type { NativeKioskService } from '../services/native-kiosk.service.js';
import type { CustomerCatalogService } from '../services/customer-catalog.service.js';
import { z } from 'zod';

export function nativeKioskController(service: NativeKioskService, catalog: CustomerCatalogService): Record<string,HttpHandler> {
  const credential = (req: Parameters<HttpHandler>[0]) => req.cookies?.photo_session;
  return {
    create: async (req,res) => { res.status(201).json({ data: await service.create(Array.isArray(req.files) ? req.files : [],req.body) }); },
    claim: async (req,res) => {
      const result = await service.claim(req.params.code,req.body,credential(req));
      if (result.browser) res.cookie('photo_session',result.browser.value,{ httpOnly: true, secure: service.config.secureCookie,
        sameSite: 'lax',path: '/api/v1',maxAge: result.browser.ttl*1000 });
      res.json({ data: result.session });
    },
    session: async (req,res) => { res.json({ data: await service.info(await service.require(req.params.code,credential(req))) }); },
    photo: async (req,res) => { const photo = await service.photo(req.params.id,credential(req)); res.type(photo.contentType).send(photo.bytes); },
    imageMetadata: async (req,res) => { res.json({ data: await service.photoMetadata(req.params.id,credential(req)) }); },
    photoUrl: async (req,res) => { res.json({ data: await service.photoDelivery(req.params.id,credential(req)) }); },
    resultUrl: async (req,res) => { res.json({ data: await service.resultDelivery(req.params.id,credential(req)) }); },
    generate: async (req,res) => { res.status(202).json({ data: await service.generate(req.body,credential(req),req.get('Idempotency-Key')) }); },
    status: async (req,res) => { res.json({ data: await service.status(req.params.id,credential(req)) }); },
    history: async (req,res) => { res.json({ data: await service.history(req.params.code,credential(req)) }); },
    frames: async (_req,res) => { res.json({ data: await catalog.layouts() }); },
    frame: async (req,res) => { res.json({ data: await service.frame(req.params.id,catalog) }); },
    templates: async (_req,res) => { res.json({ data: (await catalog.templates()).templates }); },
    experiences: async (_req,res) => { res.json({ data: (await catalog.experiences()).experiences }); },
    styles: async (_req,res) => { res.json({ data: await catalog.styles() }); },
    ornaments: async (_req,res) => { res.json({ data: await catalog.ornaments() }); },
    resultMetadata: async (req,res) => {
      const session = await service.browser(credential(req));
      const found = await service.results.owned(req.params.id,await service.identity(session));
      const metadata = service.results.metadata(found);
      res.json({ data: { ...metadata,result_url: `/api/v1/results/${found.result.id}/image`,
        download_url: `/api/v1/results/${found.result.id}/download`,
        print_download_url: metadata.print_download_url ? `/api/v1/results/${found.result.id}/download?rendition=print` : null } });
    },
    result: async (req,res) => {
      const session = await service.browser(credential(req));
      const found = await service.results.owned(req.params.id,await service.identity(session));
      const print = z.enum(['master','print']).parse(req.query.rendition ?? 'master') === 'print';
      if (req.path.endsWith('/download')) res.attachment(`nxbooth-${found.result.id}${print ? '-2x6-300dpi' : ''}.png`);
      res.type(print ? 'image/png' : found.result.content_type).send(await service.results.rendition(found,print));
    },
    resultClaim: async (req,res) => {
      const session = await service.browser(credential(req));
      const input = z.object({ refresh: z.boolean().default(false), reuse_token: z.string().min(32).max(256).nullable().optional() }).strict().parse(req.body ?? {});
      res.json({ data: await service.results.createClaim(req.params.id,await service.identity(session),{
        refresh: input.refresh,reuseToken: input.reuse_token,kioskSessionId: session.id }) });
    },
  };
}
