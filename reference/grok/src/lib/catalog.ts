export type Mode = "basic" | "advanced";

export type Grade =
  | "classic"
  | "soft"
  | "noir"
  | "golden"
  | "polaroid"
  | "porcelain"
  | "painterly"
  | "film";

export type LookGroup =
  | "featured"
  | "new"
  | "portraits"
  | "playful"
  | "fantasy"
  | "retro"
  | "studio";

export type Look = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  mode: Mode;
  groups: LookGroup[];
  grade?: Grade;
};

export const LOOKS: Look[] = [
  {
    id: "classic-booth",
    title: "Classic Booth",
    subtitle: "Clean studio light",
    image: "/experiences/classic-booth.webp",
    mode: "basic",
    groups: ["studio"],
    grade: "classic",
  },
  {
    id: "soft-studio",
    title: "Soft Studio",
    subtitle: "Wraparound window light",
    image: "/experiences/soft-studio.webp",
    mode: "basic",
    groups: ["studio"],
    grade: "soft",
  },
  {
    id: "editorial-noir",
    title: "Editorial Noir",
    subtitle: "Silver window light",
    image: "/experiences/editorial-noir.webp",
    mode: "basic",
    groups: ["studio", "portraits"],
    grade: "noir",
  },
  {
    id: "golden-hour",
    title: "Golden Hour",
    subtitle: "Warm terrace light",
    image: "/experiences/golden-hour.webp",
    mode: "basic",
    groups: ["studio"],
    grade: "golden",
  },
  {
    id: "polaroid-dream",
    title: "Polaroid",
    subtitle: "Instant analog frame",
    image: "/experiences/polaroid-dream.webp",
    mode: "basic",
    groups: ["studio", "retro", "playful"],
    grade: "polaroid",
  },
  {
    id: "porcelain-light",
    title: "Porcelain Light",
    subtitle: "High-key beauty",
    image: "/experiences/porcelain-light.webp",
    mode: "basic",
    groups: ["studio", "portraits"],
    grade: "porcelain",
  },
  {
    id: "oil-portrait",
    title: "Painterly",
    subtitle: "Museum oil light",
    image: "/experiences/oil-portrait.webp",
    mode: "basic",
    groups: ["studio", "portraits"],
    grade: "painterly",
  },
  {
    id: "film-portrait",
    title: "Film Portrait",
    subtitle: "Soft analog color",
    image: "/experiences/cinematic-hero.webp",
    mode: "basic",
    groups: ["studio", "retro"],
    grade: "film",
  },
  {
    id: "cinematic-hero",
    title: "Cinematic Hero",
    subtitle: "Film portrait",
    image: "/experiences/cinematic-hero.webp",
    mode: "advanced",
    groups: ["featured", "portraits"],
  },
  {
    id: "mini-me",
    title: "Mini Me",
    subtitle: "Tiny living world",
    image: "/experiences/mini-me.webp",
    mode: "advanced",
    groups: ["featured", "playful", "new"],
  },
  {
    id: "fantasy-portrait",
    title: "Fantasy Portrait",
    subtitle: "Mythic beauty",
    image: "/experiences/fantasy-portrait.webp",
    mode: "advanced",
    groups: ["featured", "fantasy"],
  },
  {
    id: "action-figure",
    title: "Action Figure",
    subtitle: "Collectible portrait",
    image: "/experiences/action-figure.webp",
    mode: "advanced",
    groups: ["new", "playful"],
  },
  {
    id: "magazine-cover",
    title: "Magazine Cover",
    subtitle: "Editorial fashion",
    image: "/experiences/magazine-cover.webp",
    mode: "advanced",
    groups: ["new", "portraits"],
  },
  {
    id: "avatar-3d",
    title: "3D Avatar",
    subtitle: "Sculpted likeness",
    image: "/experiences/avatar-3d.webp",
    mode: "advanced",
    groups: ["new", "playful"],
  },
  {
    id: "sci-fi",
    title: "Sci-Fi",
    subtitle: "Cloud city light",
    image: "/experiences/sci-fi.webp",
    mode: "advanced",
    groups: ["fantasy"],
  },
  {
    id: "nature-fantasy",
    title: "Nature Fantasy",
    subtitle: "Living garden",
    image: "/experiences/nature-fantasy.webp",
    mode: "advanced",
    groups: ["fantasy"],
  },
  {
    id: "retro-80s",
    title: "Retro 80s",
    subtitle: "Sunset chrome",
    image: "/experiences/retro-80s.webp",
    mode: "advanced",
    groups: ["retro"],
  },
  {
    id: "pixel-world",
    title: "Pixel World",
    subtitle: "Game key art",
    image: "/experiences/pixel-world.webp",
    mode: "advanced",
    groups: ["playful"],
  },
  {
    id: "watercolor-dream",
    title: "Watercolor Dream",
    subtitle: "Botanical wash",
    image: "/experiences/watercolor-dream.webp",
    mode: "advanced",
    groups: ["portraits", "fantasy"],
  },
  {
    id: "noir-world",
    title: "Noir",
    subtitle: "Silver drama",
    image: "/experiences/editorial-noir.webp",
    mode: "advanced",
    groups: ["portraits", "retro"],
  },
];

export function lookById(id: string | null | undefined): Look | undefined {
  if (!id) return undefined;
  return LOOKS.find((look) => look.id === id);
}

export function looksFor(mode: Mode, group?: LookGroup): Look[] {
  return LOOKS.filter(
    (look) => look.mode === mode && (!group || look.groups.includes(group)),
  );
}

export const ADVANCED_GROUPS: { id: LookGroup; title: string }[] = [
  { id: "new", title: "New Worlds" },
  { id: "portraits", title: "Portraits" },
  { id: "playful", title: "Playful" },
  { id: "fantasy", title: "Fantasy" },
  { id: "retro", title: "Retro" },
];
