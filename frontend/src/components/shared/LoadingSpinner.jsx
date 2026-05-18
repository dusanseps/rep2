import { createSignal, onMount } from 'solid-js';

/**
 * LoadingSpinner – zdieľaný loading komponent pre celú aplikáciu
 * Možnosti: 'spinner', 'skeleton', 'text'
 */
export default function LoadingSpinner(props) {
  /* props: type='spinner'|'skeleton'|'text', label='Načítavam…', size='sm'|'md'|'lg' */
  const type = () => props.type || 'spinner';
  const label = () => props.label || 'Načítavam…';
  const size = () => props.size || 'md';

  return (
    <div class={`rep-loading-spinner rep-loading-spinner--${size()}`}>
      {type() === 'text' && (
        <span class="rep-loading-text">{label()}</span>
      )}
      {type() === 'spinner' && (
        <>
          <div class="rep-spinner" />
          <span class="rep-loading-text">{label()}</span>
        </>
      )}
      {type() === 'skeleton' && (
        <div class="rep-skeleton" />
      )}
    </div>
  );
}

export function InlineLoader(props) {
  /* Kompaktný loader pre inline zobrazenie v zoznamoch */
  return (
    <div class="rep-inline-loader">
      <span class="rep-spinner-mini" />
      <span>{props.label || 'Načítavam…'}</span>
    </div>
  );
}
