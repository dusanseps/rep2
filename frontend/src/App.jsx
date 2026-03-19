
/**
 * App.jsx – koreň aplikácie REPRESENTATIVE
 *
 * Autentifikácia → Router → Shell (Header+Sidebar+Ticker) → Stránky
 */

import { createResource, Show } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import { initAuth } from './services/auth.js';
import { UserProvider } from './context/user.jsx';
import Shell from './components/layout/Shell.jsx';
import LoginForm from './components/layout/LoginForm.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import NewsPage from './pages/NewsPage.jsx';
import EventsPage from './pages/EventsPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import ManualPage from './pages/ManualPage.jsx';

function AppRouter({ user }) {
  return (
    <UserProvider value={user}>
      <Router root={Shell}>
        <Route path="/"          component={DashboardPage} />
        <Route path="/novinky"   component={NewsPage} />
        <Route path="/udalosti"  component={EventsPage} />
        <Route path="/dokumenty" component={DocumentsPage} />
        <Route path="/manual"    component={ManualPage} />
      </Router>
    </UserProvider>
  );
}

export default function App() {
  const [account, { mutate }] = createResource(initAuth);

  return (
    <Show when={!account.loading} fallback={<LoadingScreen />}>
      <Show when={account()} fallback={<LoginForm onLogin={user => mutate(user)} />}>
        <AppRouter user={account} />
      </Show>
    </Show>
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

