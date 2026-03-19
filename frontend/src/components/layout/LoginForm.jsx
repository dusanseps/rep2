/**
 * LoginForm – prihlasovacie okno (username + password)
 * Náhrada za MSAL / Microsoft login redirect.
 */

import { createSignal } from 'solid-js';
import { login } from '../../services/auth.js';

export default function LoginForm(props) {
  /* props: onLogin(user) */
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error,    setError]    = createSignal('');
  const [loading,  setLoading]  = createSignal(false);
  let passwordRef;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username().trim() || !password()) return;
    setError('');
    setLoading(true);
    try {
      const user = await login(username().trim().toLowerCase(), password());
      props.onLogin?.(user);
    } catch (err) {
      setError(err.message || 'Prihlásenie zlyhalo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="rep-login">
      <div class="rep-login__box">
        <img src="/seps-logo.jpg" alt="SEPS" style={{ height: '48px', 'border-radius': '6px' }} />
        <h1 class="rep-login__title">REPRESENTATIVE</h1>
        <p class="rep-login__desc">Prihláste sa svojím firemným účtom.</p>

        <form class="rep-login__form" onSubmit={handleSubmit} autocomplete="on">
          <div class="rep-login__field">
            <label for="lf-username">Používateľské meno</label>
            <input
              id="lf-username"
              type="text"
              autocomplete="username"
              placeholder="meno.priezvisko"
              value={username()}
              onInput={e => setUsername(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); passwordRef?.focus(); } }}
              required
              disabled={loading()}
            />
          </div>

          <div class="rep-login__field">
            <label for="lf-password">Heslo</label>
            <input
              id="lf-password"
              ref={passwordRef}
              type="password"
              autocomplete="current-password"
              placeholder="••••••••"
              value={password()}
              onInput={e => setPassword(e.target.value)}
              required
              disabled={loading()}
            />
          </div>

          {error() && (
            <div class="rep-login__error" role="alert">{error()}</div>
          )}

          <button type="submit" class="rep-login__btn" disabled={loading()}>
            {loading() ? 'Prihlasovanie…' : 'Prihlásiť sa'}
          </button>
        </form>
      </div>
    </div>
  );
}
