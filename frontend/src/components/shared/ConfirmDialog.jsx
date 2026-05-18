/**
 * ConfirmDialog – modálne potvrdenie deštruktívnej akcie
 */
import { onCleanup, onMount } from 'solid-js';

export default function ConfirmDialog({
  message,
  confirmLabel = 'Odstrániť',
  cancelLabel = 'Zrušiť',
  confirmOnEnter = false,
  onConfirm,
  onCancel,
}) {
  onMount(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
      }
      if (confirmOnEnter && e.key === 'Enter') {
        e.preventDefault();
        onConfirm?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div class="rep-confirm">
        <p class="rep-confirm__msg">{message}</p>
        <div class="rep-confirm__actions">
          <button class="rep-btn rep-btn--ghost" onClick={onCancel}>{cancelLabel}</button>
          <button class="rep-btn rep-btn--danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
