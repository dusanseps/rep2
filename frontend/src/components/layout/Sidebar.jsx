/**
 * Sidebar – navigácia aplikácie 
 */

import { For } from 'solid-js';
import { A } from '@solidjs/router';
import { NAV_ITEMS } from '../../config/sharepoint.js';
import { useUser } from '../../context/user.jsx';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const user = useUser();

  const visibleItems = () => {
    return NAV_ITEMS.filter(({ roles }) => {
      if (roles == null) return true;
      if (Array.isArray(roles) && roles.length === 0) return true;
      if (!Array.isArray(roles)) return false;
      return roles.includes(user().role);
    });
  };

  return (
    <nav class={styles['rep-sidebar']} aria-label="Lokálna navigácia">
      <For each={visibleItems()}>
        {(item) => (
          item.external
            ? (
              <a href={item.href} target="_blank" rel="noopener" class={styles['rep-sidebar__item']}>
                {item.label}
              </a>
            )
            : (
              <A
                href={item.href}
                end={item.href === '/'}
                activeClass={styles['rep-sidebar__item--active']}
                class={styles['rep-sidebar__item']}
              >
                {item.label}
              </A>
            )
        )}
      </For>
    </nav>
  );
}
