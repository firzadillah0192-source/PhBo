import { useEffect, useRef } from "react";
import { useStudio } from "@/lib/store";

type Key = {
  t: number;
  s: number;
  x: number;
  y: number;
  fog: number;
  clouds: number;
  emerge: number;
  estate: number;
  island: number;
  arch: number;
  detail: number;
};

/** 15s loop matching the Imagine camera: clouds → terrace → estate → pull back → clouds. */
const KEYS: Key[] = [
  { t: 0, s: 1.62, x: 0, y: 26, fog: 0.82, clouds: 1, emerge: 0.04, estate: 0, island: 0, arch: 0.04, detail: 0.04 },
  { t: 0.13, s: 1.36, x: -18, y: 8, fog: 0.34, clouds: 0.42, emerge: 1, estate: 0.16, island: 0, arch: 0.62, detail: 0.22 },
  { t: 0.3, s: 1.12, x: 2, y: 0, fog: 0.08, clouds: 0.08, emerge: 0.18, estate: 1, island: 0.06, arch: 0.92, detail: 1 },
  { t: 0.48, s: 1.02, x: 14, y: -10, fog: 0.1, clouds: 0.1, emerge: 0, estate: 0.7, island: 0.48, arch: 0.32, detail: 0.42 },
  { t: 0.68, s: 0.86, x: 4, y: -22, fog: 0.2, clouds: 0.28, emerge: 0, estate: 0.1, island: 1, arch: 0.06, detail: 0.06 },
  { t: 0.86, s: 1.24, x: 2, y: 10, fog: 0.62, clouds: 0.88, emerge: 0.06, estate: 0.04, island: 0.22, arch: 0.08, detail: 0.06 },
  { t: 1, s: 1.62, x: 0, y: 26, fog: 0.82, clouds: 1, emerge: 0.04, estate: 0, island: 0, arch: 0.04, detail: 0.04 },
];

const REST = KEYS[2];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function sample(t: number): Key {
  const wrapped = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].t < wrapped) i += 1;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const u = smooth((wrapped - a.t) / (b.t - a.t || 1));
  return {
    t: wrapped,
    s: lerp(a.s, b.s, u),
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u),
    fog: lerp(a.fog, b.fog, u),
    clouds: lerp(a.clouds, b.clouds, u),
    emerge: lerp(a.emerge, b.emerge, u),
    estate: lerp(a.estate, b.estate, u),
    island: lerp(a.island, b.island, u),
    arch: lerp(a.arch, b.arch, u),
    detail: lerp(a.detail, b.detail, u),
  };
}

function mixKey(a: Key, b: Key, t: number): Key {
  return {
    t: lerp(a.t, b.t, t),
    s: lerp(a.s, b.s, t),
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    fog: lerp(a.fog, b.fog, t),
    clouds: lerp(a.clouds, b.clouds, t),
    emerge: lerp(a.emerge, b.emerge, t),
    estate: lerp(a.estate, b.estate, t),
    island: lerp(a.island, b.island, t),
    arch: lerp(a.arch, b.arch, t),
    detail: lerp(a.detail, b.detail, t),
  };
}

function applyPose(
  root: HTMLDivElement,
  el: HTMLDivElement,
  k: Key,
  mouse: { x: number; y: number },
  travel: number,
) {
  const x = k.x + mouse.x * (18 + 10 * travel);
  const y = k.y + mouse.y * (12 + 8 * travel);
  el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k.s})`;
  root.style.setProperty("--fog", String(k.fog));
  root.style.setProperty("--p-clouds", String(k.clouds));
  root.style.setProperty("--p-emerge", String(k.emerge));
  root.style.setProperty("--p-estate", String(k.estate));
  root.style.setProperty("--p-island", String(k.island));
  root.style.setProperty("--p-arch", String(k.arch));
  root.style.setProperty("--p-detail", String(k.detail));
}

function usePrefersReducedMotion() {
  const ref = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    ref.current = mq.matches;
    const onChange = () => {
      ref.current = mq.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return ref;
}

export function CelestialWorld() {
  const mood = useStudio((s) => s.mood);
  const hover = useStudio((s) => s.hoverMode);
  const world = useRef<HTMLDivElement>(null);
  const rig = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const moodRef = useRef(mood);
  moodRef.current = mood;

  useEffect(() => {
    const root = world.current;
    const el = rig.current;
    if (!root || !el) return;
    let raf = 0;
    const start = performance.now();
    const mouse = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

    const onMove = (event: PointerEvent) => {
      target.x = event.clientX / window.innerWidth - 0.5;
      target.y = event.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const tick = (now: number) => {
      mouse.x += (target.x - mouse.x) * 0.04;
      mouse.y += (target.y - mouse.y) * 0.04;
      const scene = moodRef.current;
      const travel =
        scene === "home" ? 1 : scene === "gallery" ? 0.38 : 0.16;

      if (reduced.current) {
        applyPose(root, el, { ...REST, s: 1.08, x: 0, y: 0, fog: 0.16 }, mouse, 0.2);
        raf = requestAnimationFrame(tick);
        return;
      }

      const t = ((now - start) / 15000) % 1;
      const k = mixKey(REST, sample(t), travel);
      applyPose(root, el, k, mouse, travel);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [reduced]);

  return (
    <div
      ref={world}
      className="world"
      data-mood={mood}
      data-hover={hover ?? undefined}
      aria-hidden="true"
    >
      <div ref={rig} className="world-rig">
        <div className="layer layer-sky" />
        <div className="plate plate-island" />
        <div className="layer layer-garden" />
        <div className="plate plate-estate-hero" />
        <div className="plate plate-emerge" />
        <div className="plate plate-clouds" />
        <div className="cloud cloud-a" />
        <div className="cloud cloud-b" />
        <div className="cloud cloud-c" />
        <div className="layer layer-arch" />
        <div className="layer layer-waterfall" />
        <div className="falls" />
        <figure className="install install-1">
          <img
            src="/experiences/cinematic-hero.webp"
            alt=""
            draggable={false}
          />
        </figure>
        <figure className="install install-2">
          <img
            src="/experiences/fantasy-portrait.webp"
            alt=""
            draggable={false}
          />
        </figure>
        <figure className="install install-3">
          <img src="/experiences/classic-booth.webp" alt="" draggable={false} />
        </figure>
        <div className="light-sweep" />
        <div className="fog-front" />
        <div className="mist-veil" />
      </div>
    </div>
  );
}
