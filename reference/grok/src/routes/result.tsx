import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ResultStage } from "@/components/result/result-stage";
import { useClientReady } from "@/hooks/use-client-ready";
import { useMood } from "@/hooks/use-mood";
import { useStudio } from "@/lib/store";

export const Route = createFileRoute("/result")({ component: ResultPage });

function ResultPage() {
  useMood("result");
  const ready = useClientReady();
  const navigate = useNavigate();
  const result = useStudio((s) => s.resultDataUrl);

  useEffect(() => {
    if (!ready) return;
    if (!result) navigate({ to: "/" });
  }, [navigate, ready, result]);

  if (!ready || !result) return null;
  return <ResultStage />;
}
