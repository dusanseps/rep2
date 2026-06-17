/**
 * DocumentsPage – hierarchický prehliadač dokumentov s vlastnou DB
 * Admin: plná správa priečinkov
 * User: nahrávanie súborov a vytváranie podpriečinkov v povolených vetvách
 */
import { createContext, createEffect, createResource, createSignal, For, onCleanup, onMount, Show, useContext } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { useUser } from '../context/user.jsx';
import { showErrorToast, showSuccessToast } from '../components/ui/Toasts.jsx';
import ConflictRenameDialog from '../components/shared/ConflictRenameDialog.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import MobileMenu from '../components/shared/MobileMenu.jsx';
import { uploadFileWithConflictHandler } from '../utils/uploadHelper.js';

const API = import.meta.env.VITE_API_BASE || '/api';
const DOC_UPLOAD_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.tif,.tiff,.msg,.eml,.odt,.ods,.odp,.rtf,.xml,.json,.md';

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

async function fetchTree() {
  try {
    const r = await fetch(`${API}/documents/tree`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  } catch (err) {
    console.error('[Documents fetchTree] Error:', err.message);
    throw err;
  }
}

function formatSize(b) {
  if (!b) return '';
  if (b < 1024)     return `${b} B`;
  if (b < 1048576)  return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.includes('pdf'))                                   return '📕';
  if (mime.includes('word') || mime.includes('document'))     return '📘';
  if (mime.includes('excel') || mime.includes('sheet') || mime.includes('csv')) return '📗';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📙';
  if (mime.includes('image'))                                 return '🖼️';
  if (mime.includes('zip') || mime.includes('rar'))           return '🗜️';
  return '📄';
}

const DocsCtx = createContext();

// ── Rekurzívny uzol stromu ────────────────────────────────────────────────────

function countAllFiles(node) {
  const own = Number(node.file_count) || 0;
  return own + (node.children || []).reduce((sum, c) => sum + countAllFiles(c), 0);
}

