import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQuota, useStudio } from "@/lib/store";

const links = [
  { to: "/studio", label: "Basic" },
  { to: "/worlds", label: "Advanced" },
] as const;

export function SiteNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const credits = useQuota((s) => s.credits);
  const hydrate = useQuota((s) => s.hydrate);
  const menuOpen = useStudio((s) => s.menuOpen);
  const setMenuOpen = useStudio((s) => s.setMenuOpen);
  const setAccountOpen = useStudio((s) => s.setAccountOpen);
  const mood = useStudio((s) => s.mood);
  const inverted = mood === "result";

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, setMenuOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-30 nav-glass",
        inverted && "border-paper/10 bg-night/55 text-paper",
      )}
    >
      <nav
        className="relative mx-auto grid h-[4.25rem] max-w-[90rem] grid-cols-[1fr_auto_1fr] items-center px-5 md:px-8"
        aria-label="Primary"
      >
        <Link
          to="/"
          className={cn(
            "justify-self-start font-display text-[1.15rem] tracking-tight text-ink",
            inverted && "text-paper",
          )}
        >
          Photobooth AI
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((link) => {
            const active = pathname.startsWith(link.to);
            return (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "relative py-2 text-sm tracking-wide text-ink/70 transition-colors duration-300",
                  "hover:text-ink focus-visible:text-ink",
                  active && "text-ink",
                  inverted && "text-paper/70 hover:text-paper focus-visible:text-paper",
                  inverted && active && "text-paper",
                )}
              >
                {link.label}
                <span
                  className={cn(
                    "absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-current transition-transform duration-500",
                    active && "scale-x-100",
                  )}
                />
              </Link>
            );
          })}
        </div>

        <div className="hidden items-center justify-self-end gap-5 md:flex">
          <span
            className={cn(
              "text-xs tabular-nums tracking-wide text-ink/60",
              inverted && "text-paper/60",
            )}
          >
            {credits} AI {credits === 1 ? "credit" : "credits"}
          </span>
          <button
            type="button"
            className={cn(
              "text-sm tracking-wide text-ink/80 hover:text-ink",
              inverted && "text-paper/80 hover:text-paper",
            )}
            onClick={() => setAccountOpen(true)}
          >
            Account
          </button>
        </div>

        <button
          type="button"
          className="justify-self-end p-2 md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {menuOpen ? (
        <div
          className={cn(
            "border-t border-ink/8 px-5 py-5 md:hidden",
            inverted && "border-paper/10",
          )}
        >
          <div className="flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="py-3 text-lg font-display tracking-tight"
              >
                {link.label}
              </Link>
            ))}
            <p className="pt-2 text-sm tabular-nums text-ink/60">
              {credits} AI {credits === 1 ? "credit" : "credits"}
            </p>
            <button
              type="button"
              className="py-3 text-left text-lg font-display"
              onClick={() => setAccountOpen(true)}
            >
              Account
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
