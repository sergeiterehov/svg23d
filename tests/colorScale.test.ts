import { describe, expect, it } from 'vitest';
import { HEIGHT_GRADIENT_CSS, heightColor } from '@app/components/preview/colorScale';

function channelSum(color: string): number {
  const numbers = color.match(/\d+/g)?.map(Number) ?? [];
  return numbers.reduce((sum, value) => sum + value, 0);
}

describe('height colour scale', () => {
  it('goes deep navy → azure → pale blue, like water depth', () => {
    expect(heightColor(0)).toBe('rgb(9, 24, 64)');
    expect(heightColor(0.35)).toBe('rgb(13, 71, 161)');
    expect(heightColor(0.7)).toBe('rgb(34, 176, 214)');
    expect(heightColor(1)).toBe('rgb(198, 235, 255)');
  });

  it('gets lighter and bluer towards the top', () => {
    const samples = [0, 0.35, 0.7, 1].map((t) => heightColor(t).match(/\d+/g)!.map(Number));
    for (let i = 1; i < samples.length; i += 1) {
      const [r, g, b] = samples[i]!;
      // Every stop is brighter than the previous one, and blue stays the dominant channel.
      expect(r + g + b).toBeGreaterThan(samples[i - 1]!.reduce((sum, v) => sum + v, 0));
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
    }
  });

  it('interpolates and stays monotonic in brightness', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => channelSum(heightColor(t)));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it('clamps out-of-range values', () => {
    expect(heightColor(-5)).toBe('rgb(9, 24, 64)');
    expect(heightColor(5)).toBe('rgb(198, 235, 255)');
    expect(heightColor(Number.NaN)).toBe('rgb(9, 24, 64)');
  });

  it('keeps the CSS legend in sync with the stops', () => {
    expect(HEIGHT_GRADIENT_CSS).toContain('#091840');
    expect(HEIGHT_GRADIENT_CSS).toContain('#0d47a1');
    expect(HEIGHT_GRADIENT_CSS).toContain('#22b0d6');
    expect(HEIGHT_GRADIENT_CSS).toContain('#c6ebff');
  });
});
