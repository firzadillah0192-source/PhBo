import { useEffect, useState } from "react";
import { StudioButton } from "@/components/ui/studio-button";
import { useQuota, useStudio } from "@/lib/store";

export function AccountSheet() {
  const open = useStudio((s) => s.accountOpen);
  const setOpen = useStudio((s) => s.setAccountOpen);
  const { credits, joined, name, join } = useQuota();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-ink/35"
        aria-label="Close account"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-labelledby="account-title"
        className="relative m-4 w-full max-w-md rounded-[2rem] bg-paper p-8 text-ink shadow-[0_30px_80px_rgba(17,18,22,0.28)]"
      >
        <p className="hero-kicker">Studio</p>
        <h2
          id="account-title"
          className="mt-3 font-display text-4xl leading-none tracking-tight"
        >
          {joined ? `Welcome, ${name}.` : "Join the studio."}
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-graphite/80">
          {joined
            ? "Your credits stay on this device. Basic portraits never use AI credits."
            : "Anonymous visitors receive 2 AI credits. Joining the studio grants 5."}
        </p>
        <p className="mt-6 text-sm tabular-nums tracking-wide text-ink/70">
          {credits} AI {credits === 1 ? "credit" : "credits"}
        </p>

        {joined ? null : (
          <form
            className="mt-6 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              join(value);
            }}
          >
            <label className="text-xs tracking-wide text-ink/55" htmlFor="studio-name">
              Your name
            </label>
            <input
              id="studio-name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-12 rounded-full border border-ink/15 bg-white px-5 text-sm outline-none focus:border-ink"
              placeholder="First name"
              autoComplete="given-name"
            />
            <StudioButton type="submit" disabled={!value.trim()}>
              Join the studio
            </StudioButton>
          </form>
        )}

        <div className="mt-6">
          <StudioButton variant="ghost" onClick={() => setOpen(false)}>
            Close
          </StudioButton>
        </div>
      </div>
    </div>
  );
}
