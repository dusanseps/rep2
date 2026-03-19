/**
 * DocumentsPage – hierarchický prehliadač dokumentov s vlastnou DB
 * Editor/Admin: vytváranie, mazanie priečinkov, nahrávanie súborov (drag & drop)
 */
import { createContext, createResource, createSignal, For, Show, useContext } from 'solid-js';
import { useUser } from '../context/user.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';

async function fetchTree() {
  const r = await fetch(`${API}/documents/tree`, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
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
  const canEdit = () => user()?.role === 'admin' || user()?.role === 'editor';

  const [open, setOpen]           = createSignal(depth === 0);
  const [dragging, setDragging]   = createSignal(false);
  const [addingChild, setAddingChild] = createSignal(false);
  const [newName, setNewName]     = createSignal('');
  const [saving, setSaving]       = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
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
      const r = await fetch(`${API}/documents/folders/${folderId}/files`, { credentials: 'include' });
      if (!r.ok) return [];
      return r.json();
    }
  );

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
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Chyba'); return; }
      setNewName(''); setAddingChild(false); refetch();
    } finally { setSaving(false); }
  }

  async function deleteFolder() {
    if (!confirm(`Naozaj zmazať priečinok „${node.name}" aj so všetkým obsahom?`)) return;
    const r = await fetch(`${API}/documents/folders/${node.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) refetch();
  }

  async function doUpload(filesList) {
    if (!filesList.length) return;
    setUploading(true);
    if (!open()) setOpen(true);
    try {
      for (const file of filesList) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`${API}/documents/folders/${node.id}/upload`, {
          method: 'POST', credentials: 'include', body: fd,
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Chyba nahrávania'); }
      }
      refetchFiles();
    } finally { setUploading(false); }
  }

  async function deleteFile(fileId) {
    if (!confirm('Naozaj zmazať súbor?')) return;
    await fetch(`${API}/documents/files/${fileId}`, { method: 'DELETE', credentials: 'include' });
    refetchFiles();
  }

  return (
    <Show when={visible()}>
      <div class={`docs-node docs-node--depth-${Math.min(depth, 3)}`}>

        {/* ── Riadok priečinka ── */}
        <div
          class={`docs-node__row${(node.children?.length || open()) ? ' docs-node__row--haschildren' : ''}${dragging() ? ' docs-node__row--dragover' : ''}`}
          onClick={() => setOpen(o => !o)}
          onDragOver={e => { e.preventDefault(); if (canEdit()) setDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation(); setDragging(false);
            if (canEdit()) doUpload([...e.dataTransfer.files]);
          }}
          style={{ 'padding-left': `${12 + depth * 20}px` }}
        >
          <span class="docs-node__toggle">{shouldOpen() ? '▾' : '▸'}</span>
          <span class="docs-node__icon">{shouldOpen() ? '📂' : '📁'}</span>
          <span class="docs-node__label">{label()}</span>
          <Show when={node.children?.length > 0}>
            <span class="docs-node__badge">{node.children.length}</span>
          </Show>
          <Show when={uploading()}>
            <span class="docs-node__uploading">↑</span>
          </Show>

          {/* Akcie – viditeľné pri hoveri */}
          <Show when={canEdit()}>
            <div class="docs-node__actions" onClick={e => e.stopPropagation()}>
              <button
                class="docs-action-btn docs-action-btn--add"
                title="Pridať podpriečinok"
                onClick={() => { setAddingChild(a => !a); setOpen(true); setTimeout(() => nameInputRef?.focus(), 50); }}
              >+📁</button>
              <label class="docs-action-btn docs-action-btn--upload" title="Nahrať súbory">
                📎
                <input type="file" multiple ref={fileInputRef} style="display:none"
                  onChange={e => doUpload([...e.target.files])} />
              </label>
              <button class="docs-action-btn docs-action-btn--del" title="Zmazať priečinok" onClick={deleteFolder}>🗑</button>
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
                      <Show when={canEdit()}>
                        <button class="docs-file__del" title="Zmazať súbor" onClick={() => deleteFile(f.id)}>🗑</button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Dropzone pre nahrávanie - skrytá, zobrazí sa pri hoveri nad priečinkom */}
            <Show when={canEdit()}>
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

  const canEdit = () => user()?.role === 'admin' || user()?.role === 'editor';

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
      if (r.ok) { setRootName(''); setAddingRoot(false); refetch(); }
    } finally { setRootSaving(false); }
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
            <Show when={canEdit()}>
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
