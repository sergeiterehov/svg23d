import type { GlobalSettings, NodeSettings } from './types';

/**
 * Parameter limits. They are enforced in the store, so every entry point — typed numbers,
 * `+2`/`-2` deltas, the arrows on the model — lands on a value the solver can actually build.
 */

/**
 * Minimum band thickness. Zero is allowed on purpose: «до» may sit exactly on «от», and such an
 * element is simply not printed (a zero-height solid cannot exist).
 */
export const MIN_HEIGHT_MM = 0;
export const MIN_SIZE_MM = 1;
export const MAX_SIZE_MM = 1000;
export const MIN_CLEARANCE_MM = 0;
/** A bigger gap makes the socket disappear, so the slider is capped. */
export const MAX_CLEARANCE_MM = 10;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A 45° chamfer eats the wall from both sides, so each one is limited by the band height minus the
 * opposite chamfer (and by the minimum remaining wall).
 */
export function maxChamfer(height: number, otherChamfer: number): number {
  return Math.max(0, roundMm(height - otherChamfer - MIN_HEIGHT_MM));
}

/** Applies the limits to a per-node patch, using the node's current effective settings. */
export function constrainNodePatch(
  patch: NodeSettings,
  effective: {
    zFrom: number;
    zTo: number;
    clearance: number;
    chamferTop: number;
    chamferBottom: number;
  },
): NodeSettings {
  const has = (key: keyof NodeSettings): boolean =>
    Object.prototype.hasOwnProperty.call(patch, key);
  const next: NodeSettings = { ...patch };

  // Heights: the edited end wins, the other one gives way so the band never collapses.
  const fromGiven = has('zFrom') && patch.zFrom !== undefined;
  const toGiven = has('zTo') && patch.zTo !== undefined;
  let zFrom = fromGiven ? (patch.zFrom as number) : effective.zFrom;
  let zTo = toGiven ? (patch.zTo as number) : effective.zTo;
  // «От» may not climb into «до», «до» may not sink into «от». When both are given at once the
  // top follows the edited bottom.
  if (fromGiven) {
    zFrom = toGiven ? zFrom : Math.min(zFrom, effective.zTo - MIN_HEIGHT_MM);
  }
  if (toGiven) {
    zTo = Math.max(zTo, zFrom + MIN_HEIGHT_MM);
  }
  if (fromGiven) next.zFrom = roundMm(zFrom);
  if (toGiven) next.zTo = roundMm(zTo);

  const bandHeight = Math.max(MIN_HEIGHT_MM, zTo - zFrom);
  if (has('clearance') && patch.clearance !== undefined) {
    next.clearance = roundMm(clamp(patch.clearance, MIN_CLEARANCE_MM, MAX_CLEARANCE_MM));
  }
  if (has('chamferTop') && patch.chamferTop !== undefined) {
    const other = has('chamferBottom')
      ? (patch.chamferBottom ?? effective.chamferBottom)
      : effective.chamferBottom;
    next.chamferTop = roundMm(clamp(patch.chamferTop, 0, maxChamfer(bandHeight, other)));
  }
  if (has('chamferBottom') && patch.chamferBottom !== undefined) {
    const other = has('chamferTop')
      ? (next.chamferTop ?? effective.chamferTop)
      : effective.chamferTop;
    next.chamferBottom = roundMm(clamp(patch.chamferBottom, 0, maxChamfer(bandHeight, other)));
  }

  return next;
}

/** Same for the project defaults, which have no node to inherit from. */
export function constrainGlobalPatch(
  patch: Partial<GlobalSettings>,
  current: GlobalSettings,
): Partial<GlobalSettings> {
  const next: Partial<GlobalSettings> = { ...patch };

  if (next.fitSizeMm !== undefined) {
    next.fitSizeMm = roundMm(clamp(next.fitSizeMm, MIN_SIZE_MM, MAX_SIZE_MM));
  }

  const fromGiven = next.defaultZFrom !== undefined;
  const toGiven = next.defaultZTo !== undefined;
  let zFrom = next.defaultZFrom ?? current.defaultZFrom;
  let zTo = next.defaultZTo ?? current.defaultZTo;
  if (fromGiven) {
    zFrom = toGiven ? zFrom : Math.min(zFrom, current.defaultZTo - MIN_HEIGHT_MM);
  }
  if (toGiven) {
    zTo = Math.max(zTo, zFrom + MIN_HEIGHT_MM);
  }
  if (fromGiven) next.defaultZFrom = roundMm(zFrom);
  if (toGiven) next.defaultZTo = roundMm(zTo);

  const bandHeight = Math.max(MIN_HEIGHT_MM, zTo - zFrom);
  if (next.defaultClearance !== undefined) {
    next.defaultClearance = roundMm(
      clamp(next.defaultClearance, MIN_CLEARANCE_MM, MAX_CLEARANCE_MM),
    );
  }
  if (next.defaultChamferTop !== undefined) {
    const other = next.defaultChamferBottom ?? current.defaultChamferBottom;
    next.defaultChamferTop = roundMm(
      clamp(next.defaultChamferTop, 0, maxChamfer(bandHeight, other)),
    );
  }
  if (next.defaultChamferBottom !== undefined) {
    const other = next.defaultChamferTop ?? current.defaultChamferTop;
    next.defaultChamferBottom = roundMm(
      clamp(next.defaultChamferBottom, 0, maxChamfer(bandHeight, other)),
    );
  }

  return next;
}
