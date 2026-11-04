/**
 * Height map scale read like water depth: deep navy at the bottom, azure in the middle, pale blue at
 * the top. Interpolation happens in RGB, which keeps the ramp monotonic and readable on a dark
 * background.
 */

const STOPS: Array<{ t: number; rgb: [number, number, number] }> = [
  { t: 0, rgb: [9, 24, 64] },
  { t: 0.35, rgb: [13, 71, 161] },
  { t: 0.7, rgb: [34, 176, 214] },
  { t: 1, rgb: [198, 235, 255] },
];

export const HEIGHT_GRADIENT_CSS =
  'linear-gradient(90deg, #091840 0%, #0d47a1 35%, #22b0d6 70%, #c6ebff 100%)';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function heightColor(t: number): string {
  const value = clamp01(Number.isFinite(t) ? t : 0);
  for (let i = 1; i < STOPS.length; i++) {
    const previous = STOPS[i - 1];
    const next = STOPS[i];
    if (value <= next.t) {
      const span = next.t - previous.t || 1;
      const k = (value - previous.t) / span;
      const rgb = previous.rgb.map((channel, index) =>
        Math.round(channel + (next.rgb[index] - channel) * k),
      );
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }
  const last = STOPS[STOPS.length - 1];
  return `rgb(${last.rgb[0]}, ${last.rgb[1]}, ${last.rgb[2]})`;
}
