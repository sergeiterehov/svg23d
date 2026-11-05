import { fallbackFillOf, findNode, type PartInfo } from '@core/solver/resolveLeaves';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { orderedChildren } from '@core/solver/order';
import { collectSubtreeIds, findUnionOwner } from '@core/solver/selection';
import type { BBox3, LeafStats, NodeSettings, SvgDocNode } from '@core/model/types';
import { useProjectStore } from '../../store/useProjectStore';
import {
  MAX_CLEARANCE_MM,
  MAX_SIZE_MM,
  MIN_HEIGHT_MM,
  MIN_SIZE_MM,
  maxChamfer,
} from '@core/model/limits';
import { NumberField } from '../common/NumberField';
import { ColorChip, MixedColorChip, Toggle } from '../common/Toggle';
import { FieldSection } from '../common/Field';
import {
  ChamferBottomIcon,
  ChamferTopIcon,
  ClearanceIcon,
  CurveIcon,
  HeightFromIcon,
  HeightToIcon,
  ResetIcon,
  SizeIcon,
} from '../common/Icon';
import { SelectField } from '../common/Select';
import { NodeIcon } from '../common/NodeIcon';
import { useT } from '../../i18n';
import { formatNumber, t as translate } from '@i18n';

/**
 * Right panel shows exactly one mode (ADR-0006 UI note): settings of the selected element,
 * settings shared by a multi-selection, or project-wide defaults when nothing is selected.
 * The modes are never mixed in one list.
 *
 * Layout follows Figma (ADR-0027): a section is a caption plus a row of filled, borderless fields,
 * and every field is identified by the icon inside it instead of a caption of its own.
 */
export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const selectedIds = useProjectStore((s) => s.selectedIds);

  const nodes: SvgDocNode[] = project
    ? selectedIds
        .map((id) => findNode(project.document.root, id))
        .filter((node): node is SvgDocNode => node !== null)
    : [];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {nodes.length === 0 ? (
        <ProjectPanel />
      ) : nodes.length === 1 ? (
        <ElementPanel node={nodes[0]} />
      ) : (
        <MultiPanel nodes={nodes} />
      )}
      <StatsPanel />
    </div>
  );
}

