import { describe, it, expect } from 'vitest';
import { safeRedirect } from './safeRedirect';

describe('safeRedirect', () => {
  it('keeps same-site paths, query and hash', () => {
    expect(safeRedirect('/admin/jobs')).toBe('/admin/jobs');
    expect(safeRedirect('/admin/jobs?stage=qc#top')).toBe('/admin/jobs?stage=qc#top');
  });

  it('falls back when missing', () => {
    expect(safeRedirect(null)).toBe('/admin');
    expect(safeRedirect('')).toBe('/admin');
  });

  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    // Dot-segment normalization to a protocol-relative '//evil.com'
    '/x/..//evil.com',
    '/.//evil.com',
    '/%2e%2e//evil.com',
    '/a/b/../..//evil.com',
    '/admin/..//evil.com/x',
    'http://same-site.invalid//evil.com',
  ])('rejects off-site %s', (raw) => {
    expect(safeRedirect(raw)).toBe('/admin');
  });

  it('returns the normalized path, never the raw input', () => {
    // A raw 'http:evil.com' would leave an https page; the parsed path can't.
    expect(safeRedirect('http:evil.com')).toBe('/evil.com');
  });
});
