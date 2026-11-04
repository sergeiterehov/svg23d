import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import {
  MAX_CLEARANCE_MM,
  MAX_SIZE_MM,
  MIN_HEIGHT_MM,
  constrainGlobalPatch,
  constrainNodePatch,
  maxChamfer,
} from '@core/model/limits';

const band = { zFrom: 10, zTo: 30, clearance: 0.15, chamferTop: 0, chamferBottom: 0 };

describe('constrainNodePatch', () => {
  it('keeps «до» above «от»', () => {
    expect(constrainNodePatch({ zTo: 5 }, band).zTo).toBe(10 + MIN_HEIGHT_MM);
    expect(constrainNodePatch({ zFrom: 40 }, band).zFrom).toBe(30 - MIN_HEIGHT_MM);
  });

  it('lets valid heights through untouched', () => {
    expect(constrainNodePatch({ zTo: 45 }, band).zTo).toBe(45);
    expect(constrainNodePatch({ zFrom: 2 }, band).zFrom).toBe(2);
  });

  it('clamps the pair when both ends are set at once', () => {
    expect(constrainNodePatch({ zFrom: 20, zTo: 5 }, band)).toMatchObject({
      zFrom: 20,
      zTo: 20 + MIN_HEIGHT_MM,
    });
  });

  it('caps the clearance', () => {
    expect(constrainNodePatch({ clearance: -1 }, band).clearance).toBe(0);
    expect(constrainNodePatch({ clearance: 99 }, band).clearance).toBe(MAX_CLEARANCE_MM);
  });

  it('keeps chamfers within the band height', () => {
    // Band height is 20 mm: a 45° chamfer may not eat the whole wall.
    expect(constrainNodePatch({ chamferTop: 50 }, band).chamferTop).toBe(maxChamfer(20, 0));
    // The opposite chamfer already takes space.
    expect(constrainNodePatch({ chamferTop: 50 }, { ...band, chamferBottom: 5 }).chamferTop).toBe(
      maxChamfer(20, 5),
    );
  });

  it('does not touch settings that are not in the patch', () => {
    expect(constrainNodePatch({ isPart: true }, band)).toEqual({ isPart: true });
  });
});

describe('constrainGlobalPatch', () => {
  it('clamps the model size', () => {
    expect(constrainGlobalPatch({ fitSizeMm: 0 }, DEFAULT_GLOBAL_SETTINGS).fitSizeMm).toBe(1);
    expect(constrainGlobalPatch({ fitSizeMm: 5000 }, DEFAULT_GLOBAL_SETTINGS).fitSizeMm).toBe(
      MAX_SIZE_MM,
    );
  });

  it('keeps the default band consistent', () => {
    expect(constrainGlobalPatch({ defaultZTo: -5 }, DEFAULT_GLOBAL_SETTINGS).defaultZTo).toBe(
      DEFAULT_GLOBAL_SETTINGS.defaultZFrom + MIN_HEIGHT_MM,
    );
    expect(constrainGlobalPatch({ defaultZFrom: 100 }, DEFAULT_GLOBAL_SETTINGS).defaultZFrom).toBe(
      DEFAULT_GLOBAL_SETTINGS.defaultZTo - MIN_HEIGHT_MM,
    );
  });

  it('caps default clearance and chamfers', () => {
    expect(
      constrainGlobalPatch({ defaultClearance: 50 }, DEFAULT_GLOBAL_SETTINGS).defaultClearance,
    ).toBe(MAX_CLEARANCE_MM);
    expect(
      constrainGlobalPatch({ defaultChamferTop: 100 }, DEFAULT_GLOBAL_SETTINGS).defaultChamferTop,
    ).toBe(maxChamfer(DEFAULT_GLOBAL_SETTINGS.defaultZTo, 0));
  });
});
