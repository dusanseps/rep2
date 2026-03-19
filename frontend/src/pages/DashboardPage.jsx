/**
 * DashboardPage – úvodná stránka (dashboard) so panelmi udalostí a noviniek
 * Prepínač zobrazenia: list (štandardný) ↔ cards (kartičky)
 */
import { createSignal } from 'solid-js';
import EventsPanel from '../components/events/EventsPanel.jsx';
import NewsPanel from '../components/news/NewsPanel.jsx';

const VIEW_KEY = 'rep_dashboard_view';

export default function DashboardPage() {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
  const [view, setView] = createSignal(stored === 'cards' ? 'cards' : 'list');

  function toggleView(v) {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  }

  return (
    <div class="rep-hero">
      {/* Prepínač zobrazenia */}
      <div class="dash-view-toggle">
        <button
          class={`dash-view-btn${view() === 'list' ? ' dash-view-btn--active' : ''}`}
          onClick={() => toggleView('list')}
          title="Zoznamové zobrazenie"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="2" width="14" height="2.5" rx="1"/>
            <rect x="1" y="6.75" width="14" height="2.5" rx="1"/>
            <rect x="1" y="11.5" width="14" height="2.5" rx="1"/>
          </svg>
          Zoznam
        </button>
        <button
          class={`dash-view-btn${view() === 'cards' ? ' dash-view-btn--active' : ''}`}
          onClick={() => toggleView('cards')}
          title="Kartičkové zobrazenie"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="6" height="6" rx="1.5"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5"/>
          </svg>
          Karty
        </button>
      </div>

      <div class={`rep-hero__panels${view() === 'cards' ? ' rep-hero__panels--cards' : ''}`}>
        <EventsPanel view={view()} />
        <NewsPanel   view={view()} />
      </div>
    </div>
  );
}
