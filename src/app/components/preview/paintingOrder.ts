/**
 * Painting order of the 2D preview: elements are drawn by height, not by their place in the tree — the
 * one built higher covers the ones below it, exactly as it does in 3D. Ties keep the tree order, so the
 * picture stays stable while heights are being edited.
 *
 * The "как есть" mode skips this and shows the document order of the SVG.
 */
export function paintingOrder<T>(items: T[], topOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, top: topOf(item) }))
    .sort((a, b) => a.top - b.top || a.index - b.index)
    .map((entry) => entry.item);
}
