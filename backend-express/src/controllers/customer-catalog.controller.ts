import type { HttpHandler } from '../types/http.js';
import type { CustomerCatalogService } from '../services/customer-catalog.service.js';

// Return the existing public JSON shapes, not the upstream /api/v1 envelope.
export const customerCatalogController = (service: CustomerCatalogService): Record<string, HttpHandler> => ({
  templates: async (_req, res) => { res.json(await service.templates()); },
  templatePreview: async (req, res) => { res.type('png').sendFile(await service.templatePreview(req.params.id)); },
  experiences: async (_req, res) => { res.json(await service.experiences()); },
  experienceThumbnail: async (req, res) => { res.type('png').sendFile(await service.experienceThumbnail(req.params.id)); },
  layouts: async (_req, res) => { res.json(await service.layouts()); },
  classicPreview: async (req, res) => { res.type('png').sendFile(await service.classicPreview(req.params.id)); },
  styles: async (_req, res) => { res.json(await service.styles()); },
  ornaments: async (_req, res) => { res.json(await service.ornaments()); },
});
