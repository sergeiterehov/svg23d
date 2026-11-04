# Architecture Decision Records

Формат: `NNNN-короткое-имя.md`. Один файл — одно решение. Шаблон: `template.md`.

Новое решение: скопировать шаблон, взять следующий свободный номер, добавить строку в таблицу ниже.
Отменённое решение не удаляем — ставим `Status: Superseded by ADR-XXXX` и оставляем историю.

| # | Решение | Статус |
| --- | --- | --- |
| [0001](0001-frontend-stack.md) | Стек фронтенда: React 19 + TypeScript + Vite + Tailwind + zustand + three.js | Accepted |
| [0002](0002-geometry-engine-manifold.md) | Геометрическое ядро — manifold-3d (WASM) | Accepted |
| [0003](0003-print-parts-model.md) | Модель сборки: набор отдельных печатных деталей с гнёздами | Accepted |
| [0004](0004-cut-priority-paint-order.md) | Приоритет вырезания = порядок отрисовки SVG + ручной порядок | Accepted |
| [0005](0005-clearance-semantics.md) | Допуск = зазор на сторону; резак = offset(+clearance) с той же фаской | Accepted |
| [0006](0006-group-inheritance.md) | Группы `<g>`: объединение детей и наследование настроек | Accepted |
| [0007](0007-chamfer-45-stepped.md) | Фаски: 45°, размер в мм, ступенчатая тесселяция | Accepted |
| [0008](0008-export-formats.md) | Экспорт: 3MF (мультиобъект, цвета) + бинарный STL; STEP вне MVP | Accepted |
| [0009](0009-units-and-scale.md) | Единицы и система координат: мм, Z вверх, fit по стороне | Accepted |
| [0010](0010-worker-protocol.md) | Геометрия в Web Worker, протокол job/result с отменой | Accepted |
| [0011](0011-svg-scope.md) | Область поддержки SVG в MVP | Accepted |
| [0012](0012-testing-strategy.md) | Тестирование: инварианты геометрии вместо скриншотов | Accepted |
| [0013](0013-project-file-format.md) | Формат файла проекта `.svg23d.json` | Accepted |
| [0014](0014-stroke-to-geometry.md) | Обводка (stroke) → отдельный элемент геометрии | Accepted |
| [0015](0015-mask-support.md) | Маски (`mask`) как 2D-вычитание в солвере | Accepted |
| [0016](0016-preview-rendering.md) | Рендеринг предпросмотра: плоские нормали и пресеты вида | Accepted |
| [0017](0017-projection-and-nav-cube.md) | Проекция 3D-камеры (перспектива/ортогональ) и навигационный куб | Accepted |
| [0018](0018-distribute-layers.md) | «Разложить по слоям»: элемент встаёт на накрывающий его слой | Accepted |
| [0019](0019-multi-selection-and-deltas.md) | Множественный выбор и дельты в числовых полях | Accepted |
| [0020](0020-height-arrows-on-model.md) | Стрелки высоты на самой 3D-модели | Accepted |
| [0021](0021-parameter-limits.md) | Границы параметров и «нулевая» высота | Accepted |
