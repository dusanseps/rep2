import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { NAV_ITEMS } from '../../config/sharepoint.js';
import { useUser } from '../../context/user.jsx';
import styles from './MobileMenu.module.css';

export default function MobileMenu() {
  const user = useUser();
  const location = useLocation();
  const [open, setOpen] = createSignal(false);
  let panelRef;
  let buttonRef;

  const visibleItems = () => {
    return NAV_ITEMS.filter(({ roles }) => {
      if (roles == null) return true;
      if (Array.isArray(roles) && roles.length === 0) return true;
      if (!Array.isArray(roles)) return false;
      return roles.includes(user().role);
    });
  };

  onMount(() => {
    const onPointerDown = (e) => {
      if (!open()) return;
      const target = e.target;
      const insidePanel = panelRef && panelRef.contains(target);
      const onButton = buttonRef && buttonRef.contains(target);
      if (!insidePanel && !onButton) {
        setOpen(false);
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    });
  });

  createEffect(() => {
    location.pathname;
    setOpen(false);
  });

  return (
    <div class={styles.mobileMenu}>
      <button
        ref={(el) => (buttonRef = el)}
        type="button"
        class={styles.button}
        onClick={() => setOpen((v) => !v)}
        aria-label="Otvoriť navigáciu"
        aria-haspopup="true"
        aria-expanded={open()}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path d="M4 12H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path d="M4 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>

      <Show when={open()}>
        <nav ref={(el) => (panelRef = el)} class={styles.panel} aria-label="Mobilná navigácia">
          <For each={visibleItems()}>
            {(item) => (
              item.external
                ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener"
                    class={styles.item}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </a>
                )
                : (
                  <A
                    href={item.href}
                    end={item.href === '/'}
                    class={styles.item}
                    activeClass={styles.itemActive}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </A>
                )
            )}
          </For>
        </nav>
      </Show>
    </div>
  );
}
