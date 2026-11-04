import { strToU8, zipSync, type Zippable } from 'fflate';
import type { PartMesh } from '../model/types';

/**
 * 3MF writer (ADR-0008): one object per printed part, colours from the SVG as base materials,
 * millimetre units. Bambu Studio (and other modern slicers) import this directly.
 */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

export interface ThreeMfOptions {
  title?: string;
  /** Overrides the colour of a part (otherwise taken from the mesh). */
  colorOverrides?: Record<string, string>;
}

export function writeThreeMf(parts: PartMesh[], options: ThreeMfOptions = {}): Uint8Array {
  const colors: string[] = [];
  const colorIndexOf = (hex: string): number => {
    const normalized = normalizeHex(hex);
    const existing = colors.indexOf(normalized);
    if (existing >= 0) return existing;
    colors.push(normalized);
    return colors.length - 1;
  };

  const partColors = parts.map((part) =>
    colorIndexOf(options.colorOverrides?.[part.partId] ?? part.color),
  );

  const resources: string[] = [];
  resources.push(
    `<basematerials id="1">${colors
      .map((hex, index) => `<base name="color_${index + 1}" displaycolor="${hex}"/>`)
      .join('')}</basematerials>`,
  );

  parts.forEach((part, index) => {
    const objectId = index + 10;
    const vertices: string[] = [];
    const { positions } = part;
    for (let i = 0; i < positions.length; i += 3) {
      vertices.push(
        `<vertex x="${fmt(positions[i])}" y="${fmt(positions[i + 1])}" z="${fmt(positions[i + 2])}"/>`,
      );
    }
    const triangles: string[] = [];
    const { indices } = part;
    for (let i = 0; i < indices.length; i += 3) {
      triangles.push(
        `<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}" pid="1" p1="${partColors[index]}"/>`,
      );
    }
    resources.push(
      `<object id="${objectId}" type="model" name="${escapeXml(part.name)}" pid="1" pindex="${partColors[index]}">` +
        `<mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>` +
        `</object>`,
    );
  });

  const build = parts
    .map((_, index) => `<item objectid="${index + 10}"/>`)
    .join('');

  const metadata = options.title
    ? `<metadata name="Title">${escapeXml(options.title)}</metadata>`
    : '';

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="ru-RU" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  ${metadata}
  <resources>${resources.join('')}</resources>
  <build>${build}</build>
</model>`;

  const files: Zippable = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  };

  return zipSync(files, { level: 6 });
}

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function normalizeHex(hex: string): string {
  const trimmed = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return `${trimmed.toUpperCase()}FF`;
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase() + 'FF';
  }
  return '#CCCCCCFF';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
