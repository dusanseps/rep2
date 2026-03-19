/**
 * Ticker – pohyblivá páska správ v dolnej časti stránky
 * Animácia requestAnimationFrame, kliknutie pravým tlačidlom otvára modal správcu.
 * Prepojenie na SharePoint cez sp.js service (Bearer token auth).
 */

import { createSignal, onMount, onCleanup } from 'solid-js';
import { fetchTickerMessages } from '../../services/sp.js';
import TickerModal from './TickerModal.jsx';
import '../../styles/ticker.css';

const PURGE_AFTER_DAYS = 30;
const SPEED_SECS = 20; // čas prechodu jednej slučky (sekundy)

function esc(s) {
  return s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escUrl(s) {
  return s == null ? '' : String(s)
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function activeMessages(list) {
  const t = Date.now();
  return list.filter(m => !m.expiresAt || m.expiresAt > t);
}

function buildLoopHTML(list) {
  const items = list.map(m => {
    const text = esc(m.text || '');
    if (m.link) {
      return `<span class="item"><a href="${escUrl(m.link)}" target="_blank" rel="noopener" data-interception="off"><strong>${text}</strong></a></span>`;
    }
    return `<span class="item"><strong>${text}</strong></span>`;
  }).join('');
  return `<div class="loop">${items || '<span class="item"><strong>(Žiadne aktívne správy)</strong></span>'}</div>`;
}

export default function Ticker() {
  let tickerEl;
  let trackEl;

  const [modalOpen, setModalOpen] = createSignal(false);
  const [messages, setMessages] = createSignal([]);

  let loopWidth = 0;
  let offset = 0;
  let speedPxPerSec = 60;
  let hoverFactor = 1;
  let lastTs = 0;
  let rafId = null;
  let paused = false;
  let repaintTimer = null;
  let minutelyTimer = null;

  function renderTrack() {
    if (!trackEl) return;
    const loopHTML = buildLoopHTML(activeMessages(messages()));
    const viewportW = window.innerWidth || document.documentElement.clientWidth;

    let html = loopHTML.repeat(4);
    let copies = 4;
    trackEl.innerHTML = html;

    const first = trackEl.querySelector('.loop');
    loopWidth = first ? first.getBoundingClientRect().width : 0;

    while (trackEl.scrollWidth < viewportW + loopWidth * 2 && copies < 30) {
      html += loopHTML;
      copies++;
      trackEl.innerHTML = html;
    }

    speedPxPerSec = (loopWidth || viewportW) / Math.max(SPEED_SECS, 0.001);
    offset = 0;
    trackEl.style.transform = 'translate3d(0,0,0)';

    // Klikateľné linky – zabrán default na linky, otvor v novom okne
    trackEl.querySelectorAll('a[href]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        try { window.open(a.href, '_blank', 'noopener'); } catch (_) { location.href = a.href; }
      });
    });
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    if (!paused && loopWidth > 0 && trackEl) {
      offset -= speedPxPerSec * hoverFactor * dt;
      if (-offset >= loopWidth) offset = -((-offset) % loopWidth);
      trackEl.style.transform = `translate3d(${offset}px,0,0)`;
    }

    rafId = requestAnimationFrame(tick);
  }

  function startRaf() {
    lastTs = 0;
    if (rafId != null) { try { cancelAnimationFrame(rafId); } catch (_) {} rafId = null; }
    rafId = requestAnimationFrame(tick);
  }

  function scheduleRepaint() {
    if (repaintTimer) { clearTimeout(repaintTimer); repaintTimer = null; }
    const t = Date.now();
    let nextTs = Infinity;
    for (const m of messages()) {
      if (m.expiresAt && m.expiresAt > t && m.expiresAt < nextTs) nextTs = m.expiresAt;
    }
    if (nextTs < Infinity) {
      const wait = Math.max(500, nextTs - t + 250);
      repaintTimer = setTimeout(() => { renderTrack(); scheduleRepaint(); }, wait);
    }
  }

  async function loadMessages() {
    try {
      const data = await fetchTickerMessages();
      setMessages(data);
    } catch (err) {
      console.error('Ticker: nepodarilo sa načítať správy', err);
    }
  }

  function handleMessagesChange(data) {
    setMessages(data);
    renderTrack();
    scheduleRepaint();
  }

  onMount(async () => {
    // Pridaj triedu na body pre padding
    document.body.classList.add('with-ticker-bottom');

    // Oneskorenie pri prvom renderi (SP layout môže byť ešte neviditeľný)
    function tryRender(attempt) {
      renderTrack();
      if (loopWidth === 0 && attempt < 15) {
        setTimeout(() => tryRender(attempt + 1), 100);
      }
    }
    tryRender(0);

    startRaf();

    // Načítaj správy zo SharePoint
    await loadMessages();
    renderTrack();
    scheduleRepaint();

    // Každú minútu refresh
    minutelyTimer = setInterval(() => {
      loadMessages().then(() => { renderTrack(); scheduleRepaint(); });
    }, 60_000);

    // Hover spomaľuje
    tickerEl?.addEventListener('mouseenter', () => { hoverFactor = 0.4; });
    tickerEl?.addEventListener('mouseleave', () => { hoverFactor = 1; });

    // Pravý klik = otvoriť modal správcu
    tickerEl?.addEventListener('contextmenu', e => { e.preventDefault(); setModalOpen(true); });

    // Back/forward cache + viditeľnosť tabu
    window.addEventListener('pageshow', () => { startRaf(); renderTrack(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { startRaf(); renderTrack(); }
    });
  });

  onCleanup(() => {
    if (rafId != null) try { cancelAnimationFrame(rafId); } catch (_) {}
    if (repaintTimer) clearTimeout(repaintTimer);
    if (minutelyTimer) clearInterval(minutelyTimer);
    document.body.classList.remove('with-ticker-bottom');
  });

  return (
    <>
      <div
        ref={tickerEl}
        class="demo-ticker"
        title="Klikni pravým tlačidlom pre správu tickera"
      >
        <div ref={trackEl} class="demo-track" />
      </div>

      <TickerModal
        open={modalOpen()}
        onClose={() => { setModalOpen(false); paused = false; }}
        onMessagesChange={handleMessagesChange}
      />
    </>
  );
}
