import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMood } from "@/hooks/use-mood";
import { useStudio } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  useMood("home");
  const navigate = useNavigate();
  const setHoverMode = useStudio((s) => s.setHoverMode);
  const setMode = useStudio((s) => s.setMode);

  function go(mode: "basic" | "advanced") {
    setHoverMode(null);
    setMode(mode);
    navigate({ to: mode === "basic" ? "/studio" : "/worlds" });
  }

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-5 pb-16 pt-24 text-center">
      <div className="enter-copy max-w-4xl">
        <p className="hero-kicker">Photobooth AI</p>
        <h1 className="hero-title mt-6">
          Step into
          <br />
          <em>another version of you.</em>
        </h1>
        <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-ink/65 md:text-base">
          Choose a curated studio or enter an AI-powered world.
        </p>
      </div>

      <div className="mt-12 flex flex-col items-stretch sm:flex-row sm:items-start sm:gap-4">
        <button
          type="button"
          className="mode-pick"
          onMouseEnter={() => setHoverMode("basic")}
          onMouseLeave={() => setHoverMode(null)}
          onFocus={() => setHoverMode("basic")}
          onBlur={() => setHoverMode(null)}
          onClick={() => go("basic")}
        >
          <span className="hero-kicker">Basic</span>
          <span className="font-display text-3xl tracking-tight">Curated Studio</span>
        </button>
        <button
          type="button"
          className="mode-pick"
          onMouseEnter={() => setHoverMode("advanced")}
          onMouseLeave={() => setHoverMode(null)}
          onFocus={() => setHoverMode("advanced")}
          onBlur={() => setHoverMode(null)}
          onClick={() => go("advanced")}
        >
          <span className="hero-kicker">Advanced</span>
          <span className="font-display text-3xl tracking-tight">AI Worlds</span>
        </button>
      </div>
    </main>
  );
}
