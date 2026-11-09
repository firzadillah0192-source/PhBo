import { cn } from "@/lib/utils";

const STEPS = ["Studio", "Photo", "Create", "Result"] as const;

type Props = {
  current: 0 | 1 | 2 | 3;
  inverted?: boolean;
};

export function ProgressRail({ current, inverted }: Props) {
  const progress = (current + 1) / STEPS.length;
  return (
    <div className="mx-auto w-full max-w-md px-1">
      <div className="progress-line">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <ol className="mt-3 flex justify-between text-[0.65rem] tracking-[0.22em] uppercase">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className={cn(
              "transition-opacity duration-500",
              inverted ? "text-paper" : "text-ink",
              index === current ? "opacity-100" : "opacity-35",
            )}
          >
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
