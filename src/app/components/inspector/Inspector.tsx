import { findNode, type PartInfo } from '@core/solver/resolveLeaves';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import { collectSubtreeIds, findUnionOwner } from '@core/solver/selection';
import type { BBox3, LeafStats, NodeSettings, ResolvedLeaf, SvgDocNode } from '@core/model/types';
import { useProjectStore, type BuildResultState } from '../../store/useProjectStore';
import {
  MAX_CLEARANCE_MM,
  MAX_SIZE_MM,
  MIN_HEIGHT_MM,
  MIN_SIZE_MM,
  maxChamfer,
} from '@core/model/limits';
import { NumberField } from '../common/NumberField';
import { ColorChip, MixedColorChip, Toggle } from '../common/Toggle';
import {
  ChamferBottomIcon,
  ChamferTopIcon,
  ClearanceIcon,
  CurveIcon,
  HelpHint,
  HeightFromIcon,
  HeightToIcon,
  ResetIcon,
  SizeIcon,
} from '../common/Icon';
import { SelectField } from '../common/Select';

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

/** One block of related fields: caption on the left, optional actions on the right. */
function Section({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-slate-800/70 px-3 py-2.5">
      <div className="flex min-h-4 items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-200">
          <span className="truncate">{title}</span>
          {hint && <HelpHint text={hint} />}
        </h2>
        {right}
      </div>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </section>
  );
}

/** Pair of two fields in one row, like Figma's W/H or X/Y. */
function Pair({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}

function BackToProject() {
  const select = useProjectStore((s) => s.select);
  return (
    <button
      type="button"
      onClick={() => select(null)}
      title="К настройкам проекта"
      className="shrink-0 text-[10px] text-slate-500 transition hover:text-slate-200"
    >
      к проекту ✕
    </button>
  );
}

function ElementPanel({ node }: { node: SvgDocNode }) {
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
      <Section title="Элемент" right={<BackToProject />}>
        <div className="flex items-center gap-2">
          <ColorChip color={node.fill} size={14} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-100">{node.name}</div>
            <div className="truncate text-[10px] text-slate-500">
              {node.tag} · {node.id} ·{' '}
              {node.union
                ? 'объединение'
                : unionParent
                  ? 'часть объединения'
                  : node.kind === 'group'
                    ? 'группа'
                    : 'фигура'}
            </div>
          </div>
        </div>
        {node.union && (
          <p className="text-[10px] leading-snug text-slate-500">
            Объединение: фигуры внутри слиты в одну деталь на 2D-уровне, их личные настройки не
            учитываются — высоты, фаска и допуск действуют на всё тело. Содержимое можно менять:
            перетаскивать, удалять и добавлять части.
          </p>
        )}
        {unionParent && (
          <p className="text-[10px] leading-snug text-amber-400/90">
            Часть объединения «{unionParent.name}»: печатается одним телом, личные настройки части
            не действуют.{' '}
            <button
              type="button"
              onClick={() => select(unionParent.id)}
              className="text-sky-400 transition hover:text-sky-300"
            >
              Выбрать объединение
            </button>
          </p>
        )}
      </Section>

      {unionParent && <UnionPartSections node={node} unionParent={unionParent} />}

      {!unionParent && (
        <>
          <Section
            title="Высота"
            hint="Нижняя и верхняя граница выдавливания. «До» не может быть ниже «от»."
          >
            <Pair>
              <NumberField
                label="Высота от"
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
                label="Высота до"
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
              <p className="text-[11px] text-rose-400">
                «До» меньше «от» — элемент не будет напечатан.
              </p>
            )}
          </Section>

          <Section
            title="Фаска"
            hint="Снятие под 45° на верхней и нижней грани; не больше половины высоты элемента."
          >
            <Pair>
              <NumberField
                label="Фаска сверху"
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
                label="Фаска снизу"
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
          </Section>

          <Section
            title="Гнёзда"
            hint="Зазор на сторону: отверстие под этот элемент будет больше на 2× значения. Гнездо вырезается в деталях, которые лежат ниже."
          >
            <NumberField
              label="Допуск"
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
              label="Отдельная деталь"
              checked={own.isPart === true}
              onChange={(checked) =>
                updateSettings(node.id, { isPart: checked ? true : undefined })
              }
              hint="Верхние элементы будут вырезать гнёзда в этой детали"
            />
          </Section>

          <Section title="Вид">
            <ColorField
              value={own.colorOverride ?? (node.union ? unionFill(node) : colourOf(node))}
              // A group has no colour of its own: its children bring their own, so "none" is the default.
              empty={
                node.kind === 'group' && !node.union && own.colorOverride === undefined
                  ? 'нет'
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
              label="Скрыть"
              checked={effective.hidden}
              // A group hides its whole subtree; a child cannot undo that on its own.
              disabled={effective.hidden && own.hidden !== true}
              hint={
                effective.hidden && own.hidden !== true
                  ? 'Элемент скрыт вместе с группой — снимите «Скрыть» у группы'
                  : undefined
              }
              onChange={(checked) =>
                updateSettings(node.id, { hidden: checked ? true : undefined })
              }
            />
          </Section>
        </>
      )}
    </>
  );
}

