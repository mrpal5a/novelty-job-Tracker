import { describe, expect, it } from 'vitest';
import { companyMatches, normalizeRef } from './trackMatch';

describe('normalizeRef', () => {
  it('keeps only lowercase letters and digits', () => {
    expect(normalizeRef(' ABC-123/25 ')).toBe('abc12325');
  });
});

describe('companyMatches', () => {
  it('accepts the whole first word or more, any case/spacing', () => {
    expect(companyMatches('ARYSTA', 'arysta')).toBe(true);
    expect(companyMatches('DHANUKA - SANAND', 'Dhanuka')).toBe(true);
    expect(companyMatches('DHANUKA - SANAND', 'dhanuka sanand')).toBe(true);
    expect(companyMatches('UPL - 03', 'UPL')).toBe(true);
    expect(companyMatches('PI INDUSTRIES', 'pi industries')).toBe(true);
  });

  it('accepts a longer legal name that starts with our stored name', () => {
    expect(companyMatches('ARYSTA', 'Arysta LifeScience India Ltd')).toBe(true);
    expect(companyMatches('SAFEX', 'Safex Chemicals')).toBe(true);
    expect(companyMatches('ARYSTA', 'Ary Chemicals')).toBe(false);
  });

  it('rejects partial first words and mid-name fragments', () => {
    expect(companyMatches('ARYSTA', 'ar')).toBe(false);
    expect(companyMatches('ARYSTA', 'arys')).toBe(false);
    expect(companyMatches('DHANUKA - SANAND', 'sanand')).toBe(false);
    expect(companyMatches('PI INDUSTRIES', 'in')).toBe(false);
  });

  it('rejects other companies, empty input and missing party', () => {
    expect(companyMatches('SAFEX', 'arysta')).toBe(false);
    expect(companyMatches('ARYSTA', '  ')).toBe(false);
    expect(companyMatches(null, 'arysta')).toBe(false);
  });

  it('still needs 2 characters when the first word is a single letter', () => {
    expect(companyMatches('A1 LABELS', 'a')).toBe(false);
    expect(companyMatches('A1 LABELS', 'a1')).toBe(true);
  });
});
