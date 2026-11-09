import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ReviewStage } from "@/components/review/review-stage";
import { useClientReady } from "@/hooks/use-client-ready";
import { useMood } from "@/hooks/use-mood";
import { useStudio } from "@/lib/store";

export const Route = createFileRoute("/review")({ component: ReviewPage });

function ReviewPage() {
  useMood("review");
  const ready = useClientReady();
  const navigate = useNavigate();
  const photo = useStudio((s) => s.photoDataUrl);
  const selectedId = useStudio((s) => s.selectedId);

  useEffect(() => {
    if (!ready) return;
    if (!photo || !selectedId) navigate({ to: "/" });
  }, [navigate, photo, ready, selectedId]);

  if (!ready || !photo || !selectedId) return null;
  return <ReviewStage />;
}
