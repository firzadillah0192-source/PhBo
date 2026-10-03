import type { PrismaClient, Prisma, NxGenerationJob, NxProviderRun } from '@prisma/client';
import { legacyId } from '../services/customer-credentials.service.js';
import { ProviderFailure, type OperationalMeta, type ProviderImage } from '../services/native-provider.service.js';

export function providerRunMetadata(meta: OperationalMeta): Prisma.NxProviderRunUpdateInput {
  const data: Prisma.NxProviderRunUpdateInput = {};
  const text: Record<string, keyof Prisma.NxProviderRunUpdateInput> = { requested_model: 'requested_model', router_request_id: 'router_request_id', upstream_request_id: 'upstream_request_id',
    provider_account_ref: 'provider_account_id', routing_strategy: 'routing_strategy', provider_reported_model: 'provider_reported_model', provider_name: 'provider_name' };
  for (const [key, field] of Object.entries(text)) if (typeof meta[key] === 'string') Object.assign(data, { [field]: meta[key] });
  if (typeof meta.upstream_request_id === 'string') data.provider_request_id = meta.upstream_request_id;
  if (typeof meta.routing_strategy === 'string') data.provider_strategy_hint = meta.routing_strategy;
  if (typeof meta.provider_reported_model === 'string') data.provider_model = meta.provider_reported_model;
  for (const key of ['retry_count', 'attempt_count', 'failover_count', 'router_duration_ms', 'provider_reported_cost']) if (typeof meta[key] === 'number') Object.assign(data, { [key]: meta[key] });
  if (typeof meta.usage_available === 'string') data.usage_available = meta.usage_available.toLowerCase() === 'true';
  if (meta.usage && typeof meta.usage === 'object') {
    const usage: Record<string, number> = {};
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'input_text_tokens', 'input_image_tokens', 'output_image_tokens', 'billable_units']) {
      const value = meta.usage[key]; if (Number.isSafeInteger(value) && value >= 0) { usage[key] = value; Object.assign(data, { [key]: value }); }
    }
    data.provider_usage_raw_json = JSON.stringify(usage); data.usage_available = true;
  }
  return data;
}
export class ProviderRunModel {
  constructor(private readonly db: PrismaClient) {}
  start(job: NxGenerationJob, name: string, model: string) {
    return this.db.$transaction(async tx => {
      await tx.nxGenerationJob.update({ where: { id: job.id }, data: { provider: name, model } });
      return tx.nxProviderRun.create({ data: { id: legacyId(), generation_job_id: job.id, account_id: job.account_id,
        provider_name: name, provider_model: model, requested_model: model, upstream_status: 'PROCESSING', request_started_at: new Date() } });
    });
  }
  async finish(run: NxProviderRun, job: NxGenerationJob, image: ProviderImage | null, error?: unknown) {
    const now = new Date(); const failure = error instanceof ProviderFailure ? error : null;
    const meta = image?.meta ?? failure?.meta ?? {};
    await this.db.nxProviderRun.update({ where: { id: run.id }, data: { ...providerRunMetadata(meta),
      ...(image ? { provider_reported_model: image.model, provider_model: image.model } : {}),
      upstream_status: image ? 'SUCCEEDED' : String(meta.upstream_status ?? 'FAILED').slice(0, 32),
      upstream_error_code: image ? null : failure?.code ?? 'INTERNAL_ERROR', upstream_error_message: image ? null : failure?.message ?? 'Provider execution failed.',
      request_completed_at: now, total_duration_ms: Math.max(0, now.getTime() - run.request_started_at.getTime()),
      application_duration_ms: job.started_at ? Math.max(0, now.getTime() - job.started_at.getTime()) : null } });
    await this.db.nxGenerationEvent.create({ data: { id: legacyId(), job_id: job.id, event_type: image ? 'provider_run_succeeded' : 'provider_run_failed',
      detail: image ? 'Provider execution metadata recorded' : failure?.code ?? 'INTERNAL_ERROR', metadata_json: JSON.stringify({ provider_run_id: run.id, provider: image?.provider ?? run.provider_name }) } });
  }
}