/** Pair of two fields in one row, like Figma's W/H or X/Y. */
function Pair({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}

function BackToProject() {
  const t = useT();
  const select = useProjectStore((s) => s.select);
  return (
    <button
      type="button"
      onClick={() => select(null)}
      title={t('inspector.backToProject')}
      className="shrink-0 text-[10px] text-slate-500 transition hover:text-slate-200"
    >
      {t('inspector.backShort')}
    </button>
  );
}

function ElementPanel({ node }: { node: SvgDocNode }) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const select = useProjectStore((s) => s.select);

  if (!project) return null;
  /** The union this node is a part of: the settings below would not reach the model. */
  const unionParent = findUnionOwner(project.document.root, node.id);

  const effective = effectiveSettingsFor(
    project.document.root,
    project.settings,
    project.global,
    node.id,
  );
  if (!effective) return null;
  const own = project.settings[node.id] ?? {};

  return (
    <>
      <FieldSection title={t('inspector.element')} right={<BackToProject />}>
        <div className="flex items-center gap-2">
          <NodeIcon
            node={node}
            root={project.document.root}
            settings={project.settings}
            size={14}
            className="grid shrink-0 place-items-center text-slate-400"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-100">{node.name}</div>
            <div className="truncate text-[10px] text-slate-500">
              {node.tag} · {node.id} ·{' '}
              {node.union
                ? t('inspector.kind.union')
                : unionParent
                  ? t('inspector.kind.unionPart')
                  : node.kind === 'group'
                    ? t('inspector.kind.group')
                    : t('inspector.kind.shape')}
            </div>
          </div>
        </div>
        {node.union && (
          <p className="text-[10px] leading-snug text-slate-500">{t('inspector.unionNote')}</p>
        )}
        {unionParent && (
          <p className="text-[10px] leading-snug text-amber-400/90">
            {t('inspector.unionPartOf', { name: unionParent.name })}{' '}
            <button
              type="button"
              onClick={() => select(unionParent.id)}
              className="text-sky-400 transition hover:text-sky-300"
            >
              {t('inspector.selectUnion')}
            </button>
          </p>
        )}
      </FieldSection>

      {unionParent && <UnionPartSections node={node} unionParent={unionParent} />}

      {!unionParent && (
        <>
          <FieldSection title={t('inspector.height')} hint={t('inspector.heightHint')}>
            <Pair>
              <NumberField
                label={t('field.zFrom')}
                icon={HeightFromIcon}
                value={own.zFrom}
                placeholder={String(round(effective.zFrom))}
                showReset={own.zFrom !== undefined}
                step={0.2}
                max={round(effective.zTo - MIN_HEIGHT_MM)}
                onCommit={(value) => updateSettings(node.id, { zFrom: value })}
                onDelta={(delta) =>
                  updateSettings(node.id, { zFrom: round(effective.zFrom + delta) })
                }
              />
              <NumberField
                label={t('field.zTo')}
                icon={HeightToIcon}
                value={own.zTo}
                placeholder={String(round(effective.zTo))}
                showReset={own.zTo !== undefined}
                step={0.2}
                min={round(effective.zFrom + MIN_HEIGHT_MM)}
                onCommit={(value) => updateSettings(node.id, { zTo: value })}
                onDelta={(delta) => updateSettings(node.id, { zTo: round(effective.zTo + delta) })}
              />
            </Pair>
            {effective.zTo < effective.zFrom && (
              <p className="text-[11px] text-rose-400">{t('inspector.heightInvalid')}</p>
            )}
          </FieldSection>

          <FieldSection title={t('inspector.chamfer')} hint={t('inspector.chamferHint')}>
            <Pair>
              <NumberField
                label={t('field.chamferTop')}
                icon={ChamferTopIcon}
                value={own.chamferTop}
                placeholder={String(round(effective.chamferTop))}
                showReset={own.chamferTop !== undefined}
                step={0.1}
                min={0}
                max={maxChamfer(effective.zTo - effective.zFrom, effective.chamferBottom)}
                onCommit={(value) => updateSettings(node.id, { chamferTop: value })}
                onDelta={(delta) =>
                  updateSettings(node.id, {
                    chamferTop: Math.max(0, round(effective.chamferTop + delta)),
                  })
                }
              />
              <NumberField
                label={t('field.chamferBottom')}
                icon={ChamferBottomIcon}
                value={own.chamferBottom}
                placeholder={String(round(effective.chamferBottom))}
                showReset={own.chamferBottom !== undefined}
                step={0.1}
                min={0}
                max={maxChamfer(effective.zTo - effective.zFrom, effective.chamferTop)}
                onCommit={(value) => updateSettings(node.id, { chamferBottom: value })}
                onDelta={(delta) =>
                  updateSettings(node.id, {
                    chamferBottom: Math.max(0, round(effective.chamferBottom + delta)),
                  })
                }
              />
            </Pair>
          </FieldSection>

          <FieldSection title={t('inspector.sockets')} hint={t('inspector.socketsHint')}>
            <NumberField
              label={t('field.clearance')}
              icon={ClearanceIcon}
              value={own.clearance}
              placeholder={String(round(effective.clearance))}
              showReset={own.clearance !== undefined}
              step={0.05}
              min={0}
              max={MAX_CLEARANCE_MM}
              onCommit={(value) => updateSettings(node.id, { clearance: value })}
              onDelta={(delta) =>
                updateSettings(node.id, {
                  clearance: Math.max(0, round(effective.clearance + delta)),
                })
              }
            />
            <Toggle
              label={t('inspector.isPart')}
              checked={own.isPart === true}
              onChange={(checked) =>
                updateSettings(node.id, { isPart: checked ? true : undefined })
              }
              hint={t('inspector.isPartHint')}
            />
          </FieldSection>

          <FieldSection title={t('inspector.appearance')}>
            <ColorField
              value={own.colorOverride ?? fallbackFillOf(node)}
              // A group has no colour of its own: its children bring their own, so "none" is the default.
              empty={
                node.kind === 'group' && !node.union && own.colorOverride === undefined
                  ? t('common.none')
                  : undefined
              }
              mixed={false}
              onPick={(value) => updateSettings(node.id, { colorOverride: value })}
              onReset={
                own.colorOverride !== undefined
                  ? () => updateSettings(node.id, { colorOverride: undefined })
                  : null
              }
            />
            <Toggle
              label={t('inspector.hide')}
              checked={effective.hidden}
              // A group hides its whole subtree; a child cannot undo that on its own.
              disabled={effective.hidden && own.hidden !== true}
              hint={
                effective.hidden && own.hidden !== true
                  ? t('inspector.hideInherited')
                  : t('inspector.hideHint')
              }
              onChange={(checked) =>
                updateSettings(node.id, { hidden: checked ? true : undefined })
              }
            />
            <Toggle
              label={t('inspector.ignore')}
              checked={effective.ignored}
              disabled={effective.ignored && own.ignored !== true}
              hint={
                effective.ignored && own.ignored !== true
                  ? t('inspector.ignoreInherited')
                  : t('inspector.ignoreHint')
              }
              onChange={(checked) =>
                updateSettings(node.id, { ignored: checked ? true : undefined })
              }
            />
          </FieldSection>
        </>
      )}

      <ElementsSection node={node} />
    </>
  );
}

