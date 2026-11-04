/**
 * Temperature-like colour scale for the 2D height map: cold (low) → hot (high).
 * Stops are interpolated in RGB, which is stable and readable on light backgrounds.
 */

const STOPS: Array<{ t: number; rgb: [number, number, number] }> = [
  { t: 0, rgb: [37, 99, 235] }, // #2563eb
  { t: 0.25, rgb: [6, 182, 212] }, // #06b6d4
  { t: 0.5, rgb: [34, 197, 94] }, // #22c55e
  { t: 0.75, rgb: [245, 158, 11] }, // #f59e0b
  { t: 1, rgb: [239, 68, 68] }, // #ef4444
];

export const HEIGHT_GRADIENT_CSS =
  'linear-gradient(90deg, #2563eb 0%, #06b6d4 25%, #22c55e 50%, #f59e0b 75%, #ef4444 100%)';

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
