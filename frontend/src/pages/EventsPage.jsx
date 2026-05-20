/**
 * EventsPage – správa udalostí (zoznam + CRUD)
 * Poznámka: plánovaná integrácia s MS Teams kalendárom.
 */
import { createResource, createSignal, createEffect, For, Show, Suspense } from 'solid-js';
import { createMemo, onCleanup, onMount } from 'solid-js';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { fetchAllEvents, createEvent, updateEvent, deleteEvent } from '../services/sp.js';
import { useUser } from '../context/user.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import MobileMenu from '../components/shared/MobileMenu.jsx';
import { showErrorToast } from '../components/ui/Toasts.jsx';

const API = import.meta.env.VITE_API_BASE || '/api';

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
function EventItem({ event, canEdit, onEdit, onDelete, onView }) {
  const isPast = event.start && event.start < new Date();
  return (
    <div
      class={`ev-page-item${isPast ? ' ev-page-item--past' : ''}`}
      style={{ cursor: 'pointer' }}
      onClick={e => { if (!e.target.closest('.ev-page-item__actions')) onView(); }}
      title="Zobraziť detail udalosti"
    >
      <div class="ev-datebox" style={{ 'flex-shrink': '0' }}>
        <span class="ev-datebox__month">{event.start ? SK_MONTHS[event.start.getMonth()].toUpperCase() : '—'}</span>
        <span class="ev-datebox__day">{event.start ? event.start.getDate() + '.' : '—'}</span>
      </div>
      <div class="ev-page-item__body">
        <h3 class="ev-page-item__title">{event.title}</h3>
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

function EventDetailModal({ event, onClose }) {
  return (
    <div class="rep-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="rep-drawer rep-drawer--wide">
        <div class="rep-drawer__header">
          <h2 class="rep-drawer__title" style={{ 'font-size': '17px', 'line-height': '1.4' }}>{event.title}</h2>
          <button class="rep-drawer__close" onClick={onClose} aria-label="Zatvoriť">✕</button>
        </div>
        <div class="rep-drawer__body">
          <div class="news-detail__meta" style={{ display: 'flex', gap: '12px', 'margin-bottom': '18px', 'font-size': '13px', color: '#64748b', 'flex-wrap': 'wrap' }}>
            <Show when={event.start}>
              <span>📅 {formatEventDate(event.start, event.end, event.allDay)}</span>
            </Show>
            <Show when={event.location}>
              <span>📍 {event.location}</span>
            </Show>
          </div>
          <Show when={event.description} fallback={<p style={{ color: '#94a3b8', 'font-style': 'italic' }}>Popis udalosti nie je k dispozícii.</p>}>
            <div style={{ 'font-size': '14px', color: '#475569', 'line-height': '1.75', 'white-space': 'pre-wrap' }}>{event.description}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ── formulár pre udalosť ─────────────────────────────────────────────────────

function EventForm({ item, onSave, onClose }) {
  const [saving, setSaving] = createSignal(false);
  const [err, setErr] = createSignal('');
  let formRef;

  onMount(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

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
      showErrorToast(e.message || 'Chyba pri ukladaní udalosti.');
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
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useUser();
  const [events, { refetch }] = createResource(fetchAllEvents);
  const [showModal, setShowModal] = createSignal(!!params.view);
  const selectedEvent = createMemo(() => {
    const id = params.view ? String(params.view) : null;
    if (!id) return null;
    return (events() || []).find((e) => String(e.id) === id) || null;
  });

  createEffect(() => {
    setShowModal(!!params.view);
  });

  function closeModal() {
    setShowModal(false);
    navigate('/udalosti', { replace: true });
  }

  function openEventModal(eventId) {
    navigate(`/udalosti?view=${eventId}`);
  }
  
  createEffect(() => {
    if (events.error) {
      showErrorToast(events.error.message || 'Nepodarilo sa načítať udalosti.');
    }
  });
  
  const [editing, setEditing] = createSignal(null);
  const [toDelete, setToDelete] = createSignal(null);
  const [eventFilter, setEventFilter] = createSignal('all');

  const userId = () => user()?.id ? String(user().id) : null;
  const canCreate = () => Boolean(user()?.id);

  const canEditEvent = (event) => {
    const role = user()?.role;
    if (role === 'admin' || role === 'editor') return true;
    return event?.createdById === userId();
  };

  const filteredEvents = createMemo(() => {
    const all = events() || [];
    if (eventFilter() === 'my') return all.filter((e) => e.createdById === userId());
    return all;
  });

  const countAll = () => events()?.length || 0;
  const countMine = () => (events() || []).filter((e) => e.createdById === userId()).length;

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

  onMount(() => {
    try {
      const eventSource = new EventSource(`${API}/events/subscribe`);

      eventSource.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type) refetch();
        } catch (err) {
          console.warn('[EventsPage SSE] Parse failed:', err.message);
        }
      });

      eventSource.addEventListener('error', () => {
        eventSource.close();
      });

      onCleanup(() => {
        eventSource.close();
      });
    } catch (err) {
      console.warn('[EventsPage SSE] Connection failed:', err.message);
    }
  });

  return (
    <div class="rep-page">
      <div class="rep-page__header">
        <h1 class="rep-page__title">Udalosti</h1>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <Show when={canCreate()}>
            <button class="rep-btn rep-btn--primary" onClick={() => setEditing({})}>
              + Pridať udalosť
            </button>
          </Show>
          <MobileMenu />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '16px', 'flex-wrap': 'wrap' }}>
        <button
          class={`rep-btn rep-btn--sm ${eventFilter() === 'all' ? 'rep-btn--primary' : 'rep-btn--ghost'}`}
          onClick={() => setEventFilter('all')}
        >
          Všetky udalosti ({countAll()})
        </button>
        <button
          class={`rep-btn rep-btn--sm ${eventFilter() === 'my' ? 'rep-btn--primary' : 'rep-btn--ghost'}`}
          onClick={() => setEventFilter('my')}
        >
          Moje udalosti ({countMine()})
        </button>
      </div>

      <div class="rep-page__content">

  

      <Suspense fallback={<p class="rep-page__loading">Načítavam…</p>}>
        <Show when={!events.error} fallback={
          <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
            <button onClick={refetch} class="rep-btn rep-btn--primary">Skúsiť znova</button>
          </div>
        }>
          <Show when={filteredEvents()?.length > 0} fallback={
            <p class="rep-page__empty">Žiadne udalosti. Kliknite na „+ Pridať udalosť".</p>
          }>
            <div class="ev-page-list">
              <For each={filteredEvents()}>
                {event => (
                  <EventItem
                    event={event}
                    canEdit={canEditEvent(event)}
                    onView={() => openEventModal(event.id)}
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

      <Show when={showModal() && selectedEvent()}>
        <EventDetailModal event={selectedEvent()} onClose={closeModal} />
      </Show>
    </div>
  );
}
