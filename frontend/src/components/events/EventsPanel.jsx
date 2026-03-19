/**
 * EventsPanel – panel udalostí (ľavá časť hero oblasti)
 * Načíta udalosti zo SharePoint Calendar listu a zobrazí ich
 * v rovnakom štýle ako originálna SharePoint stránka.
 */

import { createResource, For, Show, Suspense } from 'solid-js';
import { A } from '@solidjs/router';
import { fetchEvents } from '../../services/sp.js';

const SK_MONTHS = ['jan', 'feb', 'mar', 'apr', 'máj', 'jún', 'júl', 'aug', 'sep', 'okt', 'nov', 'dec'];
const SK_MONTHS_FULL = ['Január','Február','Marec','Apríl','Máj','Jún','Júl','August','September','Október','November','December'];

function formatDay(date) {
  return String(date.getDate()).padStart(2, '0') + '.';
}
function formatMonth(date) {
  return SK_MONTHS[date.getMonth()].toUpperCase();
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function EventDateBox({ start, end }) {
  if (!start) return <div class="ev-datebox ev-datebox--empty" />;
  const startDay = start.getDate();
  const endDay = end && !isSameDay(start, end) ? end.getDate() : null;
  const monthStr = formatMonth(start);

  return (
    <div class="ev-datebox">
      <span class="ev-datebox__month">{monthStr}</span>
      <span class="ev-datebox__day">
        {startDay}.{endDay ? `\u2013${endDay}.` : ''}
      </span>
    </div>
  );
}

function EventCard(props) {
  const isCards = () => props.view === 'cards';
  return (
    <div class={`ev-card${isCards() ? ' ev-card--card' : ''}`}
      style={{ cursor: 'pointer' }}
      onClick={() => window.open('https://teams.cloud.microsoft', '_blank', 'noopener')}
      title="Otvoriť MS Teams kalenár"
    >
      <EventDateBox start={props.event.start} end={props.event.end} />
      <div class="ev-card__body">
        <span class="ev-card__title">{props.event.title}</span>
        <span class="ev-card__sub">
          {props.event.start
            ? `${props.event.start.toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric' })}${props.event.allDay ? ', Celý deň' : ''}`
            : ''}
        </span>
        <Show when={props.event.location && isCards()}>
          <span class="ev-card__loc">📍 {props.event.location}</span>
        </Show>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div class="ev-card ev-card--skeleton">
      <div class="ev-datebox ev-datebox--skeleton" />
      <div class="ev-card__body" style={{ gap: '6px', display: 'flex', 'flex-direction': 'column' }}>
        <div class="skeleton-line" style={{ width: '80%' }} />
        <div class="skeleton-line" style={{ width: '55%' }} />
      </div>
    </div>
  );
}

export default function EventsPanel(props) {
  const [events, { refetch }] = createResource(() => props.view, () => fetchEvents(6));

  return (
    <section class="rep-panel">
      <div class="rep-panel__header">
        <h2 class="rep-panel__title">Udalosti</h2>
        <A href="/udalosti" class="rep-panel__showall">Zobraziť všetko →</A>
      </div>

      <div class={`ev-list${props.view === 'cards' ? ' ev-list--cards' : ''}`}>
        <Suspense fallback={<For each={[1,2,3,4,5,6]}>{() => <SkeletonCard />}</For>}>
          <Show when={!events.error} fallback={
            <div class="rep-panel__error">
              <p>Nepodarilo sa načítať udalosti.</p>
              <button onClick={refetch} class="rep-panel__retry">Skúsiť znova</button>
            </div>
          }>
            <Show
              when={events() && events().length > 0}
              fallback={<p class="rep-panel__empty">Žiadne nadchádzajúce udalosti.</p>}
            >
              <For each={events()}>
                {event => <EventCard event={event} view={props.view} />}
              </For>
            </Show>
          </Show>
        </Suspense>
      </div>
    </section>
  );
}
