export const WEB_RESULT_RETENTION_DAYS = 14;
export const WEB_RESULT_RETENTION_MS = WEB_RESULT_RETENTION_DAYS * 86400000;
export function webResultExpiresAt(createdAt: Date) {
  return new Date(createdAt.getTime() + WEB_RESULT_RETENTION_MS);
}
