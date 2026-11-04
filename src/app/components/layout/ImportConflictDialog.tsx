import { useProjectStore } from '../../store/useProjectStore';
import { Dialog, DialogButton } from '../common/Dialog';

/**
 * Asked when an imported SVG carries a name that is already in the history (ADR-0031): continue with
 * the existing project or start a new one from the file.
 */
export function ImportConflictDialog() {
  const pending = useProjectStore((s) => s.pendingImport);
  const resolveImport = useProjectStore((s) => s.resolveImport);
  const cancelImport = useProjectStore((s) => s.cancelImport);

  if (!pending) return null;

  return (
    <Dialog
      title="Проект уже есть"
      onClose={cancelImport}
      footer={
        <>
          <DialogButton onClick={cancelImport}>Отмена</DialogButton>
          <DialogButton onClick={() => resolveImport('new')}>Создать новый</DialogButton>
          <DialogButton variant="primary" onClick={() => resolveImport('existing')}>
            Открыть существующий
          </DialogButton>
        </>
      }
    >
      В истории уже есть проект «{pending.existingName}». Открыть его или создать новый из файла «
      {pending.fileName}»?
    </Dialog>
  );
}
