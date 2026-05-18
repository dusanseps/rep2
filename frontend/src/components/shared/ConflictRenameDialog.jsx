import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { showErrorToast } from '../ui/Toasts.jsx';
import { buildSuggestedName } from '../../utils/fileNames.js';

export default function ConflictRenameDialog(props) {
  const [renameValue, setRenameValue] = createSignal(props.suggestedName || buildSuggestedName(props.itemName));

  createEffect(() => {
    setRenameValue(props.suggestedName || buildSuggestedName(props.itemName));
  });

  const normalize = props.normalizeName || ((v) => String(v || '').trim());
  const validate = props.validateName || (() => null);

  const submitRename = () => {
    const nextName = normalize(renameValue());
    const err = validate(nextName);
    if (err) {
      showErrorToast(err);
      return;
    }
    props.onRename?.(nextName);
  };

  const canRename = createMemo(() => {
    const current = normalize(renameValue());
    const original = normalize(props.itemName);
    if (!current) return false;
    return current.toLowerCase() !== original.toLowerCase();
  });

  return (
    <div
      class="rep-overlay"
      style={{ 'z-index': 12050 }}
      onClick={(e) => { if (e.target === e.currentTarget) props.onCancel?.(); }}
    >
      <div class="rep-confirm docs-upload-conflict">
        <h3 class="docs-upload-conflict__title">{props.title}</h3>
        <p class="rep-confirm__msg docs-upload-conflict__msg">
          {props.descriptionPrefix} <strong>{props.itemName}</strong>.
          {props.descriptionSuffix}
        </p>

        <div class="docs-upload-conflict__rename">
          <label class="rep-form__label" for={props.inputId || 'docs-conflict-rename'}>Nový názov</label>
          <input
            id={props.inputId || 'docs-conflict-rename'}
            class="rep-form__input"
            type="text"
            value={renameValue()}
            onInput={(e) => setRenameValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') props.onCancel?.();
            }}
          />
        </div>

        <div class="rep-confirm__actions docs-upload-conflict__actions">
          <button class="rep-btn rep-btn--ghost" onClick={props.onCancel}>{props.cancelLabel || 'Zrušiť'}</button>
          <button class={props.renameButtonClass || 'rep-btn rep-btn--ghost'} onClick={submitRename} disabled={!canRename()}>
            Uložiť s novým názvom
          </button>
          <Show when={props.onOverwrite}>
            <button class="rep-btn rep-btn--danger" onClick={props.onOverwrite}>{props.overwriteLabel || 'Nahradiť súbor'}</button>
          </Show>
        </div>
      </div>
    </div>
  );
}
