/**
 * Ticker – pohyblivá páska správ v dolnej časti stránky
 * Animácia requestAnimationFrame, kliknutie pravým tlačidlom otvára modal správcu.
 * Prepojenie na SharePoint cez sp.js service (Bearer token auth).
 */

import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { fetchTickerMessages } from "../../services/sp.js";
import { useLocation, useNavigate } from "@solidjs/router";
import TickerModal from "./TickerModal.jsx";
import { showErrorToast } from "../ui/Toasts.jsx";
import { useUser } from "../../context/user.jsx";
import "../../styles/ticker.css";

const PURGE_AFTER_DAYS = 30;
const SPEED_SECS = 20; // čas prechodu jednej slučky (sekundy)

function esc(s) {
  return s == null
    ? ""
    : String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function activeMessages(list) {
  const t = Date.now();
  return list.filter((m) => !m.expiresAt || m.expiresAt > t);
}

function toSafeHref(rawHref) {
  const href = String(rawHref || "").trim();
  if (!href) return "";
  if (href.startsWith("/")) return href.startsWith("//") ? "" : href;
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") return href;
  } catch (_err) {
    return "";
  }
  return "";
}

function buildLoopHTML(list) {
  const items = list
    .map((m) => {
      const text = esc(m.text || "");
      const href = toSafeHref(m.link);
      const isDocumentLink = String(m.link || '').includes('/uploads/documents/');
      
      // Ak je dokument link (nie externe URL) → span s onclick na dokumenty
      if (isDocumentLink && !href.includes('https://') && !href.includes('http://')) {
        // Vezmi folder_id z prvého attachmentu (backend ho teraz vracia)
        let folderId = null;
        if (Array.isArray(m.attachments) && m.attachments.length > 0) {
          folderId = m.attachments[0].folder_id;
        }
        if (folderId) {
          return `<span class="item" style="cursor: pointer;" onclick="window.tickerNavigate('${folderId}', event); return false;"><strong>${text}</strong></span>`;
        }
      }
      
      // Ak má externe link → <a> ako predtým
      if (href && (href.includes('https://') || href.includes('http://'))) {
        return `<span class="item"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><strong>${text}</strong></a></span>`;
      }
      
      // Ak nemá nič → normálny text
      return `<span class="item"><strong>${text}</strong></span>`;
    })
    .join("");
  return `<div class="loop">${items || '<span class="item"><strong>Aktuálne neevidujeme žiadne nové správy. Platnosť predchádzajúcich správ vypršala.</strong></span>'}</div>`;
}

