import type { FillRule } from '../model/types';

/**
 * Colour and style cascade.
 *
 * Precedence (low → high): inherited value < tag selector < class selector < id selector
 * < presentation attribute < inline `style`. `<style>` blocks are supported with simple
 * selectors (tag / .class / #id, combined in a single compound), covering the CSS that
 * vector editors emit on export.
 */

export interface StyleState {
  fill: string;
  fillRule: FillRule;
  visible: boolean;
  opacity: number;
  color: string;
  /** Stroke paint: `#rrggbb`, or `'none'`. */
  stroke: string;
  strokeWidth: number;
  linecap: 'butt' | 'round' | 'square';
  linejoin: 'miter' | 'round' | 'bevel';
  /** Convenience flag: stroke is painted and has a positive width. */
  hasStroke: boolean;
}

export const ROOT_STYLE: StyleState = {
  fill: '#000000',
  fillRule: 'nonzero',
  visible: true,
  opacity: 1,
  color: '#000000',
  stroke: 'none',
  strokeWidth: 1,
  linecap: 'butt',
  linejoin: 'miter',
  hasStroke: false,
};

export interface CssRule {
  selectors: string[];
  declarations: Record<string, string>;
  order: number;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
  brown: '#a52a2a',
  pink: '#ffc0cb',
  gold: '#ffd700',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  crimson: '#dc143c',
  salmon: '#fa8072',
  coral: '#ff7f50',
  tomato: '#ff6347',
  violet: '#ee82ee',
  indigo: '#4b0082',
  turquoise: '#40e0d0',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  royalblue: '#4169e1',
  darkgreen: '#006400',
  seagreen: '#2e8b57',
  forestgreen: '#228b22',
  emerald: '#50c878',
  darkblue: '#00008b',
  slategray: '#708090',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
};

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => clampByte(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return toHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/** Normalises a CSS colour to `#rrggbb` or `'none'`. Unknown values become black. */
export function normalizeColor(input: string | null | undefined, currentColor = '#000000'): string {
  if (!input) return currentColor;
  const value = input.trim().toLowerCase();
  if (value === '' || value === 'inherit') return currentColor;
  if (value === 'none' || value === 'transparent') return 'none';
  if (value === 'currentcolor') return currentColor;

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b] = hex.split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
    return currentColor;
  }

  const fnMatch = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(value);
  if (fnMatch) {
    const nums = (fnMatch[2] ?? '')
      .split(/[,\s/]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (fnMatch[1].startsWith('rgb')) {
      const channel = (raw: string): number =>
        raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw);
      return toHex(channel(nums[0] ?? '0'), channel(nums[1] ?? '0'), channel(nums[2] ?? '0'));
    }
    const hue = Number.parseFloat(nums[0] ?? '0');
    const sat = Number.parseFloat((nums[1] ?? '0').replace('%', '')) / 100;
    const light = Number.parseFloat((nums[2] ?? '0').replace('%', '')) / 100;
    return hslToHex(hue, sat, light);
  }

  return NAMED_COLORS[value] ?? currentColor;
}

/** Parses an inline `style="a:b; c:d"` attribute. */
export function parseStyleAttribute(raw: string | null | undefined): Record<string, string> {
  const declarations: Record<string, string> = {};
  if (!raw) return declarations;
  for (const chunk of raw.split(';')) {
    const index = chunk.indexOf(':');
    if (index < 0) continue;
    const name = chunk.slice(0, index).trim().toLowerCase();
    const value = chunk.slice(index + 1).trim();
    if (name) declarations[name] = value;
  }
  return declarations;
}

/** Parses the content of `<style>` elements (simple selectors only). */
export function parseCssRules(cssText: string): CssRule[] {
  const rules: CssRule[] = [];
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let order = 0;
  while ((match = ruleRe.exec(withoutComments)) !== null) {
    const selectorText = match[1] ?? '';
    const declarationText = match[2] ?? '';
    const selectors = selectorText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('@'));
    if (selectors.length === 0) continue;
    rules.push({ selectors, declarations: parseStyleAttribute(declarationText), order: order++ });
  }
  return rules;
}

interface CompoundSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
}

function parseSelector(selector: string): CompoundSelector | null {
  const trimmed = selector.trim();
  // Only the right-most compound is considered; ancestors are ignored (documented limitation).
  const last = trimmed.split(/\s+/).pop() ?? '';
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(last);
  const idMatch = /#([\w-]+)/.exec(last);
  const classes = Array.from(last.matchAll(/\.([\w-]+)/g)).map((m) => m[1]);
  if (!tagMatch && !idMatch && classes.length === 0) return null;
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    id: idMatch ? idMatch[1] : null,
    classes,
  };
}