/**
 * A part of a union: only the things that make sense for a piece are offered — its visibility
 * (it is still a shape of the document) and its place in the stack. Geometry comes from the union.
 */
function UnionPartSections({ node, unionParent }: { node: SvgDocNode; unionParent: SvgDocNode }) {
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
    <Section
      title={`Часть объединения «${unionParent.name}»`}
      hint="Высоты, фаска, допуск и цвет задаются у самого объединения: части сливаются в одно тело до выдавливания."
    >
      <Toggle
        label="Скрыть часть"
        checked={effective?.hidden === true}
        disabled={effective?.hidden === true && own.hidden !== true}
        hint="Скрытая часть не входит в объединение — например, чтобы убрать обводку"
        onChange={(checked) => updateSettings(node.id, { hidden: checked ? true : undefined })}
      />
    </Section>
  );
}

type NumericKey = 'zFrom' | 'zTo' | 'clearance' | 'chamferTop' | 'chamferBottom';

/** Settings panel for a multi-selection: equal values are shown, different ones as a range. */
function MultiPanel({ nodes }: { nodes: SvgDocNode[] }) {
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

  const setFlags = (key: 'isPart' | 'hidden', value: boolean) =>
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
  const unionParents = nodes.map((node) => findUnionOwner(root, node.id));
  const namesText = nodes
    .slice(0, 4)
    .map((node) => node.name)
    .join(', ');

  // Every selected node is a part of a union: nothing here can reach the model.
  if (unionParents.every((parent) => parent !== null)) {
    return (
      <Section title={`Выбрано: ${nodes.length}`} right={<BackToProject />}>
        <p className="truncate text-[11px] text-slate-500">
          {namesText}
          {nodes.length > 4 ? ` и ещё ${nodes.length - 4}` : ''}
        </p>
        <p className="text-[10px] leading-snug text-amber-400/90">
          Это части объединений: каждая печатается в составе своего тела, поэтому высоты, фаска и
          допуск задаются у самого объединения. Скрыть часть по отдельности можно в дереве.
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section
        title={`Выбрано: ${nodes.length}`}
        hint="⌘/Ctrl-клик по дереву добавляет элемент к выбору. Пустое поле с разбросом вроде «12-15» значит разные значения."
        right={<BackToProject />}
      >
        <p className="truncate text-[11px] text-slate-500">
          {namesText}
          {nodes.length > 4 ? ` и ещё ${nodes.length - 4}` : ''}
        </p>
        {unionParents.some((parent) => parent !== null) && (
          <p className="text-[10px] leading-snug text-amber-400/90">
            Части объединений в выборке: их личные настройки не действуют.
          </p>
        )}
      </Section>

      <Section title="Высота" hint="Применяется ко всем выбранным элементам.">
        <Pair>
          <NumberField
            label="Высота от"
            icon={HeightFromIcon}
            value={zFrom.value}
            placeholder={zFrom.placeholder}
            step={0.2}
            onCommit={zFrom.commit}
            onDelta={(delta) => zFrom.delta(delta)}
          />
          <NumberField
            label="Высота до"
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
        }) && (
          <p className="text-[11px] text-rose-400">
            У части элементов «до» меньше «от» — они не будут напечатаны.
          </p>
        )}
      </Section>

      <Section
        title="Фаска"
        hint="Снятие под 45° на верхней и нижней грани (не больше половины высоты элемента)."
      >
        <Pair>
          <NumberField
            label="Фаска сверху"
            icon={ChamferTopIcon}
            value={chamferTop.value}
            placeholder={chamferTop.placeholder}
            step={0.1}
            min={0}
            onCommit={chamferTop.commit}
            onDelta={(delta) => chamferTop.delta(delta, 0)}
          />
          <NumberField
            label="Фаска снизу"
            icon={ChamferBottomIcon}
            value={chamferBottom.value}
            placeholder={chamferBottom.placeholder}
            step={0.1}
            min={0}
            onCommit={chamferBottom.commit}
            onDelta={(delta) => chamferBottom.delta(delta, 0)}
          />
        </Pair>
      </Section>

      <Section title="Гнёзда" hint="Зазор на сторону в гнёздах, которые эти элементы вырезают.">
        <NumberField
          label="Допуск"
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
          label="Отдельная деталь"
          checked={isPart.checked}
          mixed={isPart.mixed}
          onChange={(checked) => setFlags('isPart', checked)}
          hint="Применяется ко всем выбранным элементам"
        />
      </Section>

      <Section title="Вид">
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
          label="Скрыть"
          checked={hidden.checked}
          mixed={hidden.mixed}
          onChange={(checked) => setFlags('hidden', checked)}
        />
      </Section>
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
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-400">Цвет модели</span>
      <span className="flex items-center gap-1.5">
        {mixed && (
          <>
            <MixedColorChip colors={mixedColors ?? [value, value]} size={12} />
            <span className="text-[10px] text-slate-500">разное</span>
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
            aria-label="Цвет модели"
            value={value}
            onChange={(event) => onPick(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {onReset && (
          <button
            type="button"
            title="Сбросить к цвету из документа"
            aria-label="Сбросить цвет"
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
  const project = useProjectStore((s) => s.project);
  const updateGlobal = useProjectStore((s) => s.updateGlobal);

  if (!project) return null;
  const { global } = project;

  return (
    <>
      <Section title="Настройки проекта">
        <p className="text-[10px] leading-snug text-slate-500">
          Значения по умолчанию для всех элементов
        </p>
      </Section>

      <Section
        title="Размер"
        hint="Ширина, высота или бо́льшая сторона модели в мм; пропорции сохраняются."
      >
        <Pair>
          <NumberField
            label="Размер модели"
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
            label="Подгонять по"
            prefix="по"
            value={global.fit}
            options={[
              { value: 'max', label: 'максимуму' },
              { value: 'width', label: 'ширине' },
              { value: 'height', label: 'высоте' },
            ]}
            onChange={(value) => updateGlobal({ fit: value as 'width' | 'height' | 'max' })}
          />
        </Pair>
      </Section>

      <Section title="Высота" hint="Границы выдавливания по умолчанию, мм.">
        <Pair>
          <NumberField
            label="Высота от"
            icon={HeightFromIcon}
            value={global.defaultZFrom}
            placeholder=""
            step={0.2}
            onCommit={(value) => updateGlobal({ defaultZFrom: value ?? 0 })}
            onDelta={(delta) => updateGlobal({ defaultZFrom: round(global.defaultZFrom + delta) })}
          />
          <NumberField
            label="Высота до"
            icon={HeightToIcon}
            value={global.defaultZTo}
            placeholder=""
            step={0.2}
            onCommit={(value) => updateGlobal({ defaultZTo: value ?? 0 })}
            onDelta={(delta) => updateGlobal({ defaultZTo: round(global.defaultZTo + delta) })}
          />
        </Pair>
      </Section>

      <Section title="Фаска" hint="Снятие под 45° на верхней и нижней грани по умолчанию.">
        <Pair>
          <NumberField
            label="Фаска сверху"
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
            label="Фаска снизу"
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
      </Section>

      <Section title="Допуск" hint="Зазор на сторону в гнёздах между соседними деталями.">
        <NumberField
          label="Допуск"
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
      </Section>

      <Section
        title="Качество кривых"
        hint="Допуск спрямления кривых: точнее — больше треугольников и медленнее расчёт"
      >
        <SelectField
          label="Качество кривых"
          icon={CurveIcon}
          value={String(global.flatness)}
          options={[
            { value: '0.05', label: 'Черновое' },
            { value: '0.02', label: 'Обычное' },
            { value: '0.01', label: 'Точное' },
            { value: '0.005', label: 'Максимальное' },
          ]}
          onChange={(value) => updateGlobal({ flatness: Number(value) })}
        />
      </Section>

      <p className="px-3 py-3 text-[10px] leading-snug text-slate-500">
        Чтобы настроить конкретный элемент, выберите его в дереве слева.
      </p>
    </>
  );
}

function StatsPanel() {
  const result = useProjectStore((s) => s.result);
  const project = useProjectStore((s) => s.project);
  const parts = useProjectStore((s) => s.parts);
  const leaves = useProjectStore((s) => s.leaves);
  const selectedIds = useProjectStore((s) => s.selectedIds);

  const root = project?.document.root ?? null;
  const selected = root && selectedIds.length === 1 ? findNode(root, selectedIds[0]) : null;
  // A part of a union has no body of its own: the numbers belong to the whole merged object.
  const node = selected && root ? (findUnionOwner(root, selected.id) ?? selected) : null;

  return (
    <section className="px-3 py-2.5">
      <h2 className="text-[11px] font-semibold text-slate-200">Результат</h2>

      {!result || !project ? (
        <EmptyStats />
      ) : !node ? (
        <>
          <dl className="mt-2 space-y-1 text-[11px]">
            <Row label="Деталей" value={String(result.stats.partCount)} />
            <Row label="Треугольников" value={result.stats.triangleCount.toLocaleString('ru-RU')} />
            <Row label="Объём" value={formatVolume(result.stats.volume)} />
            <Row label="Габариты" value={formatBox(result.stats.bbox)} />
            <Row label="Время" value={`${result.stats.durationMs} мс`} />
          </dl>
          {parts.length > 1 && <PartList parts={parts} />}
        </>
      ) : (
        <SelectionStats node={node} result={result} parts={parts} leaves={leaves} />
      )}
    </section>
  );
}

/** Same rows as a built model, so the panel keeps its shape before anything is loaded. */
function EmptyStats() {
  return (
    <dl className="mt-2 space-y-1 text-[11px]">
      <Row label="Деталей" value="—" />
      <Row label="Треугольников" value="—" />
      <Row label="Объём" value="—" />
      <Row label="Габариты" value="—" />
      <Row label="Время" value="—" />
    </dl>
  );
}

/** Numbers for the selected element (a shape) or the sum over its subtree (a group). */
function SelectionStats({
  node,
  result,
  parts,
  leaves,
}: {
  node: SvgDocNode;
  result: BuildResultState;
  parts: PartInfo[];
  leaves: ResolvedLeaf[];
}) {
  const subtree = collectSubtreeIds(node);
  const nodeLeaves = leaves.filter((leaf) => subtree.has(leaf.id));
  const stats = nodeLeaves
    .map((leaf) => result.leafStats[leaf.id])
    .filter((value): value is LeafStats => Boolean(value));

  if (stats.length === 0) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Элемент не вошёл в модель: полностью перекрыт верхними элементами или пуст.
      </p>
    );
  }

  const volume = stats.reduce((sum, item) => sum + item.volume, 0);
  const triangles = stats.reduce((sum, item) => sum + item.triangleCount, 0);
  const box = unionBoxes(stats.map((item) => item.bbox));

  const partIds = new Set(nodeLeaves.map((leaf) => leaf.partId));
  const groupParts = parts.filter((part) => partIds.has(part.id));

  return (
    <>
      <dl className="mt-2 space-y-1 text-[11px]">
        {node.kind === 'group' && <Row label="Элементов" value={String(stats.length)} />}
        <Row label="Треугольников" value={triangles.toLocaleString('ru-RU')} />
        <Row label="Объём" value={formatVolume(volume)} />
        <Row label="Габариты" value={formatBox(box)} />
      </dl>
      {node.kind === 'group' && groupParts.length > 0 && <PartList parts={groupParts} />}
    </>
  );
}

function PartList({ parts }: { parts: PartInfo[] }) {
  return (
    <div className="mt-3 space-y-1">
      <h3 className="text-[10px] uppercase tracking-wider text-slate-500">Детали</h3>
      {parts.map((part) => (
        <div key={part.id} className="flex items-center gap-2 text-[11px] text-slate-300">
          <ColorChip color={part.color} size={10} />
          <span className="truncate">{part.name}</span>
        </div>
      ))}
    </div>
  );
}

function formatVolume(mm3: number): string {
  return `${(mm3 / 1000).toFixed(2)} см³`;
}

function formatBox(box: BBox3): string {
  return `${round(box.max[0] - box.min[0])} × ${round(box.max[1] - box.min[1])} × ${round(
    box.max[2] - box.min[2],
  )} мм`;
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

function colourOf(node: SvgDocNode): string {
  return node.fill === 'none' ? '#cccccc' : node.fill;
}

/** Colour of a union object: its own fill, or the first coloured shape inside (the solver's rule). */
function unionFill(node: SvgDocNode): string {
  if (node.fill !== 'none') return node.fill;
  const stack = [...node.children];
  while (stack.length > 0) {
    const next = stack.shift() as SvgDocNode;
    if (next.kind === 'shape' && next.fill !== 'none') return next.fill;
    stack.push(...next.children);
  }
  return '#cccccc';
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
