import type { PrismaClient } from '@prisma/client';

export class CustomerCatalogModel {
  constructor(private readonly db: PrismaClient) {}
  templates() { return this.db.nxTemplate.findMany({ where: { enabled: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }); }
  template(id: string) { return this.db.nxTemplate.findUnique({ where: { id } }); }
  // Publication status is the existing source of visibility, not the legacy enabled flag.
  experiences() { return this.db.nxExperience.findMany({ where: { status: 'published' }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }); }
  experience(id: string) { return this.db.nxExperience.findUnique({ where: { id } }); }
  layouts() { return this.db.nxClassicLayout.findMany({ where: { active: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }); }
  layout(id: string) { return this.db.nxClassicLayout.findUnique({ where: { id } }); }
  styles() { return this.db.nxFrameStyle.findMany({ where: { enabled: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }); }
  ornaments() { return this.db.nxOrnament.findMany({ where: { enabled: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }); }
}
