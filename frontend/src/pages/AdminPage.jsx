/**
 * AdminPage – správa aplikácie
 *
 * Oprávnenými spravovať aplikáciu sú administrátori. Editori spravujú priečinky v rozsahu svojich oprávnení.
 */

import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { useUser } from '../context/user.jsx';
import {
  fetchUsers,
  fetchRootFolders,
  fetchUserFolderPermissions,
  saveUserFolderPermissions,
} from '../services/auth.js';
import { showErrorToast, showSuccessToast } from '../components/ui/Toasts.jsx';
import MobileMenu from '../components/shared/MobileMenu.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';
const PAGE_SIZE = 20;

const DummyTestUsers = [
  { username: 'admin', display_name: 'Administrátor', email: 'rep_admin@sepsas.sk', role: 'admin' },
  { username: 'user', display_name: 'Bežný užívateľ', email: 'user@sepssk.sk', role: 'user' },
  { username: 'user2', display_name: 'Druhý užívateľ', email: 'user2@sepssk.sk', role: 'user' },
];

const USE_DUMMY_DATA = false;
const USE_DUMMY_FOLDERS = false;
const USE_DUMMY_SAVE = false;

function UsersListRoot(props) {
  return <div class="admin-users">{props.children}</div>;
}

function UsersListMeta(props) {
  return (
    <div class="admin-users__meta">
      Nájdené: <strong>{props.total}</strong>
    </div>
  );
}

function UsersListCard({ item }) {
  const displayName = item.display_name || item.displayName || item.username || '-';
  const email = item.email || '-';

  return (
    <article class="admin-users__card">
      <div class="admin-users__card-head">
        <h3 class="admin-users__card-name">{displayName}</h3>
        <Show when={item.role}>
          <span class="admin-users__card-badge">{item.role}</span>
        </Show>
      </div>
      <div class="admin-users__card-row">
        <span class="admin-users__card-label">Login</span>
        <span class="admin-users__card-value">{item.username || '-'}</span>
      </div>
      <div class="admin-users__card-row">
        <span class="admin-users__card-label">Email</span>
        <span class="admin-users__card-value">{email}</span>
      </div>
    </article>
  );
}

function UsersListCards(props) {
  return (
    <div class="admin-users__cards">
      <For each={props.rows}>
        {(item) => (
          <div onClick={() => props.onSelectUser(item)} style={{ cursor: 'pointer' }}>
            <UsersListCard item={item} />
          </div>
        )}
      </For>
    </div>
  );
}

function UsersListPager(props) {
  return (
    <Show when={props.totalPages > 1}>
      <div class="admin-users__pager">
        <button class="rep-btn rep-btn--ghost rep-btn--sm" onClick={props.onPrev} disabled={props.page === 1}>Predošlá</button>

        <For each={props.pageNumbers}>
          {(n) => (
            <button
              class={`rep-btn rep-btn--sm ${n === props.page ? 'rep-btn--primary' : 'rep-btn--ghost'}`}
              onClick={() => props.onPage(n)}
            >
              {n}
            </button>
          )}
        </For>

        <button class="rep-btn rep-btn--ghost rep-btn--sm" onClick={props.onNext} disabled={props.page === props.totalPages}>Ďalšia</button>
      </div>
    </Show>
  );
}

const UsersList = Object.assign(UsersListRoot, {
  Meta: UsersListMeta,
  Cards: UsersListCards,
  Pager: UsersListPager,
});

function formatGroupsLabel(count) {
  if (count === 1) return '1 vybraná';
  if (count >= 2 && count <= 4) return `${count} vybrané`;
  return `${count} vybraných`;
}

function formatFoundGroups(count) {
  if (count === 1) return '1 nájdená';
  if (count >= 2 && count <= 4) return `${count} nájdené`;
  return `${count} nájdených`;
}

