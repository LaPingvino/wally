import { atom } from 'jotai';

export type Persona = {
  displayname: string;
  avatar_url?: string;
  pronouns?: string;
};

// MSC4144 not yet merged — send unstable Beeper key only; read both for forward-compat
export const PER_MSG_PROFILE_KEY = 'm.per_message_profile';
export const PER_MSG_PROFILE_UNSTABLE = 'com.beeper.per_message_profile';

/** Derive a stable grouping id from a persona's displayname. */
export function personaId(p: Persona): string {
  return p.displayname;
}

/** Read per-message profile from event content (stable key preferred). */
export function getPerMsgProfile(
  content: Record<string, unknown>
): { id?: string; displayname?: string; avatar_url?: string; pronouns?: string } | undefined {
  return (content[PER_MSG_PROFILE_KEY] ??
    content[PER_MSG_PROFILE_UNSTABLE]) as
    | { id?: string; displayname?: string; avatar_url?: string; pronouns?: string }
    | undefined;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const STORAGE_ACTIVE = 'wally_active_persona';
const STORAGE_SAVED = 'wally_saved_personas';

const baseActive = atom<Persona | null>(load<Persona | null>(STORAGE_ACTIVE, null));
/** Currently active persona (null = use account profile). Persisted to localStorage. */
export const activePersonaAtom = atom(
  (get) => get(baseActive),
  (_get, set, next: Persona | null) => {
    set(baseActive, next);
    if (next) localStorage.setItem(STORAGE_ACTIVE, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_ACTIVE);
  }
);

const baseSaved = atom<Persona[]>(load<Persona[]>(STORAGE_SAVED, []));
/** All saved personas for quick selection. Persisted to localStorage. */
export const savedPersonasAtom = atom(
  (get) => get(baseSaved),
  (_get, set, next: Persona[]) => {
    set(baseSaved, next);
    localStorage.setItem(STORAGE_SAVED, JSON.stringify(next));
  }
);
