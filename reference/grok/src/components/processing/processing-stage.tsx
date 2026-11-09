import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ProgressRail } from "@/components/journey/progress-rail";
import { StudioButton } from "@/components/ui/studio-button";
import { lookById } from "@/lib/catalog";
import { createPortrait } from "@/lib/portrait";
import { processBasic } from "@/lib/process-basic";
import { useQuota, useStudio } from "@/lib/store";

const COPY = {
  queued: "Preparing your portrait",
  processing: "Building your world",
  completed: "Finishing your image",
  failed: "We couldn't finish this portrait",
  idle: "Preparing your portrait",
};

export function ProcessingStage() {
  const navigate = useNavigate();
  const photo = useStudio((s) => s.photoDataUrl);
  const selectedId = useStudio((s) => s.selectedId);
  const look = lookById(selectedId);
  const processState = useStudio((s) => s.processState);
  const result = useStudio((s) => s.resultDataUrl);
  const setProcess = useStudio((s) => s.setProcess);
  const setResult = useStudio((s) => s.setResult);
  const setError = useStudio((s) => s.setError);
  const spend = useQuota((s) => s.spend);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (result && attempt === 0) {
      navigate({ to: "/result" });
      return;
    }
    if (!photo || !look) {
      navigate({ to: "/" });
      return;
    }

    const selected = look;
    const source = photo;
    let cancelled = false;

    async function run() {
      setProcess("queued", COPY.queued);
      await wait(700);
      if (cancelled) return;
      setProcess("processing", COPY.processing);
      const began = performance.now();
      try {
        let image: string;
        if (selected.mode === "basic" && selected.grade) {
          image = await processBasic(source, selected.grade);
        } else {
          if (useQuota.getState().credits < 1) {
            setProcess("failed", COPY.failed);
            setError("You're out of AI credits.");
            return;
          }
          const portrait = await createPortrait({
            data: { experienceId: selected.id, photoDataUrl: source },
          });
          if (!portrait.ok) {
            setProcess("failed", COPY.failed);
            setError(portrait.error);
            return;
          }
          if (!spend()) {
            setProcess("failed", COPY.failed);
            setError("You're out of AI credits.");
            return;
          }
          image = portrait.imageDataUrl;
        }
        if (cancelled) return;
        const elapsed = performance.now() - began;
        if (elapsed < 1800) await wait(1800 - elapsed);
        if (cancelled) return;
        setProcess("completed", COPY.completed);
        setResult(image);
        await wait(480);
        if (!cancelled) navigate({ to: "/result" });
      } catch {
        if (!cancelled) {
          setProcess("failed", COPY.failed);
          setError("We couldn't finish this portrait.");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    look,
    navigate,
    photo,
    result,
    setError,
    setProcess,
    setResult,
    spend,
  ]);

  if (!photo || !look) return null;

  const failed = processState === "failed";

  return (
    <section className="relative z-10 mx-auto flex min-h-dvh w-full max-w-4xl flex-col items-center px-5 pb-16 pt-24 md:px-8">
      <ProgressRail current={2} />
      <div className="relative mt-16 w-full max-w-[20rem]">
        <span className="studio-glow -left-10 top-8 h-36 w-36 bg-cool" />
        <span className="studio-glow -right-8 bottom-10 h-40 w-40 bg-warm" />
        <div className="relative aspect-[3/4] overflow-hidden">
          <img
            src={look.image}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-md"
          />
          <img
            src={photo}
            alt=""
            className="relative h-full w-full object-cover opacity-90"
          />
          <div className="pointer-events-none absolute inset-0 light-sweep opacity-80" />
        </div>
      </div>
      <p
        className={
          failed
            ? "mt-10 font-display text-3xl tracking-tight"
            : "mt-10 font-display text-3xl tracking-tight shimmer-copy"
        }
      >
        {failed ? COPY.failed : COPY[processState] || COPY.processing}
      </p>
      {failed ? (
        <div className="mt-8 flex gap-3">
          <StudioButton
            onClick={() => {
              setProcess("idle");
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </StudioButton>
          <StudioButton variant="line" onClick={() => navigate({ to: "/review" })}>
            Go back
          </StudioButton>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink/50">Stay with the light.</p>
      )}
    </section>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
