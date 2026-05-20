/**
 * NewsPage – správa noviniek (zoznam + pridávanie / úprava / mazanie)
 */

import { createResource, createSignal, createEffect, createMemo, For, Show, Suspense, onCleanup } from 'solid-js';
import { fetchAllNews, fetchNewsById, createNews, updateNews, deleteNews } from '../services/sp.js';
import { useUser } from '../context/user.jsx';
import { useSearchParams, useNavigate } from '@solidjs/router';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import MobileMenu from '../components/shared/MobileMenu.jsx';
import { cleanupOrphanedFiles, getNewlyUploadedUrls, getNewlyUploadedImageUrls } from '../utils/uploadCleanup.js';
import NewsComments from '../components/news/NewsComments.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';

// ── detail novinky v modale podľa query parametra view ───────────────
function NewsDetailModal({ id, onClose }) {
  const [news] = createResource(id, fetchNewsById);
  return (
    <Show when={news()}>
      <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div class="rep-drawer rep-drawer--wide">
          <div class="rep-drawer__header">
            <h2 class="rep-drawer__title" style={{ 'font-size': '17px', 'line-height': '1.4' }}>{news().title}</h2>
            <button class="rep-drawer__close" onClick={onClose} aria-label="Zatvoriť">✕</button>
          </div>
          <div class="rep-drawer__body">
            <Show when={news().imageUrl}>
              <img src={news().imageUrl} alt={news().title}
                style={{ width: '100%', 'max-height': '260px', 'object-fit': 'cover', 'border-radius': '10px', 'margin-bottom': '18px' }}
                onError={e => { e.target.style.display = 'none'; }} />
            </Show>
            <div class="news-detail__meta" style={{ display: 'flex', gap: '12px', 'margin-bottom': '18px', 'font-size': '13px', color: '#64748b' }}>
              <Show when={news().author}><span>✍ {news().author}</span></Show>
              <Show when={news().publishedAt}>
                <span>{news().publishedAt.toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </Show>
            </div>
            <Show when={news().description}>
              <p style={{ 'font-size': '15px', color: '#334155', 'margin-bottom': '16px', 'font-weight': '500', 'line-height': '1.6' }}>{news().description}</p>
            </Show>
            <Show when={news().content} fallback={
              <p style={{ color: '#94a3b8', 'font-style': 'italic' }}>Plný text nie je k dispozícii.</p>
            }>
              <div style={{ 'font-size': '14px', color: '#475569', 'line-height': '1.75', 'white-space': 'pre-wrap' }}>{news().content}</div>
            </Show>
            {/* Komentáre pod novinkou */}
            <div style={{ 'margin-top': '32px', 'border-top': '1px solid #e2e8f0', 'padding-top': '24px' }}>
              <NewsComments newsId={news().id} />
            </div>
          </div>
        </div>
      </div>
    </Show>
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
  const [uploadingFiles, setUploadingFiles] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal(item.imageUrl || '');
  const [attachments, setAttachments] = createSignal(item.attachments || []);
  const [docFolders, setDocFolders] = createSignal([]);
  const [docFolderId, setDocFolderId] = createSignal('');
  const [originalImageUrl] = createSignal(item.imageUrl || '');
  const [originalAttachments] = createSignal(item.attachments || []);
  let formRef;

  // Cleanup handler for form cancellation
  async function cleanupOnClose() {
    // Get newly uploaded files (files added in this session but not saved)
    const newAttachmentUrls = getNewlyUploadedUrls(attachments(), originalAttachments());
    const newImageUrls = getNewlyUploadedImageUrls(imageUrl(), originalImageUrl());
    const allNewUrls = [...newAttachmentUrls, ...newImageUrls];

    if (allNewUrls.length > 0) {
      try {
        await cleanupOrphanedFiles(allNewUrls, { silent: true });
      } catch (err) {
        console.warn('[NewsForm] Cleanup error on close (non-blocking):', err.message);
        // Ignore cleanup errors on close - don't block form closing
      }
    }
  }

  async function requestClose() {
    await cleanupOnClose();
    onClose?.();
  }

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

  async function uploadAttachmentFiles(files) {
    if (!files?.length) return;
    const selectedFolderId = String(docFolderId() || '').trim();
    if (!selectedFolderId) {
      setErr('Najprv vyberte cieľový priečinok v Dokumentoch.');
      return;
    }
    setUploadingFiles(true);
    setErr('');
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`${API}/documents/folders/${selectedFolderId}/upload`, { 
          method: 'POST', credentials: 'include', body: fd 
        });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.error || `HTTP ${r.status}`);
        }
        const data = await r.json();
        setAttachments((prev) => [...prev, {
          name: data.name,
          url: data.file_url,
          size: data.file_size,
          mime_type: data.mime_type,
        }]);
      }
    } catch (e) {
      setErr(`Nahrávanie prílohy zlyhalo: ${e.message}`);
    } finally {
      setUploadingFiles(false);
    }
  }

  // Načítaj priečinky pre dokumenty
  async function loadDocFolders() {
    try {
      const r = await fetch(`${API}/documents/tree`, { credentials: 'include' });
      if (!r.ok) return;
      const tree = await r.json();
      const flattened = flattenFolders(tree);
      setDocFolders(flattened);
    } catch (err) {
      console.warn('[NewsPage] Load folders failed:', err.message);
      setDocFolders([]);
    }
  }

  function flattenFolders(nodes, level = 0, out = []) {
    for (const n of nodes || []) {
      const maxLen = 40;
      const truncated = n.name.length > maxLen ? n.name.substring(0, maxLen - 1) + '…' : n.name;
      out.push({ id: n.id, name: n.name, label: `${' '.repeat(level)}${truncated}` });
      flattenFolders(n.children || [], level + 1, out);
    }
    return out;
  }

  createEffect(() => {
    loadDocFolders();
  });

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
        attachments:    attachments(),
      });
    } catch (e) {
      setErr(e.message || 'Chyba pri ukladaní.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) requestClose(); }}>
      <div class="rep-drawer">
        <div class="rep-drawer__header">
          <h2 class="rep-drawer__title">{item.id ? 'Upraviť novinku' : 'Nová novinka'}</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" class="rep-btn rep-btn--ghost rep-btn--sm" onClick={requestClose}>Zrušiť</button>
            <button type="submit" form="news-form" class="rep-btn rep-btn--primary rep-btn--sm" disabled={saving() || uploading()}>
              {saving() ? 'Ukladám…' : (item.id ? 'Uložiť zmeny' : 'Pridať novinku')}
            </button>
          </div>
        </div>

        <form id="news-form" ref={formRef} onSubmit={submit} class="rep-form">
          <div class="rep-form__row">
            <label class="rep-form__label">Názov *</label>
            <input class="rep-form__input" name="title" required value={item.title || ''} placeholder="Názov novinky" />
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Krátky popis</label>
            <textarea class="rep-form__input" name="description" rows="2" placeholder="Krátky popis novinky…">{item.description || ''}</textarea>
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Obsah</label>
            <textarea class="rep-form__input" name="content" rows="5" placeholder="Plný text novinky…">{item.content || ''}</textarea>
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
            <label class="rep-form__label">Priložené dokumenty</label>
            <select
              value={docFolderId()}
              onInput={e => setDocFolderId(e.target.value)}
              class="rep-form-select"
              style={{ 'margin-bottom': '12px' }}
            >
              <option value="">Vyberte cieľový priečinok v Dokumentoch</option>
              <For each={docFolders()}>{f => <option value={String(f.id)} title={f.name}>{f.label}</option>}</For>
            </select>
            <Show when={attachments().length > 0}>
              <div style={{ 'margin-bottom': '12px' }}>
                <For each={attachments()}>
                  {(att, idx) => (
                    <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', padding: '8px', background: '#f1f5f9', 'border-radius': '6px', 'margin-bottom': '6px' }}>
                      <span style={{ flex: 1, 'font-size': '13px', color: '#334155' }}>{att.name || att.url}</span>
                      <button type="button" onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx()))}
                        style={{ padding: '4px 8px', background: '#e2e8f0', border: 'none', 'border-radius': '4px', cursor: 'pointer', 'font-size': '12px' }}>Odstrániť</button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <label class="rep-upload-btn">
              <input type="file" multiple style={{ display: 'none' }} onChange={e => uploadAttachmentFiles([...e.target.files])} disabled={uploadingFiles()} />
              {uploadingFiles() ? '⏳ Nahrávam…' : '📎 Nahrať dokumenty'}
            </label>
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
        </form>
      </div>
    </div>
  );
}

