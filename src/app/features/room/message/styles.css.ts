import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

export const MessageBase = style({
  position: 'relative',
});

// CSS-only hover for action buttons — avoids React state changes on mouse movement.
// The options bar is always in the DOM but hidden; :hover or [data-options-visible]
// makes it visible. This eliminates per-message re-renders on mouseover.
export const MessageOptionsHidden = style({
  visibility: 'hidden',
  pointerEvents: 'none',
  selectors: {
    [`${MessageBase}:hover &, ${MessageBase}:focus-within &, &[data-options-visible="true"]`]: {
      visibility: 'visible',
      pointerEvents: 'auto',
    },
  },
});
export const MessageBaseBubbleCollapsed = style({
  paddingTop: 0,
});

export const MessageOptionsBase = style([
  DefaultReset,
  {
    position: 'absolute',
    top: toRem(-30),
    right: 0,
    zIndex: 1,
  },
]);
export const MessageOptionsBar = style([
  DefaultReset,
  {
    padding: config.space.S100,
  },
]);

export const BubbleAvatarBase = style({
  paddingTop: 0,
});

export const MessageAvatar = style({
  cursor: 'pointer',
});

export const MessageQuickReaction = style({
  minWidth: toRem(32),
});

export const MessageMenuGroup = style({
  padding: config.space.S100,
});

export const MessageMenuItemText = style({
  flexGrow: 1,
});

export const ReactionsContainer = style({
  selectors: {
    '&:empty': {
      display: 'none',
    },
  },
});

export const ReactionsTooltipText = style({
  wordBreak: 'break-word',
});
