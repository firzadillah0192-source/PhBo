import type { ErrorComponentProps } from "@tanstack/react-router";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-6 text-center text-ink">
      <p className="text-[0.68rem] tracking-[0.42em] uppercase text-ink/50">
        Studio
      </p>
      <h1 className="font-display text-4xl tracking-tight">
        We couldn't load the studio.
      </h1>
      <p className="max-w-md text-sm break-words text-ink/55">
        {errorMessage(error)}
      </p>
      <a
        href="/"
        className="mt-2 text-sm tracking-wide underline underline-offset-4"
      >
        Try again
      </a>
    </main>
  );
}
