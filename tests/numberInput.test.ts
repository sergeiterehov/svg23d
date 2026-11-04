// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseDelta, parseNumber } from '@app/components/common/NumberField';

describe('parseNumber', () => {
  it('accepts plain and decimal-comma numbers', () => {
    expect(parseNumber('12')).toBe(12);
    expect(parseNumber(' 12.5 ')).toBe(12.5);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('-3')).toBe(-3);
  });

  it('rejects anything that is not a number', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('+')).toBeNull();
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
    expect(parseNumber('1 мм')).toBeNull();
  });
});

describe('parseDelta', () => {
  it('treats a signed value as a relative change', () => {
    expect(parseDelta('+2')).toBe(2);
    expect(parseDelta('-2')).toBe(-2);
    expect(parseDelta('+0,5')).toBe(0.5);
  });

  it('ignores values without an explicit sign', () => {
    expect(parseDelta('2')).toBeNull();
    expect(parseDelta('')).toBeNull();
    expect(parseDelta('+')).toBeNull();
    expect(parseDelta('+abc')).toBeNull();
  });
});