// Extrahovať folder ID z URL dokumentu
// Z /uploads/documents/FOLDER_ID/... alebo /uploads/documents/FOLDER_NAME/...
// Ak je v DB file_url, musíme vrátiť folder_id. 
// Skúsim parsovať z URL - backend by mal vrátiť folder_id v response!
function extractFolderIdFromUrl(url) {
  // Teraz vracia Backend len URL bez folder_id, takže to nevieme extrahovať!
  // Musíme zmeniť backend aby vraciał folder_id
  const match = String(url || '').match(/\/uploads\/documents\/(\w+)\//);
  return match ? match[1] : null;
}

export default function Ticker() {
  let tickerEl;
  let trackEl;

  const location = useLocation();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = createSignal(false);
  const [editTickerId, setEditTickerId] = createSignal(null);
  const [messages, setMessages] = createSignal([]);
  const [tickerMounted, setTickerMounted] = createSignal(false);

  // Sleduj zmeny URL query parametra editTicker
  createEffect(() => {
    const params = new URLSearchParams(location.search);
    const tickerId = params.get("editTicker");

    if (tickerId) {
      const id = Number(tickerId);
      if (Number.isFinite(id) && id > 0) {
        setEditTickerId(id);
        setModalOpen(true);
      }
    }
  });

  createEffect(() => {
    document.body.classList.toggle("with-ticker", tickerMounted());
  });

  let loopWidth = 0;
  let offset = 0;
  let speedPxPerSec = 60;
  let hoverFactor = 1;
  let lastTs = 0;
  let rafId = null;
  let paused = false;
  let repaintTimer = null;
  let sseSource = null;

  function renderTrack() {
    if (!trackEl) return;
    const loopHTML = buildLoopHTML(activeMessages(messages()));
    const viewportW = window.innerWidth || document.documentElement.clientWidth;

    let html = loopHTML.repeat(4);
    let copies = 4;
    trackEl.innerHTML = html;

    const first = trackEl.querySelector(".loop");
    loopWidth = first ? first.getBoundingClientRect().width : 0;

    while (trackEl.scrollWidth < viewportW + loopWidth * 2 && copies < 30) {
      html += loopHTML;
      copies++;
      trackEl.innerHTML = html;
    }

    speedPxPerSec = (loopWidth || viewportW) / Math.max(SPEED_SECS, 0.001);
    offset = 0;
    trackEl.style.transform = "translate3d(0,0,0)";

    // Necháme natívne správanie <a target="_blank"> bez window.open,
    // aby prehliadač nehlásil popup warning pri legitímnom kliknutí používateľa.
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    if (!paused && loopWidth > 0 && trackEl) {
      offset -= speedPxPerSec * hoverFactor * dt;
      if (-offset >= loopWidth) offset = -(-offset % loopWidth);
      trackEl.style.transform = `translate3d(${offset}px,0,0)`;
    }

    rafId = requestAnimationFrame(tick);
  }

  function startRaf() {
    lastTs = 0;
    if (rafId != null) {
      try {
        cancelAnimationFrame(rafId);
      } catch (err) {
        console.warn("[Ticker RAF] Cancel failed:", err.message);
      }
      rafId = null;
    }
    rafId = requestAnimationFrame(tick);
  }

  function scheduleRepaint() {
    if (repaintTimer) {
      clearTimeout(repaintTimer);
      repaintTimer = null;
    }
    const t = Date.now();
    let nextTs = Infinity;
    for (const m of messages()) {
      if (m.expiresAt && m.expiresAt > t && m.expiresAt < nextTs)
        nextTs = m.expiresAt;
    }
    if (nextTs < Infinity) {
      const wait = Math.max(500, nextTs - t + 250);
      repaintTimer = setTimeout(() => {
        renderTrack();
        scheduleRepaint();
      }, wait);
    }
  }

  async function loadMessages() {
    try {
      const data = await fetchTickerMessages();
      setMessages(data);
    } catch (err) {
      console.error("Ticker: nepodarilo sa načítať správy", err);
      showErrorToast("Nepodarilo sa načítať ticker správy.");
    }
  }

  function connectSSE() {
    const API = import.meta.env.VITE_API_BASE || "/api";
    try {
      const eventSource = new EventSource(`${API}/ticker/subscribe`, { withCredentials: true });
      eventSource.addEventListener("message", (event) => {
        try {
          const { type, item } = JSON.parse(event.data);
          if (type === "create" || type === "update" || type === "delete") {
            loadMessages().then(() => {
              renderTrack();
              scheduleRepaint();
            });
          }
        } catch (err) {
          console.warn("[Ticker SSE] Parse failed:", err.message);
        }
      });
      eventSource.addEventListener("error", () => {
        console.warn("Ticker SSE error");
        eventSource.close();
      });
      return eventSource;
    } catch (err) {
      console.warn("[Ticker SSE] Connection failed:", err.message);
      return null;
    }
  }

  function handleMessagesChange(data) {
    setMessages(data);
    renderTrack();
    scheduleRepaint();
  }

  onMount(async () => {
    // Globálna funkcia na navigáciu z inline onclick
    window.tickerNavigate = (folderId, event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      navigate(`/dokumenty?folder=${folderId}`);
    };

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

    // Pripojiť sa na SSE pre real-time updates
    sseSource = connectSSE();

    // Hover spomaľuje
    tickerEl?.addEventListener("mouseenter", () => {
      hoverFactor = 0.4;
    });
    tickerEl?.addEventListener("mouseleave", () => {
      hoverFactor = 1;
    });

    // Pravý klik = otvoriť modal správcu
    tickerEl?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      setModalOpen(true);
    });

    // Back/forward cache + viditeľnosť tabu
    window.addEventListener("pageshow", () => {
      startRaf();
      renderTrack();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        startRaf();
        renderTrack();
      }
    });

    setTickerMounted(true);
  });

  onCleanup(() => {
    if (rafId != null)
      try {
        cancelAnimationFrame(rafId);
      } catch (err) {
        console.warn("[Ticker cleanup] RAF cancel failed:", err.message);
      }
    if (repaintTimer) clearTimeout(repaintTimer);
    if (sseSource) sseSource.close();
  });

  return (
    <>
      <div
        ref={(el) => {
          tickerEl = el;
          setTickerMounted(!!el);
        }}
        class="demo-ticker"
        title="Klikni pravým tlačidlom pre správu tickera"
      >
        <div ref={trackEl} class="demo-track" />
      </div>

      <TickerModal
        open={modalOpen()}
        onClose={() => {
          setModalOpen(false);
          setEditTickerId(null); // Resetuj editTickerId keď sa modal zavrie
          navigate(location.pathname, { replace: true });
          paused = false;
        }}
        onMessagesChange={handleMessagesChange}
        user={useUser()}
        editTickerId={editTickerId}
      />
    </>
  );
}
