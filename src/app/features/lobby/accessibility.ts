import { MatrixError } from 'matrix-js-sdk';

// Decide whether a child room listed in the space's m.space.child state
// should be hidden because the user cannot access it.
//
// A child the user has joined is always accessible regardless of what
// /hierarchy returns. Some servers (e.g. Conduwuit/Continuwuity) have
// returned partial /hierarchy responses that omit rooms the user is already
// in; without the `joined` clause, only the rooms the server happened to
// include would appear in the lobby — leaving joined rooms invisible.
export const isInaccessibleChildRoom = (params: {
  inHierarchy: boolean;
  joined: boolean;
  fetching: boolean;
  error: Error | null;
}): boolean => {
  if (params.fetching) return false;
  if (params.inHierarchy) return false;
  if (params.joined) return false;
  if (params.error && !(params.error instanceof MatrixError)) return false;
  if (params.error instanceof MatrixError && params.error.errcode !== 'M_FORBIDDEN') return false;
  return true;
};
