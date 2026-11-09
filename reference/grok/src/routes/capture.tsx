import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PhotoStage } from "@/components/capture/photo-stage";
import { useClientReady } from "@/hooks/use-client-ready";
import { useMood } from "@/hooks/use-mood";
import { useStudio } from "@/lib/store";

export const Route = createFileRoute("/capture")({ component: CapturePage });

function CapturePage() {
  useMood("capture");
  const ready = useClientReady();
  const navigate = useNavigate();
  const selectedId = useStudio((s) => s.selectedId);

  useEffect(() => {
    if (!ready) return;
    if (!selectedId) navigate({ to: "/" });
  }, [navigate, ready, selectedId]);

  if (!ready || !selectedId) return null;
  return <PhotoStage />;
}