function FolderNode({ node, depth = 0, query }) {
  const { user, refetch, filesVersion, openFolderIds, consumeAutoOpenFolderId } = useContext(DocsCtx);
  const canManageNode = () => {
    const role = user()?.role;
    if (role === 'admin' || role === 'editor') return true;
    if (role === 'user') return Boolean(node.can_manage);
    return false;
  };
  const canDeleteNode = () => user()?.role === 'admin' || user()?.role === 'editor';

  // Ak je folder ID v openFolderIds, začni s otvoreným
  const initialOpen = depth === 0 || openFolderIds()?.has(String(node.id));
  const [open, setOpen]           = createSignal(initialOpen);
  const [dragging, setDragging]   = createSignal(false);

  // Keď sa zmenia openFolderIds, aktualizuj open state
  createEffect(() => {
    const shouldBeOpen = openFolderIds()?.has(String(node.id));
    if (shouldBeOpen) {
      consumeAutoOpenFolderId?.(String(node.id));
    }
    if (shouldBeOpen && !open()) {
      setOpen(true);
    }
  });
  const [addingChild, setAddingChild] = createSignal(false);
  const [newName, setNewName]     = createSignal('');
  const [saving, setSaving]       = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [renamingFileId, setRenamingFileId] = createSignal(null);
  const [renameValue, setRenameValue] = createSignal('');
  const [renamingFolder, setRenamingFolder] = createSignal(false);
  const [renameFolderValue, setRenameFolderValue] = createSignal('');
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [pendingDeleteFile, setPendingDeleteFile] = createSignal(null); // { id, name }
  const [tickerUsageWarning, setTickerUsageWarning] = createSignal(null); // { type: 'file'|'folder', messages: [], onConfirm }

  // Conflict resolution dialog state
  const [showConflictDialog, setShowConflictDialog] = createSignal(false);
  const [conflictData, setConflictData] = createSignal(null);
  const [conflictResolver, setConflictResolver] = createSignal(null);
  
  let nameInputRef, fileInputRef;

  const label = () => node.name;

  const matchesSelf = () => !query() || node.name.toLowerCase().includes(query().toLowerCase());
  const hasVisibleChild = () => {
    if (!query()) return true;
    function anyMatch(ns) {
      return ns.some(n => n.name.toLowerCase().includes(query().toLowerCase()) || anyMatch(n.children || []));
    }
    return anyMatch(node.children || []);
  };
  const visible    = () => matchesSelf() || hasVisibleChild();
  const shouldOpen = () => open() || (query() && hasVisibleChild());

  // Lazy-load súborov keď je priečinok otvorený
  const [files, { refetch: refetchFiles }] = createResource(
    () => (open() ? `${node.id}:${filesVersion()}` : null),
    async (key) => {
      const [folderIdStr] = key.split(':');
      const r = await fetch(`${API}/documents/folders/${folderIdStr}/files`, { credentials: 'include' });
      if (!r.ok) return [];
      return r.json();
    }
  );

  const folderFileCount = () => {
    const loaded = files();
    if (Array.isArray(loaded)) return loaded.length;
    return Number(node.file_count) || 0;
  };

  async function addSubfolder() {
    const name = newName().trim();
    if (!name) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/documents/folders`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: node.id }),
      });
      if (!r.ok) {
        const e = await r.json().catch((err) => {
          console.warn('[Documents addSubfolder] Response parse failed:', err.message);
          return {};
        });
        showErrorToast(e.error || 'Chyba vytvárania priečinka');
        return;
      }
      setNewName('');
      setAddingChild(false);
      refetch();
      showSuccessToast('Priečinok vytvorený');
    } catch (err) {
      console.error('[Documents addSubfolder] Error:', err.message);
      showErrorToast('Chyba vytvárania priečinka');
    } finally {
      setSaving(false);
    }
  }

  async function deleteFolder() {
    setShowDeleteConfirm(true);
  }

  async function doDeleteFolder() {
    setShowDeleteConfirm(false);

    try {
      const usageRes = await fetch(`${API}/documents/folders/${node.id}/ticker-usage`, { credentials: 'include' });
      if (usageRes.ok) {
        const tickerMsgs = await usageRes.json();
        if (tickerMsgs.length > 0) {
          setTickerUsageWarning({ messages: tickerMsgs, onConfirm: () => executeDeleteFolder() });
          return;
        }
      }
    } catch (err) {
      console.warn('[Documents] Ticker usage check failed:', err.message);
    }

    await executeDeleteFolder();
  }

  async function executeDeleteFolder() {
    setTickerUsageWarning(null);
    try {
      const r = await fetch(`${API}/documents/folders/${node.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) {
        const e = await r.json().catch((err) => {
          console.warn('[Documents deleteFolder] Response parse failed:', err.message);
          return {};
        });
        showErrorToast(e.error || 'Chyba mazania priečinka');
        return;
      }
      refetch();
      showSuccessToast('Priečinok zmazaný');
    } catch (err) {
      console.error('[Documents deleteFolder] Error:', err.message);
      showErrorToast('Chyba mazania priečinka');
    }
  }

  async function doUpload(filesList) {
    if (!filesList.length) return;
    setUploading(true);
    if (!open()) setOpen(true);
    try {
      for (const file of filesList) {
        await uploadFileWithConflictHandler({
          uploadUrl: `${API}/documents/folders/${node.id}/upload`,
          file,
          onConflict: async (data) => {
            // Show conflict dialog and wait for user action
            return new Promise((resolve) => {
              setConflictData({
                existingName: data.existingName,
                suggestedName: data.suggestedName
              });
              setConflictResolver(() => resolve);
              setShowConflictDialog(true);
            });
          },
          onError: (msg) => showErrorToast(msg),
          onSuccess: () => {
            // Success handled after all files
          }
        });
      }
      refetchFiles();
      refetch();
      showSuccessToast('Súbory nahrané');
    } catch (err) {
      console.error('[Documents doUpload] Error:', err.message);
      showErrorToast('Chyba nahrávania súborov');
    } finally {
      setUploading(false);
    }
  }

  async function deleteFile(fileId, fileName) {
    setPendingDeleteFile({ id: fileId, name: fileName });
  }

  async function doDeleteFile() {
    const file = pendingDeleteFile();
    setPendingDeleteFile(null);
    if (!file) return;

    try {
      const usageRes = await fetch(`${API}/documents/files/${file.id}/ticker-usage`, { credentials: 'include' });
      if (usageRes.ok) {
        const tickerMsgs = await usageRes.json();
        if (tickerMsgs.length > 0) {
          setTickerUsageWarning({ messages: tickerMsgs, onConfirm: () => executeDeleteFile(file.id) });
          return;
        }
      }
    } catch (err) {
      console.warn('[Documents] Ticker usage check failed:', err.message);
    }

    await executeDeleteFile(file.id);
  }

  async function executeDeleteFile(fileId) {
    setTickerUsageWarning(null);
    try {
      const r = await fetch(`${API}/documents/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) {
        const e = await r.json().catch((err) => {
          console.warn('[Documents deleteFile] Response parse failed:', err.message);
          return {};
        });
        showErrorToast(e.error || 'Chyba mazania súboru');
        return;
      }
      refetchFiles();
      refetch();
      showSuccessToast('Súbor zmazaný');
    } catch (err) {
      console.error('[Documents deleteFile] Error:', err.message);
      showErrorToast('Chyba mazania súboru');
    }
  }

  async function renameFile(fileId, newName) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const r = await fetch(`${API}/documents/files/${fileId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        showErrorToast(e.error || 'Chyba premenovania súboru');
        return;
      }
      setRenamingFileId(null);
      refetchFiles();
      showSuccessToast('Súbor premenovaný');
    } catch (err) {
      console.error('[Documents renameFile] Error:', err.message);
      showErrorToast('Chyba premenovania súboru');
    }
  }

  async function renameFolder(newName) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const r = await fetch(`${API}/documents/folders/${node.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        showErrorToast(e.error || 'Chyba premenovania priečinka');
        return;
      }
      setRenamingFolder(false);
      refetch();
      showSuccessToast('Priečinok premenovaný');
    } catch (err) {
      console.error('[Documents renameFolder] Error:', err.message);
      showErrorToast('Chyba premenovania priečinka');
    }
  }

  return (
    <Show when={visible()}>
      <div class={`docs-node docs-node--depth-${Math.min(depth, 3)}`}>

        {/* ── Riadok priečinka ── */}
        <div
          class={`docs-node__row${(node.children?.length || open()) ? ' docs-node__row--haschildren' : ''}${dragging() ? ' docs-node__row--dragover' : ''}`}
          onClick={() => setOpen(o => !o)}
          onDragOver={e => { e.preventDefault(); if (canManageNode()) setDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation(); setDragging(false);
            if (canManageNode()) doUpload([...e.dataTransfer.files]);
          }}
          style={{ 'padding-left': `${12 + depth * 20}px` }}
        >
          <span class="docs-node__toggle">{shouldOpen() ? '▾' : '▸'}</span>
          <span class="docs-node__icon">{shouldOpen() ? '📂' : '📁'}</span>
          <Show when={renamingFolder()} fallback={<>
            <span class="docs-node__label">{label()}</span>
            <Show when={folderFileCount() > 0}>
              <span class="docs-node__file-count">({folderFileCount()})</span>
            </Show>
          </>}>
            <input
              class="docs-addfolder__input"
              style={{ flex: 1, 'min-width': 0 }}
              value={renameFolderValue()}
              ref={el => setTimeout(() => el?.focus(), 0)}
              onClick={e => e.stopPropagation()}
              onInput={e => setRenameFolderValue(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') renameFolder(renameFolderValue());
                if (e.key === 'Escape') { e.preventDefault(); setRenamingFolder(false); }
              }}
            />
            <button class="docs-addfolder__btn docs-addfolder__btn--ok" onClick={e => { e.stopPropagation(); renameFolder(renameFolderValue()); }}>✓</button>
            <button class="docs-addfolder__btn docs-addfolder__btn--cancel" onClick={e => { e.stopPropagation(); setRenamingFolder(false); }}>✕</button>
          </Show>
          <Show when={uploading()}>
            <span class="docs-node__uploading">↑</span>
          </Show>

          {/* Akcie – viditeľné pri hoveri */}
          <Show when={canManageNode()}>
            <div class="docs-node__actions" onClick={e => e.stopPropagation()}>
              <button
                class="docs-action-btn docs-action-btn--add"
                title="Pridať podpriečinok"
                onClick={() => { setAddingChild(a => !a); setOpen(true); setTimeout(() => nameInputRef?.focus(), 50); }}
              >+📁</button>
              <button
                class="docs-action-btn"
                title="Premenovať priečinok"
                onClick={() => { setRenamingFolder(true); setRenameFolderValue(node.name); }}
              >✏️</button>
              <label class="docs-action-btn docs-action-btn--upload" title="Nahrať súbory">
                📎
                <input type="file" multiple ref={fileInputRef} style="display:none"
                  accept={DOC_UPLOAD_ACCEPT}
                  onChange={e => doUpload([...e.target.files])} />
              </label>
              <Show when={canDeleteNode()}>
                <button class="docs-action-btn docs-action-btn--del" title="Zmazať priečinok" onClick={deleteFolder}>🗑</button>
              </Show>
            </div>
          </Show>
        </div>

        {/* ── Obsah otvoreného priečinka ── */}
        <Show when={shouldOpen()}>
          <div class="docs-node__children">

            {/* Inline formulár pre nový podpriečinok */}
            <Show when={addingChild()}>
              <div class="docs-addfolder" style={{ 'padding-left': `${12 + (depth + 1) * 20}px` }}>
                <input
                  ref={nameInputRef}
                  class="docs-addfolder__input"
                  placeholder="Názov podpriečinka…"
                  value={newName()}
                  onInput={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') addSubfolder();
                    if (e.key === 'Escape') { setAddingChild(false); setNewName(''); }
                  }}
                />
                <button class="docs-addfolder__btn docs-addfolder__btn--ok" disabled={saving()} onClick={addSubfolder}>✓</button>
                <button class="docs-addfolder__btn docs-addfolder__btn--cancel" onClick={() => { setAddingChild(false); setNewName(''); }}>✕</button>
              </div>
            </Show>

            {/* Podpriečinky */}
            <For each={node.children}>
              {child => <FolderNode node={child} depth={depth + 1} query={query} />}
            </For>

            {/* Zoznam súborov */}
            <Show when={files() && files().length > 0}>
              <div class="docs-files" style={{ 'padding-left': `${12 + (depth + 1) * 20}px` }}>
                <For each={files()}>
                  {f => (
                    <div class="docs-file">
                      <span class="docs-file__icon">{fileIcon(f.mime_type)}</span>
                      <Show when={renamingFileId() === f.id} fallback={<>
                        <a class="docs-file__name" href={toSafeHref(f.file_url)} target="_blank" download={f.name}>{f.name}</a>
                        <Show when={f.file_size}>
                          <span class="docs-file__size">{formatSize(f.file_size)}</span>
                        </Show>
                        <Show when={canManageNode()}>
                          <button class="docs-file__ren" title="Premenovať súbor" onClick={() => { setRenamingFileId(f.id); setRenameValue(f.name); }}>✏️</button>
                          <button class="docs-file__del" title="Zmazať súbor" onClick={() => deleteFile(f.id, f.name)}>🗑</button>
                        </Show>
                      </>}>
                        <input
                          class="docs-addfolder__input"
                          style={{ flex: 1, 'min-width': 0 }}
                          value={renameValue()}
                          ref={el => setTimeout(() => el?.focus(), 0)}
                          onInput={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter') renameFile(f.id, renameValue());
                            if (e.key === 'Escape') { e.preventDefault(); setRenamingFileId(null); }
                          }}
                        />
                        <button class="docs-addfolder__btn docs-addfolder__btn--ok" onClick={() => renameFile(f.id, renameValue())}>✓</button>
                        <button class="docs-addfolder__btn docs-addfolder__btn--cancel" onClick={() => setRenamingFileId(null)}>✕</button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Dropzone pre nahrávanie - skrytá, zobrazí sa pri hoveri nad priečinkom */}
            <Show when={canManageNode()}>
              <div
                class="docs-dropzone"
                style={{ 'margin-left': `${16 + (depth + 1) * 20}px`, 'margin-right': '8px' }}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragging(false); doUpload([...e.dataTransfer.files]); }}
                onClick={() => fileInputRef?.click()}
              >
                {uploading() ? '↑ Nahrávam…' : '＋ Nahrať súbory'}
              </div>
            </Show>

          </div>
        </Show>

        {/* Potvrdenie mazania súboru */}
        <Show when={pendingDeleteFile()}>
          <ConfirmDialog
            message={`Naozaj chcete zmazať súbor „${pendingDeleteFile()?.name}"?`}
            confirmLabel="Zmazať"
            cancelLabel="Zrušiť"
            onConfirm={doDeleteFile}
            onCancel={() => setPendingDeleteFile(null)}
          />
        </Show>

        {/* Potvrdenie mazania priečinka */}
        <Show when={showDeleteConfirm()}>
          {() => {
            const totalFiles = countAllFiles(node);
            const msg = totalFiles > 0
              ? `V priečinku „${node.name}" sa nachádza ${totalFiles} ${totalFiles === 1 ? 'súbor' : totalFiles < 5 ? 'súbory' : 'súborov'} (vrátane podpriečinkov). Naozaj chcete priečinok zmazať aj s celým obsahom?`
              : `Naozaj chcete zmazať priečinok „${node.name}"?`;
            return (
              <ConfirmDialog
                message={msg}
                confirmLabel="Zmazať"
                cancelLabel="Zrušiť"
                onConfirm={doDeleteFolder}
                onCancel={() => setShowDeleteConfirm(false)}
              />
            );
          }}
        </Show>

        {/* Conflict Resolution Dialog */}
        <Show when={showConflictDialog() && conflictData()}>
          <ConflictRenameDialog
            title="Konflikt pri nahraní súboru"
            descriptionPrefix="Súbor"
            descriptionSuffix="už v tomto priečinku existuje."
            itemName={conflictData()?.existingName}
            suggestedName={conflictData()?.suggestedName}
            onRename={(newName) => {
              setShowConflictDialog(false);
              const resolver = conflictResolver();
              if (resolver) resolver({ type: 'rename', newName });
            }}
            onCancel={() => {
              setShowConflictDialog(false);
              const resolver = conflictResolver();
              if (resolver) resolver({ type: 'cancel' });
            }}
            onOverwrite={() => {
              setShowConflictDialog(false);
              const resolver = conflictResolver();
              if (resolver) resolver({ type: 'overwrite' });
            }}
          />
        </Show>

        {/* Ticker usage warning */}
        <Show when={tickerUsageWarning()}>
          <ConfirmDialog
            message={`Tento súbor/priečinok sa používa ako príloha v ${tickerUsageWarning().messages.length} ticker ${tickerUsageWarning().messages.length === 1 ? 'správe' : tickerUsageWarning().messages.length < 5 ? 'správach' : 'správach'}:\n\n${tickerUsageWarning().messages.map(m => `„${m.text}"`).join('\n')}\n\nAk súbor zmažete, tieto prílohy prestanú fungovať. Pokračovať?`}
            confirmLabel="Zmazať aj tak"
            cancelLabel="Zrušiť"
            onConfirm={tickerUsageWarning().onConfirm}
            onCancel={() => setTickerUsageWarning(null)}
          />
        </Show>
      </div>
    </Show>
  );
}

// ── Hlavná stránka ────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const user = useUser();
  const location = useLocation();
  const [tree, { refetch }] = createResource(fetchTree);
  const [search, setSearch]       = createSignal('');
  const [addingRoot, setAddingRoot] = createSignal(false);
  const [rootName, setRootName]   = createSignal('');
  const [rootSaving, setRootSaving] = createSignal(false);
  const [openFolderIds, setOpenFolderIds] = createSignal(new Set());
  let rootNameRef;

  const [filesVersion, setFilesVersion] = createSignal(0);

  // Keď sa zmení query parameter, otvoriť príslušný priečinok
  createEffect(() => {
    const params = new URLSearchParams(location.search);
    const folderId = params.get('folder');
    if (folderId) {
      setOpenFolderIds(new Set([folderId]));
    }
  });

  function consumeAutoOpenFolderId(folderId) {
    setOpenFolderIds((prev) => {
      if (!prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
  }

  onMount(() => {
    const es = new EventSource(`${API}/documents/subscribe`, { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        refetch();
        if (msg.type === 'file_upload' || msg.type === 'file_delete') {
          setFilesVersion(v => v + 1);
        }
      } catch (_) {}
    };
    onCleanup(() => es.close());
  });

  const canManageRoots = () => user()?.role === 'admin';

  const totalFolders = () => {
    function count(ns) { return ns.reduce((s, n) => s + 1 + count(n.children || []), 0); }
    return tree() ? count(tree()) : 0;
  };

  async function addRootFolder() {
    const name = rootName().trim();
    if (!name) return;
    setRootSaving(true);
    try {
      const r = await fetch(`${API}/documents/folders`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const e = await r.json().catch((err) => {
          console.warn('[Documents addRootFolder] Response parse failed:', err.message);
          return {};
        });
        showErrorToast(e.error || 'Chyba vytvárania priečinka');
        return;
      }
      setRootName('');
      setAddingRoot(false);
      refetch();
      showSuccessToast('Priečinok vytvorený');
    } catch (err) {
      console.error('[Documents addRootFolder] Error:', err.message);
      showErrorToast('Chyba vytvárania priečinka');
    } finally {
      setRootSaving(false);
    }
  }

  return (
    <DocsCtx.Provider value={{ user, refetch, filesVersion, openFolderIds, consumeAutoOpenFolderId }}>
      <div class="rep-page">
        <div class="rep-page__header">
          <h1 class="rep-page__title">Dokumenty</h1>
          <MobileMenu />
        </div>

        <div class="rep-page__content">
          <div class="docs-toolbar">
            <input
              class="docs-search"
              type="text"
              placeholder="Hľadať priečinok…"
              value={search()}
              onInput={e => setSearch(e.target.value)}
            />
            <Show when={tree()}>
              <span class="docs-count">{totalFolders()} priečinkov</span>
            </Show>
            <Show when={canManageRoots()}>
              <button
                class="docs-add-root-btn"
                onClick={() => { setAddingRoot(a => !a); setTimeout(() => rootNameRef?.focus(), 50); }}
              >+ Priečinok</button>
            </Show>
          </div>

          {/* Inline formulár pre koreňový priečinok */}
          <Show when={addingRoot()}>
            <div class="docs-addfolder docs-addfolder--root">
              <input
                ref={rootNameRef}
                class="docs-addfolder__input"
                placeholder="Názov nového koreňového priečinka…"
                value={rootName()}
                onInput={e => setRootName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addRootFolder();
                  if (e.key === 'Escape') { setAddingRoot(false); setRootName(''); }
                }}
              />
              <button class="docs-addfolder__btn docs-addfolder__btn--ok" disabled={rootSaving()} onClick={addRootFolder}>✓</button>
              <button class="docs-addfolder__btn docs-addfolder__btn--cancel" onClick={() => { setAddingRoot(false); setRootName(''); }}>✕</button>
            </div>
          </Show>

          <Show when={tree.error}>
            <div class="rep-panel__error">
              <p>Nepodarilo sa načítať dokumenty.</p>
              <button class="rep-btn" onClick={refetch}>Skúsiť znova</button>
            </div>
          </Show>

          <Show when={!tree.loading && !tree.error}>
            <div class="docs-tree">
              <For each={tree()}>
                {node => <FolderNode node={node} depth={0} query={search} />}
              </For>
            </div>
          </Show>

          <Show when={tree.loading}>
            <p class="rep-page__loading">Načítavam…</p>
          </Show>
        </div>
      </div>
    </DocsCtx.Provider>
  );
}
