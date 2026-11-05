import type { GlobalSettings, SvgDocument } from '../model/types';
import { extractDocument, readViewBox } from './extractTree';
import { computeUnitMapping } from './units';
import { t } from '@i18n';

/** Raised when the file is not a parseable SVG document. */
export class SvgParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgParseError';
  }
}

export interface ParseSvgOptions {
  fileName: string;
  global: GlobalSettings;
}

const FORBIDDEN_TAGS = new Set([
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
]);

/**
 * Parses an SVG file into the internal document tree.
 *
 * Parsing happens on the main thread (DOMParser is not available in workers); the resulting
 * structure is plain data and can be posted to the geometry worker.
 */
export function parseSvg(text: string, options: ParseSvgOptions): SvgDocument {
  if (typeof DOMParser === 'undefined') {
    throw new SvgParseError(t('error.parse.dom'));
  }
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const parserError = parsed.getElementsByTagName('parsererror')[0];
  if (parserError) {
    const detail = (parserError.textContent ?? '').trim().split('\n')[0];
    throw new SvgParseError(t('error.parse.invalid', { detail: detail || t('error.parse.xml') }));
  }

  const svgRoot = parsed.documentElement;
  if (!svgRoot || svgRoot.tagName.toLowerCase() !== 'svg') {
    throw new SvgParseError(t('error.parse.root'));
  }

  sanitize(svgRoot);

  const viewBox = readViewBox(svgRoot);
  const mapping = computeUnitMapping(viewBox, options.global);
  const document = extractDocument(svgRoot, {
    fileName: options.fileName,
    mapping,
    flatnessMm: options.global.flatness,
  });

  return { ...document, hash: hashString(text) };
}

/** Removes active content, external references and inline event handlers. */
export function sanitize(root: Element): void {
  const toRemove: Element[] = [];
  const walk = (element: Element): void => {
    const tag = element.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) {
      toRemove.push(element);
      return;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'href' || name === 'xlink:href') {
        if (!attribute.value.trim().startsWith('#')) {
          element.removeAttribute(attribute.name);
        }
      }
      if (/url\(\s*['"]?(?!#)/.test(attribute.value)) {
        // External paint servers / clip paths cannot be resolved.
        element.removeAttribute(attribute.name);
      }
    }
    for (const child of Array.from(element.children)) walk(child);
  };
  walk(root);
  for (const element of toRemove) element.remove();
}

/** FNV-1a 32-bit hash, used for cache invalidation only. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
