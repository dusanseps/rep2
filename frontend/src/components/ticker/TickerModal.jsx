/**
 * TickerModal – správcovský modal pre ticker správy
 * Zachováva pôvodnú funkcionalitu: zoznam správ, formulár, CRUD na SharePoint.
 */

import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import {
  fetchTickerMessages,
  createTickerMessage,
  updateTickerMessage,
  deleteTickerMessage,
} from '../../services/sp.js';
import ConflictRenameDialog from '../shared/ConflictRenameDialog.jsx';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import { showErrorToast, showSuccessToast, showWarningToast } from '../ui/Toasts.jsx';
import LoadingSpinner from '../shared/LoadingSpinner.jsx';
import { shortBadgeText } from '../../utils/text.js';
import { buildSuggestedName, normalizeFileName, validateFileName } from '../../utils/fileNames.js';
import { cleanupOrphanedFiles, getNewlyUploadedUrls } from '../../utils/uploadCleanup.js';

const DAY = 24 * 60 * 60 * 1000;

function humanLeft(msg) {
  if (!msg.expiresAt) return 'Bez expirácie';
  const ms = msg.expiresAt - Date.now();
  if (ms <= 0) return 'Expirované';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms - d * DAY) / (60 * 60 * 1000));
  return d > 0 ? `${d} d ${h} h` : `${h} h`;
}

function esc(s) {
  return s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(u) {
  try {
    const t = String(u || '').trim();
    if (!t) return '';
    return decodeURIComponent(t);
  } catch (err) {
    console.warn('[TickerModal] URL decode failed:', err.message);
    return String(u || '').trim();
  }
}

function isAllowedLink(link) {
  return /^https?:\/\//i.test(link) || link.startsWith('/');
}

function toSafeHref(rawHref) {
  const href = String(rawHref || '').trim();
  if (!href) return '#';
  if (href.startsWith('/')) return href.startsWith('//') ? '#' : href;
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return href;
  } catch (_err) {
    return '#';
  }
  return '#';
}

function flattenFolders(nodes, level = 0, out = [], showAll = true) {
  for (const n of nodes || []) {
    if (showAll || n.can_manage) {
      // Skrátenie + minimálne odsadenie pre čitateľnosť
      const maxLen = 40; // Rozumná dĺžka pre select options 
      const truncated = n.name.length > maxLen ? n.name.substring(0, maxLen - 1) + '…' : n.name;
      out.push({ id: n.id, name: n.name, label: `${' '.repeat(level)}${truncated}` });
    }
    flattenFolders(n.children || [], level + 1, out, showAll);
  }
  return out;
}


