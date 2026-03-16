import { atom } from 'jotai';

export type Persona = {
  displayname: string;
  /** mxc:// URI stored on the homeserver */
  avatar_url?: string;
  /** Original https:// URL cached for round-trip export compatibility */
  avatar_http?: string;
  pronouns?: string;
  /** Trigger prefixes for this persona (e.g. ["A:", "alex:"]). Multiple allowed. */
  prefixes?: string[];
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

/**
 * Check if a message text starts with any of a persona's prefixes.
 * Returns the matched prefix and stripped text, or null if no match.
 */
export function matchPersonaPrefix(
  text: string,
  savedPersonas: Persona[]
): { persona: Persona; prefix: string; stripped: string } | null {
  for (const p of savedPersonas) {
    for (const prefix of p.prefixes ?? []) {
      if (!prefix) continue;
      if (text.startsWith(prefix)) {
        return { persona: p, prefix, stripped: text.slice(prefix.length).trimStart() };
      }
    }
  }
  return null;
}

/**
 * Strip a literal text prefix from the start of Matrix custom HTML.
 * Handles both bare text and text following opening block tags (e.g. <p>).
 */
export function stripHtmlPrefix(html: string, prefix: string): string {
  const idx = html.indexOf(prefix);
  if (idx === -1) return html;
  // Only strip if everything before the prefix is HTML tags (no visible text)
  const before = html.slice(0, idx);
  if (before.replace(/<[^>]*>/g, '') !== '') return html;
  return before + html.slice(idx + prefix.length).replace(/^\s+/, '');
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
const STORAGE_PREFIX_STICKY = 'wally_prefix_sticky';

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

const basePrefixSticky = atom<boolean>(load<boolean>(STORAGE_PREFIX_STICKY, false));
/**
 * Prefix sticky mode.
 * - false (default): prefix applies only to the message it's typed on (temporary override).
 * - true: prefix switches the active persona persistently; use \ to escape one message,
 *   \\ to permanently reset back to no active persona.
 */
export const prefixStickyAtom = atom(
  (get) => get(basePrefixSticky),
  (_get, set, next: boolean) => {
    set(basePrefixSticky, next);
    if (next) localStorage.setItem(STORAGE_PREFIX_STICKY, 'true');
    else localStorage.removeItem(STORAGE_PREFIX_STICKY);
  }
);

// ── PluralKit import / export ─────────────────────────────────────────────────

type PluralKitProxyTag = { prefix?: string; suffix?: string };
type PluralKitMember = {
  name?: string;
  display_name?: string | null;
  /** https:// URL for PluralKit compatibility */
  avatar_url?: string | null;
  /** mxc:// URL preserved for round-trip (custom field, ignored by PluralKit) */
  avatar_mxc?: string | null;
  pronouns?: string | null;
  proxy_tags?: PluralKitProxyTag[];
};
type PluralKitSystem = { members?: PluralKitMember[] };

/**
 * Convert our Persona list to a PluralKit-compatible JSON array.
 * @param mxcToHttp - optional converter; converts mxc:// → https:// for avatar_url.
 *   Pass `(mxc) => mx.mxcUrlToHttp(mxc)` from a component that has the Matrix client.
 */
export function exportPersonasToPluralKit(
  personas: Persona[],
  mxcToHttp?: (mxc: string) => string | null
): string {
  const members = personas.map((p) => {
    const mxc = p.avatar_url?.startsWith('mxc://') ? p.avatar_url : undefined;
    // Prefer cached original https URL, then homeserver conversion, then raw avatar_url
    const http = p.avatar_http ?? (mxc && mxcToHttp ? (mxcToHttp(mxc) ?? null) : (p.avatar_url ?? null));
    return {
      name: p.displayname,
      display_name: null,
      avatar_url: http,
      ...(mxc ? { avatar_mxc: mxc } : {}),
      pronouns: p.pronouns ?? null,
      proxy_tags: (p.prefixes ?? []).map((pfx) => ({ prefix: pfx, suffix: '' })),
    };
  });
  return JSON.stringify(members, null, 2);
}

/** Parse PluralKit JSON (system export or members array) or our own format into Personas.
 *  Returns personas where avatar_url is the mxc:// URI if available (avatar_mxc field),
 *  otherwise the raw avatar_url (https:// — caller should upload to mxc).
 */
export function importPersonasFromJson(json: string): Persona[] {
  const raw = JSON.parse(json) as unknown;
  let members: PluralKitMember[] = [];

  if (Array.isArray(raw)) {
    members = raw as PluralKitMember[];
  } else if (raw && typeof raw === 'object') {
    const sys = raw as PluralKitSystem;
    if (Array.isArray(sys.members)) {
      members = sys.members;
    }
  }

  return members
    .map((m): Persona | null => {
      const displayname = (m.display_name || m.name || '').trim();
      if (!displayname) return null;
      const prefixes = (m.proxy_tags ?? [])
        .filter((t) => t.prefix && !t.suffix)
        .map((t) => t.prefix as string);
      // Prefer mxc:// (our custom round-trip field) over https:// avatar_url
      const avatarUrl = m.avatar_mxc || m.avatar_url || undefined;
      // Cache the https URL for round-trip export (prefer avatar_url if it's https)
      const avatarHttp = m.avatar_url?.startsWith('http') ? m.avatar_url : undefined;
      return {
        displayname,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        ...(avatarHttp ? { avatar_http: avatarHttp } : {}),
        ...(m.pronouns ? { pronouns: m.pronouns } : {}),
        ...(prefixes.length > 0 ? { prefixes } : {}),
      };
    })
    .filter((p): p is Persona => p !== null);
}
