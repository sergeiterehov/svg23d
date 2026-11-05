import { CHAMFER_STEP_MM, MAX_CHAMFER_LAYERS } from '../model/defaults';
import type { ManifoldApi, Section, Solid } from './section';
import { offsetSection, unionSolids } from './section';
import { buildLoftedPrism } from './chamfer';
import { t } from '@i18n';

export interface PrismOptions {
  zFrom: number;
  zTo: number;
  /** 45° chamfer size at the bottom, in mm. */
  chamferBottom?: number;
  /** 45° chamfer size at the top, in mm. */
  chamferTop?: number;
  /** Vertical tessellation step for chamfers, in mm. */
  chamferStep?: number;
}

/**
 * Extrudes a section between two Z heights, optionally chamfering the bottom/top edges (ADR-0007).
 *
 * A 45° chamfer is realised as a stack of thin layers whose cross-section is progressively
 * offset inwards. The step is small enough (0.05 mm by default) to be invisible on FDM prints,
 * and it keeps the operation robust: only `offset`, `extrude` and `add` are involved.
 */
export function buildPrism(api: ManifoldApi, section: Section, options: PrismOptions): Solid {
  const height = options.zTo - options.zFrom;
  if (!(height > 1e-6)) {
    throw new Error(t('error.extrude.height'));
  }

  const step = options.chamferStep ?? CHAMFER_STEP_MM;
  let bottom = Math.max(0, options.chamferBottom ?? 0);
  let top = Math.max(0, options.chamferTop ?? 0);
  if (bottom + top > height) {
    const scale = height / (bottom + top);
    bottom *= scale;
    top *= scale;
  }

  if (bottom > 1e-6 || top > 1e-6) {
    // A true 45° loft: one ring instead of a stack of layers (ADR-0040). Shapes that cannot be
    // lofted safely fall back to the stepped build below.
    const lofted = buildLoftedPrism(api, section, {
      zFrom: options.zFrom,
      zTo: options.zTo,
      bottom,
      top,
    });
    if (lofted) return lofted;
  }

  const pieces: Solid[] = [];

  if (bottom > 1e-6) {
    const layers = fallbackLayers(bottom, step);
    const layerHeight = bottom / layers;
    for (let i = 0; i < layers; i++) {
      const inset = bottom - (i + 0.5) * layerHeight;
      pushLayer(inset, i * layerHeight, layerHeight);
    }
  }

  const middleBottom = bottom;
  const middleTop = height - top;
  if (middleTop - middleBottom > 1e-6) {
    pushLayer(0, middleBottom, middleTop - middleBottom);
  }

  if (top > 1e-6) {
    const layers = fallbackLayers(top, step);
    const layerHeight = top / layers;
    for (let i = 0; i < layers; i++) {
      const inset = (i + 0.5) * layerHeight;
      pushLayer(inset, middleTop + i * layerHeight, layerHeight);
    }
  }

  function pushLayer(inset: number, zOffset: number, layerHeight: number): void {
    if (layerHeight <= 1e-9) return;
    const sliced = inset > 1e-9 ? offsetSection(section, -inset) : section;
    if (sliced.isEmpty()) {
      if (sliced !== section) sliced.delete();
      return;
    }
    const solid = sliced.extrude(layerHeight);
    if (sliced !== section) sliced.delete();
    const placed = solid.translate([0, 0, options.zFrom + zOffset]);
    solid.delete();
    pieces.push(placed);
  }

  const union = unionSolids(pieces);
  if (!union) {
    throw new Error(t('error.extrude.empty'));
  }
  return union;
}

/**
 * Layers of a stepped chamfer. Only shapes the loft cannot handle get here (a contour splits or
 * vanishes at the inset), and those are small features: a cap of 6 layers keeps the staircase
 * below a print layer while staying far away from the 40-layer blow-up (ADR-0040).
 */
function fallbackLayers(size: number, step: number): number {
  return Math.max(1, Math.min(MAX_CHAMFER_LAYERS, 6, Math.ceil(size / step)));
}

/** Convenience: plain extrusion without chamfers. */
export function buildExtrusion(
  _api: ManifoldApi,
  section: Section,
  zFrom: number,
  zTo: number,
): Solid {
  const height = zTo - zFrom;
  if (!(height > 1e-6)) throw new Error(t('error.extrude.height'));
  const solid = section.extrude(height);
  const placed = solid.translate([0, 0, zFrom]);
  solid.delete();
  return placed;
}
