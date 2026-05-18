/**
 * Header – horná lišta aplikácie
 * Replikuje dizajn SharePoint stránky REPRESENTATIVE.
 */

import { createSignal, onCleanup, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { logout } from '../../services/auth.js';

export default function Header({ user }) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [searchFocus, setSearchFocus] = createSignal(false);
  const displayName = user?.displayName || user?.username || 'Používateľ';
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const navigate = useNavigate();
  let menuRef, avatarRef, searchRef;

  // Close menu on click outside or Escape
  onMount(() => {
    function handleClick(e) {
      if (menuOpen() && menuRef && !menuRef.contains(e.target) && avatarRef && !avatarRef.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        if (searchFocus()) {
          setSearchFocus(false);
          searchRef?.blur();
        }
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    });
  });

  function handleSearchSubmit(e) {
    e.preventDefault();
    const value = search().trim();
    if (value.length >= 2) {
      setSearch('');
      setSearchFocus(false);
      navigate(`/search?query=${encodeURIComponent(value)}`);
    }
  }

  return (
    <header class="rep-header" style={{ display: 'flex', alignItems: 'center' }}>
      {/* Logo + názov */}
      <div class="rep-header__brand">
        <img src="/seps-logo.jpg" alt="SEPS" class="rep-header__logo" />
        <span class="rep-header__title">REPRESENTATIVE 2</span>
      </div>

      {/* Akcie vpravo: search + avatar */}
      <div class="rep-header__actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <form
          class="rep-header__search"
          style={{ maxWidth: '340px', minWidth: '180px' }}
          onSubmit={handleSearchSubmit}
          autoComplete="off"
        >
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              ref={el => (searchRef = el)}
              class="rep-form__input rep-header__search-input"
              type="text"
              placeholder="Vyhľadať..."
              value={search()}
              onInput={e => setSearch(e.target.value)}
              onFocus={() => setSearchFocus(true)}
              onBlur={() => setSearchFocus(false)}
              style={{ paddingRight: '36px', height: '38px', fontSize: '15px' }}
            />
            <button
              type="submit"
              class="rep-header__search-btn"
              style={{
                position: 'absolute',
                right: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                color: '#64748b',
                fontSize: '20px',
                display: 'flex',
                alignItems: 'center',
                height: '28px',
                width: '28px',
              }}
              aria-label="Vyhľadať"
              tabIndex={-1}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="9" cy="9" r="7" stroke="#64748b" strokeWidth="2" />
                <line x1="14.4142" y1="14" x2="18" y2="17.5858" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </form>
        <div
          class="rep-header__user"
          style={{ position: 'relative' }}
        >
          <button
            ref={el => (avatarRef = el)}
            class="rep-avatar"
            title={displayName}
            onClick={() => setMenuOpen(v => !v)}
            aria-haspopup="true"
            aria-expanded={menuOpen()}
            style={{ marginLeft: 'auto' }}
          >
            {initials}
          </button>
          {menuOpen() && (
            <div
              ref={el => (menuRef = el)}
              class="rep-user-menu"
              style={{ right: 0, left: 'auto' }}
            >
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
