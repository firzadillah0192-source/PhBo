// Names the startup step that failed without leaking the underlying error text,
// which may contain connection strings or credentials.
export class StartupStageError extends Error {
  constructor(readonly stage: string) { super(`startup stage failed: ${stage}`); this.name = 'StartupStageError'; }
}

export async function startupStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch { throw new StartupStageError(stage); }
}

export function failedStage(error: unknown): string { return error instanceof StartupStageError ? error.stage : 'unknown'; }
