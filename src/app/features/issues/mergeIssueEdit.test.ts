import { describe, it, expect, vi, afterEach } from 'vitest';
import { confirmIssueMerge, mergeIssueEdit } from './mergeIssueEdit';

const base = { title: 'Bug', status: 'open', assignee: '@a:x', threads: ['$t1'] };

describe('mergeIssueEdit', () => {
  it("keeps a field someone else changed while I edited another (the clobber)", () => {
    const mine = { ...base, title: 'Bug in login' };
    const theirs = { ...base, status: 'done' };
    const { merged, conflicts } = mergeIssueEdit(base, mine, theirs);
    expect(merged).toMatchObject({ title: 'Bug in login', status: 'done' });
    expect(conflicts).toEqual([]);
  });

  it('reports a field both sides changed differently, holding mine', () => {
    const { merged, conflicts } = mergeIssueEdit(base, { ...base, status: 'wip' }, { ...base, status: 'done' });
    expect(conflicts).toEqual(['status']);
    expect(merged.status).toBe('wip');
  });

  it('is no conflict when both made the same change', () => {
    expect(mergeIssueEdit(base, { ...base, status: 'done' }, { ...base, status: 'done' }).conflicts).toEqual([]);
  });

  it('keeps both sides\' thread links', () => {
    const { merged } = mergeIssueEdit(base, { ...base, threads: ['$t1', '$mine'] }, { ...base, threads: ['$t1', '$theirs'] });
    expect(merged.threads).toEqual(['$t1', '$theirs', '$mine']);
  });

  it('keeps fields only they added', () => {
    expect(mergeIssueEdit(base, base, { ...base, priority: 'high' }).merged.priority).toBe('high');
  });

  it('drops a field I cleared', () => {
    const mine: Record<string, unknown> = { ...base };
    delete mine.assignee;
    expect('assignee' in mergeIssueEdit(base, mine, base).merged).toBe(false);
  });

  it('restoring a bare-deleted issue keeps my whole version', () => {
    const { merged } = mergeIssueEdit(base, { ...base, title: 'x' }, { _deleted: true });
    expect(merged).toMatchObject({ ...base, title: 'x', _deleted: true });
  });
});

describe('confirmIssueMerge', () => {
  afterEach(() => vi.restoreAllMocks());
  const schema = { fields: [{ key: 'status', label: 'Status' }] };

  it('throws, naming the field, when the user keeps their version', () => {
    window.confirm = vi.fn().mockReturnValue(false);
    expect(() => confirmIssueMerge(schema, ['status'], base, {})).toThrow(/Status/);
  });

  it('strips the deletion mark when the user restores', () => {
    window.confirm = vi.fn().mockReturnValue(true);
    const merged: Record<string, unknown> = { title: 'x', _deleted: true };
    confirmIssueMerge(schema, [], { _deleted: true }, merged);
    expect(merged._deleted).toBeUndefined();
  });

  it("doesn't ask when nothing conflicts", () => {
    const confirm = vi.fn();
    window.confirm = confirm;
    confirmIssueMerge(schema, [], base, { ...base });
    expect(confirm).not.toHaveBeenCalled();
  });
});
