import { useProjectStore } from '../../store/useProjectStore';
import { useT } from '../../i18n';
import { Dialog, DialogButton } from '../common/Dialog';

/**
 * Asked when an imported SVG carries a name that is already in the history (ADR-0031): continue with
 * the existing project or start a new one from the file.
 */
export function ImportConflictDialog() {
  const t = useT();
  const pending = useProjectStore((s) => s.pendingImport);
  const resolveImport = useProjectStore((s) => s.resolveImport);
  const cancelImport = useProjectStore((s) => s.cancelImport);

  if (!pending) return null;

  return (
    <Dialog
      title={t('import.exists.title')}
      onClose={cancelImport}
      footer={
        <>
          <DialogButton onClick={cancelImport}>{t('common.cancel')}</DialogButton>
          <DialogButton onClick={() => resolveImport('new')}>
            {t('import.exists.create')}
          </DialogButton>
          <DialogButton variant="primary" onClick={() => resolveImport('existing')}>
            {t('import.exists.open')}
          </DialogButton>
        </>
      }
    >
      {t('import.exists.body', {
        existing: pending.existingName,
        file: pending.fileName,
      })}
    </Dialog>
  );
}
