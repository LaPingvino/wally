import { style } from '@vanilla-extract/css';
import { config, color } from 'folds';

const base = {
  border: 'none',
  borderRadius: config.radii.R400,
  padding: 0,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  boxShadow: `0 8px 32px ${color.Other.Shadow}`,
  '::backdrop': {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
} as const;

/** Default dialog — fits content up to 90vw/90vh */
export const NativeDialog = style({
  ...base,
  maxWidth: '90vw',
  maxHeight: '90vh',
});

/** Fixed-size dialog matching folds Modal size="500" (used by Settings, etc.) */
export const NativeDialog500 = style({
  ...base,
  width: config.size.X600,
  maxWidth: '100vw',
  height: '80vh',
  maxHeight: '100vh',
});
