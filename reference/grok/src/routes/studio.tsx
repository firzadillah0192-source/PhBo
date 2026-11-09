import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LookCard } from "@/components/gallery/look-card";
import { ProgressRail } from "@/components/journey/progress-rail";
import { useMood } from "@/hooks/use-mood";
import { looksFor, type Look } from "@/lib/catalog";
import { useStudio } from "@/lib/store";

export const Route = createFileRoute("/studio")({ component: Studio });

function Studio() {
  useMood("gallery");
  const navigate = useNavigate();
  const selectLook = useStudio((s) => s.selectLook);
  const looks = looksFor("basic");

  function onSelect(look: Look) {
    selectLook(look.id, "basic");
    navigate({ to: "/capture" });
  }

  return (
    <main className="relative z-10 mx-auto min-h-dvh w-full max-w-6xl px-5 pb-24 pt-24 md:px-8">
      <ProgressRail current={0} />
      <header className="enter-copy mx-auto mt-12 max-w-2xl text-center">
        <p className="hero-kicker">Basic</p>
        <h1 className="mt-4 font-display text-5xl tracking-tight md:text-7xl">
          Choose your studio.
        </h1>
        <p className="mt-4 text-sm text-ink/60">
          Fast, photographic, template-driven portraits.
        </p>
      </header>
      <div className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2">
        {looks.map((look) => (
          <LookCard key={look.id} look={look} onSelect={onSelect} />
        ))}
      </div>
    </main>
  );
}
