/**
 * EventsPage – správa udalostí (zoznam + CRUD)
 * Poznámka: plánovaná integrácia s MS Teams kalendárom.
 */
import { createResource, createSignal, For, Show, Suspense } from 'solid-js';
import { fetchAllEvents, createEvent, updateEvent, deleteEvent } from '../services/sp.js';
import { useUser } from '../context/user.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';

const SK_MONTHS = ['jan', 'feb', 'mar', 'apr', 'máj', 'jún', 'júl', 'aug', 'sep', 'okt', 'nov', 'dec'];

function formatEventDate(start, end, allDay) {
  if (!start) return '';
  const d = `${start.getDate()}. ${SK_MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  if (!end || end.getTime() === start.getTime()) return d + (allDay ? ', celý deň' : '');
  const d2 = `${end.getDate()}. ${SK_MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  return `${d} – ${d2}`;
}

function toInputDT(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return '';
  return date.toISOString().slice(0, 16);
}

// ── karta udalosti ───────────────────────────────────────────────────────────

function openTeams() {
  window.open('https://teams.cloud.microsoft', '_blank', 'noopener');
}

function EventItem({ event, canEdit, onEdit, onDelete }) {
  const isPast = event.start && event.start < new Date();
  return (
    <div
      class={`ev-page-item${isPast ? ' ev-page-item--past' : ''}`}
      style={{ cursor: 'pointer' }}
      onClick={e => { if (!e.target.closest('.ev-page-item__actions')) openTeams(event); }}
      title="Otvoriť MS Teams kalenár"
    >
      <div class="ev-datebox" style={{ 'flex-shrink': '0' }}>
        <span class="ev-datebox__month">{event.start ? SK_MONTHS[event.start.getMonth()].toUpperCase() : '—'}</span>
        <span class="ev-datebox__day">{event.start ? event.start.getDate() + '.' : '—'}</span>
      </div>
      <div class="ev-page-item__body">
        <h3 class="ev-page-item__title">{event.title} <span style={{ 'font-size': '11px', color: '#6366f1', 'font-weight': '400', 'margin-left': '4px' }}>↗ Teams</span></h3>
        <span class="ev-page-item__date">{formatEventDate(event.start, event.end, event.allDay)}</span>
        <Show when={event.location}>
          <span class="ev-page-item__loc">📍 {event.location}</span>
        </Show>
        <Show when={event.description}>
          <p class="ev-page-item__desc">{event.description}</p>
        </Show>
      </div>
      <Show when={canEdit}>
        <div class="ev-page-item__actions">
          <button class="rep-btn rep-btn--ghost rep-btn--sm" onClick={onEdit}>Upraviť</button>
          <button class="rep-btn rep-btn--danger rep-btn--sm" onClick={onDelete}>Zmazať</button>
        </div>
      </Show>
    </div>
  );
}

// ── formulár pre udalosť ─────────────────────────────────────────────────────

function EventForm({ item, onSave, onClose }) {
  const [saving, setSaving] = createSignal(false);
  const [err, setErr] = createSignal('');
  let formRef;

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(formRef);
    setSaving(true); setErr('');
    try {
      await onSave({
        title:       f.get('title'),
        description: f.get('description') || null,
        start:       f.get('start') || null,
        end:         f.get('end') || null,
        allDay:      f.get('allDay') === 'on',
        location:    f.get('location') || null,
      });
    } catch (e) {
      setErr(e.message || 'Chyba pri ukladaní.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="rep-drawer">
        <div class="rep-drawer__header">
          <h2 class="rep-drawer__title">{item.id ? 'Upraviť udalosť' : 'Nová udalosť'}</h2>
          <button class="rep-drawer__close" onClick={onClose} aria-label="Zatvoriť">✕</button>
        </div>

        <form ref={formRef} onSubmit={submit} class="rep-form">
          <div class="rep-form__row">
            <label class="rep-form__label">Názov *</label>
            <input class="rep-form__input" name="title" required value={item.title || ''} placeholder="Názov udalosti" />
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Začiatok</label>
            <input class="rep-form__input" name="start" type="datetime-local" value={toInputDT(item.start)} />
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Koniec</label>
            <input class="rep-form__input" name="end" type="datetime-local" value={toInputDT(item.end)} />
          </div>

          <div class="rep-form__row rep-form__row--check">
            <label class="rep-form__check">
              <input type="checkbox" name="allDay" checked={item.allDay || false} />
              <span>Celý deň</span>
            </label>
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Miesto</label>
            <input class="rep-form__input" name="location" value={item.location || ''} placeholder="Napr. Bratislava, online…" />
          </div>

          <div class="rep-form__row">
            <label class="rep-form__label">Popis</label>
            <textarea class="rep-form__input" name="description" rows="4" placeholder="Popis udalosti…">{item.description || ''}</textarea>
          </div>

          <Show when={err()}>
            <div class="rep-login__error">{err()}</div>
          </Show>

          <div class="rep-form__actions">
            <button type="button" class="rep-btn rep-btn--ghost" onClick={onClose}>Zrušiť</button>
            <button type="submit" class="rep-btn rep-btn--primary" disabled={saving()}>
              {saving() ? 'Ukladám…' : (item.id ? 'Uložiť zmeny' : 'Pridať udalosť')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── hlavná stránka ───────────────────────────────────────────────────────────

export default function EventsPage() {
  const user = useUser();
  const [events, { refetch }] = createResource(fetchAllEvents);
  const [editing, setEditing] = createSignal(null);
  const [toDelete, setToDelete] = createSignal(null);

  const canEdit = () => ['admin', 'editor'].includes(user()?.role);

  async function handleSave(data) {
    if (editing().id) await updateEvent(editing().id, data);
    else await createEvent(data);
    setEditing(null);
    refetch();
  }

  async function handleDelete() {
    await deleteEvent(toDelete());
    setToDelete(null);
    refetch();
  }

  return (
    <div class="rep-page">
      <div class="rep-page__header">
        <h1 class="rep-page__title">Udalosti</h1>
        <Show when={canEdit()}>
          <button class="rep-btn rep-btn--primary" onClick={() => setEditing({})}>
            + Pridať udalosť
          </button>
        </Show>
      </div>

      <div class="rep-page__content">

        <div class="rep-page__info">
        <span>📅</span>
        <span>
          Plánuje sa prepojenie s <strong>MS Teams kalendárom</strong> – udalosti sa budú importovať automaticky.
          Teraz môžete udalosti spravovať manuálne.
        </span>
      </div>

      <Suspense fallback={<p class="rep-page__loading">Načítavam…</p>}>
        <Show when={!events.error} fallback={
          <div class="rep-panel__error">
            <p>Nepodarilo sa načítať udalosti.</p>
            <button onClick={refetch} class="rep-btn">Skúsiť znova</button>
          </div>
        }>
          <Show when={events()?.length > 0} fallback={
            <p class="rep-page__empty">Žiadne udalosti. Kliknite na „+ Pridať udalosť".</p>
          }>
            <div class="ev-page-list">
              <For each={events()}>
                {event => (
                  <EventItem
                    event={event}
                    canEdit={canEdit()}
                    onEdit={() => setEditing(event)}
                    onDelete={() => setToDelete(event.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Suspense>
      </div>

      <Show when={editing() !== null}>
        <EventForm item={editing()} onSave={handleSave} onClose={() => setEditing(null)} />
      </Show>

      <Show when={toDelete()}>
        <ConfirmDialog
          message="Naozaj chcete odstrániť túto udalosť? Akcia je nevratná."
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      </Show>
    </div>
  );
}
