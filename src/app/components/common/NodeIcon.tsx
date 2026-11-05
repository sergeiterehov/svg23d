import type { NodeSettings, SvgDocNode } from '@core/model/types';
import { fallbackFillOf } from '@core/solver/resolveLeaves';
import { findUnionOwner } from '@core/solver/selection';
import { ColorChip } from './Toggle';
import { FolderIcon, UnionIcon } from './Icon';
import { useT } from '../../i18n';

/**
 * The little mark in front of an element's name (ADR-0004 tree, ADR-0006 inspector).
 *
 * It is defined once and used by both panels, so a row in the tree and the same element in the
 * inspector can never disagree: a union is a merged-body icon in the body's colour, a plain group is
 * a folder (it has no colour of its own), a shape is a colour chip. A part of a union wears the
 * union's colour — its own never reaches the model.
 */
export function nodeColour(
  root: SvgDocNode,
  settings: Record<string, NodeSettings>,
  node: SvgDocNode,
): { colour: string; unionOwner: SvgDocNode | null } {
  const unionOwner = node.union === true ? null : findUnionOwner(root, node.id);
  const colourNode = unionOwner ?? node;
  const colour = settings[colourNode.id]?.colorOverride ?? fallbackFillOf(colourNode);
  return { colour, unionOwner };
}

/** The union icon is drawn in the body's colour, but a very dark colour would vanish on the panel. */
function readableIconColour(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#94a3b8';
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.22 ? '#94a3b8' : hex;
}

export function NodeIcon({
  node,
  root,
  settings,
  size = 14,
  className,
}: {
  node: SvgDocNode;
  root: SvgDocNode;
  settings: Record<string, NodeSettings>;
  /** Icon and chip size in px. */
  size?: number;
  className?: string;
}) {
  const { colour, unionOwner } = nodeColour(root, settings, node);
  const t = useT();

  if (node.union === true) {
    return (
      <span
        className={className}
        style={{ color: readableIconColour(colour) }}
        title={t('tree.unionLabel')}
      >
        <UnionIcon style={{ width: size, height: size }} className="block" />
      </span>
    );
  }
  if (node.kind === 'group' && !unionOwner) {
    return (
      <span className={className} title={t('tree.groupLabel')}>
        <FolderIcon style={{ width: size, height: size }} className="block" />
      </span>
    );
  }
  return (
    <span className={className}>
      <ColorChip color={colour} size={size} />
    </span>
  );
}
