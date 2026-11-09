import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LookCard } from "@/components/gallery/look-card";
import { ProgressRail } from "@/components/journey/progress-rail";
import { useMood } from "@/hooks/use-mood";
import { ADVANCED_GROUPS, looksFor, type Look } from "@/lib/catalog";
import { useStudio } from "@/lib/store";

export const Route = createFileRoute("/worlds")({ component: Worlds });

function Worlds() {
  useMood("gallery");
  const navigate = useNavigate();
  const selectLook = useStudio((s) => s.selectLook);
  const featured = looksFor("advanced", "featured");
  const [hero, ...restFeatured] = featured;
  const featuredIds = new Set(featured.map((look) => look.id));

  function onSelect(look: Look) {
    selectLook(look.id, "advanced");
    navigate({ to: "/capture" });
  }

  return (
    <main className="relative z-10 mx-auto min-h-dvh w-full max-w-6xl px-5 pb-24 pt-24 md:px-8">
      <ProgressRail current={0} />
      <header className="enter-copy mx-auto mt-12 max-w-2xl text-center">
        <p className="hero-kicker">Advanced</p>
        <h1 className="mt-4 font-display text-5xl tracking-tight md:text-7xl">
          Choose your world.
        </h1>
        <p className="mt-4 text-sm text-ink/60">
          Pick a creative direction and we'll create the rest.
        </p>
      </header>

      {hero ? (
        <section className="mt-14 grid gap-8 lg:grid-cols-[1.4fr_0.8fr]">
          <LookCard look={hero} onSelect={onSelect} size="hero" />
          <div className="grid gap-8">
            {restFeatured.map((look) => (
              <LookCard key={look.id} look={look} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ) : null}

      {ADVANCED_GROUPS.map((group) => {
        const unique = looksFor("advanced", group.id).filter((look) => {
          if (group.id === "new") return true;
          return !featuredIds.has(look.id);
        });
        if (unique.length === 0) return null;
        return (
          <section key={group.id} className="mt-16">
            <h2 className="font-display text-3xl tracking-tight">{group.title}</h2>
            <div className="-mx-5 mt-6 flex gap-5 overflow-x-auto px-5 pb-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4">
              {unique.map((look) => (
                <div
                  key={look.id}
                  className="w-[16.5rem] shrink-0 md:w-auto md:shrink"
                >
                  <LookCard look={look} onSelect={onSelect} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
