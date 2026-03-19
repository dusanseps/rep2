/**
 * TickerModal – správcovský modal pre ticker správy
 * Zachováva pôvodnú funkcionalitu: zoznam správ, formulár, CRUD na SharePoint.
 */

import { createSignal, createEffect, For, Show, onMount } from 'solid-js';
import {
  fetchTickerMessages,
  createTickerMessage,
  updateTickerMessage,
  deleteTickerMessage,
} from '../../services/sp.js';

const DAY = 24 * 60 * 60 * 1000;

function humanLeft(msg) {
  if (!msg.expiresAt) return 'Bez expirácie';
  const ms = msg.expiresAt - Date.now();
  if (ms <= 0) return 'Expirované';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms - d * DAY) / (60 * 60 * 1000));
  return d > 0 ? `${d} d ${h} h` : `${h} h`;
}

function esc(s) {
  return s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(u) {
  try {
    const t = String(u || '').trim();
    if (!t) return '';
    return decodeURIComponent(t);
  } catch (_) { return String(u || '').trim(); }
}

export default function TickerModal(props) {
  /* props: open, onClose, onMessagesChange */

  const [msgs, setMsgs] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [toast, setToast] = createSignal([]);

  // Form state
  const [editId, setEditId] = createSignal('');
  const [fText, setFText] = createSignal('');
  const [fDays, setFDays] = createSignal('3');
  const [fLink, setFLink] = createSignal('');
  const [fAttachments, setFAttachments] = createSignal([]);
  const [uploadingFiles, setUploadingFiles] = createSignal(false);
  const [draggingFiles, setDraggingFiles] = createSignal(false);
  const [errText, setErrText] = createSignal('');
  const [errLink, setErrLink] = createSignal('');
  const [linkCounter, setLinkCounter] = createSignal('');
  let textRef;
  let fileInputRef;

  function showToast(msg, type = 'ok') {
    const id = Date.now();
    setToast(t => [...t, { id, msg, type }]);
    setTimeout(() => setToast(t => t.filter(x => x.id !== id)), 2200);
  }

  async function loadMessages() {
    setLoading(true);
    try {
      const data = await fetchTickerMessages();
      setMsgs(data);
      props.onMessagesChange?.(data);
    } catch (err) {
      console.error(err);
      showToast(`Chyba načítania: ${err.message || err}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    if (props.open) {
      loadMessages();
      resetForm();
      setTimeout(() => textRef?.focus(), 0);
    }
  });

  function resetForm() {
    setEditId('');
    setFText('');
    setFDays('3');
    setFLink('');
    setFAttachments([]);
    setErrText('');
    setErrLink('');
    setLinkCounter('');
  }

  function openEdit(id) {
    const m = msgs().find(x => x.id === id);
    if (!m) return;
    setEditId(m.id);
    setFText(m.text || '');
    setFLink(m.link || '');
    setFAttachments(m.attachments || []);
    if (m.expiresDays && m.expiresDays > 0) {
      setFDays(String(m.expiresDays));
    } else if (m.expiresAt) {
      const leftDays = m.expiresAt > Date.now()
        ? Math.max(1, Math.round((m.expiresAt - Date.now()) / DAY))
        : 1;
      setFDays(String(leftDays));
    } else {
      setFDays('');
    }
    setErrText('');
    setErrLink('');
    textRef?.focus();
  }

  async function handleDelete(id) {
    const m = msgs().find(x => x.id === id);
    if (!window.confirm(`Naozaj chcete zmazať túto správu?\n\n"${m?.text || ''}"`)) return;
    try {
      await deleteTickerMessage(id);
      await loadMessages();
      showToast('Správa zmazaná', 'warn');
    } catch (err) {
      console.error(err);
      showToast(`Chyba mazania: ${err.message || err}`, 'err');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = fText().trim();
    if (!text) { setErrText('Nadpis je povinný.'); textRef?.focus(); return; }

    const link = safeUrl(fLink());
    if (link && !/^https?:\/\//i.test(link)) {
      setErrLink('URL musí začínať http:// alebo https://');
      return;
    }
    if (link.length > 2048) {
      setErrLink('URL je príliš dlhá (max 2048 znakov).');
      return;
    }

    const daysRaw = fDays().trim();
    let expiresAt = null;
    let expiresDays = null;
    if (daysRaw && /^\d+$/.test(daysRaw)) {
      const days = parseInt(daysRaw, 10);
      if (days > 0) {
        expiresDays = days;
        expiresAt = Date.now() + days * DAY;
      }
    }

    try {
      if (editId()) {
        await updateTickerMessage(editId(), { text, link, expiresAt, expiresDays, attachments: fAttachments() });
      } else {
        await createTickerMessage({ text, link, expiresDays, attachments: fAttachments() });
      }
      resetForm();
      await loadMessages();
      showToast('Uložené', 'ok');
    } catch (err) {
      console.error(err);
      showToast(`Chyba ukladania: ${err.message || err}`, 'err');
    }
  }

  async function uploadTickerFiles(files) {
    if (!files.length) return;
    setUploadingFiles(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`${import.meta.env.VITE_API_BASE || '/api'}/upload/file`, {
          method: 'POST', credentials: 'include', body: fd,
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.error || 'Chyba nahrávania', 'err'); continue; }
        const data = await r.json();
        setFAttachments(prev => [...prev, data]);
      }
    } finally { setUploadingFiles(false); }
  }

  function removeAttachment(url) {
    setFAttachments(prev => prev.filter(a => a.url !== url));
  }

  function onLinkInput(v) {
    setFLink(v);
    const decoded = safeUrl(v);
    const maxLen = 2048;
    if (v.trim()) {
      setLinkCounter(`${decoded.length} / ${maxLen} znakov`);
    } else {
      setLinkCounter('');
    }
    setErrLink(v && !/^https?:\/\//i.test(v) ? 'URL musí začínať http:// alebo https://' : '');
  }

  function handleChip(days) {
    setFDays(days === 0 ? '' : String(days));
  }

  // Filtered list
  const filteredMsgs = () => {
    const q = search().toLowerCase().trim();
    return msgs()
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .filter(m => !q || (m.text || '').toLowerCase().includes(q) || (m.author || '').toLowerCase().includes(q));
  };

  // Preview
  const prevUnderline = () => fLink().trim() ? 'underline' : 'none';

  return (
    <>
      {/* Modal */}
      <div id="dt-modal" class="dt-modal" aria-hidden={props.open ? 'false' : 'true'}>
        <div class="dt-backdrop" onClick={props.onClose} />
        <div class="dt-dialog" role="dialog" aria-modal="true" aria-labelledby="dt-modal-title"
          onKeyDown={e => e.key === 'Escape' && props.onClose?.()}
        >
          {/* Header */}
          <div class="dt-header">
            <h3 id="dt-modal-title">Správy pre ticker</h3>
            <div class="dt-actions-inline">
              <input
                id="dt-search"
                type="search"
                placeholder="Hľadať v správach – text, autor…"
                aria-label="Hľadať v správach"
                value={search()}
                onInput={e => setSearch(e.target.value)}
              />
              <button class="dt-btn dt-primary" onClick={resetForm}>+ Nová</button>
              <button class="dt-btn" onClick={loadMessages} disabled={loading()} title="Obnoviť">
                {loading() ? '…' : '↻ Obnoviť'}
              </button>
              <button class="dt-btn dt-ghost" onClick={props.onClose} aria-label="Zavrieť">✖</button>
            </div>
          </div>

          {/* Body */}
          <div class="dt-body">
            <div class="dt-two-col">
              {/* Zoznam */}
              <div class="dt-panel">
                <div class="dt-list-head">
                  <span>Správa</span><span>Stav</span><span>Akcie</span>
                </div>

                <div class="dt-list">
                  <Show
                    when={filteredMsgs().length > 0}
                    fallback={
                      <div class="dt-card" style={{ 'grid-template-columns': '1fr' }}>
                        <span style={{ color: '#6b7280', 'font-size': '13px' }}>
                          {loading() ? 'Načítavam…' : 'Žiadne správy'}
                        </span>
                      </div>
                    }
                  >
                    <For each={filteredMsgs()}>
                      {(m) => {
                        const alive = !m.expiresAt || m.expiresAt > Date.now();
                        return (
                          <div class="dt-card">
                            <div>
                              <span class="dt-title">{m.text}</span>
                              <span class="dt-sub">
                                {m.author && <>{m.author} · </>}
                                {m.createdAt
                                  ? new Date(m.createdAt).toLocaleDateString('sk-SK')
                                  : ''}
                              </span>
                            </div>
                            <div class="dt-badges">
                              <span class={`badge ${alive ? 'ok' : 'dead'}`}>
                                {alive ? 'Aktívna' : 'Expirovaná'}
                              </span>
                              {alive && m.expiresAt &&
                                <span class="badge warn">~ {humanLeft(m)}</span>}
                              {m.link && <span class="badge link">odkaz</span>}
                              {m.attachments?.length > 0 &&
                                <span class="badge att">{m.attachments.length > 1 ? 'prílohy' : 'príloha'}</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button class="dt-btn" onClick={() => openEdit(m.id)}>Upraviť</button>
                              <button class="dt-btn dt-danger" onClick={() => handleDelete(m.id)}>Zmazať</button>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </div>

              {/* Formulár */}
              <div class="dt-panel">
                <form class="dt-form" onSubmit={handleSubmit} autocomplete="off">
                  {/* Text */}
                  <div class="dt-row">
                    <label for="dt-f-text">Rýchla správa *</label>
                    <input
                      id="dt-f-text"
                      type="text"
                      ref={textRef}
                      required
                      placeholder="Text správy"
                      value={fText()}
                      onInput={e => { setFText(e.target.value); setErrText(''); }}
                    />
                    <small class="dt-help">Krátka a zrozumiteľná správa.</small>
                    <div class="dt-error" role="alert">{errText()}</div>
                  </div>

                  {/* Životnosť */}
                  <div class="dt-row">
                    <label for="dt-f-days">Životnosť</label>
                    <div class="dt-inline">
                      <input
                        id="dt-f-days"
                        type="number"
                        min="1"
                        max="30"
                        style={{ width: '90px' }}
                        value={fDays()}
                        onInput={e => setFDays(e.target.value)}
                      />
                      <span style={{ 'font-size': '13px', color: '#6b7280' }}>dni</span>
                      <div class="dt-chips">
                        {[1, 3, 7, 14].map(d => (
                          <button type="button" class="dt-chip" onClick={() => handleChip(d)}>{d}d</button>
                        ))}
                        <button type="button" class="dt-chip" onClick={() => handleChip(0)}>∞</button>
                      </div>
                    </div>
                  </div>

                  {/* Link */}
                  <div class="dt-row">
                    <label for="dt-f-link">Odkaz (URL)</label>
                    <small class="dt-help">Voliteľné – priečinok, súbor, alebo externá stránka</small>
                    <input
                      id="dt-f-link"
                      type="text"
                      placeholder="https://…"
                      value={fLink()}
                      onInput={e => onLinkInput(e.target.value)}
                    />
                    <small class="dt-help" style={{ color: '#6b7280' }}>{linkCounter()}</small>
                    <div class="dt-error" role="alert">{errLink()}</div>
                  </div>

                  {/* Prílohy */}
                  <div class="dt-row">
                    <label>Prílohy</label>
                    <div
                      class={`dt-dropzone${draggingFiles() ? ' dt-dropzone--over' : ''}`}
                      onDragOver={e => { e.preventDefault(); setDraggingFiles(true); }}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDraggingFiles(false); }}
                      onDrop={e => { e.preventDefault(); setDraggingFiles(false); uploadTickerFiles([...e.dataTransfer.files]); }}
                      onClick={() => fileInputRef?.click()}
                    >
                      <input type="file" ref={fileInputRef} multiple style="display:none"
                        onChange={e => uploadTickerFiles([...e.target.files])} />
                      {uploadingFiles()
                        ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>↑</span> Nahrávam…</>
                        : <><span>📎</span> Presunúť súbory sem alebo kliknúť pre výber</>
                      }
                    </div>
                    <Show when={fAttachments().length > 0}>
                      <div class="dt-att-chips">
                        <For each={fAttachments()}>
                          {att => (
                            <div class="dt-att-chip">
                              <a href={att.url} target="_blank">{att.name}</a>
                              <button type="button" onClick={() => removeAttachment(att.url)}>×</button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* Náhľad */}
                  <div class="dt-preview">
                    <div class="dt-preview-title">Náhľad</div>
                    <div class="dt-preview-body">
                      <span
                        id="prev-text"
                        style={{
                          'text-decoration': prevUnderline(),
                          cursor: fLink().trim() ? 'pointer' : 'default',
                        }}
                      >
                        {fText().trim() || '—'}
                      </span>
                    </div>
                  </div>

                  <div class="dt-form-actions">
                    <button type="submit" class="dt-btn dt-primary">Uložiť</button>
                    <button type="button" class="dt-btn" onClick={resetForm}>Vyčistiť</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      <div class="dt-toast" aria-live="polite" aria-atomic="true">
        <For each={toast()}>
          {(t) => <div class={`toast ${t.type}`}>{t.msg}</div>}
        </For>
      </div>
    </>
  );
}
