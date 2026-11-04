// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_SETTINGS } from '@core/model/defaults';
import type { NodeSettings, SvgDocument } from '@core/model/types';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { parseSvg } from '@core/svg/parseSvg';

const SOURCE =
  '<svg viewBox="0 0 10 10"><g id="group"><rect id="a" width="5" height="5"/></g></svg>';

function document(): SvgDocument {
  return parseSvg(SOURCE, { fileName: 'test.svg', global: DEFAULT_GLOBAL_SETTINGS });
}

const hiddenOf = (doc: SvgDocument, settings: Record<string, NodeSettings>, id: string): boolean =>
  effectiveSettingsFor(doc.root, settings, DEFAULT_GLOBAL_SETTINGS, id)?.hidden ?? false;

describe('hidden inheritance', () => {
  it('hides everything inside a hidden group', () => {
    const doc = document();
    expect(hiddenOf(doc, { group: { hidden: true } }, 'a')).toBe(true);
  });

  it('keeps a child hidden even after it was shown and the group is hidden later', () => {
    const doc = document();
    // The user hid the shape and then showed it again: `hidden: false` is left in the settings.
    const settings: Record<string, NodeSettings> = { a: { hidden: false } };
    expect(hiddenOf(doc, settings, 'a')).toBe(false);
    // Hiding the group must hide the shape again.
    expect(hiddenOf(doc, { ...settings, group: { hidden: true } }, 'a')).toBe(true);
  });

  it('lets a group be shown again', () => {
    const doc = document();
    const settings: Record<string, NodeSettings> = { group: { hidden: true } };
    expect(hiddenOf(doc, settings, 'a')).toBe(true);
    expect(hiddenOf(doc, { group: { hidden: undefined } }, 'a')).toBe(false);
  });
});
