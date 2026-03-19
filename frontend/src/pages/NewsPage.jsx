/**
 * NewsPage – správa noviniek (zoznam + pridávanie / úprava / mazanie)
 */
import { createResource, createSignal, For, Show, Suspense } from 'solid-js';
import { fetchAllNews, createNews, updateNews, deleteNews } from '../services/sp.js';
import { useUser } from '../context/user.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';

// ── detail novinky ─────────────────────────────────────────────────────────────

function NewsDetail({ item, onClose }) {
  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="rep-drawer rep-drawer--wide">
        <div class="rep-drawer__header">
          <h2 class="rep-drawer__title" style={{ 'font-size': '17px', 'line-height': '1.4' }}>{item.title}</h2>
          <button class="rep-drawer__close" onClick={onClose} aria-label="Zatvoriť">✕</button>
        </div>
        <div class="rep-drawer__body">
          <Show when={item.imageUrl}>
            <img src={item.imageUrl} alt={item.title}
              style={{ width: '100%', 'max-height': '260px', 'object-fit': 'cover', 'border-radius': '10px', 'margin-bottom': '18px' }}
              onError={e => { e.target.style.display = 'none'; }} />
          </Show>
          <div class="news-detail__meta" style={{ display: 'flex', gap: '12px', 'margin-bottom': '18px', 'font-size': '13px', color: '#64748b' }}>
            <Show when={item.author}><span>✍ {item.author}</span></Show>
            <Show when={item.publishedAt}>
              <span>{item.publishedAt.toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </Show>
          </div>
          <Show when={item.description}>
            <p style={{ 'font-size': '15px', color: '#334155', 'margin-bottom': '16px', 'font-weight': '500', 'line-height': '1.6' }}>{item.description}</p>
          </Show>
          <Show when={item.content} fallback={
            <p style={{ color: '#94a3b8', 'font-style': 'italic' }}>Plný text nie je k dispozícii.</p>
          }>
            <div style={{ 'font-size': '14px', color: '#475569', 'line-height': '1.75', 'white-space': 'pre-wrap' }}>{item.content}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ── pomocné funkcie ──────────────────────────────────────────────────────────

function timeAgo(date) {
  if (!date) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days === 0) return 'dnes';
  if (days === 1) return 'pred dňom';
  if (days < 30) return `pred ${days} dňami`;
  const m = Math.floor(days / 30);
  if (m === 1) return 'pred mesiacom';
  if (m < 12) return `pred ${m} mesiacmi`;
  return `pred ${Math.floor(m / 12)} rokmi`;
}

// ── karta novinky ────────────────────────────────────────────────────────────

function NewsCard({ item, canEdit, onEdit, onDelete, onView }) {
  return (
    <article class="news-page-card">
      <Show when={item.imageUrl}>
        <div class="news-page-card__img-wrap" style={{ cursor: 'pointer' }} onClick={onView}>
          <img
            src={item.imageUrl}
            alt={item.title}
            class="news-page-card__img"
            loading="lazy"
            onError={e => { e.target.closest('.news-page-card__img-wrap').style.display = 'none'; }}
          />
        </div>
      </Show>
      <div class="news-page-card__body">
        <h2 class="news-page-card__title" style={{ cursor: 'pointer' }} onClick={onView}>{item.title}</h2>
        <Show when={item.description}>
          <p class="news-page-card__desc">{item.description}</p>
        </Show>
        <div class="news-page-card__footer">
          <span class="news-card__meta">
            {item.author && <span class="news-card__author">{item.author}</span>}
            {item.publishedAt && (
              <span class="news-card__date" title={item.publishedAt.toLocaleDateString('sk-SK')}>
                {timeAgo(item.publishedAt)}
              </span>
            )}
          </span>
          <Show when={canEdit}>
            <div class="news-page-card__actions">
              <button class="rep-btn rep-btn--ghost rep-btn--sm" onClick={onEdit}>Upraviť</button>
              <button class="rep-btn rep-btn--danger rep-btn--sm" onClick={onDelete}>Zmazať</button>
            </div>
          </Show>
        </div>
      </div>
    </article>
  );
}

// ── formulár pre novinku ─────────────────────────────────────────────────────

function NewsForm({ item, onSave, onClose }) {
  const [saving, setSaving] = createSignal(false);
  const [err, setErr] = createSignal('');
  const [uploading, setUploading] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal(item.imageUrl || '');
  let formRef;

  async function handleImageFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch(`${API}/upload/image`, { method: 'POST', credentials: 'include', body: fd });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `HTTP ${r.status}`); }
      const { url } = await r.json();
      setImageUrl(url);
    } catch (e) {
      setErr(`Upload zlyhal: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(formRef);
    setSaving(true); setErr('');
    try {
      await onSave({
        title:          f.get('title'),
        description:    f.get('description') || null,
        content:        f.get('content') || null,
        bannerImageUrl: imageUrl() || null,
        authorName:     f.get('authorName') || null,
        isPublished:    f.get('isPublished') === 'on',
      });
    } catch (e) {
      setErr(e.message || 'Chyba pri ukladaní.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="rep-drawer">
        <div class="rep-drawer__header">
          <h2 class="rep-drawer__title">{item.id ? 'Upraviť novinku' : 'Nová novinku'}</h2>
          <button class="rep-drawer__close" onClick={onClose} aria-label="Zatvoriť">✕</button>
        </div>

        <form ref={formRef} onSubmit={submit} class="rep-form">
          <div class="rep-form__row">
            <label class="rep-form__label">Názov *</label>
            <input class="rep-form__input" name="title" required value={item.title || ''} placeholder="Názov novinky" />
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Krátky popis</label>
            <textarea class="rep-form__input" name="description" rows="3" placeholder="Krátky popis novinky…">{item.description || ''}</textarea>
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Obsah</label>
            <textarea class="rep-form__input" name="content" rows="7" placeholder="Plný text novinky…">{item.content || ''}</textarea>
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Titulný obrázok</label>
            <Show when={imageUrl()}>
              <div style={{ position: 'relative', 'margin-bottom': '8px' }}>
                <img src={imageUrl()} alt="" style={{ width: '100%', height: '140px', 'object-fit': 'cover', 'border-radius': '8px', 'border': '1px solid #e2e8f0' }} onError={e => e.target.style.display='none'} />
                <button type="button" onClick={() => setImageUrl('')}
                  style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,.55)', color: '#fff', border: 'none', 'border-radius': '50%', width: '24px', height: '24px', cursor: 'pointer', 'font-size': '14px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}>✕</button>
              </div>
            </Show>
            <label class="rep-upload-btn">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleImageFile} disabled={uploading()} />
              {uploading() ? '⏳ Nahrávam…' : '📁 Nahrať obrázok (JPEG/PNG/WebP)'}
            </label>
            <span style={{ 'font-size': '11px', color: '#94a3b8', 'margin-top': '2px' }}>alebo zadaj URL priamo:</span>
            <input class="rep-form__input" type="text" value={imageUrl()} onInput={e => setImageUrl(e.target.value)} placeholder="https://… alebo /uploads/…" />
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Autor</label>
            <input class="rep-form__input" name="authorName" value={item.author || ''} placeholder="Meno Priezvisko" />
          </div>

          <div class="rep-form__row rep-form__row--check">
            <label class="rep-form__check">
              <input type="checkbox" name="isPublished" checked={item.publishedAt != null} />
              <span>Zverejniť ihneď</span>
            </label>
          </div>

          <Show when={err()}>
            <div class="rep-login__error">{err()}</div>
          </Show>

          <div class="rep-form__actions">
            <button type="button" class="rep-btn rep-btn--ghost" onClick={onClose}>Zrušiť</button>
            <button type="submit" class="rep-btn rep-btn--primary" disabled={saving() || uploading()}>
              {saving() ? 'Ukladám…' : (item.id ? 'Uložiť zmeny' : 'Pridať novinku')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── hlavná stránka ───────────────────────────────────────────────────────────

export default function NewsPage() {
  const user = useUser();
  const [news, { refetch }] = createResource(fetchAllNews);
  const [editing, setEditing] = createSignal(null);   // null=closed, {}=new, {id,...}=edit
  const [toDelete, setToDelete] = createSignal(null);
  const [viewing, setViewing] = createSignal(null);   // detail novinky

  const canEdit = () => ['admin', 'editor'].includes(user()?.role);

  async function handleSave(data) {
    if (editing().id) await updateNews(editing().id, data);
    else await createNews(data);
    setEditing(null);
    refetch();
  }

  async function handleDelete() {
    await deleteNews(toDelete());
    setToDelete(null);
    refetch();
  }

  return (
    <div class="rep-page">
      <div class="rep-page__header">
        <h1 class="rep-page__title">Novinky</h1>
        <Show when={canEdit()}>
          <button class="rep-btn rep-btn--primary" onClick={() => setEditing({})}>
            + Pridať novinku
          </button>
        </Show>
      </div>

      <div class="rep-page__content">
        <Suspense fallback={<p class="rep-page__loading">Načítavam…</p>}>
          <Show when={!news.error} fallback={
            <div class="rep-panel__error">
            <p>Nepodarilo sa načítať novinky.</p>
            <button onClick={refetch} class="rep-btn">Skúsiť znova</button>
          </div>
        }>
          <Show when={news()?.length > 0} fallback={
            <p class="rep-page__empty">Žiadne novinky. Kliknite na „+ Pridať novinku" pre vytvorenie prvej.</p>
          }>
            <div class="news-page-grid">
              <For each={news()}>
                {item => (
                  <NewsCard
                    item={item}
                    canEdit={canEdit()}
                    onView={() => setViewing(item)}
                    onEdit={() => setEditing(item)}
                    onDelete={() => setToDelete(item.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Suspense>
      </div>

      <Show when={viewing() !== null}>
        <NewsDetail item={viewing()} onClose={() => setViewing(null)} />
      </Show>

      <Show when={editing() !== null}>
        <NewsForm item={editing()} onSave={handleSave} onClose={() => setEditing(null)} />
      </Show>

      <Show when={toDelete()}>
        <ConfirmDialog
          message="Naozaj chcete odstrániť túto novinku? Akcia je nevratná."
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      </Show>
    </div>
  );
}
