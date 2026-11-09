export interface SamplePhoto {
  id: string;
  name: string;
  avatarUrl: string;
}

export const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: 'sample-1',
    name: 'Elena (Natural Light)',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=85',
  },
  {
    id: 'sample-2',
    name: 'Marcus (Studio Shade)',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=85',
  },
  {
    id: 'sample-3',
    name: 'Aria (Warm Sunlight)',
    avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=85',
  },
  {
    id: 'sample-4',
    name: 'Kai (Architectural Focus)',
    avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=85',
  },
];
