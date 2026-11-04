import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { PartMesh } from '@core/model/types';
import { writeBinaryStl } from '@core/export/stl';
import { writeThreeMf } from '@core/export/threemf';

function makePart(overrides: Partial<PartMesh> = {}): PartMesh {
  return {
    partId: 'part-1',
    name: 'Деталь 1',
    color: '#e44d26',
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    indices: new Uint32Array([0, 1, 2]),
    triangleCount: 1,
    volume: 100,
    ...overrides,
  };
}

describe('binary STL writer', () => {
  it('writes the 80-byte header, triangle count and 50 bytes per triangle', () => {
    const parts = [makePart(), makePart({ partId: 'part-2' })];
    const bytes = writeBinaryStl(parts);
    expect(bytes.byteLength).toBe(84 + 2 * 50);

    const view = new DataView(bytes.buffer);
    expect(view.getUint32(80, true)).toBe(2);

    // Normal of the triangle should point to +Z.
    expect(view.getFloat32(84, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(88, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(92, true)).toBeCloseTo(1, 5);
  });
});

describe('3MF writer', () => {
  it('creates a valid package with one object per part and colours', () => {
    const parts = [
      makePart(),
      makePart({ partId: 'part-2', name: 'Деталь 2', color: '#f16529' }),
    ];
    const bytes = writeThreeMf(parts, { title: 'sample' });
    const files = unzipSync(bytes);

    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model',
      '[Content_Types].xml',
      '_rels/.rels',
    ]);

    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('<metadata name="Title">sample</metadata>');
    expect((model.match(/<object /g) ?? []).length).toBe(2);
    expect((model.match(/<triangle /g) ?? []).length).toBe(2);
    expect((model.match(/<item objectid=/g) ?? []).length).toBe(2);
    expect(model).toContain('displaycolor="#E44D26FF"');
    expect(model).toContain('displaycolor="#F16529FF"');
    expect(model).toContain('name="Деталь 2"');
  });

  it('reuses identical colours and escapes names', () => {
    const parts = [
      makePart({ name: 'a & b' }),
      makePart({ partId: 'part-2', name: 'c', color: '#e44d26' }),
    ];
    const model = strFromU8(unzipSync(writeThreeMf(parts))['3D/3dmodel.model']);
    expect((model.match(/<base /g) ?? []).length).toBe(1);
    expect(model).toContain('name="a &amp; b"');
  });
});
