import { style } from '@vanilla-extract/css';
import { config, color } from 'folds';

export const NativeDialog = style({
  border: 'none',
  borderRadius: config.radii.R400,
  padding: 0,
  maxWidth: '90vw',
  maxHeight: '90vh',
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  boxShadow: `0 8px 32px ${color.Other.Shadow}`,
  '::backdrop': {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});
