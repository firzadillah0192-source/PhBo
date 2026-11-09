import { ArrowUpRight } from "lucide-react";
import type { Look } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type Props = {
  look: Look;
  onSelect: (look: Look) => void;
  size?: "hero" | "rail" | "grid";
};

export function LookCard({ look, onSelect, size = "grid" }: Props) {
  return (
    <button
      type="button"
      className={cn("look-card group", size === "hero" && "h-full")}
      onClick={() => onSelect(look)}
    >
      <div
        className={cn(
          "look-media",
          size === "hero" && "h-full min-h-[28rem] md:min-h-[36rem]",
          size === "rail" && "aspect-[3/4] w-[16.5rem] md:w-[20rem]",
          size === "grid" && "aspect-[3/4]",
        )}
      >
        <img src={look.image} alt="" draggable={false} />
      </div>
      <div className="look-meta">
        <div>
          <p className="font-display text-2xl leading-none tracking-tight">
            {look.title}
          </p>
          <p className="mt-1 text-sm text-ink/55">{look.subtitle}</p>
        </div>
        <ArrowUpRight className="look-arrow size-5 opacity-70" />
      </div>
    </button>
  );
}
