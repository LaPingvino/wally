import { style, keyframes } from '@vanilla-extract/css';
import { config } from 'folds';

// Slow pulse for a room whose data hasn't live-synced yet (see useRoomHydration).
// Distinct from the Cinny unread dot — it's the NAME gently breathing, signalling
// "still loading". Respects reduced-motion (no animation).
const RoomLoadingPulse = keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.45 },
  '100%': { opacity: 1 },
});
export const RoomLoadingName = style({
  animation: `${RoomLoadingPulse} 1.8s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      opacity: 0.6,
    },
  },
});

export const CategoryButton = style({
  flexGrow: 1,
});
export const CategoryButtonIcon = style({
  opacity: config.opacity.P400,
});
