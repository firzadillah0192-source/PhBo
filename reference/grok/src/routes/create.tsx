import { createFileRoute } from "@tanstack/react-router";
import { ProcessingStage } from "@/components/processing/processing-stage";
import { useClientReady } from "@/hooks/use-client-ready";
import { useMood } from "@/hooks/use-mood";

export const Route = createFileRoute("/create")({ component: CreatePage });

function CreatePage() {
  useMood("process");
  const ready = useClientReady();
  if (!ready) return null;
  return <ProcessingStage />;
}
