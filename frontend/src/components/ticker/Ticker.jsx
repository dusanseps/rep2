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

function buildLoopHTML(list) {
  const items = list
    .map((m) => {
      const text = esc(m.text || "");
      return `<span class="item"><strong>${text}</strong></span>`;
    })
    .join("");
  return `<div class="loop">${items || '<span class="item"><strong>Aktuálne neevidujeme žiadne nové správy. Platnosť predchádzajúcich správ vypršala.</strong></span>'}</div>`;
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
    console.log("[Ticker] createEffect - location.search:", {
      search: location.search,
      tickerId,
    });

    if (tickerId) {
      const id = Number(tickerId);
      console.log("[Ticker] Parsed tickerId:", {
        tickerId,
        id,
        isFinite: Number.isFinite(id),
      });
      if (Number.isFinite(id) && id > 0) {
        console.log("[Ticker] Setting editTickerId and opening modal:", { id });
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
      const eventSource = new EventSource(`${API}/ticker/subscribe`);
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
