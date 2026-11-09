import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ProgressRail } from "@/components/journey/progress-rail";
import { StudioButton } from "@/components/ui/studio-button";
import { lookById } from "@/lib/catalog";
import { useQuota, useStudio } from "@/lib/store";

export function ReviewStage() {
  const navigate = useNavigate();
  const photo = useStudio((s) => s.photoDataUrl);
  const look = lookById(useStudio((s) => s.selectedId));
  const credits = useQuota((s) => s.credits);
  const hydrated = useQuota((s) => s.hydrated);
  const setAccountOpen = useStudio((s) => s.setAccountOpen);
  const setProcess = useStudio((s) => s.setProcess);

  useEffect(() => {
    setProcess("idle");
  }, [setProcess]);

  if (!photo || !look) {
    return null;
  }

  const advanced = look.mode === "advanced";
  const needsCredit = advanced && hydrated && credits < 1;

  return (
    <section className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 pb-16 pt-24 md:px-8">
      <ProgressRail current={2} />
      <header className="enter-copy mx-auto mt-8 max-w-2xl text-center">
        <p className="hero-kicker">Review</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">
          Your photograph, this world.
        </h1>
      </header>

      <div className="mt-8 grid items-center gap-5 md:grid-cols-[1fr_auto_1fr] md:gap-8">
        <figure className="relative">
          <img
            src={photo}
            alt="Your photograph"
            className="aspect-[3/4] max-h-[52vh] w-full object-cover shadow-[0_30px_70px_rgba(17,18,22,0.18)]"
          />
          <figcaption className="mt-3 text-xs tracking-[0.22em] uppercase text-ink/50">
            Your photograph
          </figcaption>
        </figure>
        <p className="hidden text-center font-display text-4xl italic text-ink/30 md:block">
          →
        </p>
        <figure className="relative">
          <img
            src={look.image}
            alt=""
            className="aspect-[3/4] max-h-[52vh] w-full object-cover shadow-[0_30px_70px_rgba(17,18,22,0.18)]"
          />
          <figcaption className="mt-3 text-xs tracking-[0.22em] uppercase text-ink/50">
            {look.title}
          </figcaption>
        </figure>
      </div>

      <div className="mx-auto mt-8 flex w-full max-w-md flex-col items-center gap-3">
        {needsCredit ? (
          <>
            <StudioButton onClick={() => setAccountOpen(true)}>
              Join the studio for credits
            </StudioButton>
            <p className="text-sm text-ink/55">AI portraits use one credit.</p>
          </>
        ) : (
          <StudioButton block onClick={() => navigate({ to: "/create" })}>
            {advanced
              ? hydrated
                ? "Create with AI · 1 credit"
                : "Create with AI"
              : "Create Photo"}
          </StudioButton>
        )}
        <StudioButton variant="ghost" onClick={() => navigate({ to: "/capture" })}>
          Replace photograph
        </StudioButton>
      </div>
    </section>
  );
}
