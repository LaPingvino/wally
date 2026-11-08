import { describe, it, expect } from 'vitest';
import { breakoutEndpointProblem, isOwnServerHost } from '../BreakoutPanel';

describe('breakout endpoint checks', () => {
  it('accepts https only', () => {
    expect(breakoutEndpointProblem('https://kiefte.eu/wally-conference')).toBeNull();
    expect(breakoutEndpointProblem('http://kiefte.eu/wally-conference')).not.toBeNull();
    expect(breakoutEndpointProblem('javascript:alert(1)')).not.toBeNull();
    expect(breakoutEndpointProblem('not a url')).not.toBeNull();
  });

  it("treats the user's own server domain and its subdomains as home", () => {
    expect(isOwnServerHost('kiefte.eu', 'kiefte.eu')).toBe(true);
    expect(isOwnServerHost('cinny.kiefte.eu', 'kiefte.eu')).toBe(true);
    expect(isOwnServerHost('cinny.kiefte.eu', 'kiefte.eu:8448')).toBe(true);
    expect(isOwnServerHost('evilkiefte.eu', 'kiefte.eu')).toBe(false);
    expect(isOwnServerHost('kiefte.eu.evil.example', 'kiefte.eu')).toBe(false);
    expect(isOwnServerHost('kiefte.eu', null)).toBe(false);
  });
});
