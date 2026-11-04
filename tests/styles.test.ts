import { describe, expect, it } from 'vitest';
import { normalizeColor, parseCssRules, parseStyleAttribute } from '@core/svg/styles';

describe('colour normalisation', () => {
  it('handles hex in all lengths', () => {
    expect(normalizeColor('#fff')).toBe('#ffffff');
    expect(normalizeColor('#e44d26')).toBe('#e44d26');
    expect(normalizeColor('#e44d26ff')).toBe('#e44d26');
  });

  it('handles rgb/rgba and hsl', () => {
    expect(normalizeColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(normalizeColor('rgba(0,0,0,0.5)')).toBe('#000000');
    expect(normalizeColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
  });

  it('handles keywords and currentColor', () => {
    expect(normalizeColor('none')).toBe('none');
    expect(normalizeColor('transparent')).toBe('none');
    expect(normalizeColor('red')).toBe('#ff0000');
    expect(normalizeColor('currentColor', '#123456')).toBe('#123456');
  });
});

describe('style parsing', () => {
  it('parses inline declarations', () => {
    expect(parseStyleAttribute('fill: #fff; stroke:none')).toEqual({
      fill: '#fff',
      stroke: 'none',
    });
  });

  it('parses css rules with simple selectors', () => {
    const rules = parseCssRules('.cls-1{fill:#e44d26} path{fill:none} #special{fill:#000}');
    expect(rules).toHaveLength(3);
    expect(rules[0].selectors).toEqual(['.cls-1']);
    expect(rules[0].declarations.fill).toBe('#e44d26');
  });
});