// ── hlavná stránka noviniek ───────────────────────────────────────────────
export default function NewsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [showModal, setShowModal] = createSignal(!!params.view);
  createEffect(() => {
    setShowModal(!!params.view);
  });
  function closeModal() {
    setShowModal(false);
    navigate('/novinky', { replace: true });
  }
  // Escape key closes modal
  onCleanup(() => {
    const handler = (e) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  // Základné dáta a stavy
  const user = useUser();
  const [news, { refetch }] = createResource(fetchAllNews);
  const [editing, setEditing] = createSignal(null);   // null=closed, {}=new, {id,...}=edit
  const [toDelete, setToDelete] = createSignal(null);
  const [newsFilter, setNewsFilter] = createSignal('all'); // Filter: all, published, my-published, drafts, my-drafts

  const canEdit = () => ['admin', 'editor'].includes(user()?.role);
  const userId = () => user()?.id;
  const isAdmin = () => ['admin', 'editor'].includes(user()?.role);

  // Filter news based on current filter selection
  const filteredNews = createMemo(() => {
    const allNews = news() || [];
    const filter = newsFilter();
    switch (filter) {
      case 'published':
        return allNews.filter(n => n.publishedAt != null);
      case 'my-published':
        return allNews.filter(n => n.publishedAt != null && n.createdById === userId());
      case 'drafts':
        return isAdmin() ? allNews.filter(n => n.publishedAt == null) : [];
      case 'my-drafts':
        return allNews.filter(n => n.publishedAt == null && n.createdById === userId());
      case 'all':
      default:
        if (isAdmin()) return allNews;
        return allNews.filter(n => n.publishedAt != null || n.createdById === userId());
    }
  });

  // Count utilities for filter buttons
  const countAll = () => isAdmin() ? news()?.length || 0 : (news() || []).filter(n => n.publishedAt != null || n.createdById === userId()).length;
  const countPublished = () => (news() || []).filter(n => n.publishedAt != null).length;
  const countMyPublished = () => (news() || []).filter(n => n.publishedAt != null && n.createdById === userId()).length;
  const countDrafts = () => (news() || []).filter(n => n.publishedAt == null).length;
  const countMyDrafts = () => (news() || []).filter(n => n.publishedAt == null && n.createdById === userId()).length;

  async function handleSave(data) {
    if (editing()?.id) await updateNews(editing().id, data);
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
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <Show when={canEdit()}>
            <button class="rep-btn rep-btn--primary" onClick={() => setEditing({})}>
              + Pridať novinku
            </button>
          </Show>
          <MobileMenu />
        </div>
      </div>
      {/* Filter buttons */}
      <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '16px', 'flex-wrap': 'wrap' }}>
        <button class={`rep-btn rep-btn--sm ${newsFilter() === 'all' ? 'rep-btn--primary' : 'rep-btn--ghost'}`} onClick={() => setNewsFilter('all')}>Všetky ({countAll()})</button>
        <button class={`rep-btn rep-btn--sm ${newsFilter() === 'published' ? 'rep-btn--primary' : 'rep-btn--ghost'}`} onClick={() => setNewsFilter('published')}>Publikované ({countPublished()})</button>
        <button class={`rep-btn rep-btn--sm ${newsFilter() === 'my-published' ? 'rep-btn--primary' : 'rep-btn--ghost'}`} onClick={() => setNewsFilter('my-published')}>Moje publikované ({countMyPublished()})</button>
        <Show when={isAdmin()}>
          <button class={`rep-btn rep-btn--sm ${newsFilter() === 'drafts' ? 'rep-btn--primary' : 'rep-btn--ghost'}`} onClick={() => setNewsFilter('drafts')}>Drafty ({countDrafts()})</button>
        </Show>
        <button class={`rep-btn rep-btn--sm ${newsFilter() === 'my-drafts' ? 'rep-btn--primary' : 'rep-btn--ghost'}`} onClick={() => setNewsFilter('my-drafts')}>Moje drafty ({countMyDrafts()})</button>
      </div>
      <div class="rep-page__content" style={{ 'padding-top': '20px' }}>
        <Suspense fallback={<p class="rep-page__loading">Načítavam…</p>}>
          <Show when={!news.error} fallback={
            <div class="rep-panel__error">
              <p>Nepodarilo sa načítať novinky.</p>
              <button onClick={refetch} class="rep-btn">Skúsiť znova</button>
            </div>
          }>
            <Show when={filteredNews()?.length > 0} fallback={
              <p class="rep-page__empty">Žiadne novinky. Kliknite na „+ Pridať novinku" pre vytvorenie prvej.</p>
            }>
              <div class="news-page-grid">
                <For each={filteredNews()}>{item => (
                  <NewsCard
                    item={item}
                    canEdit={canEdit()}
                    onView={() => navigate(`/novinky?view=${item.id}`)}
                    onEdit={() => setEditing(item)}
                    onDelete={() => setToDelete(item.id)}
                  />
                )}</For>
              </div>
            </Show>
          </Show>
        </Suspense>
      </div>
      <Show when={editing() !== null}>
        <NewsForm item={editing() || {}} onSave={handleSave} onClose={() => setEditing(null)} />
      </Show>
      <Show when={toDelete()}>
        <ConfirmDialog message="Naozaj chcete odstrániť túto novinku? Akcia je nevratná." onConfirm={handleDelete} onCancel={() => setToDelete(null)} />
      </Show>
      {/* MODAL DETAIL NOVINKY */}
      <Show when={showModal() && params.view}>
        <NewsDetailModal id={params.view} onClose={closeModal} />
      </Show>
    </div>
  );
}
