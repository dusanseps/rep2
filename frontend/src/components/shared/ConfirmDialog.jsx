/**
 * ConfirmDialog – modálne potvrdenie deštruktívnej akcie
 */
export default function ConfirmDialog({ message, confirmLabel = 'Odstrániť', onConfirm, onCancel }) {
  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div class="rep-confirm">
        <p class="rep-confirm__msg">{message}</p>
        <div class="rep-confirm__actions">
          <button class="rep-btn rep-btn--ghost" onClick={onCancel}>Zrušiť</button>
          <button class="rep-btn rep-btn--danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
