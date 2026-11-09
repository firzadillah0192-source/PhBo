import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, Share2 } from "lucide-react";
import { ProgressRail } from "@/components/journey/progress-rail";
import { StudioButton } from "@/components/ui/studio-button";
import { lookById } from "@/lib/catalog";
import { downloadDataUrl } from "@/lib/photo";
import { useStudio } from "@/lib/store";

export function ResultStage() {
  const navigate = useNavigate();
  const result = useStudio((s) => s.resultDataUrl);
  const look = lookById(useStudio((s) => s.selectedId));
  const mode = useStudio((s) => s.mode);
  const resetJourney = useStudio((s) => s.resetJourney);
  const keepPhotoNewLook = useStudio((s) => s.keepPhotoNewLook);
  const [revealed, setRevealed] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setRevealed(true), 80);
    setCanShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
    return () => window.clearTimeout(t);
  }, []);

  if (!result || !look) return null;

  const image = result;
  const selected = look;

  async function onDownload() {
    await downloadDataUrl(image, `photobooth-${selected.id}.jpg`);
  }

  async function onShare() {
    try {
      const res = await fetch(image);
      const blob = await res.blob();
      const file = new File([blob], `photobooth-${selected.id}.jpg`, {
        type: blob.type || "image/jpeg",
      });
      await navigator.share({
        files: [file],
        title: "Photobooth AI",
        text: selected.title,
      });
    } catch {
      await onDownload();
    }
  }

  return (
    <section className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center px-5 pb-16 pt-24 text-paper md:px-8">
      <ProgressRail current={3} inverted />
      <h1 className="sr-only">Your portrait</h1>
      <div
        className="relative mt-10 w-full max-w-[26rem] transition-[transform,filter,opacity] duration-1000"
        style={{
          opacity: revealed ? 1 : 0,
          transform: revealed
            ? "scale(1) translateY(0)"
            : "scale(1.08) translateY(18px)",
          filter: revealed ? "blur(0px)" : "blur(12px)",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <img
          src={image}
          alt={`Portrait in ${selected.title}`}
          className="aspect-[3/4] w-full object-cover shadow-[0_40px_90px_rgba(0,0,0,0.45)]"
        />
      </div>

      <div
        className="mt-10 flex w-full max-w-md flex-col gap-3 transition-opacity duration-700"
        style={{
          opacity: revealed ? 1 : 0,
          transitionDelay: "480ms",
        }}
      >
        <StudioButton variant="paper" onClick={onDownload}>
          <Download className="size-4" />
          Download
        </StudioButton>
        {canShare ? (
          <StudioButton
            variant="line"
            className="border-paper/25 text-paper hover:border-paper/50"
            onClick={onShare}
          >
            <Share2 className="size-4" />
            Share
          </StudioButton>
        ) : null}
        <div className="flex gap-3">
          <StudioButton
            variant="ghost"
            className="flex-1 text-paper hover:bg-paper/10"
            onClick={() => {
              keepPhotoNewLook();
              navigate({ to: mode === "basic" ? "/studio" : "/worlds" });
            }}
          >
            Try another look
          </StudioButton>
          <StudioButton
            variant="ghost"
            className="flex-1 text-paper hover:bg-paper/10"
            onClick={() => {
              resetJourney();
              navigate({ to: "/" });
            }}
          >
            Create another
          </StudioButton>
        </div>
      </div>
    </section>
  );
}