/**
 * Contents of the selected container as a plain list — a union is one printed body, so its «Результат»
 * is about the body and this block is about what the body is made of. A row selects that element.
 */
function ElementsSection({ node }: { node: SvgDocNode }) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const select = useProjectStore((s) => s.select);

  if (!project || node.children.length === 0) return null;
  // Same order as the tree: the top row is the element drawn last.
  const children = [...orderedChildren(node, project.settings)].reverse();

  return (
    <FieldSection title={t('inspector.elements')} hint={t('inspector.elementsHint')}>
      <ul className="flex flex-col gap-0.5">
        {children.map((child) => (
          <li key={child.id}>
            <button
              type="button"
              onClick={() => select(child.id)}
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[11px] text-slate-300 transition hover:bg-slate-800/70 hover:text-white"
            >
              <NodeIcon
                node={child}
                root={project.document.root}
                settings={project.settings}
                size={11}
                className="grid shrink-0 place-items-center text-slate-400"
              />
              <span className="truncate">{child.name}</span>
              {child.kind === 'group' && child.children.length > 0 && (
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-500">
                  {child.children.length}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </FieldSection>
  );
}

/**
 * A part of a union: the piece is not printed on its own, so only its place in the body is offered —
 * «Игнорировать» takes it out of the merged body, exactly like deleting it (ADR-0035). «Скрыть» is
 * not offered: a piece inside a merged body cannot be hidden from the view on its own.
 */
function UnionPartSections({ node, unionParent }: { node: SvgDocNode; unionParent: SvgDocNode }) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  if (!project) return null;
  const own = project.settings[node.id] ?? {};
  const effective = effectiveSettingsFor(
    project.document.root,
    project.settings,
    project.global,
    node.id,
  );

  return (
    <FieldSection
      title={t('inspector.unionPart', { name: unionParent.name })}
      hint={t('inspector.unionPartHint')}
    >
      <Toggle
        label={t('inspector.ignorePart')}
        checked={effective?.ignored === true}
        disabled={effective?.ignored === true && own.ignored !== true}
        hint={t('inspector.ignorePartHint')}
        onChange={(checked) => updateSettings(node.id, { ignored: checked ? true : undefined })}
      />
    </FieldSection>
  );
}

type NumericKey = 'zFrom' | 'zTo' | 'clearance' | 'chamferTop' | 'chamferBottom';

/** Settings panel for a multi-selection: equal values are shown, different ones as a range. */
function MultiPanel({ nodes }: { nodes: SvgDocNode[] }) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const updateSettingsBatch = useProjectStore((s) => s.updateSettingsBatch);

  if (!project) return null;
  const { root } = project.document;
  const { settings } = project;
  const effectiveOf = (node: SvgDocNode) =>
    effectiveSettingsFor(root, settings, project.global, node.id);

  const numbers = (key: NumericKey) => {
    const values = nodes
      .map((node) => effectiveOf(node)?.[key])
      .filter((value): value is number => value !== undefined);
    const same = values.every((value) => value === values[0]);
    return {
      value: same ? values[0] : undefined,
      placeholder: same ? '' : `${round(Math.min(...values))}-${round(Math.max(...values))}`,
      delta: (change: number, min = -Infinity) =>
        updateSettingsBatch(
          Object.fromEntries(
            nodes.map((node) => [
              node.id,
              { [key]: Math.max(min, round((effectiveOf(node)?.[key] ?? 0) + change)) },
            ]),
          ),
        ),
      commit: (value: number | undefined) =>
        updateSettingsBatch(
          Object.fromEntries(nodes.map((node) => [node.id, { [key]: value } as NodeSettings])),
        ),
    };
  };

  const flags = (read: (node: SvgDocNode) => boolean) => {
    const values = nodes.map(read);
    const mixed = values.some(Boolean) && values.some((value) => !value);
    return { checked: !mixed && values[0] === true, mixed };
  };

  const setFlags = (key: 'isPart' | 'hidden' | 'ignored', value: boolean) =>
    updateSettingsBatch(
      Object.fromEntries(nodes.map((node) => [node.id, { [key]: value ? true : undefined }])),
    );

  const colors = nodes.map(
    (node) => settings[node.id]?.colorOverride ?? (node.fill === 'none' ? '#000000' : node.fill),
  );
  const colorsEqual = colors.every((color) => color === colors[0]);

  const zFrom = numbers('zFrom');
  const zTo = numbers('zTo');
  const clearance = numbers('clearance');
  const chamferTop = numbers('chamferTop');
  const chamferBottom = numbers('chamferBottom');
  const isPart = flags((node) => settings[node.id]?.isPart === true);
  const hidden = flags((node) => effectiveOf(node)?.hidden === true);
  const ignored = flags((node) => effectiveOf(node)?.ignored === true);
  const unionParents = nodes.map((node) => findUnionOwner(root, node.id));
  const namesText = nodes
    .slice(0, 4)
    .map((node) => node.name)
    .join(', ');

  // Every selected node is a part of a union: nothing here can reach the model.
  if (unionParents.every((parent) => parent !== null)) {
    return (
      <FieldSection
        title={t('inspector.selectedCount', { count: nodes.length })}
        right={<BackToProject />}
      >
        <p className="truncate text-[11px] text-slate-500">
          {namesText}
          {nodes.length > 4 ? t('inspector.andMore', { count: nodes.length - 4 }) : ''}
        </p>
        <p className="text-[10px] leading-snug text-amber-400/90">
          {t('inspector.multiUnionOnly')}
        </p>
      </FieldSection>
    );
  }

  return (
    <>
      <FieldSection
        title={t('inspector.selectedCount', { count: nodes.length })}
        hint={t('inspector.multiHint')}
        right={<BackToProject />}
      >
        <p className="truncate text-[11px] text-slate-500">
          {namesText}
          {nodes.length > 4 ? t('inspector.andMore', { count: nodes.length - 4 }) : ''}
        </p>
        {unionParents.some((parent) => parent !== null) && (
          <p className="text-[10px] leading-snug text-amber-400/90">
            {t('inspector.multiUnionMixed')}
          </p>
        )}
      </FieldSection>

      <FieldSection title={t('inspector.height')} hint={t('inspector.multiHeightHint')}>
        <Pair>
          <NumberField
            label={t('field.zFrom')}
            icon={HeightFromIcon}
            value={zFrom.value}
            placeholder={zFrom.placeholder}
            step={0.2}
            onCommit={zFrom.commit}
            onDelta={(delta) => zFrom.delta(delta)}
          />
          <NumberField
            label={t('field.zTo')}
            icon={HeightToIcon}
            value={zTo.value}
            placeholder={zTo.placeholder}
            step={0.2}
            onCommit={zTo.commit}
            onDelta={(delta) => zTo.delta(delta)}
          />
        </Pair>
        {nodes.some((node) => {
          const settings = effectiveOf(node);
          return settings ? settings.zTo < settings.zFrom : false;
        }) && <p className="text-[11px] text-rose-400">{t('inspector.multiHeightInvalid')}</p>}
      </FieldSection>

      <FieldSection title={t('inspector.chamfer')} hint={t('inspector.multiChamferHint')}>
        <Pair>
          <NumberField
            label={t('field.chamferTop')}
            icon={ChamferTopIcon}
            value={chamferTop.value}
            placeholder={chamferTop.placeholder}
            step={0.1}
            min={0}
            onCommit={chamferTop.commit}
            onDelta={(delta) => chamferTop.delta(delta, 0)}
          />
          <NumberField
            label={t('field.chamferBottom')}
            icon={ChamferBottomIcon}
            value={chamferBottom.value}
            placeholder={chamferBottom.placeholder}
            step={0.1}
            min={0}
            onCommit={chamferBottom.commit}
            onDelta={(delta) => chamferBottom.delta(delta, 0)}
          />
        </Pair>
      </FieldSection>

      <FieldSection title={t('inspector.sockets')} hint={t('inspector.multiSocketsHint')}>
        <NumberField
          label={t('field.clearance')}
          icon={ClearanceIcon}
          value={clearance.value}
          placeholder={clearance.placeholder}
          step={0.05}
          min={0}
          max={MAX_CLEARANCE_MM}
          onCommit={clearance.commit}
          onDelta={(delta) => clearance.delta(delta, 0)}
        />
        <Toggle
          label={t('inspector.isPart')}
          checked={isPart.checked}
          mixed={isPart.mixed}
          onChange={(checked) => setFlags('isPart', checked)}
          hint={t('inspector.multiIsPartHint')}
        />
      </FieldSection>

      <FieldSection title={t('inspector.appearance')}>
        <ColorField
          value={colors[0]}
          mixed={!colorsEqual}
          mixedColors={colors}
          onPick={(value) =>
            updateSettingsBatch(
              Object.fromEntries(nodes.map((node) => [node.id, { colorOverride: value }])),
            )
          }
          onReset={
            nodes.some((node) => settings[node.id]?.colorOverride !== undefined)
              ? () =>
                  updateSettingsBatch(
                    Object.fromEntries(
                      nodes.map((node) => [node.id, { colorOverride: undefined } as NodeSettings]),
                    ),
                  )
              : null
          }
        />
        <Toggle
          label={t('inspector.hide')}
          checked={hidden.checked}
          mixed={hidden.mixed}
          onChange={(checked) => setFlags('hidden', checked)}
          hint={t('inspector.multiHideHint')}
        />
        <Toggle
          label={t('inspector.ignore')}
          checked={ignored.checked}
          mixed={ignored.mixed}
          onChange={(checked) => setFlags('ignored', checked)}
          hint={t('inspector.multiIgnoreHint')}
        />
      </FieldSection>
    </>
  );
}

function ColorField({
  value,
  mixed,
  mixedColors,
  empty,
  onPick,
  onReset,
}: {
  value: string;
  mixed: boolean;
  mixedColors?: string[];
  /** Shown instead of the swatch when the element has no colour of its own (groups). */
  empty?: string;
  onPick: (color: string) => void;
  onReset: (() => void) | null;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-400">{t('inspector.colour')}</span>
      <span className="flex items-center gap-1.5">
        {mixed && (
          <>
            <MixedColorChip colors={mixedColors ?? [value, value]} size={12} />
            <span className="text-[10px] text-slate-500">{t('common.mixed')}</span>
          </>
        )}
        {empty && <span className="text-[10px] text-slate-500">{empty}</span>}
        <label
          title={value}
          className="relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-slate-800/60 pl-1.5 pr-2 transition hover:bg-slate-800 focus-within:ring-1 focus-within:ring-sky-500"
        >
          <span
            className="h-3.5 w-5 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/40"
            style={{ backgroundColor: value }}
          />
          <span className="select-none text-[10px] tabular-nums leading-none text-slate-400">
            {value.toLowerCase()}
          </span>
          <input
            type="color"
            aria-label={t('inspector.colour')}
            value={value}
            onChange={(event) => onPick(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {onReset && (
          <button
            type="button"
            title={t('inspector.colourReset')}
            aria-label={t('inspector.colourResetAria')}
            onClick={onReset}
            className="grid h-7 w-7 place-items-center rounded-md bg-slate-800/60 text-slate-500 transition hover:bg-slate-800 hover:text-white"
          >
            <ResetIcon className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  );
}

function ProjectPanel() {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const updateGlobal = useProjectStore((s) => s.updateGlobal);

  if (!project) return null;
  const { global } = project;

  return (
    <>
      <FieldSection title={t('project.settings')}>
        <p className="text-[10px] leading-snug text-slate-500">{t('project.defaults')}</p>
      </FieldSection>

      <FieldSection title={t('project.size')} hint={t('project.sizeHint')}>
        <Pair>
          <NumberField
            label={t('project.sizeField')}
            icon={SizeIcon}
            value={global.fitSizeMm}
            placeholder=""
            step={5}
            min={MIN_SIZE_MM}
            max={MAX_SIZE_MM}
            onCommit={(value) => updateGlobal({ fitSizeMm: value ?? global.fitSizeMm })}
            onDelta={(delta) =>
              updateGlobal({ fitSizeMm: Math.max(1, round(global.fitSizeMm + delta)) })
            }
          />
          <SelectField
            label={t('project.fit')}
            prefix={t('project.fitPrefix')}
            value={global.fit}
            options={[
              { value: 'max', label: t('project.fit.max') },
              { value: 'width', label: t('project.fit.width') },
              { value: 'height', label: t('project.fit.height') },
            ]}
            onChange={(value) => updateGlobal({ fit: value as 'width' | 'height' | 'max' })}
          />
        </Pair>
      </FieldSection>

      <FieldSection title={t('project.height')} hint={t('project.heightHint')}>
        <Pair>
          <NumberField
            label={t('field.zFrom')}
            icon={HeightFromIcon}
            value={global.defaultZFrom}
            placeholder=""
            step={0.2}
            onCommit={(value) => updateGlobal({ defaultZFrom: value ?? 0 })}
            onDelta={(delta) => updateGlobal({ defaultZFrom: round(global.defaultZFrom + delta) })}
          />
          <NumberField
            label={t('field.zTo')}
            icon={HeightToIcon}
            value={global.defaultZTo}
            placeholder=""
            step={0.2}
            onCommit={(value) => updateGlobal({ defaultZTo: value ?? 0 })}
            onDelta={(delta) => updateGlobal({ defaultZTo: round(global.defaultZTo + delta) })}
          />
        </Pair>
      </FieldSection>

      <FieldSection title={t('project.chamfer')} hint={t('project.chamferHint')}>
        <Pair>
          <NumberField
            label={t('field.chamferTop')}
            icon={ChamferTopIcon}
            value={global.defaultChamferTop}
            placeholder=""
            step={0.1}
            min={0}
            onCommit={(value) => updateGlobal({ defaultChamferTop: value ?? 0 })}
            onDelta={(delta) =>
              updateGlobal({
                defaultChamferTop: Math.max(0, round(global.defaultChamferTop + delta)),
              })
            }
          />
          <NumberField
            label={t('field.chamferBottom')}
            icon={ChamferBottomIcon}
            value={global.defaultChamferBottom}
            placeholder=""
            step={0.1}
            min={0}
            onCommit={(value) => updateGlobal({ defaultChamferBottom: value ?? 0 })}
            onDelta={(delta) =>
              updateGlobal({
                defaultChamferBottom: Math.max(0, round(global.defaultChamferBottom + delta)),
              })
            }
          />
        </Pair>
      </FieldSection>

      <FieldSection title={t('project.clearance')} hint={t('project.clearanceHint')}>
        <NumberField
          label={t('field.clearance')}
          icon={ClearanceIcon}
          value={global.defaultClearance}
          placeholder=""
          step={0.05}
          min={0}
          onCommit={(value) => updateGlobal({ defaultClearance: value ?? 0 })}
          onDelta={(delta) =>
            updateGlobal({ defaultClearance: Math.max(0, round(global.defaultClearance + delta)) })
          }
        />
      </FieldSection>

      <FieldSection title={t('project.quality')} hint={t('project.qualityHint')}>
        <SelectField
          label={t('project.quality')}
          icon={CurveIcon}
          value={String(global.flatness)}
          options={[
            { value: '0.05', label: t('project.quality.draft') },
            { value: '0.02', label: t('project.quality.normal') },
            { value: '0.01', label: t('project.quality.fine') },
            { value: '0.005', label: t('project.quality.max') },
          ]}
          onChange={(value) => updateGlobal({ flatness: Number(value) })}
        />
      </FieldSection>

      <p className="px-3 py-3 text-[10px] leading-snug text-slate-500">{t('project.hint')}</p>
    </>
  );
}

/**
 * «Результат» и «Детали» — одна и та же пара блоков для всего проекта, выделенной группы и
 * объединения. «Scope» — весь документ или поддерево выделения: по нему считаются числа и по нему
 * же собирается список печатных тел, поэтому блоки не меняют вид и смысл при смене выбора.
 */
function StatsPanel() {
  const t = useT();
  const result = useProjectStore((s) => s.result);
  const project = useProjectStore((s) => s.project);
  const parts = useProjectStore((s) => s.parts);
  const leaves = useProjectStore((s) => s.leaves);
  const selectedIds = useProjectStore((s) => s.selectedIds);

  const root = project?.document.root ?? null;
  const selected = root && selectedIds.length === 1 ? findNode(root, selectedIds[0]) : null;
  // A part of a union prints only as part of the merged body: neither block belongs to the piece.
  if (selected && root && findUnionOwner(root, selected.id)) return null;

  const scope = selected ? collectSubtreeIds(selected) : null;
  const scopeLeaves = scope ? leaves.filter((leaf) => scope.has(leaf.id)) : leaves;
  const leafStats = result
    ? scopeLeaves
        .map((leaf) => result.leafStats[leaf.id])
        .filter((value): value is LeafStats => Boolean(value))
    : [];
  const partIds = new Set(scopeLeaves.map((leaf) => leaf.partId));
  const scopeParts = scope ? parts.filter((part) => partIds.has(part.id)) : parts;
  // A selected element can be missing from the model entirely (ignored, hidden in the source or
  // fully covered on top).
  const missing = Boolean(scope) && leafStats.length === 0;
  const ignored =
    selected && project
      ? effectiveSettingsFor(project.document.root, project.settings, project.global, selected.id)
          ?.ignored === true
      : false;

  // Whole project — the numbers the build itself reported; a selection — the same sums over its subtree.
  const totals = !result
    ? null
    : scope
      ? {
          triangles: leafStats.reduce((sum, item) => sum + item.triangleCount, 0),
          volume: leafStats.reduce((sum, item) => sum + item.volume, 0),
          box: unionBoxes(leafStats.map((item) => item.bbox)),
        }
      : {
          triangles: result.stats.triangleCount,
          volume: result.stats.volume,
          box: result.stats.bbox,
        };

  return (
    <>
      <FieldSection title={t('stats.result')}>
        {!result || !project || !totals ? (
          <EmptyStats />
        ) : missing ? (
          <p className="text-[11px] leading-snug text-slate-500">
            {ignored ? t('stats.ignoredMissing') : t('stats.notInModel')}
          </p>
        ) : (
          <dl className="space-y-1 text-[11px]">
            <Row
              label={t('stats.parts')}
              value={String(scope ? scopeParts.length : result.stats.partCount)}
            />
            <Row label={t('stats.triangles')} value={formatNumber(totals.triangles)} />
            <Row label={t('stats.volume')} value={formatVolume(totals.volume)} />
            <Row label={t('stats.box')} value={formatBox(totals.box)} />
            <Row
              label={t('stats.time')}
              value={t('stats.timeValue', { ms: result.stats.durationMs })}
            />
          </dl>
        )}
      </FieldSection>
      {result && project && !missing && scopeParts.length > 0 && (
        <PartsSection parts={scopeParts} />
      )}
    </>
  );
}

/** Same rows as a built model, so the panel keeps its shape before anything is loaded. */
function EmptyStats() {
  const t = useT();
  return (
    <dl className="space-y-1 text-[11px]">
      <Row label={t('stats.parts')} value="—" />
      <Row label={t('stats.triangles')} value="—" />
      <Row label={t('stats.volume')} value="—" />
      <Row label={t('stats.box')} value="—" />
      <Row label={t('stats.time')} value="—" />
    </dl>
  );
}

/** Printed bodies of the result, bottom → top — the same block for the project and for a selection. */
function PartsSection({ parts }: { parts: PartInfo[] }) {
  const t = useT();
  return (
    <FieldSection title={t('stats.details')} hint={t('stats.detailsHint')}>
      <ul className="flex flex-col gap-0.5">
        {parts.map((part) => (
          <li
            key={part.id}
            className="flex items-center gap-2 px-1 py-1 text-[11px] text-slate-300"
          >
            <ColorChip color={part.color} size={11} />
            <span className="truncate">{part.name}</span>
          </li>
        ))}
      </ul>
    </FieldSection>
  );
}

function formatVolume(mm3: number): string {
  return `${(mm3 / 1000).toFixed(2)} ${translate('unit.cm3')}`;
}

function formatBox(box: BBox3): string {
  return `${round(box.max[0] - box.min[0])} × ${round(box.max[1] - box.min[1])} × ${round(
    box.max[2] - box.min[2],
  )} ${translate('unit.mm')}`;
}

function unionBoxes(boxes: BBox3[]): BBox3 {
  const result: BBox3 = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      result.min[axis] = Math.min(result.min[axis], box.min[axis]);
      result.max[axis] = Math.max(result.max[axis], box.max[axis]);
    }
  }
  return result;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="select-text tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
