import { findNode } from '@core/solver/resolveLeaves';
import { effectiveSettingsFor } from '@core/solver/inheritance';
import type { SvgDocNode } from '@core/model/types';
import { useProjectStore } from '../../store/useProjectStore';
import { NumberField } from '../common/NumberField';
import { ColorChip, Toggle } from '../common/Toggle';
import { HelpHint } from '../common/Icon';
import { SelectField } from '../common/Select';

/**
 * Right panel shows exactly one mode (ADR-0006 UI note): settings of the selected element,
 * or project-wide defaults when nothing is selected. The two are never mixed in one list.
 */
export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const selectedId = useProjectStore((s) => s.selectedId);

  if (!project) return null;

  const node = selectedId ? findNode(project.document.root, selectedId) : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {node ? <ElementPanel node={node} /> : <ProjectPanel />}
      <StatsPanel />
    </div>
  );
}

function ElementPanel({ node }: { node: SvgDocNode }) {
  const project = useProjectStore((s) => s.project);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const select = useProjectStore((s) => s.select);

  if (!project) return null;

  const effective = effectiveSettingsFor(
    project.document.root,
    project.settings,
    project.global,
    node.id,
  );
  if (!effective) return null;
  const own = project.settings[node.id] ?? {};

  return (
    <section className="border-b border-slate-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Элемент
        </h2>
        <button
          type="button"
          onClick={() => select(null)}
          title="К настройкам проекта"
          className="text-[10px] text-slate-500 transition hover:text-slate-200"
        >
          к проекту ✕
        </button>
      </div>
      <div className="mt-2 space-y-3">
            <div className="flex items-center gap-2">
              <ColorChip color={node.fill} size={14} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-100">{node.name}</div>
                <div className="truncate text-[10px] text-slate-500">
                  {node.tag} · {node.id} · {node.kind === 'group' ? 'группа' : 'фигура'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Высота от"
                value={own.zFrom}
                inheritedValue={effective.zFrom}
                step={0.2}
                hint="Нижняя граница выдавливания"
                onChange={(value) => updateSettings(node.id, { zFrom: value })}
              />
              <NumberField
                label="Высота до"
                value={own.zTo}
                inheritedValue={effective.zTo}
                step={0.2}
                hint="Верхняя граница выдавливания, должна быть больше нижней"
                onChange={(value) => updateSettings(node.id, { zTo: value })}
              />
            </div>
            {!(effective.zTo > effective.zFrom) && (
              <p className="text-[11px] text-rose-400">
                «До» должно быть больше «от», иначе элемент будет пропущен.
              </p>
            )}

            <NumberField
              label="Допуск"
              value={own.clearance}
              inheritedValue={effective.clearance}
              step={0.05}
              min={0}
              hint="Зазор на сторону. Отверстие под элемент будет больше на 2× значения"
              onChange={(value) => updateSettings(node.id, { clearance: value })}
            />

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Фаска снизу"
                value={own.chamferBottom}
                inheritedValue={effective.chamferBottom}
                step={0.1}
                min={0}
                hint="Снятие фаски под 45° на нижней грани"
                onChange={(value) => updateSettings(node.id, { chamferBottom: value })}
              />
              <NumberField
                label="Фаска сверху"
                value={own.chamferTop}
                inheritedValue={effective.chamferTop}
                step={0.1}
                min={0}
                hint="Снятие фаски под 45° на верхней грани"
                onChange={(value) => updateSettings(node.id, { chamferTop: value })}
              />
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-3">
              <Toggle
                label="Отдельная деталь"
                checked={own.isPart === true}
                onChange={(checked) => updateSettings(node.id, { isPart: checked ? true : undefined })}
                hint="Верхние элементы будут вырезать гнёзда в этой детали"
              />
              <Toggle
                label="Скрыть"
                checked={effective.hidden}
                onChange={(checked) => updateSettings(node.id, { hidden: checked ? true : undefined })}
              />
            </div>

            <label className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <span>Цвет модели</span>
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  value={own.colorOverride ?? (node.fill === 'none' ? '#000000' : node.fill)}
                  onChange={(event) => updateSettings(node.id, { colorOverride: event.target.value })}
                  className="h-6 w-10 cursor-pointer rounded border border-slate-700 bg-transparent"
                />
                {own.colorOverride !== undefined && (
                  <button
                    type="button"
                    className="text-[10px] text-sky-400 hover:text-sky-300"
                    onClick={() => updateSettings(node.id, { colorOverride: undefined })}
                  >
                    сбросить
                  </button>
                )}
              </span>
            </label>
      </div>
    </section>
  );
}

function ProjectPanel() {
  const project = useProjectStore((s) => s.project);
  const updateGlobal = useProjectStore((s) => s.updateGlobal);
  const distributeZ = useProjectStore((s) => s.distributeZ);

  if (!project) return null;
  const { global } = project;

  return (
    <section className="border-b border-slate-800 p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Настройки проекта
      </h2>
      <p className="mt-1 text-[10px] text-slate-500">Значения по умолчанию для всех элементов</p>
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <NumberField
            label="Размер"
            value={global.fitSizeMm}
            step={5}
            min={1}
            hint="Ширина или высота модели в мм; пропорции сохраняются"
            onChange={(value) => updateGlobal({ fitSizeMm: value ?? global.fitSizeMm })}
          />
          <label className="block">
            <span className="text-xs text-slate-400">по</span>
            <SelectField
              className="mt-1"
              value={global.fit}
              options={[
                { value: 'width', label: 'ширине' },
                { value: 'height', label: 'высоте' },
              ]}
              onChange={(value) => updateGlobal({ fit: value as 'width' | 'height' })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Высота от"
            value={global.defaultZFrom}
            step={0.2}
            onChange={(value) => updateGlobal({ defaultZFrom: value ?? 0 })}
          />
          <NumberField
            label="Высота до"
            value={global.defaultZTo}
            step={0.2}
            onChange={(value) => updateGlobal({ defaultZTo: value ?? 2 })}
          />
        </div>

        <NumberField
          label="Допуск"
          value={global.defaultClearance}
          step={0.05}
          min={0}
          onChange={(value) => updateGlobal({ defaultClearance: value ?? 0 })}
        />

        <label className="block">
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <span>Качество кривых</span>
            <HelpHint text="Допуск спрямления кривых: точнее — больше треугольников и медленнее расчёт" />
          </span>
          <SelectField
            className="mt-1"
            value={String(global.flatness)}
            options={[
              { value: '0.05', label: 'Черновое' },
              { value: '0.02', label: 'Обычное' },
              { value: '0.005', label: 'Точное' },
              { value: '0.001', label: 'Максимальное' },
            ]}
            onChange={(value) => updateGlobal({ flatness: Number(value) })}
          />
        </label>

        <button
          type="button"
          onClick={distributeZ}
          className="w-full rounded-md border border-slate-700 px-2 py-1.5 text-[11px] text-slate-300 hover:border-slate-500 hover:text-white"
          title="Каждой детали — свой диапазон высот с перекрытием 0.5 мм"
        >
          Разложить по слоям
        </button>

        <p className="pt-1 text-[10px] leading-snug text-slate-500">
          Чтобы настроить конкретный элемент, выберите его в дереве слева.
        </p>
      </div>
    </section>
  );
}

function StatsPanel() {
  const result = useProjectStore((s) => s.result);
  const project = useProjectStore((s) => s.project);
  const parts = useProjectStore((s) => s.parts);

  if (!project) return null;

  return (
    <section className="p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Результат
      </h2>
      {!result ? (
        <p className="mt-2 text-xs text-slate-500">Модель не построена</p>
      ) : (
        <dl className="mt-2 space-y-1 text-[11px]">
          <Row label="Деталей" value={String(result.stats.partCount)} />
          <Row label="Треугольников" value={result.stats.triangleCount.toLocaleString('ru-RU')} />
          <Row label="Объём" value={`${(result.stats.volume / 1000).toFixed(2)} см³`} />
          <Row
            label="Габариты"
            value={`${round(result.stats.bbox.max[0] - result.stats.bbox.min[0])} × ${round(
              result.stats.bbox.max[1] - result.stats.bbox.min[1],
            )} × ${round(result.stats.bbox.max[2] - result.stats.bbox.min[2])} мм`}
          />
          <Row label="Время" value={`${result.stats.durationMs} мс`} />
        </dl>
      )}

      {parts.length > 1 && (
        <div className="mt-3 space-y-1">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500">Детали</h3>
          {parts.map((part) => (
            <div key={part.id} className="flex items-center gap-2 text-[11px] text-slate-300">
              <ColorChip color={part.color} size={10} />
              <span className="truncate">{part.name}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
