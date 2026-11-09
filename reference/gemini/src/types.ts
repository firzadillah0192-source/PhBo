export type AppMode = 'home' | 'basic' | 'advanced';

export type AppStep = 'home' | 'gallery' | 'capture' | 'review' | 'processing' | 'result';

export interface StudioTemplate {
  id: string;
  title: string;
  subtitle: string;
  category: 'Studio' | 'Film' | 'Monochrome' | 'Colorway';
  previewImage: string;
  description: string;
  aspectRatio: '3:4' | '1:1' | '9:16';
  frameStyle: 'minimal' | 'filmstrip' | 'polaroid' | 'gallery-white';
  filterStyle: {
    brightness: number;
    contrast: number;
    saturation: number;
    sepia: number;
    blur?: number;
    grain?: number;
    tint?: string;
  };
}

export interface AIExperience {
  id: string;
  title: string;
  tagline: string;
  category: 'Featured' | 'New Worlds' | 'Portraits' | 'Playful' | 'Fantasy' | 'Retro';
  previewImage: string;
  heroImage?: string;
  accentColor: string;
  badge?: string;
  transformationType: 
    | 'cinematic-hero'
    | 'mini-me'
    | 'action-figure'
    | 'fantasy-portrait'
    | 'avatar-3d'
    | 'magazine-cover'
    | 'retro-80s'
    | 'pixel-world'
    | 'sci-fi'
    | 'nature-fantasy';
}

export interface UserPhoto {
  dataUrl: string;
  source: 'webcam' | 'upload' | 'sample';
  timestamp: number;
}

export interface GenerationResult {
  id: string;
  imageUrl: string;
  originalPhotoUrl: string;
  experienceTitle: string;
  mode: 'basic' | 'advanced';
  createdAt: number;
}

export interface QuotaState {
  aiCredits: number;
  totalGenerated: number;
  isRegistered: boolean;
}
