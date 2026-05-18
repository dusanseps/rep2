import { For, Show, createSignal } from 'solid-js';

export default function DocumentDeleteConflictDialog({
  links = [],
  userId,
  userRole,
  onCancel,
  onDeleteDocument,
  onRefresh,
  onEditLink,
}) {
  const [deleting, setDeleting] = createSignal(false);

  // Rozdelíme na moje a cudzie
  const myLinks = links.filter(l => l.ownerId === userId);
  const otherLinks = links.filter(l => l.ownerId !== userId);
  const isAdmin = userRole === 'admin';
  const canDeleteDocument = isAdmin || (otherLinks.length === 0);
  const hasLinks = links.length > 0;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteDocument?.();
      onCancel?.();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div class="rep-confirm" style={{'min-width': '420px', 'max-width': '90vw'}}>
        <Show when={hasLinks}>
          <h3 class="rep-confirm__msg" style={{'margin-bottom': '12px'}}>Tento dokument je pripojený k iným záznamom</h3>
          <div class="docs-conflict-list">
            <Show when={myLinks.length > 0}>
              <div class="docs-conflict-group">
                <div class="docs-conflict-group__title">Moje záznamy</div>
                <For each={myLinks}>{link => (
                  <div class="docs-conflict-item">
                    <span class="docs-conflict-item__type">{link.type === 'news' ? 'Novinka' : 'Ticker správa'}</span>
                    <span class="docs-conflict-item__title">{link.title}</span>
                    <button class="rep-btn rep-btn--ghost" onClick={() => onEditLink?.(link)}>Upraviť</button>
                  </div>
                )}</For>
              </div>
            </Show>
            <Show when={otherLinks.length > 0}>
              <div class="docs-conflict-group">
                <div class="docs-conflict-group__title">Ostatné záznamy</div>
                <For each={otherLinks}>{link => (
                  <div class="docs-conflict-item">
                    <span class="docs-conflict-item__type">{link.type === 'news' ? 'Novinka' : 'Ticker správa'}</span>
                    <span class="docs-conflict-item__title">{link.title}</span>
                    <Show when={isAdmin}>
                      <button class="rep-btn rep-btn--ghost" onClick={() => onEditLink?.(link)}>Upraviť</button>
                    </Show>
                  </div>
                )}</For>
              </div>
            </Show>
          </div>
          <div class="rep-confirm__actions" style={{'margin-top': '18px', 'gap': '8px'}}>
            <button class="rep-btn rep-btn--ghost" onClick={onCancel}>Zrušiť</button>
            <button class="rep-btn rep-btn--ghost" onClick={onRefresh}>Aktualizovať</button>
            <button class="rep-btn rep-btn--danger" disabled={true} style={{'opacity': '0.5', 'cursor': 'not-allowed'}}>Zmazať súbor</button>
          </div>
          <div class="docs-conflict-hint">Kým existujú odkazy, dokument nie je možné zmazať. Upravte alebo zmažte väzby.</div>
        </Show>

        <Show when={!hasLinks}>
          <h3 class="rep-confirm__msg" style={{'margin-bottom': '12px'}}>Naozaj zmazať tento súbor?</h3>
          <div class="rep-confirm__actions" style={{'margin-top': '18px'}}>
            <button class="rep-btn rep-btn--ghost" onClick={onCancel} disabled={deleting()}>Zrušiť</button>
            <button class="rep-btn rep-btn--danger" onClick={handleDelete} disabled={deleting()}>{deleting() ? 'Mazím...' : 'Zmazať súbor'}</button>
          </div>
        </Show>
      </div>
    </div>
  );
}

