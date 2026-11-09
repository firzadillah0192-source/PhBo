import { create } from "zustand";
import type { Mode } from "./catalog";

export type Mood =
  | "home"
  | "gallery"
  | "capture"
  | "review"
  | "process"
  | "result";

export type ProcessState =
  | "idle"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type HoverMode = Mode | null;

type StudioState = {
  mode: Mode | null;
  selectedId: string | null;
  photoDataUrl: string | null;
  resultDataUrl: string | null;
  processState: ProcessState;
  processMessage: string;
  hoverMode: HoverMode;
  mood: Mood;
  accountOpen: boolean;
  menuOpen: boolean;
  error: string | null;
  setMode: (mode: Mode | null) => void;
  selectLook: (id: string, mode: Mode) => void;
  setPhoto: (dataUrl: string | null) => void;
  setResult: (dataUrl: string | null) => void;
  setProcess: (state: ProcessState, message?: string) => void;
  setHoverMode: (mode: HoverMode) => void;
  setMood: (mood: Mood) => void;
  setAccountOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  setError: (error: string | null) => void;
  resetJourney: () => void;
  keepPhotoNewLook: () => void;
};

const SESSION_KEY = "pb-session";

function readSession(): Partial<StudioState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<StudioState>;
  } catch {
    return {};
  }
}

function writeSession(state: StudioState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        mode: state.mode,
        selectedId: state.selectedId,
        photoDataUrl: state.photoDataUrl,
        resultDataUrl: state.resultDataUrl,
      }),
    );
  } catch {
    /* quota exceeded — keep memory only */
  }
}

export const useStudio = create<StudioState>((set, get) => ({
  mode: null,
  selectedId: null,
  photoDataUrl: null,
  resultDataUrl: null,
  processState: "idle",
  processMessage: "",
  hoverMode: null,
  mood: "home",
  accountOpen: false,
  menuOpen: false,
  error: null,
  setMode: (mode) => {
    set({ mode });
    writeSession(get());
  },
  selectLook: (id, mode) => {
    set({ selectedId: id, mode, error: null, resultDataUrl: null });
    writeSession(get());
  },
  setPhoto: (dataUrl) => {
    set({ photoDataUrl: dataUrl, resultDataUrl: null, error: null });
    writeSession(get());
  },
  setResult: (dataUrl) => {
    set({ resultDataUrl: dataUrl });
    writeSession(get());
  },
  setProcess: (processState, processMessage = "") =>
    set({ processState, processMessage }),
  setHoverMode: (hoverMode) => set({ hoverMode }),
  setMood: (mood) => set({ mood }),
  setAccountOpen: (accountOpen) => set({ accountOpen, menuOpen: false }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setError: (error) => set({ error }),
  resetJourney: () => {
    set({
      selectedId: null,
      photoDataUrl: null,
      resultDataUrl: null,
      processState: "idle",
      processMessage: "",
      error: null,
    });
    writeSession(get());
  },
  keepPhotoNewLook: () => {
    set({
      selectedId: null,
      resultDataUrl: null,
      processState: "idle",
      processMessage: "",
      error: null,
    });
    writeSession(get());
  },
}));

function restoreSession() {
  const saved = readSession();
  if (!saved.selectedId && !saved.photoDataUrl && !saved.resultDataUrl) return;
  useStudio.setState({
    mode: saved.mode ?? null,
    selectedId: saved.selectedId ?? null,
    photoDataUrl: saved.photoDataUrl ?? null,
    resultDataUrl: saved.resultDataUrl ?? null,
  });
}

if (typeof window !== "undefined") {
  restoreSession();
}

type QuotaState = {
  credits: number;
  joined: boolean;
  name: string | null;
  hydrated: boolean;
  hydrate: () => void;
  join: (name: string) => void;
  spend: () => boolean;
};

const QUOTA_KEY = "pb-quota";
const ANON_CREDITS = 2;
const JOIN_CREDITS = 5;

export const useQuota = create<QuotaState>((set, get) => ({
  credits: ANON_CREDITS,
  joined: false,
  name: null,
  hydrated: false,
  hydrate: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(QUOTA_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          credits?: number;
          joined?: boolean;
          name?: string | null;
        };
        set({
          credits:
            typeof parsed.credits === "number" ? parsed.credits : ANON_CREDITS,
          joined: Boolean(parsed.joined),
          name: parsed.name ?? null,
          hydrated: true,
        });
        return;
      }
    } catch {
      /* ignore */
    }
    set({ hydrated: true });
  },
  join: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = {
      joined: true,
      name: trimmed,
      credits: get().joined ? get().credits : JOIN_CREDITS,
      hydrated: true,
    };
    set(next);
    try {
      localStorage.setItem(
        QUOTA_KEY,
        JSON.stringify({
          credits: next.credits,
          joined: next.joined,
          name: next.name,
        }),
      );
    } catch {
      /* ignore */
    }
  },
  spend: () => {
    const { credits, joined, name } = get();
    if (credits < 1) return false;
    const next = credits - 1;
    set({ credits: next });
    try {
      localStorage.setItem(
        QUOTA_KEY,
        JSON.stringify({ credits: next, joined, name }),
      );
    } catch {
      /* ignore */
    }
    return true;
  },
}));
