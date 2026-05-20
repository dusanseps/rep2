import { createSignal, onMount, createEffect } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import MobileMenu from '../components/shared/MobileMenu.jsx';

function getMimeIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('word') || mimeType.includes('docx')) return '📘';
  if (mimeType.includes('excel') || mimeType.includes('xlsx') || mimeType.includes('spreadsheet')) return '📗';
  if (mimeType.includes('presentation') || mimeType.includes('pptx')) return '📙';
  if (mimeType.includes('text')) return '📄';
  if (mimeType.includes('image')) return '🖼️';
  if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
  return '📄';
}

function typeLabel(type) {
  if (type === 'news') return 'Novinka';
  if (type === 'events') return 'Udalosť';
  if (type === 'document') return 'Dokument';
  return '';
}

const SearchResultsPage = () => {
  const [params] = useSearchParams();
  const [results, setResults] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [searched, setSearched] = createSignal(false);
  const query = () => (params.query || '').trim();

  async function doSearch() {
    const value = query();
    if (value.length < 2) {
      setError('Zadajte aspoň 2 znaky.');
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/search?query=${encodeURIComponent(value)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setResults(Array.isArray(data) ? data : []);
      setSearched(true);
    } catch (err) {
      setError(err.message || 'Vyhľadávanie zlyhalo.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => { doSearch(); });
  createEffect(() => { if (params.query) doSearch(); });

  const docs = () => results().filter(r => r.type === 'document');
  const other = () => results().filter(r => r.type !== 'document');

  return (
    <div class="rep-page">
      <div class="rep-page__header">
        <h1 class="rep-page__title">Výsledky vyhľadávania</h1>
        <MobileMenu />
      </div>

      <div class="rep-page__content">
        {query() && (
          <div style={{ color: '#64748b', 'font-size': '14px', 'margin-bottom': '20px', 'padding-bottom': '12px' }}>
            Hľadáte: <strong>„{query()}"</strong>
            {searched() && !loading() && (
              <> — <span style={{ color: results().length ? '#0ea5e9' : '#94a3b8' }}>{results().length} výsledkov</span></>
            )}
          </div>
        )}

        {error() && <div class="rep-search-error">{error()}</div>}
        {loading() && <div class="rep-search-empty">Vyhľadávam…</div>}

        {!loading() && !error() && (
          <div>
            {results().length === 0 && searched() && (
              <div class="rep-search-empty">Nenašli sa žiadne výsledky.</div>
            )}

            {other().map((result) => (
              <div class="rep-search-result" key={result.id}>
                <div class="rep-search-meta">
                  <span class={`rep-search-badge rep-search-badge--${result.type}`}>{typeLabel(result.type)}</span>
                  <span class="rep-search-path">{result.path}</span>
                </div>
                <h3>
                  <a href={result.href || '/'} target="_blank" rel="noopener noreferrer">{result.title}</a>
                </h3>
                {result.snippet && <p>{result.snippet}…</p>}
              </div>
            ))}

            {docs().length > 0 && <h2 style={{ 'font-size': '18px', 'font-weight': 600, 'margin-top': '32px', 'margin-bottom': '16px', color: '#1e293b' }}>Dokumenty</h2>}
            <div class="rep-search-results">
              {docs().map((result) => (
                <div class="rep-search-result rep-search-result--doc" key={result.id}>
                  <div class="rep-search-meta">
                    <span class="rep-search-badge rep-search-badge--document">
                      {getMimeIcon(result.mimeType)} {typeLabel(result.type)}
                    </span>
                    <span class="rep-search-path">{result.path}</span>
                  </div>
                  <h3 style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                    <A href={result.href || '/'}>{result.title}</A>
                    {result.file_url && (
                      <button
                        class="rep-search-open-btn"
                        title="Otvoriť v novom okne"
                        style={{ border: 'none', background: 'none', cursor: 'pointer', 'font-size': '20px', padding: '4px 8px', 'line-height': '1' }}
                        onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(`/api/documents/files/${result.id.replace('doc_', '')}/view`, '_blank'); }}
                      >↗</button>
                    )}
                  </h3>
                  {result.snippet && (
                    <p class="rep-search-snippet" innerHTML={result.snippet} />
                  )}
                  {!result.snippet && (
                    <p style={{ color: '#94a3b8', 'font-style': 'italic', 'font-size': '13px' }}>
                      Zhoda v názve súboru alebo priečinka
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchResultsPage;
