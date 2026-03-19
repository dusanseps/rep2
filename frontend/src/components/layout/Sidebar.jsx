/**
 * Sidebar – ľavá navigácia aplikácie REPRESENTATIVE
 */

import { For } from 'solid-js';
import { A } from '@solidjs/router';
import { NAV_ITEMS } from '../../config/sharepoint.js';

export default function Sidebar() {
  return (
    <nav class="rep-sidebar" aria-label="Lokálna navigácia">
      <For each={NAV_ITEMS}>
        {(item) => (
          item.external
            ? (
              <a href={item.href} target="_blank" rel="noopener" class="rep-sidebar__item">
                {item.label}
              </a>
            )
            : (
              <A
                href={item.href}
                end={item.href === '/'}
                activeClass="rep-sidebar__item--active"
                class="rep-sidebar__item"
              >
                {item.label}
              </A>
            )
        )}
      </For>
    </nav>
  );
}
