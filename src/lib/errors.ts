export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);

  }
}
export function ensure(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
