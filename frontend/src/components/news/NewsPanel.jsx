/**
 * NewsPanel – panel noviniek (pravá časť hero oblasti)
 * Načíta News Posts zo SharePoint Site Pages a zobrazí ich
 * s miniatúrou, názvom, popisom a autorom.
 */

import { createResource, For, Show, Suspense } from 'solid-js';
import { A } from '@solidjs/router';
import { fetchNews } from '../../services/sp.js';

function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'dnes';
  if (days === 1) return 'pred dňom';
  if (days < 5) return `pred ${days} dňami`;
  if (days < 30) return `pred ${days} dňami`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'pred mesiacom';
  if (months < 12) return `pred ${months} mesiacmi`;
  return `pred ${Math.floor(months / 12)} rokmi`;
}

function truncate(str, max = 120) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max).trimEnd() + '…';
}

function NewsCard(props) {
  const isCards = () => props.view === 'cards';
  return (
    <article class={`news-card${isCards() ? ' news-card--card' : ''}`}>
      <Show when={props.item.imageUrl}>
        <a href={props.item.url || '#'} target="_blank" rel="noopener" class="news-card__img-wrap" tabindex="-1">
          <img
            src={props.item.imageUrl}
            alt={props.item.title}
            class="news-card__img"
            loading="lazy"
            onError={e => { e.target.closest('.news-card__img-wrap').style.display = 'none'; }}
          />
        </a>
      </Show>
      <div class="news-card__body">
        <a href={props.item.url || '#'} target="_blank" rel="noopener" class="news-card__title">
          {props.item.title}
        </a>
        <Show when={props.item.description}>
          <p class="news-card__desc">{truncate(props.item.description, isCards() ? 160 : 120)}</p>
        </Show>
        <span class="news-card__meta">
          {props.item.author && <span class="news-card__author">{props.item.author}</span>}
          {props.item.publishedAt && (
            <span class="news-card__date" title={props.item.publishedAt.toLocaleString('sk-SK')}>
              {timeAgo(props.item.publishedAt)}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div class="news-card news-card--skeleton">
      <div class="news-card__img-wrap" style={{ background: 'rgba(255,255,255,.12)', width: '96px', 'min-width': '96px', height: '72px', 'border-radius': '8px' }} />
      <div class="news-card__body" style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
        <div class="skeleton-line" style={{ width: '70%' }} />
        <div class="skeleton-line" style={{ width: '90%' }} />
        <div class="skeleton-line" style={{ width: '50%' }} />
      </div>
    </div>
  );
}

export default function NewsPanel(props) {
  const [news, { refetch }] = createResource(() => props.view, () => fetchNews(6));

  return (
    <section class="rep-panel">
      <div class="rep-panel__header">
        <h2 class="rep-panel__title">Novinky</h2>
        <A href="/novinky" class="rep-panel__showall">Zobraziť všetko →</A>
      </div>

      <div class={`news-list${props.view === 'cards' ? ' news-list--cards' : ''}`}>
        <Suspense fallback={<For each={[1,2,3,4,5,6]}>{() => <SkeletonCard />}</For>}>
          <Show when={!news.error} fallback={
            <div class="rep-panel__error">
              <p>Nepodarilo sa načítať novinky.</p>
              <button onClick={refetch} class="rep-panel__retry">Skúsiť znova</button>
            </div>
          }>
            <Show
              when={news() && news().length > 0}
              fallback={<p class="rep-panel__empty">Žiadne novinky.</p>}
            >
              <For each={news()}>
                {item => <NewsCard item={item} view={props.view} />}
              </For>
            </Show>
          </Show>
        </Suspense>
      </div>
    </section>
  );
}
