import { create } from 'zustand';
import { getStorage } from '../utils';

const storage = getStorage('ai-orb');

export type AiOrbVariant = 'classic' | 'midnight' | 'neon';

export const AI_ORB_VARIANTS: Record<AiOrbVariant, { label: string; desc: string; colors: { bg: string; c1: string; c2: string; c3: string } }> = {
  classic: {
    label: 'Classic',
    desc: 'Vivid aura',
    colors: {
      bg: 'oklch(92% 0.03 264.695)',
      c1: 'oklch(68% 0.22 350)',
      c2: 'oklch(72% 0.20 200)',
      c3: 'oklch(70% 0.22 280)',
    },
  },
  midnight: {
    label: 'Star Duo',
    desc: 'Red & Blue stars',
    colors: {
      bg: '#060606',
      c1: '#ff3e1c',
      c2: '#1c8cff',
      c3: '#060606',
    },
  },
  neon: {
    label: 'Neon Voice',
    desc: 'Voice pulse',
    colors: {
      bg: 'oklch(14% 0.02 145)',
      c1: 'oklch(60% 0.24 145)',
      c2: 'oklch(68% 0.20 155)',
      c3: 'oklch(55% 0.22 142)',
    },
  },
};

export const AI_ORB_GLOW_COLORS: Record<AiOrbVariant, { outer: string; inner: string }> = {
  classic: {
    outer: '#e879f9', // Matching classic pink/magenta aura
    inner: '#38bdf8', // Matching classic sky cyan core
  },
  midnight: {
    outer: '#ff3e1c', // Matching star duo red
    inner: '#1c8cff', // Matching star duo electric blue
  },
  neon: {
    outer: '#4ade80', // Matching neon green
    inner: '#2dd4bf', // Matching neon teal
  },
};

const DEFAULT_VARIANT: AiOrbVariant = 'classic';

interface AiOrbState {
  variant: AiOrbVariant;
  setVariant: (v: AiOrbVariant) => void;
}

export const useAiOrbStore = create<AiOrbState>((set) => {
  let initial: AiOrbVariant = DEFAULT_VARIANT;
  try {
    const saved = storage.getString('aiOrbVariant') as AiOrbVariant | null;
    if (saved && AI_ORB_VARIANTS[saved]) initial = saved;
  } catch {}
  return {
    variant: initial,
    setVariant: (v) => {
      try { storage.set('aiOrbVariant', v); } catch {}
      set({ variant: v });
    },
  };
});
