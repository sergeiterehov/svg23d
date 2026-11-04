import { describe, expect, it } from 'vitest';
import { paintingOrder } from '@app/components/preview/paintingOrder';

const item = (id: string, zTo: number) => ({ id, zTo });
const topOf = (value: { zTo: number }): number => value.zTo;
const ids = (items: Array<{ id: string }>): string[] => items.map((entry) => entry.id);

describe('paintingOrder', () => {
  it('paints the lowest element first and the highest last', () => {
    const items = [item('crown', 45), item('sky', 30), item('trunk', 40), item('crown-2', 50)];
    expect(ids(paintingOrder(items, topOf))).toEqual(['sky', 'trunk', 'crown', 'crown-2']);
  });

  it('keeps the incoming order for equal heights', () => {
    const items = [item('sun', 35), item('hill', 35), item('sky', 30)];
    expect(ids(paintingOrder(items, topOf))).toEqual(['sky', 'sun', 'hill']);
  });

  it('does not mutate the input', () => {
    const items = [item('b', 20), item('a', 10)];
    paintingOrder(items, topOf);
    expect(ids(items)).toEqual(['b', 'a']);
  });
});
