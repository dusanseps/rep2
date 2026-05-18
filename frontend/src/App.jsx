
/**
 * App.jsx – koreň aplikácie REPRESENTATIVE
 *
 * Autentifikácia → Router → Shell (Header+Sidebar+Ticker) → Stránky
 */

import { createEffect, createResource, onCleanup, Show } from 'solid-js';
import { Router, Route, Navigate } from '@solidjs/router';
import { initAuth, logout } from './services/auth.js';
import { UserProvider } from './context/user.jsx';
import Shell from './components/layout/Shell.jsx';
import ToastViewport from './components/ui/Toasts.jsx';
import LoginForm from './components/layout/LoginForm.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import NewsPage from './pages/NewsPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import ManualPage from './pages/ManualPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import SearchResultsPage from './pages/SearchResultsPage.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';

function AppRouter({ user }) {
  return (
    <UserProvider value={user}>
      <Router>
        <Route path="/" component={() => <Shell><DashboardPage /></Shell>} />
        <Route path="/novinky" component={() => <Shell><NewsPage /></Shell>} />
        <Route path="/udalosti" component={() => <Shell><EventsPage /></Shell>} />
        <Route path="/dokumenty" component={() => <Shell><DocumentsPage /></Shell>} />
        <Route path="/manual" component={() => <Shell><ManualPage /></Shell>} />
        <Route path="/administracia" component={() => <Shell><AdminPage /></Shell>} />
        <Route path="/search" component={() => <Shell><SearchResultsPage /></Shell>} />
        <Route path="*rest" component={() => <Navigate href="/" />} />
      </Router>
    </UserProvider>
  );
}

export default function App() {
  const [account, { mutate }] = createResource(initAuth);

  createEffect(() => {
    const current = account();
    if (!current?.id) return;

    let source;
    try {
      source = new EventSource(`${API}/auth/permissions/subscribe`);
    } catch (err) {
      console.warn('[Auth SSE] Connection failed:', err.message);
      return;
    }

    source.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data || '{}');
        if (data?.type !== 'permissions:update') return;

        if (data.mustLogout === true) {
          logout();
          return;
        }

        const latest = account();
        if (latest) {
          mutate({
            ...latest,
            readAccess: Boolean(data.readAccess),
          });
        }

        window.dispatchEvent(new CustomEvent('rep:permissions-updated', { detail: data }));
      } catch (err) {
        console.warn('[Auth SSE] Parse failed:', err.message);
      }
    });

    source.addEventListener('error', () => {
      console.warn('[Auth SSE] Connection error');
    });

    onCleanup(() => {
      if (source) source.close();
    });
  });

  return (
    <>
      <Show when={!account.loading} fallback={<LoadingScreen />}>
        <Show when={account()} fallback={<LoginForm onLogin={user => mutate(user)} />}>
          <AppRouter user={account} />
        </Show>
      </Show>
      <ToastViewport />
    </>
  );
}

function LoadingScreen() {
  return (
    <div class="rep-loading">
      <div class="rep-spinner" />
      <p>Overujem prihlásenie…</p>
    </div>
  );
}

