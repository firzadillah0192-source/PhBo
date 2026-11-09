import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "line" | "paper";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  block?: boolean;
};

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-graphite border border-ink",
  paper: "bg-paper text-ink hover:bg-white border border-paper",
  ghost: "bg-transparent text-ink hover:bg-ink/5 border border-transparent",
  line: "bg-transparent text-ink border border-ink/15 hover:border-ink/40",
};

export function StudioButton({
  variant = "primary",
  block,
  className,
  children,
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium tracking-wide",
        "transition-[transform,background-color,border-color,opacity] duration-200 ease-out",
        "active:not-disabled:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink",
        block && "w-full",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