export default function TickerModal(props) {
  /* props: open, onClose, onMessagesChange, user */

  const [msgs, setMsgs] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [search, setSearch] = createSignal('');

  const [editId, setEditId] = createSignal('');
  const [fText, setFText] = createSignal('');
  const [fDays, setFDays] = createSignal('3');
  const [fLink, setFLink] = createSignal('');
  const [fAttachments, setFAttachments] = createSignal([]);
  const [uploadingFiles, setUploadingFiles] = createSignal(false);
  const [draggingFiles, setDraggingFiles] = createSignal(false);
  const [errText, setErrText] = createSignal('');
  const [errLink, setErrLink] = createSignal('');
  const [linkCounter, setLinkCounter] = createSignal('');
  const [docFolders, setDocFolders] = createSignal([]);
  const [docFolderId, setDocFolderId] = createSignal('');
  const [attachmentConflict, setAttachmentConflict] = createSignal(null);
  const [pendingDeleteId, setPendingDeleteId] = createSignal(null);
  let sseSource = null;
  let textRef;
  let fileInputRef;
  let modalRef;
  let openerRef = null;

  // Track originally loaded attachments (for cleanup detection)
  let originalAttachments = [];

  // Helper: Get list of newly uploaded file URLs for cleanup
  function getNewlyUploadedFileUrls() {
    return getNewlyUploadedUrls(fAttachments(), originalAttachments);
  }

  // Helper: Cleanup orphaned files on server
  async function cleanupOnClose() {
    const urlsToCleanup = getNewlyUploadedFileUrls();
    if (urlsToCleanup.length > 0) {
      try {
        await cleanupOrphanedFiles(urlsToCleanup, { silent: true });
      } catch (err) {
        console.warn('[TickerModal] Cleanup error on close (non-blocking):', err.message);
        // Ignore cleanup errors on close - don't block modal closing
      }
    }
  }

  function requestClose() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && modalRef?.contains(active)) {
      active.blur();
    }
    
    // Cleanup orphaned files before closing (with error handling)
    cleanupOnClose().finally(() => {
      props.onClose?.();
    });
  }

  createEffect(() => {
    if (props.open) {
      openerRef = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }

    if (openerRef && document.contains(openerRef)) {
      queueMicrotask(() => {
        openerRef?.focus?.();
      });
    }
  });

  function connectSSE() {
    const API = import.meta.env.VITE_API_BASE || '/api';
    try {
      sseSource = new EventSource(`${API}/ticker/subscribe`);
      sseSource.addEventListener('message', (event) => {
        try {
          const { type, item } = JSON.parse(event.data);
          if (type === 'create' || type === 'update' || type === 'delete') {
            loadMessages();
          }
        } catch (err) {
          console.warn('[TickerModal SSE] Parse failed:', err.message);
        }
      });
      sseSource.addEventListener('error', () => {
        console.warn('Ticker Modal SSE error');
        if (sseSource) sseSource.close();
      });
    } catch (err) {
      console.warn('[TickerModal SSE] Connection failed:', err.message);
    }
  }

  onMount(() => {
    connectSSE();
  });

  onCleanup(() => {
    if (sseSource) sseSource.close();
  });

  function showToast(msg, type = 'ok') {
    if (type === 'err') {
      showErrorToast(msg);
      return;
    }
    if (type === 'warn') {
      showWarningToast(msg);
      return;
    }
    showSuccessToast(msg);
  }

  async function loadMessages() {
    setLoading(true);
    try {
      const data = await fetchTickerMessages();
      setMsgs(data);
      props.onMessagesChange?.(data);
      return data;
    } catch (err) {
      console.error(err);
      showToast(`Chyba načítania: ${err.message || err}`, 'err');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setSearch('');
    const data = await loadMessages();
    if (data) {
      showToast(`Obnovené: ${data.length} správ`, 'ok');
    }
  }

  createEffect(() => {
    if (props.open) {
      loadMessages();
      loadDocFolders();
      resetForm();
      setTimeout(() => textRef?.focus(), 0);
    }
  });

  async function loadDocFolders() {
    try {
      const API = import.meta.env.VITE_API_BASE || '/api';
      const r = await fetch(`${API}/documents/tree`, { credentials: 'include' });
      if (!r.ok) return;
      const tree = await r.json();
      const role = props.user?.role;
      const isElevated = role === 'admin' || role === 'editor';
      setDocFolders(flattenFolders(tree, 0, [], isElevated));
    } catch (err) {
      console.warn('[TickerModal] Load folders failed:', err.message);
      setDocFolders([]);
    }
  }

  function resetForm() {
    setEditId('');
    setFText('');
    setFDays('3');
    setFLink('');
    setFAttachments([]);
    setErrText('');
    setErrLink('');
    setLinkCounter('');
    setDocFolderId('');
    // Reset original attachments tracking
    originalAttachments = [];
  }

  function openEdit(id) {
    const m = msgs().find(x => x.id === id);
    if (!m) return;
    setEditId(m.id);
    setFText(m.text || '');
    setFLink(m.link || '');
    setFAttachments(m.attachments || []);
    // Track original attachments for cleanup detection
    originalAttachments = [...(m.attachments || [])];
    if (m.expiresDays && m.expiresDays > 0) {
      setFDays(String(m.expiresDays));
    } else if (m.expiresAt) {
      const leftDays = m.expiresAt > Date.now()
        ? Math.max(1, Math.round((m.expiresAt - Date.now()) / DAY))
        : 1;
      setFDays(String(leftDays));
    } else {
      setFDays('');
    }
    setErrText('');
    setErrLink('');
    textRef?.focus();
  }

  function handleDelete(id) {
    setPendingDeleteId(id);
  }

  async function doDelete() {
    const id = pendingDeleteId();
    setPendingDeleteId(null);
    try {
      await deleteTickerMessage(id);
      await loadMessages();
      showToast('Správa zmazaná', 'warn');
    } catch (err) {
      console.error(err);
      showToast(`Chyba mazania: ${err.message || err}`, 'err');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = fText().trim();
    if (!text) { setErrText('Nadpis je povinný.'); textRef?.focus(); return; }

    const link = safeUrl(fLink());
    if (link && !isAllowedLink(link)) {
      setErrLink('URL musí začínať http://, https:// alebo /uploads/...');
      return;
    }
    if (link.length > 2048) {
      setErrLink('URL je príliš dlhá (max 2048 znakov).');
      return;
    }

    const daysRaw = fDays().trim();
    let expiresAt = null;
    let expiresDays = null;
    if (daysRaw && /^\d+$/.test(daysRaw)) {
      const days = parseInt(daysRaw, 10);
      if (days > 0) {
        expiresDays = days;
        expiresAt = Date.now() + days * DAY;
      }
    }

    try {
      if (editId()) {
        await updateTickerMessage(editId(), { text, link, expiresAt, expiresDays, attachments: fAttachments() });
      } else {
        await createTickerMessage({ text, link, expiresDays, attachments: fAttachments() });
      }
      resetForm();
      await loadMessages();
      showToast('Uložené', 'ok');
    } catch (err) {
      console.error(err);
      showToast(`Chyba ukladania: ${err.message || err}`, 'err');
    }
  }

  async function uploadTickerFiles(files) {
    if (!files.length) return;
    const selectedFolderId = String(docFolderId() || '').trim();
    if (!selectedFolderId) {
      showToast('Najprv vyberte cieľový priečinok v Dokumentoch.', 'warn');
      return;
    }

    async function uploadSingleFile(file, { overwrite = false, fileName } = {}) {
      const fd = new FormData();
      fd.append('file', file);
      if (overwrite) fd.append('overwrite', 'true');
      if (fileName) fd.append('fileName', fileName);

      const r = await fetch(`${import.meta.env.VITE_API_BASE || '/api'}/documents/folders/${selectedFolderId}/upload`, {
        method: 'POST', credentials: 'include', body: fd,
      });

      const body = await r.json().catch((err) => {
        console.warn('[TickerModal upload] Response parse failed:', err.message);
        return {};
      });

      if (r.status === 409) {
        return { ok: false, conflict: true, body };
      }
      if (!r.ok) {
        return { ok: false, conflict: false, body };
      }
      return { ok: true, body };
    }

    function askAttachmentConflict({ fileName, suggestedName, current, total }) {
      return new Promise((resolve) => {
        setAttachmentConflict({
          fileName,
          suggestedName,
          current,
          total,
          onCancel: () => resolve({ action: 'cancel' }),
          onOverwrite: () => resolve({ action: 'overwrite' }),
          onRename: (nextName) => resolve({ action: 'rename', fileName: nextName }),
        });
      });
    }

    setUploadingFiles(true);
    try {
      let uploaded = 0;
      let overwritten = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        let targetName = normalizeFileName(file.name);
        const initialErr = validateFileName(targetName);
        if (initialErr) {
          failed += 1;
          showToast(initialErr, 'err');
          continue;
        }

        let done = false;
        while (!done) {
          const result = await uploadSingleFile(file, { fileName: targetName });

          if (result.ok) {
            const data = result.body;
            if (!fLink().trim() && data.file_url) {
              onLinkInput(data.file_url);
            }
            setFAttachments(prev => [...prev, {
              name: data.name,
              url: data.file_url,
              size: data.file_size,
              mime_type: data.mime_type,
            }]);
            uploaded += 1;
            done = true;
            continue;
          }

          if (!result.conflict) {
            failed += 1;
            showToast(result.body?.error || 'Chyba nahrávania', 'err');
            done = true;
            continue;
          }

          const decision = await askAttachmentConflict({
            fileName: result.body?.existingName || targetName,
            suggestedName: result.body?.suggestedName || buildSuggestedName(targetName),
            current: i + 1,
            total: files.length,
          });

          if (decision.action === 'cancel') {
            skipped += 1;
            done = true;
            continue;
          }

          if (decision.action === 'rename') {
            targetName = normalizeFileName(decision.fileName);
            const renameErr = validateFileName(targetName);
            if (renameErr) {
              showToast(renameErr, 'err');
              skipped += 1;
              done = true;
            }
            continue;
          }

          if (decision.action === 'overwrite') {
            const overwriteResult = await uploadSingleFile(file, { fileName: targetName, overwrite: true });
            if (overwriteResult.ok) {
              const data = overwriteResult.body;
              if (!fLink().trim() && data.file_url) {
                onLinkInput(data.file_url);
              }
              setFAttachments(prev => [...prev, {
                name: data.name,
                url: data.file_url,
                size: data.file_size,
                mime_type: data.mime_type,
              }]);
              overwritten += 1;
            } else {
              failed += 1;
              showToast(overwriteResult.body?.error || 'Nahradenie súboru zlyhalo', 'err');
            }
            done = true;
          }
        }
      }

      const summary = [];
      if (uploaded) summary.push(`nahrané: ${uploaded}`);
      if (overwritten) summary.push(`nahradené: ${overwritten}`);
      if (skipped) summary.push(`zrušené: ${skipped}`);
      if (failed) summary.push(`chyby: ${failed}`);

      if (uploaded || overwritten) {
        showToast(`Nahrávanie príloh dokončené (${summary.join(', ')})`, 'ok');
      } else if (skipped && !failed) {
        showToast(`Nahrávanie príloh zrušené (${summary.join(', ')})`, 'warn');
      }
    } finally {
      setAttachmentConflict(null);
      setUploadingFiles(false);
    }
  }

  function removeAttachment(url) {
    setFAttachments(prev => prev.filter(a => a.url !== url));
  }

  function onLinkInput(v) {
    setFLink(v);
    const decoded = safeUrl(v);
    const maxLen = 2048;
    if (v.trim()) {
      setLinkCounter(`${decoded.length} / ${maxLen} znakov`);
    } else {
      setLinkCounter('');
    }
    setErrLink(v && !isAllowedLink(v.trim()) ? 'URL musí začínať http://, https:// alebo /uploads/...' : '');
  }

  function handleChip(days) {
    setFDays(days === 0 ? '' : String(days));
  }

  // Filtered list
  const filteredMsgs = () => {
    const q = search().toLowerCase().trim();
    return msgs()
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .filter(m => !q || (m.text || '').toLowerCase().includes(q) || (m.author || '').toLowerCase().includes(q));
  };

  // Preview
  const prevUnderline = () => fLink().trim() ? 'underline' : 'none';

  return (
    <>
      {/* Modal */}
      <div
        id="dt-modal"
        ref={modalRef}
        class="dt-modal"
        aria-hidden={props.open ? 'false' : 'true'}
        inert={!props.open}
      >
        <div class="dt-backdrop" onClick={requestClose} />
        <div class="dt-dialog" role="dialog" aria-modal="true" aria-labelledby="dt-modal-title"
          onKeyDown={e => e.key === 'Escape' && requestClose()}
        >
          {/* Header */}
          <div class="dt-header">
            <h3 id="dt-modal-title">Správy pre ticker</h3>
            <div class="dt-actions-inline">
              <input
                id="dt-search"
                type="search"
                placeholder="Hľadať: text alebo autor"
                aria-label="Hľadať v správach"
                value={search()}
                onInput={e => setSearch(e.target.value)}
              />
              <button class="dt-btn" onClick={handleRefresh} disabled={loading()} title="Obnoviť">
                {loading() ? '…' : '↻'}
              </button>
            </div>
          </div>

          {/* Body */}
          <div class="dt-body">
            <div class="dt-two-col">
              {/* Zoznam */}
              <div class="dt-panel">
                <div class="dt-list-head">
                  <span>Správa ({filteredMsgs().length}/{msgs().length})</span><span>Stav</span><span>Akcie</span>
                </div>

                <div class="dt-list" classList={{ 'has-messages': !loading() && filteredMsgs().length > 0 }}>
                  <Show
                    when={!loading() && filteredMsgs().length > 0}
                    fallback={
                      loading()
                        ? <LoadingSpinner type="spinner" label="Načítavam správy…" size="sm" />
                        : <div class="dt-card" style={{ 'grid-template-columns': '1fr' }}>
                            <span style={{ color: '#6b7280', 'font-size': '13px' }}>
                              Žiadne správy
                            </span>
                          </div>
                    }
                  >
                    <For each={filteredMsgs()}>
                      {(m) => {
                        const alive = !m.expiresAt || m.expiresAt > Date.now();
                        return (
                          <div class="dt-card">
                            <div>
                              <span class="dt-title" lang="sk">{m.text}</span>
                              <span class="dt-sub" lang="sk">
                                {m.author && <>{m.author} · </>}
                                {m.createdAt
                                  ? new Date(m.createdAt).toLocaleDateString('sk-SK')
                                  : ''}
                              </span>
                            </div>
                            <div class="dt-badges">
                              <span class={`badge ${alive ? 'ok' : 'dead'}`}>
                                {alive ? 'Aktívna' : 'Expirovaná'}
                              </span>
                              {alive && m.expiresAt &&
                                <span class="badge warn">~ {humanLeft(m)}</span>}
                              {m.link && (
                                <a
                                  class="badge link"
                                  href={toSafeHref(m.link)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={m.link}
                                >
                                  {shortBadgeText(safeUrl(m.link).replace(/^https?:\/\//i, ''))}
                                </a>
                              )}
                              <For each={m.attachments || []}>
                                {(att) => (
                                  <a
                                    class="badge att"
                                    href={toSafeHref(att.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={att.name}
                                  >
                                    {shortBadgeText(att.name)}
                                  </a>
                                )}
                              </For>
                            </div>
                            <div class="dt-card-actions">
                              <button class="dt-btn" onClick={() => openEdit(m.id)}>Upraviť</button>
                              <button class="dt-btn dt-danger" onClick={() => handleDelete(m.id)}>Zmazať</button>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </div>

              {/* Formulár */}
              <div class="dt-panel">
                <form class="dt-form" onSubmit={handleSubmit} autocomplete="off">
                  {/* Text */}
                  <div class="dt-row">
                    <label for="dt-f-text">Rýchla správa *</label>
                    <input
                      id="dt-f-text"
                      type="text"
                      ref={textRef}
                      required
                      placeholder="Krátka a zrozumiteľná správa"
                      value={fText()}
                      onInput={e => { setFText(e.target.value); setErrText(''); }}
                    />
                    <div class="dt-error" role="alert">{errText()}</div>
                  </div>

                  {/* Životnosť */}
                  <div class="dt-row">
                    <label for="dt-f-days">Životnosť</label>
                    <div class="dt-inline">
                      <input
                        id="dt-f-days"
                        type="number"
                        min="1"
                        max="30"
                        style={{ width: '90px' }}
                        value={fDays()}
                        onInput={e => setFDays(e.target.value)}
                      />
                      <span style={{ 'font-size': '13px', color: '#6b7280' }}>dni</span>
                      <div class="dt-chips">
                        {[1, 3, 7].map(d => (
                          <button type="button" class="dt-chip" onClick={() => handleChip(d)}>{d}d</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Link */}
                  <div class="dt-row">
                    <label for="dt-f-link">Odkaz (URL)</label>
                    <input
                      id="dt-f-link"
                      type="text"
                      placeholder="https:// alebo interný odkaz"
                      value={fLink()}
                      onInput={e => onLinkInput(e.target.value)}
                    />
                    <small class="dt-help" style={{ color: '#6b7280' }}>{linkCounter()}</small>
                    <div class="dt-error" role="alert">{errLink()}</div>
                  </div>

                  {/* Prílohy */}
                  <div class="dt-row">
                    <label>Prílohy</label>
                    <div class="dt-inline" style={{ 'margin-bottom': '8px' }}>
                      <select
                        value={docFolderId()}
                        onInput={e => setDocFolderId(e.target.value)}
                        class="rep-form-select"
                        style={{ flex: 1 }}
                      >
                        <option value="">Vyberte cieľový priečinok v Dokumentoch</option>
                        <For each={docFolders()}>{f => <option value={String(f.id)} title={f.name}>{f.label}</option>}</For>
                      </select>
                    </div>
                    <div
                      class={`dt-dropzone${draggingFiles() ? ' dt-dropzone--over' : ''}`}
                      onDragOver={e => { e.preventDefault(); setDraggingFiles(true); }}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDraggingFiles(false); }}
                      onDrop={e => { e.preventDefault(); setDraggingFiles(false); uploadTickerFiles([...e.dataTransfer.files]); }}
                      onClick={() => fileInputRef?.click()}
                    >
                      <input type="file" ref={fileInputRef} multiple style="display:none"
                        onChange={e => uploadTickerFiles([...e.target.files])} />
                      {uploadingFiles()
                        ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>↑</span> Nahrávam…</>
                        : <><span>📎</span> Presunúť súbory sem alebo kliknúť pre výber</>
                      }
                    </div>
                    <Show when={fAttachments().length > 0}>
                      <div class="dt-att-chips">
                        <For each={fAttachments()}>
                          {att => (
                            <div class="dt-att-chip">
                              <a href={toSafeHref(att.url)} target="_blank">{att.name}</a>
                              <button type="button" onClick={() => removeAttachment(att.url)}>×</button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* Náhľad */}
                  <Show when={fText().trim()}>
                    <div class="dt-preview">
                      <div class="dt-preview-title">Náhľad</div>
                      <div class="dt-preview-body">
                        <span
                          id="prev-text"
                          style={{
                            'text-decoration': prevUnderline(),
                            cursor: fLink().trim() ? 'pointer' : 'default',
                          }}
                        >
                          {fText().trim()}
                        </span>
                      </div>
                    </div>
                  </Show>

                  <div class="dt-form-actions">
                    <button type="submit" class="dt-btn dt-primary">Uložiť</button>
                    <button type="button" class="dt-btn" onClick={resetForm}>Vyčistiť</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>

        <Show when={pendingDeleteId()}>
          <ConfirmDialog
            message={`Naozaj chcete zmazať túto správu?\n\n"${msgs().find(x => x.id === pendingDeleteId())?.text || ''}"`}
            confirmLabel="Zmazať"
            cancelLabel="Zrušiť"
            onConfirm={doDelete}
            onCancel={() => setPendingDeleteId(null)}
          />
        </Show>

        <Show when={attachmentConflict()}>
          <ConflictRenameDialog
            title={`Súbor už existuje (${attachmentConflict().current}/${attachmentConflict().total})`}
            descriptionPrefix="V cieľovom priečinku už existuje súbor"
            descriptionSuffix="Vyberte jednu možnosť: premenovať, zrušiť upload alebo prepísať existujúci súbor."
            itemName={attachmentConflict().fileName}
            suggestedName={attachmentConflict().suggestedName}
            normalizeName={normalizeFileName}
            validateName={validateFileName}
            onRename={attachmentConflict().onRename}
            onCancel={attachmentConflict().onCancel}
            onOverwrite={attachmentConflict().onOverwrite}
            cancelLabel="Zrušiť upload"
            overwriteLabel="Prepísať súbor"
          />
        </Show>
      </div>
    </>
  );
}