function matchesSelector(element: Element, selector: CompoundSelector): boolean {
  if (selector.tag && element.tagName.toLowerCase() !== selector.tag) return false;
  if (selector.id && element.getAttribute('id') !== selector.id) return false;
  if (selector.classes.length > 0) {
    const classes = (element.getAttribute('class') ?? '').split(/\s+/);
    for (const cls of selector.classes) {
      if (!classes.includes(cls)) return false;
    }
  }
  return true;
}

function specificity(selector: CompoundSelector): number {
  return (selector.id ? 100 : 0) + selector.classes.length * 10 + (selector.tag ? 1 : 0);
}

/** Declarations from `<style>` blocks applicable to the element, ordered by specificity. */
export function cssDeclarationsFor(element: Element, rules: CssRule[]): Record<string, string> {
  const matches: Array<{ score: number; order: number; declarations: Record<string, string> }> = [];
  for (const rule of rules) {
    for (const selectorText of rule.selectors) {
      const selector = parseSelector(selectorText);
      if (!selector) continue;
      if (matchesSelector(element, selector)) {
        matches.push({ score: specificity(selector), order: rule.order, declarations: rule.declarations });
        break;
      }
    }
  }
  matches.sort((a, b) => a.score - b.score || a.order - b.order);
  const merged: Record<string, string> = {};
  for (const match of matches) Object.assign(merged, match.declarations);
  return merged;
}

const PRESENTATION_ATTRIBUTES = [
  'fill',
  'fill-rule',
  'color',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'display',
  'visibility',
  'opacity',
  'fill-opacity',
  'stop-color',
];

/** Resolves the style of an element given its parent's resolved style. */
export function resolveElementStyle(
  element: Element,
  inherited: StyleState,
  rules: CssRule[],
): StyleState {
  const css = cssDeclarationsFor(element, rules);
  const style = parseStyleAttribute(element.getAttribute('style'));

  const lookup = (name: string): string | undefined =>
    style[name] ??
    css[name] ??
    (PRESENTATION_ATTRIBUTES.includes(name) ? (element.getAttribute(name) ?? undefined) : undefined);

  const color = normalizeColor(lookup('color') ?? inherited.color, inherited.color);

  const fillRaw = lookup('fill');
  const fill = fillRaw === undefined ? inherited.fill : normalizeColor(fillRaw, color);

  const fillRuleRaw = (lookup('fill-rule') ?? '').toLowerCase();
  const fillRule: FillRule = fillRuleRaw === 'evenodd' ? 'evenodd' : fillRuleRaw === 'nonzero' ? 'nonzero' : inherited.fillRule;

  const display = (lookup('display') ?? '').toLowerCase();
  const visibility = (lookup('visibility') ?? '').toLowerCase();
  const visible = inherited.visible && display !== 'none' && visibility !== 'hidden';

  const opacityRaw = lookup('opacity');
  const opacity = opacityRaw === undefined ? inherited.opacity : clamp01(Number.parseFloat(opacityRaw));
  const fillOpacityRaw = lookup('fill-opacity');
  const fillOpacity = fillOpacityRaw === undefined ? 1 : clamp01(Number.parseFloat(fillOpacityRaw));

  const strokeRaw = lookup('stroke');
  const stroke = strokeRaw === undefined ? inherited.stroke : normalizeColor(strokeRaw, color);

  const strokeWidthRaw = lookup('stroke-width');
  const strokeWidth =
    strokeWidthRaw === undefined
      ? inherited.strokeWidth
      : parseLength(strokeWidthRaw, inherited.strokeWidth);
  const strokeOpacityRaw = lookup('stroke-opacity');
  const strokeOpacity =
    strokeOpacityRaw === undefined ? 1 : clamp01(Number.parseFloat(strokeOpacityRaw));

  const linecap = normalizeLinecap(lookup('stroke-linecap') ?? inherited.linecap);
  const linejoin = normalizeLinejoin(lookup('stroke-linejoin') ?? inherited.linejoin);
  const strokeVisible = stroke !== 'none' && strokeWidth > 0 && strokeOpacity > 0;

  return {
    fill,
    fillRule,
    visible,
    opacity: opacity * fillOpacity,
    color,
    stroke: strokeVisible ? stroke : 'none',
    strokeWidth,
    linecap,
    linejoin,
    hasStroke: strokeVisible,
  };
}

function parseLength(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeLinecap(raw: string): StyleState['linecap'] {
  const value = raw.trim().toLowerCase();
  if (value === 'round' || value === 'square') return value;
  return 'butt';
}

function normalizeLinejoin(raw: string): StyleState['linejoin'] {
  const value = raw.trim().toLowerCase();
  if (value === 'round' || value === 'bevel') return value;
  return 'miter';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}
