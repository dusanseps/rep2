import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";

import { logout } from "../../services/auth.js";
import styles from "./Header.module.css";

export default function Header({ user }) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const navigate = useNavigate();
  let menuRef, avatarRef, searchRef;

  const displayName = user?.displayName || user?.username || "Používateľ";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  onMount(() => {
    function handleMouseClick(e) {
      if (
        menuOpen() &&
        menuRef &&
        !menuRef.contains(e.target) &&
        avatarRef &&
        !avatarRef.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    }

    function handleKey(e) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        searchRef?.blur();
      }
    }

    document.addEventListener("mousedown", handleMouseClick);
    document.addEventListener("keydown", handleKey);

    onCleanup(() => {
      document.removeEventListener("mousedown", handleMouseClick);
      document.removeEventListener("keydown", handleKey);
    });
  });

  function handleSearchSubmit(e) {
    e.preventDefault();
    const value = search().trim();
    if (value.length >= 2) {
      setSearch("");
      navigate(`/search?query=${encodeURIComponent(value)}`);
    }
  }

  return (
    <header class={styles["rep-header"]}>
      <div class={styles["rep-header__brand"]}>
        <img
          src="/seps-logo.jpg"
          alt="SEPS"
          class={styles["rep-header__logo"]}
        />
        <span class={styles["rep-header__title"]}>
          <span class={styles["rep-header__title-short"]}>REP 2</span>
          <span class={styles["rep-header__title-full"]}>REPRESENTATIVE 2</span>
        </span>
      </div>
      <div class={styles["rep-header__actions"]}>
        <form
          class={styles["rep-header__search"]}
          onSubmit={handleSearchSubmit}
          autoComplete="off"
        >
          <div class={styles["rep-header__search-wrapper"]}>
            <input
              ref={(el) => (searchRef = el)}
              class={`rep-form__input ${styles["rep-header__search-input"]}`}
              type="text"
              placeholder="Vyhľadať..."
              value={search()}
              onInput={(e) => setSearch(e.target.value)}
            />
            <button
              type="submit"
              class={styles["rep-header__search-btn"]}
              aria-label="Vyhľadať"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="9" cy="9" r="7" stroke="#64748b" strokeWidth="2" />
                <line
                  x1="14.4142"
                  y1="14"
                  x2="18"
                  y2="17.5858"
                  stroke="#64748b"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </form>
        <div class={styles["rep-header__user"]}>
          <button
            ref={(el) => (avatarRef = el)}
            class={styles["rep-avatar"]}
            title={displayName}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={menuOpen()}
          >
            {initials}
          </button>
          <Show when={menuOpen()}>
            <div ref={(el) => (menuRef = el)} class={styles["rep-user-menu"]}>
              <div class={styles["rep-user-menu__name"]}>{displayName}</div>
              <button class={styles["rep-user-menu__logout"]} onClick={logout}>
                Odhlásiť sa
              </button>
            </div>
          </Show>
        </div>
      </div>
    </header>
  );
}
