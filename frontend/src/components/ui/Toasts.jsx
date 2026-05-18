import { createSignal, For, onCleanup, onMount } from 'solid-js';

const TOAST_EVENT = 'rep:toast';
let toastId = 0;

function emitToast(payload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: payload }));
}

export function showErrorToast(message, duration = 4000) {
  emitToast({ type: 'error', message, duration });
}

export function showSuccessToast(message, duration = 4000) {
  emitToast({ type: 'success', message, duration });
}

export function showWarningToast(message, duration = 4000) {
  emitToast({ type: 'warning', message, duration });
}

export function showInfoToast(message, duration = 4000) {
  emitToast({ type: 'info', message, duration });
}

export default function ToastViewport() {
  const [items, setItems] = createSignal([]);
  const timers = new Map();

  function remove(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  function add(detail) {
    const id = ++toastId;
    const message = String(detail?.message || 'Nastala neočakávaná chyba.');
    const type = detail?.type || 'info';
    const duration = Number(detail?.duration) > 0 ? Number(detail.duration) : 4000;

    setItems((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => remove(id), duration);
    timers.set(id, timer);
  }

  function handleToast(event) {
    add(event.detail || {});
  }

  onMount(() => {
    window.addEventListener(TOAST_EVENT, handleToast);
  });

  onCleanup(() => {
    window.removeEventListener(TOAST_EVENT, handleToast);
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  });

  return (
    <div class="rep-toast-stack" aria-live="polite" aria-atomic="true">
      <For each={items()}>
        {(item) => (
          <div class={`rep-toast rep-toast--${item.type}`} role="status">
            <span>{item.message}</span>
            <button
              type="button"
              class="rep-toast__close"
              onClick={() => remove(item.id)}
              aria-label="Zatvoriť oznámenie"
            >
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
