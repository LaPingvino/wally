/**
 * Three-way merge for an issue edit (audit 2026-11-08).
 *
 * An issue is one state event, and a save replaces it whole. The form saved the content as it
 * was when the form OPENED plus your edits, so anything someone else changed meanwhile — another
 * field, a thread linked from their side — was silently put back. Now:
 *   base   = the issue when the form opened
 *   mine   = what the form holds
 *   theirs = the issue as the room has it at save time
 * A field only you changed takes yours; a field only they changed keeps theirs; a field you both
 * changed differently is a conflict the caller asks about. `threads` (links to comment threads)
 * is a set: both sides' links are kept.
 */
export type IssueFields = Record<string, unknown>;

export type IssueMerge = {
  merged: IssueFields;
  /** Fields both sides changed to different values; `merged` holds mine for them. */
  conflicts: string[];
};

const SET_FIELDS = new Set(['threads']);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function union(a: unknown, b: unknown): unknown[] {
  const out: unknown[] = [];
  [a, b].forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((x) => {
      if (!out.some((y) => same(x, y))) out.push(x);
    });
  });
  return out;
}

export function mergeIssueEdit(base: IssueFields, mine: IssueFields, theirs: IssueFields | undefined): IssueMerge {
  if (!theirs) return { merged: { ...mine }, conflicts: [] };
  // Deleted meanwhile (the widget deletes to a bare {_deleted: true}): there's nothing of theirs
  // to keep, so a restore is my whole version. confirmIssueMerge asks and strips the mark.
  if (theirs._deleted) return { merged: { ...mine, _deleted: true }, conflicts: [] };
  const merged: IssueFields = { ...theirs };
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(mine)]);
  keys.forEach((k) => {
    const iChanged = !same(mine[k], base[k]);
    const theyChanged = !same(theirs[k], base[k]);
    if (SET_FIELDS.has(k)) {
      merged[k] = union(theirs[k], mine[k]);
      return;
    }
    if (!iChanged) return; // theirs (possibly unchanged) stays
    if (theyChanged && !same(mine[k], theirs[k])) conflicts.push(k);
    if (mine[k] === undefined) delete merged[k];
    else merged[k] = mine[k];
  });
  return { merged, conflicts };
}

/**
 * Throws (keeping the form open, with the message) unless the user agrees to overwrite fields
 * someone else changed while they edited, or to restore an issue someone deleted meanwhile.
 * Strips the deletion mark when they agree to restore.
 */
export function confirmIssueMerge(
  schema: { fields: { key: string; label?: string }[] } | null | undefined,
  conflicts: string[],
  theirs: Record<string, unknown> | undefined,
  merged: Record<string, unknown>,
): void {
  if (theirs?._deleted) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Someone deleted this issue while you were editing it. Save your version and restore it?')) {
      throw new Error('Not saved: the issue was deleted meanwhile.');
    }
    // eslint-disable-next-line no-param-reassign
    delete merged._deleted;
  }
  if (conflicts.length === 0) return;
  const label = (k: string) => schema?.fields.find((f) => f.key === k)?.label ?? k;
  const names = conflicts.map(label).join(', ');
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Someone else also changed ${names} while you were editing. Overwrite with your version?`)) {
    throw new Error(`Not saved: ${names} changed meanwhile. Close and reopen the issue to see their version.`);
  }
}
