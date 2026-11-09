import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RefreshCw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { StudioButton } from "@/components/ui/studio-button";
import { ProgressRail } from "@/components/journey/progress-rail";
import { lookById } from "@/lib/catalog";
import { captureFromVideo, fileToDataUrl } from "@/lib/photo";
import { useStudio } from "@/lib/store";

export function PhotoStage() {
  const navigate = useNavigate();
  const selectedId = useStudio((s) => s.selectedId);
  const photo = useStudio((s) => s.photoDataUrl);
  const setPhoto = useStudio((s) => s.setPhoto);
  const look = lookById(selectedId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
  }

  async function startCamera() {
    setHint(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 1720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setLive(true);
    } catch {
      setHint("Camera isn't available here. Upload a photograph instead.");
    }
  }

  function takePhoto() {
    if (!videoRef.current) return;
    try {
      const data = captureFromVideo(videoRef.current);
      setPhoto(data);
      stopCamera();
    } catch {
      setHint("We couldn't capture that frame.");
    }
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setHint(null);
    try {
      const data = await fileToDataUrl(file);
      setPhoto(data);
      stopCamera();
    } catch {
      setHint("We couldn't read that photograph.");
    } finally {
      setBusy(false);
    }
  }

  if (!look) {
    return (
      <EmptyStudio
        message="We couldn't load the studio."
        action={() => navigate({ to: "/" })}
      />
    );
  }

  return (
    <section className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pb-16 pt-24 md:px-8">
      <ProgressRail current={1} />
      <header className="enter-copy mx-auto mt-8 max-w-xl text-center">
        <p className="hero-kicker">{look.title}</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight md:text-5xl">
          Take your portrait.
        </h1>
        <p className="mt-3 text-sm text-ink/60">
          Face visible · Good lighting · Look toward camera
        </p>
      </header>

      <div className="relative mx-auto mt-8 w-full max-w-[20rem] md:max-w-[22rem]">
        <span className="studio-glow left-[-20%] top-[10%] h-40 w-40 bg-cool" />
        <span className="studio-glow right-[-18%] top-[30%] h-44 w-44 bg-warm" />
        <span className="studio-glow bottom-[8%] left-[20%] h-32 w-32 bg-white" />
        <div className="viewport-frame relative aspect-[3/4] w-full">
          {photo ? (
            <img
              src={photo}
              alt="Your photograph"
              className="h-full w-full object-cover"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                className={
                  live ? "h-full w-full scale-x-[-1] object-cover" : "hidden"
                }
                playsInline
                muted
                autoPlay
              />
              {live ? null : (
                <div className="viewport-ready">
                  <p className="font-display text-3xl">Ready when you are.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mx-auto mt-7 flex w-full max-w-md flex-col items-center gap-3">
        {photo ? (
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            <StudioButton
              variant="line"
              className="flex-1"
              onClick={() => setPhoto(null)}
            >
              <RefreshCw className="size-4" />
              Replace
            </StudioButton>
            <StudioButton
              className="flex-1"
              onClick={() => navigate({ to: "/review" })}
            >
              Continue
            </StudioButton>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            {live ? (
              <StudioButton className="flex-1" onClick={takePhoto}>
                <Camera className="size-4" />
                Take Photo
              </StudioButton>
            ) : (
              <StudioButton className="flex-1" onClick={startCamera}>
                <Camera className="size-4" />
                Take Photo
              </StudioButton>
            )}
            <StudioButton
              variant="line"
              className="flex-1"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
              Upload Photo
            </StudioButton>
          </div>
        )}
        {hint ? <p className="text-center text-sm text-ink/60">{hint}</p> : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => onUpload(e.target.files?.[0])}
        />
      </div>
    </section>
  );
}

function EmptyStudio({
  message,
  action,
}: {
  message: string;
  action: () => void;
}) {
  return (
    <section className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-4xl">{message}</h1>
      <div className="mt-6">
        <StudioButton onClick={action}>Try again</StudioButton>
      </div>
    </section>
  );
}
