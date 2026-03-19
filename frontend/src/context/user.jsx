import { createContext, useContext } from 'solid-js';

const UserCtx = createContext(null);

export function UserProvider(props) {
  return <UserCtx.Provider value={props.value}>{props.children}</UserCtx.Provider>;
}

/** Vráti aktuálne prihláseného používateľa (accessor funkciu, reaktívna). */
export const useUser = () => useContext(UserCtx);
