import type { PrismaClient, Prisma } from '@prisma/client';
import { legacyId } from '../services/customer-credentials.service.js';
import type { AdminPrincipal } from '../services/admin-auth.service.js';

// Central persistence boundary for the native Admin controllers/services.
// Transactions expose the mapped existing entities, never another schema.
export class AdminDataModel {
  constructor(private readonly db: PrismaClient) {}
  read<T>(query: (db: PrismaClient) => Promise<T>) { return query(this.db); }
  transaction<T>(query: (tx: Prisma.TransactionClient) => Promise<T>) { return this.db.$transaction(query); }
  audit(tx: Prisma.TransactionClient, actor: AdminPrincipal, action: string, target_type: string, target_id: string, reason = '', metadata?: object) {
    return tx.nxAuditLog.create({ data: { id: legacyId(), admin_actor_id: actor.actor_id, action, target_type, target_id, reason, metadata_json: metadata ? JSON.stringify(metadata) : null } });
  }
}
