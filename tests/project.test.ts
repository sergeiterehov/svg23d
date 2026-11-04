// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import { PROJECT_VERSION } from '@core/model/types';
import type { NodeSettings, Project } from '@core/model/types';
import { parseProjectFile, serializeProject } from '@core/model/project';
import { parseSvg } from '@core/svg/parseSvg';
import { resolveLeaves } from '@core/solver/resolveLeaves';

const sample = readFileSync(resolve(process.cwd(), 'samples/html5.svg'), 'utf8');

function makeProject(): Project {
  const document = parseSvg(sample, { fileName: 'sample.svg', global: DEFAULT_GLOBAL_SETTINGS });
  const settings: Record<string, NodeSettings> = {
    [document.root.children[0].id]: { zFrom: 1, zTo: 4, clearance: 0.2, chamferTop: 0.5 },
  };
  return {
    version: PROJECT_VERSION,
    fileName: 'sample.svg',
    source: sample,
    document,
    settings,
    global: { ...DEFAULT_GLOBAL_SETTINGS, fitSizeMm: 80 },
  };
}

describe('project file', () => {
  it('round-trips source, settings and globals', () => {
    const project = makeProject();
    const text = serializeProject(project);
    const file = parseProjectFile(text);

    expect(file.app).toBe('svg23d');
    expect(file.version).toBe(PROJECT_VERSION);
    expect(file.fileName).toBe('sample.svg');
    expect(file.source).toContain('<svg');
    expect(file.global.fitSizeMm).toBe(80);
    expect(Object.values(file.settings)[0]).toMatchObject({ zFrom: 1, zTo: 4, clearance: 0.2 });
  });

  it('restores an equivalent model after reload', () => {
    const project = makeProject();
    const file = parseProjectFile(serializeProject(project));
    const document = parseSvg(file.source, { fileName: file.fileName, global: file.global });
    const before = resolveLeaves({
      document: project.document,
      settings: project.settings,
      global: project.global,
    });
    const after = resolveLeaves({ document, settings: file.settings, global: file.global });

    expect(after.parts.map((p) => p.id)).toEqual(before.parts.map((p) => p.id));
    expect(after.leaves.map((l) => [l.id, l.zFrom, l.zTo, l.clearance, l.chamferTop])).toEqual(
      before.leaves.map((l) => [l.id, l.zFrom, l.zTo, l.clearance, l.chamferTop]),
    );
    expect(after.widthMm).toBeCloseTo(before.widthMm, 6);
  });

  it('keeps display settings', () => {
    const project = makeProject();
    project.global = {
      ...project.global,
      view: { opaque2d: true, lighting: 'flat', material: 'glossy' },
    };
    const file = parseProjectFile(serializeProject(project));
    expect(file.global.view).toEqual({ opaque2d: true, lighting: 'flat', material: 'glossy' });
  });

  it('fills in view settings missing from older files', () => {
    const legacy = {
      app: 'svg23d',
      version: 1,
      fileName: 'old.svg',
      source: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      settings: {},
      global: {
        fitSizeMm: 50,
        fit: 'width',
        defaultZFrom: 0,
        defaultZTo: 5,
        defaultClearance: 0.1,
        defaultChamferTop: 0,
        defaultChamferBottom: 0,
        flatness: 0.02,
      },
    };
    const file = parseProjectFile(JSON.stringify(legacy));
    expect(file.global.fitSizeMm).toBe(50);
    expect(file.global.view).toEqual(DEFAULT_GLOBAL_SETTINGS.view);
  });

  it('rejects foreign or broken files', () => {
    expect(() => parseProjectFile('not json')).toThrow(/повреждён/);
    expect(() => parseProjectFile('{"app":"other"}')).toThrow(/не файл проекта/);
    expect(() => parseProjectFile('{"app":"svg23d","version":99,"source":"<svg/>"}')).toThrow(
      /не поддерживается/,
    );
    expect(() => parseProjectFile('{"app":"svg23d","version":1}')).toThrow(/исходного SVG/);
  });
});