function UserPermissionsModal(props) {
  const [saving, setSaving] = createSignal(false);
  const [enabledMap, setEnabledMap] = createSignal({});
  const [readAccess, setReadAccess] = createSignal(Boolean(props.readAccess));
  const [err, setErr] = createSignal('');
  const [msOpen, setMsOpen] = createSignal(false);
  const [folderSearch, setFolderSearch] = createSignal('');
  const [searchMode, setSearchMode] = createSignal('anywhere');

  onMount(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') props.onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  createEffect(() => {
    const assigned = props.assignments || [];
    const nextEnabled = {};
    for (const row of assigned) {
      const id = String(row.rootFolderId);
      nextEnabled[id] = true;
    }
    setEnabledMap(nextEnabled);
  });

  createEffect(() => {
    const username = props.user?.username;
    if (username) {
      setFolderSearch('');
      setSearchMode('anywhere');
    }
  });

  createEffect(() => {
    setReadAccess(Boolean(props.readAccess));
  });

  const filteredRootFolders = createMemo(() => {
    const q = folderSearch().trim().toLowerCase();
    const rows = props.rootFolders || [];
    if (!q) return rows;
    
    const mode = searchMode();
    return rows.filter((f) => {
      const name = String(f.name || '').toLowerCase();
      switch (mode) {
        case 'startsWith':
          return name.startsWith(q);
        case 'endsWith':
          return name.endsWith(q);
        case 'anywhere':
        default:
          return name.includes(q);
      }
    });
  });

  function buildAssignments(enabled) {
    return (props.rootFolders || [])
      .filter((f) => enabled[String(f.id)])
      .map((f) => ({ rootFolderId: f.id }));
  }

  async function persistAssignments(nextEnabled, nextReadAccess = readAccess()) {
    if (isAdminUser()) return;
    setErr('');
    setSaving(true);
    try {
      const assignments = buildAssignments(nextEnabled);
      await props.onSaveAssignments?.({ assignments, readAccess: nextReadAccess });
      props.onSaved?.();
    } catch (e) {
      setErr(e.message || 'Nepodarilo sa uložiť priradenia.');
      showErrorToast(e.message || 'Nepodarilo sa uložiť priradenia používateľa.');
    } finally {
      setSaving(false);
    }
  }

  function setAssigned(folderId, checked) {
    const key = String(folderId);
    setEnabledMap((prev) => {
      const next = { ...prev, [key]: checked };
      persistAssignments(next, readAccess());
      return next;
    });
  }

  function setReadAccessAndSave(checked) {
    setReadAccess(checked);
    persistAssignments(enabledMap(), checked);
  }

  const isAdminUser = () => props.user.role === 'admin';
  const selectedCount = () => Object.values(enabledMap()).filter(Boolean).length;

  return (
    <div class="rep-overlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose?.(); }}>
      <div class="rep-drawer rep-drawer--wide">
        <div class="rep-drawer__header">
          <h2 class="rep-drawer__title">Skupiny používateľa: {props.user?.display_name || props.user?.displayName || props.user?.username}</h2>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
            <button class="rep-btn rep-btn--ghost rep-btn--sm" disabled={!props.canPrev} onClick={() => props.onPrev?.()}>
              ← Predošlý
            </button>
            <button class="rep-btn rep-btn--ghost rep-btn--sm" disabled={!props.canNext} onClick={() => props.onNext?.()}>
              Ďalší →
            </button>
            <button class="rep-drawer__close" onClick={props.onClose} aria-label="Zatvoriť">✕</button>
          </div>
        </div>

        <div class="rep-drawer__body">
          <Show when={isAdminUser()}>
            <div class="rep-page__info rep-page__info--warn" style={{ margin: '0 0 16px 0' }}>
              Admin má automaticky prístup do všetkých priečinkov, preto sa členstvo nepriraďuje.
            </div>
          </Show>

          <Show when={!isAdminUser()}>
            <Show when={(props.rootFolders || []).length > 0} fallback={<p class="admin-users__hint">Nie sú dostupné žiadne root priečinky.</p>}>
              <div class="admin-users" style={{ gap: '12px' }}>
                <div class="admin-users__card" style={{ padding: '12px' }}>
                  <button type="button" class="rep-btn rep-btn--ghost" style={{ width: '100%', 'justify-content': 'space-between' }} onClick={() => setMsOpen((v) => !v)}>
                    <span>Pracovné skupiny ({formatGroupsLabel(selectedCount())})</span>
                    <span>{msOpen() ? '▲' : '▼'}</span>
                  </button>

                  <Show when={msOpen()}>
                    <div style={{ display: 'flex', gap: '8px', 'margin-top': '8px', 'align-items': 'center' }}>
                      <div class="admin-users__search-wrap" style={{ flex: 1 }}>
                        <input
                          class="docs-search"
                          type="text"
                          placeholder="Vyhľadávanie"
                          value={folderSearch()}
                          onInput={(e) => setFolderSearch(e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <Show when={folderSearch().trim().length > 0}>
                          <button
                            type="button"
                            class="admin-users__search-clear"
                            onClick={() => setFolderSearch('')}
                            aria-label="Vymazať vyhľadávanie"
                            title="Vymazať"
                          >
                            ×
                          </button>
                        </Show>
                      </div>
                      <select
                        value={searchMode()}
                        onChange={(e) => setSearchMode(e.target.value)}
                        class="rep-form-select"
                        style={{ width: 'auto', 'box-sizing': 'border-box' }}
                      >
                        <option value="anywhere">Všade</option>
                        <option value="startsWith">Na začiatku</option>
                        <option value="endsWith">Na konci</option>
                      </select>
                    </div>
                    <div style={{ 'font-size': '12px', color: '#64748b', 'margin-top': '6px', 'margin-bottom': '8px' }}>
                      {formatFoundGroups(filteredRootFolders().length)}
                    </div>
                    <div style={{ 'margin-top': '8px', border: '1px solid #e2e8f0', 'border-radius': '8px', padding: '6px', 'max-height': '220px', overflow: 'auto' }}>
                      <For each={filteredRootFolders()}>
                        {(folder) => {
                          const key = String(folder.id);
                          const assigned = () => !!enabledMap()[key];
                          return (
                            <label style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '8px', 'border-radius': '6px', background: assigned() ? '#eff6ff' : 'transparent' }}>
                              <input
                                type="checkbox"
                                checked={assigned()}
                                onChange={(e) => setAssigned(folder.id, e.currentTarget.checked)}
                              />
                              <span style={{ flex: 1 }}>{folder.name}</span>
                            </label>
                          );
                        }}
                      </For>
                      <Show when={filteredRootFolders().length === 0}>
                        <p class="admin-users__hint">Žiadny priečinok nevyhovuje filtru.</p>
                      </Show>
                    </div>
                  </Show>
                </div>

                <div class="admin-users__access-toggle">
                  <label class="admin-users__access-check">
                    <input
                      type="checkbox"
                      checked={readAccess()}
                      disabled={saving()}
                      onChange={(e) => setReadAccessAndSave(e.currentTarget.checked)}
                    />
                    <span>Oprávnenie na čítanie</span>
                  </label>
                  <p class="admin-users__access-note">
                    Používateľ môže čítať obsah celej aplikácie a dokumenty sťahovať, ale nemôže nič pridávať, upravovať ani mazať.
                  </p>
                </div>
              </div>
            </Show>
          </Show>

          <Show when={!isAdminUser()}>
            <p class="rep-page__muted" style={{ 'margin-top': '12px' }}>
              {saving() ? 'Ukladám priradenia…' : 'Zmena sa ukladá automaticky po kliknutí na checkbox.'}
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const user = useUser();

  // Route guard: Presmerovať non-admin users na Dashboard
  if (user().role !== 'admin') {
    return <Navigate href="/" />;
  }

  const [searchInput, setSearchInput] = createSignal('');
  const [submittedQuery, setSubmittedQuery] = createSignal('');
  const [page, setPage] = createSignal(1);
  const [selectedUser, setSelectedUser] = createSignal(null);
  const [selectedUserAssignments, setSelectedUserAssignments] = createSignal([]);
  const [selectedUserReadAccess, setSelectedUserReadAccess] = createSignal(false);
  const [modalLoading, setModalLoading] = createSignal(false);
  const [reindexing, setReindexing] = createSignal(false);
  const [reindexStatus, setReindexStatus] = createSignal('');
  const [reindexResult, setReindexResult] = createSignal(null);
  const [searchEngineStatus, setSearchEngineStatus] = createSignal(null);
  const [searchEngineLoading, setSearchEngineLoading] = createSignal(false);
  const [searchEngineRetrying, setSearchEngineRetrying] = createSignal(false);

  const [rootFolders] = createResource(
    () => (user().role === 'admin' ? 'load' : null),
    async (flag) => {
      if (!flag) return [];
      if (USE_DUMMY_FOLDERS) return DummyRootFolders;
      return fetchRootFolders();
    }
  );

  const [users] = createResource(
    () => (user().role === 'admin' ? 'load' : null),
    async (flag) => {
      if (!flag) return [];
      return fetchUsers();
    }
  );

  createEffect(() => {
    if (users.error) {
      showErrorToast(users.error.message || 'Nepodarilo sa načítať používateľov.');
    }
  });

  const usersList = createMemo(() => users() || []);
  const sourceUsers = createMemo(() => {
    if (USE_DUMMY_DATA) return DummyTestUsers;

    const rows = usersList();
    const q = submittedQuery().trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((item) => {
      const displayName = String(item.display_name || item.displayName || '').toLowerCase();
      const username = String(item.username || '').toLowerCase();
      const email = String(item.email || '').toLowerCase();
      return displayName.includes(q) || username.includes(q) || email.includes(q);
    });
  });
  const totalPages = createMemo(() => Math.max(1, Math.ceil(sourceUsers().length / PAGE_SIZE)));
  const pagedUsers = createMemo(() => {
    const start = (page() - 1) * PAGE_SIZE;
    return sourceUsers().slice(start, start + PAGE_SIZE);
  });

  const pageNumbers = createMemo(() => Array.from({ length: totalPages() }, (_, i) => i + 1));

  function submitSearch(e) {
    e.preventDefault();
    const q = searchInput().trim();
    setPage(1);
    setSubmittedQuery(q);
  }

  function goPrev() {
    setPage((p) => Math.max(1, p - 1));
  }

  function goNext() {
    setPage((p) => Math.min(totalPages(), p + 1));
  }

  async function openUserPermissions(item) {
    setSelectedUser(item);
    setModalLoading(true);
    try {
      if (USE_DUMMY_DATA) {
        // Dummy users - start with empty assignments
        setSelectedUserAssignments([]);
        setSelectedUserReadAccess(false);
      } else {
        const data = await fetchUserFolderPermissions(item.username);
        setSelectedUserAssignments(Array.isArray(data?.assignments) ? data.assignments : []);
        setSelectedUserReadAccess(Boolean(data?.readAccess));
      }
    } catch (_e) {
      setSelectedUserAssignments([]);
      setSelectedUserReadAccess(false);
      showErrorToast('Nepodarilo sa načítať priradenia používateľa.');
    } finally {
      setModalLoading(false);
    }
  }

  async function saveAssignmentsForSelected({ assignments, readAccess }) {
    const current = selectedUser();
    if (!current) return;

    if (USE_DUMMY_SAVE) {
      setSelectedUserAssignments(assignments);
      setSelectedUserReadAccess(Boolean(readAccess));
      return;
    }

    await saveUserFolderPermissions({
      username: current.username,
      displayName: current.display_name || current.displayName || current.username,
      email: current.email || null,
      assignments,
      readAccess: Boolean(readAccess),
    });
    setSelectedUserAssignments(assignments);
    setSelectedUserReadAccess(Boolean(readAccess));
  }

  async function startReindex() {
    setReindexing(true);
    setReindexStatus('Spúšťam reindexovanie…');
    setReindexResult(null);
    try {
      const response = await fetch(`${API}/documents/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const result = await response.json();
      setReindexStatus('Reindexovanie prebieha v pozadí…');
      setReindexResult(result);
      showSuccessToast(`✓ Reindexovanie spustené: ${result.total} súborov`);
      setTimeout(() => {
        setReindexStatus('');
        setReindexResult(null);
      }, 8000);
    } catch (err) {
      setReindexStatus('');
      showErrorToast(err.message || 'Nepodarilo sa spustiť reindexovanie.');
    } finally {
      setReindexing(false);
    }
  }

  async function loadSearchEngineStatus() {
    setSearchEngineLoading(true);
    try {
      const response = await fetch(`${API}/documents/search/status`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setSearchEngineStatus(data);
    } catch (err) {
      showErrorToast(err.message || 'Nepodarilo sa načítať stav vyhľadávania dokumentov.');
    } finally {
      setSearchEngineLoading(false);
    }
  }

  async function reconnectSearchEngine() {
    setSearchEngineRetrying(true);
    try {
      const response = await fetch(`${API}/documents/search/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setSearchEngineStatus(data.status || null);
      if (data.ok) {
        showSuccessToast(data.message || 'Vyhľadávanie dokumentov je dostupné.');
      } else {
        showErrorToast(data.message || 'Meilisearch je stále nedostupný.');
      }
    } catch (err) {
      showErrorToast(err.message || 'Nepodarilo sa skúsiť opätovné pripojenie.');
    } finally {
      setSearchEngineRetrying(false);
    }
  }

  onMount(() => {
    loadSearchEngineStatus();
    const timer = setInterval(() => {
      const status = searchEngineStatus();
      if (status?.available && !status?.connecting) return;
      loadSearchEngineStatus();
    }, 30_000);
    onCleanup(() => clearInterval(timer));
  });

  const searchStatusBadge = createMemo(() => {
    const status = searchEngineStatus();
    if (!status) {
      return {
        label: 'Neznámy stav',
        style: {
          background: '#e2e8f0',
          color: '#334155',
        },
      };
    }

    if (status.connecting) {
      return {
        label: 'Pripája sa',
        style: {
          background: '#fef3c7',
          color: '#92400e',
        },
      };
    }

    if (status.available) {
      return {
        label: 'Pripojené',
        style: {
          background: '#dcfce7',
          color: '#166534',
        },
      };
    }

    return {
      label: 'Nedostupné',
      style: {
        background: '#fee2e2',
        color: '#991b1b',
      },
    };
  });

  function switchUserBy(delta) {
    const list = pagedUsers();
    const current = selectedUser();
    if (!current || !list.length) return;
    const idx = list.findIndex((u) => u.username === current.username);
    if (idx < 0) return;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= list.length) return;
    openUserPermissions(list[nextIdx]);
  }

  const canPrevUser = () => {
    const list = pagedUsers();
    const current = selectedUser();
    if (!current || !list.length) return false;
    return list.findIndex((u) => u.username === current.username) > 0;
  };

  const canNextUser = () => {
    const list = pagedUsers();
    const current = selectedUser();
    if (!current || !list.length) return false;
    const idx = list.findIndex((u) => u.username === current.username);
    return idx >= 0 && idx < list.length - 1;
  };

  return (
    <div class="rep-page">
      <div class="rep-page__header">
        <h1 class="rep-page__title">Administrácia</h1>
        <MobileMenu />
      </div>

      <div class="rep-page__content">
        <form class="docs-toolbar" onSubmit={submitSearch}>
          <input
            class="docs-search"
            type="text"
            placeholder="Hľadať používateľa (meno, login, email)…"
            value={searchInput()}
            onInput={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" class="rep-btn rep-btn--primary">Hľadať</button>
        </form>

        <Show when={users.loading}>
          <p class="rep-page__loading">Načítavam používateľov…</p>
        </Show>

        <Show when={!users.loading && !users.error && sourceUsers().length === 0}>
          <p class="rep-page__empty">Nič sa nenašlo.</p>
        </Show>

        <Show when={!users.loading && !users.error && sourceUsers().length > 0}>
          <UsersList>
            <UsersList.Meta total={sourceUsers().length} />
            <UsersList.Cards rows={pagedUsers()} onSelectUser={openUserPermissions} />
            <UsersList.Pager
              page={page()}
              totalPages={totalPages()}
              pageNumbers={pageNumbers()}
              onPrev={goPrev}
              onNext={goNext}
              onPage={setPage}
            />
          </UsersList>
        </Show>
      </div>

      <div class="rep-page__content" style={{ 'margin-top': '16px' }}>
        <div class="rep-page__info" style={{ 'margin-bottom': 0, display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '16px' }}>
          <div>
            <strong>Reindexovanie dokumentov</strong>
            <p style={{ margin: '4px 0 0 0', 'font-size': '14px', color: 'inherit', opacity: 0.85 }}>
              Re-indexovať existujúce dokumenty z databázy do vyhľadávacieho indexu (pre dokumenty nahrané pred aktiváciou vyhľadávania). Trvá pár sekúnd až minút (závisí od počtu/veľkosti dokumentov). 
            </p>
            <Show when={reindexResult()}>
              <p style={{ margin: '8px 0 0 0', 'font-size': '12px', color: 'inherit', opacity: 0.75 }}>
                {reindexStatus()}
              </p>
            </Show>
          </div>
          <button
            class="rep-btn rep-btn--primary"
            onClick={startReindex}
            disabled={reindexing()}
            style={{ 'white-space': 'nowrap', 'flex-shrink': 0 }}
          >
            {reindexing() ? 'Spúšťam...' : 'Reindexovať'}
          </button>
        </div>
      </div>

      <div class="rep-page__content" style={{ 'margin-top': '16px' }}>
        <div class="rep-page__info" style={{ 'margin-bottom': 0, display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
              <strong>Stav full-text vyhľadávania dokumentov</strong>
              <span
                style={{
                  display: 'inline-flex',
                  'align-items': 'center',
                  padding: '2px 10px',
                  borderRadius: '999px',
                  'font-size': '12px',
                  'font-weight': 600,
                  ...searchStatusBadge().style,
                }}
              >
                {searchStatusBadge().label}
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', 'font-size': '14px', color: 'inherit', opacity: 0.85 }}>
              <Show
                when={searchEngineStatus()}
                fallback={searchEngineLoading() ? 'Načítavam stav vyhľadávania…' : 'Stav vyhľadávania sa nepodarilo zistiť.'}
              >
                {(status) => (
                  <>
                    {status().available
                      ? 'Vyhľadávanie je dostupné.'
                      : 'Vyhľadávanie je dočasne nedostupné. Backend skúša automatické opätovné pripojenie každých 30 sekúnd.'}
                  </>
                )}
              </Show>
            </p>
            <Show when={searchEngineStatus() && !searchEngineStatus().available && searchEngineStatus().lastError}>
              <p style={{ margin: '8px 0 0 0', 'font-size': '12px', color: 'inherit', opacity: 0.75 }}>
                Posledná chyba: {searchEngineStatus().lastError}
              </p>
            </Show>
          </div>
          <button
            class="rep-btn rep-btn--ghost"
            onClick={reconnectSearchEngine}
            disabled={searchEngineRetrying()}
            style={{ 'white-space': 'nowrap', 'flex-shrink': 0 }}
          >
            {searchEngineRetrying() ? 'Skúšam...' : 'Skúsiť pripojiť teraz'}
          </button>
        </div>
      </div>

      <Show when={selectedUser()}>
        <Show when={!modalLoading()} fallback={
          <div class="rep-overlay">
            <div class="rep-confirm">
              <p class="rep-confirm__msg">Načítavam priradenia…</p>
            </div>
          </div>
        }>
          <UserPermissionsModal
            user={selectedUser()}
            rootFolders={rootFolders() || []}
            assignments={selectedUserAssignments()}
            readAccess={selectedUserReadAccess()}
            canPrev={canPrevUser()}
            canNext={canNextUser()}
            onPrev={() => switchUserBy(-1)}
            onNext={() => switchUserBy(1)}
            onSaveAssignments={saveAssignmentsForSelected}
            onSaved={() => showSuccessToast('Zmena uložená')}
            onClose={() => {
              setSelectedUser(null);
              setSelectedUserAssignments([]);
              setSelectedUserReadAccess(false);
            }}
          />
        </Show>
      </Show>
    </div>
  );
}
