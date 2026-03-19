/**
 * Header – horná lišta aplikácie
 * Replikuje dizajn SharePoint stránky REPRESENTATIVE.
 */

import { createSignal } from 'solid-js';
import { logout } from '../../services/auth.js';

export default function Header({ user }) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const displayName = user?.displayName || user?.username || 'Používateľ';
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header class="rep-header">
      {/* Logo + názov */}
      <div class="rep-header__brand">
        <img src="/seps-logo.jpg" alt="SEPS" class="rep-header__logo" />
        <span class="rep-header__title">REPRESENTATIVE</span>
      </div>

      {/* Akcie vpravo */}
      <div class="rep-header__actions">
        {/* Avatar + logout */}
        <div class="rep-header__user" style={{ position: 'relative' }}>
          <button
            class="rep-avatar"
            title={displayName}
            onClick={() => setMenuOpen(v => !v)}
            aria-haspopup="true"
            aria-expanded={menuOpen()}
          >
            {initials}
          </button>

          {menuOpen() && (
            <div class="rep-user-menu">
              <div class="rep-user-menu__name">{displayName}</div>
              <button class="rep-user-menu__logout" onClick={logout}>
                Odhlásiť sa
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
