import { describe, expect, it } from 'vitest';
import { HEIGHT_GRADIENT_CSS, heightColor } from '@app/components/preview/colorScale';

function channelSum(color: string): number {
  const numbers = color.match(/\d+/g)?.map(Number) ?? [];
  return numbers.reduce((sum, value) => sum + value, 0);
}

describe('height colour scale', () => {
  it('goes black → red → yellow → white', () => {
    expect(heightColor(0)).toBe('rgb(0, 0, 0)');
    expect(heightColor(1 / 3)).toBe('rgb(255, 26, 26)');
    expect(heightColor(2 / 3)).toBe('rgb(255, 214, 10)');
    expect(heightColor(1)).toBe('rgb(255, 255, 255)');
  });

  it('interpolates and stays monotonic in brightness', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => channelSum(heightColor(t)));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it('clamps out-of-range values', () => {
    expect(heightColor(-5)).toBe('rgb(0, 0, 0)');
    expect(heightColor(5)).toBe('rgb(255, 255, 255)');
    expect(heightColor(Number.NaN)).toBe('rgb(0, 0, 0)');
  });

  it('keeps the CSS legend in sync with the stops', () => {
    expect(HEIGHT_GRADIENT_CSS).toContain('#000000');
    expect(HEIGHT_GRADIENT_CSS).toContain('#ff1a1a');
    expect(HEIGHT_GRADIENT_CSS).toContain('#ffd60a');
    expect(HEIGHT_GRADIENT_CSS).toContain('#ffffff');
  });
});
