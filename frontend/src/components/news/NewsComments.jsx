import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { showErrorToast, showSuccessToast } from '../ui/Toasts.jsx';
import {
  fetchNewsComments,
  createNewsComment,
  updateNewsComment,
  deleteNewsComment,
} from '../../services/sp.js';

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function shortenText(value, max = 160) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

const PAGE_SIZE = 5;
const API = import.meta.env.VITE_API_BASE || '/api';

export default function NewsComments(props) {
  const [draft, setDraft] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal(null);
  const [editingId, setEditingId] = createSignal(null);
  const [editDraft, setEditDraft] = createSignal('');
  const [sortOrder, setSortOrder] = createSignal('newest');
  const [page, setPage] = createSignal(1);

  const [comments, { refetch }] = createResource(
    () => (props.newsId ? String(props.newsId) : null),
    async (newsId) => {
      return fetchNewsComments(newsId);
    }
  );

  // Fix: depend on sortOrder() so sorting updates
  const byParent = createMemo(() => {
    const list = comments() || [];
    const isNewest = sortOrder() === 'newest';
    const sortByCreated = (a, b) => {
      const diff = (a.createdAt?.getTime?.() || 0) - (b.createdAt?.getTime?.() || 0);
      return isNewest ? -diff : diff;
    };

    // sortOrder() dependency
    sortOrder();

    const top = list
      .filter((c) => !c.parentCommentId)
      .sort(sortByCreated);

    return top.map((root) => ({
      ...root,
      replies: list
        .filter((c) => c.parentCommentId === root.id)
        .sort(sortByCreated),
    }));
  });

  const totalPages = createMemo(() => {
    const total = byParent().length;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  });

  const pagedComments = createMemo(() => {
    const currentPage = Math.min(page(), totalPages());
    const start = (currentPage - 1) * PAGE_SIZE;
    return byParent().slice(start, start + PAGE_SIZE);
  });

  createEffect(() => {
    if (page() > totalPages()) {
      setPage(totalPages());
    }
  });

  createEffect(() => {
    sortOrder();
    setPage(1);
  });

  onMount(() => {
    let source;
    try {
      source = new EventSource(`${API}/news/subscribe`);
      source.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          const isCommentEvent = payload?.type === 'comment_create' || payload?.type === 'comment_update' || payload?.type === 'comment_delete';
          if (!isCommentEvent) return;
          if (String(payload.newsId) !== String(props.newsId)) return;
          refetch();
        } catch (_err) {
          // ignore malformed events
        }
      });
      source.addEventListener('error', () => {
        source?.close();
      });
    } catch (_err) {
      // SSE optional, comments still work without live updates
    }

    onCleanup(() => {
      source?.close();
    });
  });

  const selectedReply = createMemo(() => {
    const target = replyTo();
    if (!target) return null;
    return (comments() || []).find((c) => c.id === target) || null;
  });

  async function submitComment() {
    const text = String(draft() || '').trim();
    if (!text) return;
    if (text.length > 4000) {
      showErrorToast('Komentár je príliš dlhý (max 4000 znakov).');
      return;
    }

    setSubmitting(true);
    try {
      await createNewsComment(props.newsId, {
        content: text,
        parentCommentId: replyTo(),
      });
      setDraft('');
      setReplyTo(null);
      await refetch();
      showSuccessToast('Komentár bol pridaný.');
    } catch (err) {
      showErrorToast(err.message || 'Nepodarilo sa pridať komentár.');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(comment) {
    setEditingId(comment.id);
    setEditDraft(comment.content || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  async function saveEdit(commentId) {
    const text = String(editDraft() || '').trim();
    if (!text) {
      showErrorToast('Komentár nemôže byť prázdny.');
      return;
    }
    if (text.length > 4000) {
      showErrorToast('Komentár je príliš dlhý (max 4000 znakov).');
      return;
    }

    setSubmitting(true);
    try {
      await updateNewsComment(props.newsId, commentId, { content: text });
      cancelEdit();
      await refetch();
      showSuccessToast('Komentár bol upravený.');
    } catch (err) {
      showErrorToast(err.message || 'Nepodarilo sa upraviť komentár.');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeComment(commentId) {
    if (!window.confirm('Naozaj chcete zmazať tento komentár?')) return;

    setSubmitting(true);
    try {
      await deleteNewsComment(props.newsId, commentId);
      if (replyTo() === commentId) setReplyTo(null);
      if (editingId() === commentId) cancelEdit();
      await refetch();
      showSuccessToast('Komentár bol zmazaný.');
    } catch (err) {
      showErrorToast(err.message || 'Nepodarilo sa zmazať komentár.');
    } finally {
      setSubmitting(false);
    }
  }

  const renderMeta = (comment) => {
    const created = formatDateTime(comment.createdAt);
    const edited = formatDateTime(comment.editedAt);
    return (
      <div style={{ 'font-size': '12px', color: '#64748b', display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
        <span>{comment.authorName || 'Používateľ'}</span>
        <Show when={created}><span>{created}</span></Show>
        <Show when={comment.editedAt}><span>zmenené {edited}</span></Show>
      </div>
    );
  };

  const renderCommentCard = (comment, isReply = false) => (
    <div
      style={{
        border: '1px solid #e2e8f0',
        'border-radius': '8px',
        padding: '10px 12px',
        background: '#fff',
        'margin-top': isReply ? '8px' : '0',
      }}
    >
      {renderMeta(comment)}

      <Show when={comment.parentPreview && comment.parentCommentId}>
        <div style={{
          'margin-top': '8px',
          'margin-bottom': '8px',
          padding: '8px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          'border-left': '3px solid #94a3b8',
          'border-radius': '6px',
          'font-size': '13px',
          color: '#475569',
          'white-space': 'pre-wrap',
        }}>
          {shortenText(comment.parentPreview)}
        </div>
      </Show>

      <Show
        when={editingId() === comment.id}
        fallback={<div style={{ 'margin-top': '8px', 'white-space': 'pre-wrap', 'word-break': 'break-word' }}>{comment.content}</div>}
      >
        <div style={{ 'margin-top': '8px' }}>
          <textarea
            class="rep-form__input"
            value={editDraft()}
            onInput={(e) => setEditDraft(e.currentTarget.value)}
            rows="4"
            style={{ width: '100%', resize: 'vertical', 'min-height': '92px', padding: '10px 12px' }}
          />
          <div style={{ display: 'flex', gap: '8px', 'justify-content': 'flex-end', 'margin-top': '8px' }}>
            <button class="rep-btn rep-btn--ghost rep-btn--sm" type="button" onClick={cancelEdit} disabled={submitting()}>
              Zrušiť
            </button>
            <button class="rep-btn rep-btn--primary rep-btn--sm" type="button" onClick={() => saveEdit(comment.id)} disabled={submitting()}>
              Uložiť
            </button>
          </div>
        </div>
      </Show>

      <div style={{ display: 'flex', gap: '8px', 'justify-content': 'flex-end', 'margin-top': '10px', 'flex-wrap': 'wrap' }}>
        <button class="rep-btn rep-btn--ghost rep-btn--sm" type="button" onClick={() => setReplyTo(comment.id)} disabled={submitting()}>
          Odpovedať
        </button>
        <Show when={comment.canEdit}>
          <button class="rep-btn rep-btn--ghost rep-btn--sm" type="button" onClick={() => startEdit(comment)} disabled={submitting() || editingId() === comment.id}>
            Upraviť
          </button>
        </Show>
        <Show when={comment.canDelete}>
          <button class="rep-btn rep-btn--danger rep-btn--sm" type="button" onClick={() => removeComment(comment.id)} disabled={submitting()}>
            Zmazať
          </button>
        </Show>
      </div>
    </div>
  );

  return (
    <section style={{ 'margin-top': '24px', border: '1px solid #e2e8f0', 'border-radius': '10px', padding: '14px', background: '#f8fafc' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '10px' }}>
        <h3 style={{ margin: 0, 'font-size': '16px' }}>Diskusia</h3>
        <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '12px', color: '#64748b' }}>
          Zoradenie
          <select
            class="rep-form-select"
            value={sortOrder()}
            onChange={(e) => setSortOrder(e.currentTarget.value)}
            style={{ height: '32px', 'font-size': '12px', padding: '4px 28px 4px 8px' }}
          >
            <option value="newest">Od najnovšieho</option>
            <option value="oldest">Od najstaršieho</option>
          </select>
        </label>
      </div>

      <Show when={selectedReply()}>
        <div style={{ 'margin-bottom': '8px', padding: '8px', background: '#fff', border: '1px solid #cbd5e1', 'border-radius': '6px' }}>
          <div style={{ 'font-size': '12px', color: '#475569', 'margin-bottom': '4px' }}>
            Odpovedáte na: <strong>{selectedReply().authorName}</strong>
          </div>
          <div style={{ 'font-size': '13px', color: '#334155', 'white-space': 'pre-wrap' }}>{shortenText(selectedReply().content)}</div>
          <div style={{ 'margin-top': '6px' }}>
            <button class="rep-btn rep-btn--ghost rep-btn--sm" type="button" onClick={() => setReplyTo(null)} disabled={submitting()}>
              Zrušiť odpoveď
            </button>
          </div>
        </div>
      </Show>

      <div style={{ 'margin-bottom': '14px' }}>
        <textarea
          class="rep-form__input"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          rows="4"
          maxlength="4000"
          placeholder="Napíšte komentár..."
          style={{ width: '100%', resize: 'vertical', 'min-height': '100px', padding: '10px 12px', 'line-height': '1.45' }}
          disabled={submitting()}
        />
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-top': '8px' }}>
          <span style={{ 'font-size': '12px', color: '#64748b' }}>{draft().length} / 4000</span>
          <button class="rep-btn rep-btn--primary rep-btn--sm" type="button" onClick={submitComment} disabled={submitting() || !String(draft() || '').trim()}>
            {submitting() ? 'Ukladám...' : 'Pridať komentár'}
          </button>
        </div>
      </div>

      <Show when={!comments.loading} fallback={<p style={{ margin: 0 }}>Načítavam komentáre...</p>}>
        <Show when={(byParent() || []).length > 0} fallback={<p style={{ margin: 0, color: '#64748b' }}>Zatiaľ bez komentárov. Buďte prvý.</p>}>
          <div style={{ display: 'grid', gap: '10px' }}>
            <For each={pagedComments()}>
              {(comment) => (
                <div>
                  {renderCommentCard(comment, false)}
                  <Show when={comment.replies.length > 0}>
                    <div style={{ 'margin-top': '8px', 'margin-left': '20px' }}>
                      <For each={comment.replies}>{(reply) => renderCommentCard(reply, true)}</For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>

          <Show when={totalPages() > 1}>
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-top': '12px' }}>
              <span style={{ 'font-size': '12px', color: '#64748b' }}>
                Strana {page()} z {totalPages()} (po {PAGE_SIZE} komentárov)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  class="rep-btn rep-btn--ghost rep-btn--sm"
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page() <= 1}
                >
                  Predchádzajúca
                </button>
                <button
                  class="rep-btn rep-btn--ghost rep-btn--sm"
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages(), p + 1))}
                  disabled={page() >= totalPages()}
                >
                  Ďalšia
                </button>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
