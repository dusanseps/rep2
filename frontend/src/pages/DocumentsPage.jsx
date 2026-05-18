/**
 * DocumentsPage – hierarchický prehliadač dokumentov s vlastnou DB
 * Admin/Editor: plná správa priečinkov
 * User: nahrávanie súborov a vytváranie podpriečinkov v povolených vetvách
 */
import { createContext, createResource, createSignal, For, onCleanup, onMount, Show, useContext } from 'solid-js';
import { useUser } from '../context/user.jsx';
import { showErrorToast, showSuccessToast } from '../components/ui/Toasts.jsx';
import ConflictRenameDialog from '../components/shared/ConflictRenameDialog.jsx';
import DocumentDeleteConflictDialog from '../components/shared/DocumentDeleteConflictDialog.jsx';
import { buildSuggestedName, normalizeFileName, validateFileName } from '../utils/fileNames.js';
import '../styles/docs-conflict.css';

const API = import.meta.env.VITE_API_BASE || '/api';
const DOC_UPLOAD_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.tif,.tiff,.msg,.eml,.odt,.ods,.odp,.rtf,.xml,.json,.md';

async function fetchTree() {
  try {
    const r = await fetch(`${API}/documents/tree`, { credentials: 'include', cache: 'no-store' });
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

function FolderNode({ node, depth = 0, query }) {
  const { user, refetch } = useContext(DocsCtx);
  const canManageNode = () => {
    const role = user()?.role;
    if (role === 'admin' || role === 'editor') return true;
    if (role === 'user') return Boolean(node.can_manage);
    return false;
  };
  const canDeleteNode = () => canManageNode();

  const [open, setOpen]           = createSignal(depth === 0);
  const [dragging, setDragging]   = createSignal(false);
  const [addingChild, setAddingChild] = createSignal(false);
  const [newName, setNewName]     = createSignal('');
  const [saving, setSaving]       = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [uploadConflict, setUploadConflict] = createSignal(null);
  const [deleteConflict, setDeleteConflict] = createSignal(null);
  let nameInputRef, fileInputRef;

  const label = () => node.name.replace(/_/g, '\u00a0');

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
    () => (open() ? node.id : null),
    async (folderId) => {
      if (!folderId) return [];
      try {
        const r = await fetch(`${API}/documents/folders/${folderId}/files`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!r.ok) return [];
        return r.json();
      } catch (err) {
        console.warn('[Documents folder files] Fetch failed:', { folderId, message: err.message });
        return [];
      }
    }
  );

  onMount(() => {
    const handleDocsUpdated = () => {
      if (open()) refetchFiles();
    };
    window.addEventListener('rep:documents-updated', handleDocsUpdated);
    onCleanup(() => {
      window.removeEventListener('rep:documents-updated', handleDocsUpdated);
    });
  });

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
    if (!confirm(`Naozaj zmazať priečinok „${node.name}" aj so všetkým obsahom?`)) return;
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

    async function uploadSingleFile(file, { overwrite = false, fileName } = {}) {
      const fd = new FormData();
      fd.append('file', file);
      if (overwrite) fd.append('overwrite', 'true');
      if (fileName) fd.append('fileName', fileName);

      const r = await fetch(`${API}/documents/folders/${node.id}/upload`, {
        method: 'POST', credentials: 'include', body: fd,
      });

      const body = await r.json().catch((err) => {
        console.warn('[Documents doUpload] Response parse failed:', err.message);
        return {};
      });

      if (r.status === 409) return { ok: false, conflict: true, body };
      if (!r.ok) return { ok: false, conflict: false, body };
      return { ok: true, body };
    }

    function askConflict({ fileName, suggestedName, current, total }) {
      return new Promise((resolve) => {
        setUploadConflict({
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

    setUploading(true);
    if (!open()) setOpen(true);
    try {
      let uploaded = 0;
      let overwritten = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < filesList.length; i += 1) {
        const file = filesList[i];
        let targetName = normalizeFileName(file.name);
        const initialErr = validateFileName(targetName);
        if (initialErr) {
          failed += 1;
          showErrorToast(initialErr);
          continue;
        }

        let done = false;
        while (!done) {
          const result = await uploadSingleFile(file, { fileName: targetName });

          if (result.ok) {
            uploaded += 1;
            done = true;
            continue;
          }

          if (!result.conflict) {
            failed += 1;
            showErrorToast(result.body?.error || 'Chyba nahrávania súboru');
            done = true;
            continue;
          }

          const decision = await askConflict({
            fileName: result.body?.existingName || targetName,
            suggestedName: result.body?.suggestedName || buildSuggestedName(targetName),
            current: i + 1,
            total: filesList.length,
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
              showErrorToast(renameErr);
              skipped += 1;
              done = true;
            }
            continue;
          }

          if (decision.action === 'overwrite') {
            const overwriteResult = await uploadSingleFile(file, { fileName: targetName, overwrite: true });
            if (overwriteResult.ok) {
              overwritten += 1;
            } else {
              failed += 1;
              showErrorToast(overwriteResult.body?.error || 'Nahradenie súboru zlyhalo');
            }
            done = true;
          }
        }
      }

      refetchFiles();
      refetch();

      const summary = [];
      if (uploaded) summary.push(`nahrané: ${uploaded}`);
      if (overwritten) summary.push(`nahradené: ${overwritten}`);
      if (skipped) summary.push(`zrušené: ${skipped}`);
      if (failed) summary.push(`chyby: ${failed}`);

      if (uploaded || overwritten) {
        showSuccessToast(`Nahrávanie dokončené (${summary.join(', ')})`);
      }
    } catch (err) {
      console.error('[Documents doUpload] Error:', err.message);
      showErrorToast('Chyba nahrávania súborov');
    } finally {
      setUploadConflict(null);
      setUploading(false);
    }
  }

  async function deleteFile(fileId) {
    try {
      // Načítaj väzby na dokument
      const r = await fetch(`${API}/documents/files/${fileId}/links`, {
        credentials: 'include',
      });
      if (!r.ok) {
        showErrorToast('Nepodarilo sa skontrolovať väzby na dokument');
        return;
      }
      const { links } = await r.json();
      
      // Ak existujú väzby, zobraz dialóg
      if (links && links.length > 0) {
        setDeleteConflict({
          fileId,
          links,
          onCancel: () => setDeleteConflict(null),
          onRefresh: () => deleteFile(fileId),
          onEditLink: (link) => {
            // Otvori novinku alebo ticker v novom tabe
            if (link.type === 'news') {
              // Novinka sa otvára v modáli na stránke /novinky?view=ID
              window.open(`/novinky?view=${link.attachmentId}`, '_blank');
            } else if (link.type === 'ticker') {
              // Ticker sa otvára na domovnej stránke s query param - TickerModal sa otvorí automaticky
              window.open(`/?editTicker=${link.attachmentId}`, '_blank');
            }
          },
          onDeleteDocument: async () => {
            // Zmaž dokument
            const delR = await fetch(`${API}/documents/files/${fileId}`, {
              method: 'DELETE',
              credentials: 'include',
            });
            if (!delR.ok) {
              const e = await delR.json().catch(() => ({}));
              showErrorToast(e.error || 'Chyba mazania súboru');
              throw new Error(e.error);
            }
            setDeleteConflict(null);
            refetchFiles();
            refetch();
            showSuccessToast('Súbor zmazaný');
          },
        });
        return;
      }

      // Bez väzieb - zobraz potvrdenie a zmaž
      if (!confirm('Naozaj zmazať súbor?')) return;
      
      const delR = await fetch(`${API}/documents/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!delR.ok) {
        const e = await delR.json().catch(() => ({}));
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

  return (
    <>
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
          <span class="docs-node__label">{label()}</span>
          <Show when={folderFileCount() > 0}>
            <span class="docs-node__file-count">({folderFileCount()})</span>
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
                      <a class="docs-file__name" href={f.file_url} target="_blank" download={f.name}>{f.name}</a>
                      <Show when={f.file_size}>
                        <span class="docs-file__size">{formatSize(f.file_size)}</span>
                      </Show>
                      <Show when={canDeleteNode()}>
                        <button class="docs-file__del" title="Zmazať súbor" onClick={() => deleteFile(f.id)}>🗑</button>
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
        </div>
      </Show>

      <Show when={uploadConflict()}>
        <ConflictRenameDialog
          title={`Súbor už existuje (${uploadConflict().current}/${uploadConflict().total})`}
          descriptionPrefix="V cieľovom priečinku už existuje súbor"
          descriptionSuffix="Vyberte jednu možnosť: premenovať, zrušiť upload alebo prepísať existujúci súbor."
          itemName={uploadConflict().fileName}
          suggestedName={uploadConflict().suggestedName}
          normalizeName={normalizeFileName}
          validateName={validateFileName}
          onRename={uploadConflict().onRename}
          onCancel={uploadConflict().onCancel}
          onOverwrite={uploadConflict().onOverwrite}
          cancelLabel="Zrušiť upload"
          overwriteLabel="Prepísať súbor"
        />
      </Show>

      <Show when={deleteConflict()}>
        <DocumentDeleteConflictDialog
          links={deleteConflict().links || []}
          userId={user()?.id}
          userRole={user()?.role}
          onCancel={deleteConflict().onCancel}
          onRefresh={deleteConflict().onRefresh}
          onEditLink={deleteConflict().onEditLink}
          onDeleteDocument={deleteConflict().onDeleteDocument}
        />
      </Show>
    </>
  );
}

// ── Hlavná stránka ────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const user = useUser();
  const [tree, { refetch }] = createResource(fetchTree);
  const [search, setSearch]       = createSignal('');
  const [addingRoot, setAddingRoot] = createSignal(false);
  const [rootName, setRootName]   = createSignal('');
  const [rootSaving, setRootSaving] = createSignal(false);
  let rootNameRef;

  onMount(() => {
    const handlePermissionsUpdated = () => {
      refetch();
    };

    let docsSource;
    try {
      docsSource = new EventSource(`${API}/documents/subscribe`);
      docsSource.addEventListener('message', () => {
        refetch();
        window.dispatchEvent(new CustomEvent('rep:documents-updated'));
      });
      docsSource.addEventListener('error', () => {
        console.warn('[Documents SSE] Connection error');
      });
    } catch (err) {
      console.warn('[Documents SSE] Connection failed:', err.message);
    }

    window.addEventListener('rep:permissions-updated', handlePermissionsUpdated);
    onCleanup(() => {
      window.removeEventListener('rep:permissions-updated', handlePermissionsUpdated);
      if (docsSource) docsSource.close();
    });
  });

  const canManageRoots = () => user()?.role === 'admin' || user()?.role === 'editor';

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
    <DocsCtx.Provider value={{ user, refetch }}>
      <div class="rep-page">
        <div class="rep-page__header">
          <h1 class="rep-page__title">Dokumenty</h1>
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
