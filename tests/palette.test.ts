import { describe, expect, it } from 'vitest';
import { hexToOklab, oklabToHex, paletteUsage, reducePalette } from '@core/color/palette';

const entry = (color: string, weight = 1) => ({ color, weight });

describe('OKLab', () => {
  it('round-trips hex colours', () => {
    for (const hex of ['#000000', '#ffffff', '#4caf50', '#f5c542', '#6d4c41', '#123456']) {
      expect(oklabToHex(hexToOklab(hex)!)).toBe(hex);
    }
  });

  it('rejects values that are not plain hex colours', () => {
    expect(hexToOklab('none')).toBeNull();
    expect(hexToOklab('#abc')).toBeNull();
  });

  it('measures distance perceptually: two greens differ more than two blues', () => {
    const distance = (a: string, b: string): number => {
      const [x, y] = [hexToOklab(a)!, hexToOklab(b)!];
      return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    };
    // Same numeric step in sRGB, very different perceptual weight.
    expect(distance('#00ff00', '#00e000')).toBeGreaterThan(distance('#0000ff', '#0000e0'));
  });
});

describe('reducePalette', () => {
  it('keeps every colour when the limit is not smaller than the palette', () => {
    const result = reducePalette([entry('#ff0000'), entry('#00ff00')], 5);
    expect(result.mapping.get('#ff0000')).toBe('#ff0000');
    expect(result.mapping.get('#00ff00')).toBe('#00ff00');
    expect(result.palette).toHaveLength(2);
    expect(result.deviation).toBe(0);
  });

  it('merges the two closest colours first', () => {
    const result = reducePalette(
      [entry('#202020', 100), entry('#242424', 10), entry('#00ff00', 5)],
      2,
    );
    expect(result.mapping.get('#202020')).toBe(result.mapping.get('#242424'));
    expect(result.mapping.get('#00ff00')).not.toBe(result.mapping.get('#202020'));
    expect(result.palette).toHaveLength(2);
  });

  it('reduces a six-colour palette to the requested number', () => {
    const result = reducePalette(
      [
        entry('#bfe3f7', 30000),
        entry('#f5c542', 1000),
        entry('#4caf50', 9000),
        entry('#6d4c41', 320),
        entry('#2ecc71', 1600),
        entry('#27ae60', 500),
      ],
      2,
    );
    expect(result.palette).toHaveLength(2);
    expect(new Set(result.mapping.values()).size).toBe(2);
    // Every original colour still resolves to one of the two kept colours.
    for (const kept of result.mapping.values()) {
      expect(result.palette.map((cluster) => cluster.color)).toContain(kept);
    }
  });

  it('pulls a centroid towards the heavier colour', () => {
    const light = reducePalette([entry('#000000', 1000), entry('#ffffff', 1)], 1);
    const [only] = hexToOklab(light.palette[0]!.color)!;
    expect(only).toBeLessThan(0.3);

    const dark = reducePalette([entry('#000000', 1), entry('#ffffff', 1000)], 1);
    const [onlyDark] = hexToOklab(dark.palette[0]!.color)!;
    expect(onlyDark).toBeGreaterThan(0.7);
  });

  it('never returns more clusters than distinct colours', () => {
    const result = reducePalette([entry('#ff0000'), entry('#ff0000'), entry('#00ff00')], 8);
    expect(result.palette).toHaveLength(2);
  });

  it('leaves colours it cannot parse untouched', () => {
    const result = reducePalette([entry('none'), entry('#ff0000'), entry('#fe0000')], 1);
    expect(result.mapping.get('none')).toBe('none');
    expect(result.mapping.get('#ff0000')).toBe(result.mapping.get('#fe0000'));
    expect(result.palette).toHaveLength(1);
  });

  it('is deterministic', () => {
    const entries = [
      entry('#bfe3f7', 30000),
      entry('#f5c542', 1000),
      entry('#4caf50', 9000),
      entry('#6d4c41', 320),
    ];
    const first = reducePalette(entries, 2);
    const second = reducePalette(entries, 2);
    expect([...first.mapping.entries()]).toEqual([...second.mapping.entries()]);
    expect(first.deviation).toBeCloseTo(second.deviation, 12);
  });
});

describe('paletteUsage', () => {
  it('weights colours by the area they cover', () => {
    const square = (size: number) => [
      [
        { x: 0, y: 0 },
        { x: size, y: 0 },
        { x: size, y: size },
        { x: 0, y: size },
      ],
    ];
    const usage = paletteUsage([
      { color: '#ff0000', contours: square(10) },
      { color: '#ff0000', contours: square(10) },
      { color: '#00ff00', contours: square(2) },
    ]);
    expect(usage).toEqual([
      { color: '#ff0000', weight: 200 },
      { color: '#00ff00', weight: 4 },
    ]);
  });
});
