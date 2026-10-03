import type { PrismaClient, Prisma } from '@prisma/client';
export class CustomerUploadModel {
  constructor(private readonly db: PrismaClient) {}
  async find(id: string) { return this.db.nxUpload.findUnique({ where: { id } }); }
  async create(data: Prisma.NxUploadCreateInput) {
    return this.db.$transaction(async tx => {
      const upload = await tx.nxUpload.create({ data });
      if (data.account_id) await tx.nxAccount.update({ where: { id: data.account_id }, data: { last_activity_at: new Date() } });
      return upload;
    });
  }
  async expired(cutoff: Date) { return this.db.nxUpload.findMany({ where: { created_at: { lte: cutoff }, storage_path: { not: '' } }, orderBy: { created_at: 'asc' } }); }
  async jobs(id: string) { return this.db.nxGenerationJob.findMany({ where: { OR: [{ upload_id: id }, { capture_upload_ids_json: { contains: JSON.stringify(id) } }] }, select: { state: true } }); }
  async remove(id: string) { return this.db.nxUpload.delete({ where: { id } }); }
  async scrub(id: string) { return this.db.nxUpload.update({ where: { id }, data: { storage_path: '', filename: '', content_type: 'application/octet-stream', size_bytes: 0, width: 0, height: 0, format: '', sha256: '', validation_status: 'EXPIRED', validation_detail: null } }); }
}
