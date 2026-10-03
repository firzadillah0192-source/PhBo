import type { CreditAccountingModel, CreditOwner } from '../models/credit-accounting.model.js';
import { AppError } from '../lib/errors.js';

export class CreditAccountingService {
  constructor(private readonly model: CreditAccountingModel) {}
  reserve(mode: string, jobId: string, owner: CreditOwner) {
    if (!['CLASSIC', 'BASIC', 'ADVANCED'].includes(mode)) throw new AppError(422, 'VALIDATION_FAILED', 'Invalid generation mode.');
    // Both customer AI modes use NineRouter; Classic remains local and free.
    return mode === 'BASIC' || mode === 'ADVANCED' ? this.model.reserve(jobId, owner) : Promise.resolve(null);
  }
  settle(jobId: string, successful: boolean) { return this.model.settle(jobId, successful); }
}
