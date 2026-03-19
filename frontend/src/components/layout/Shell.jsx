/**
 * Shell – obal pre všetky stránky: Header + Sidebar + Ticker + <Outlet>
 * Prijíma `props.children` od @solidjs/router (matched route component).
 */
import { useUser } from '../../context/user.jsx';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';
import Ticker from '../ticker/Ticker.jsx';

export default function Shell(props) {
  const user = useUser();
  return (
    <div class="rep-app">
      <Header user={user()} />
      <div class="rep-body">
        <Sidebar />
        <main class="rep-main">
          {props.children}
        </main>
      </div>
      <Ticker />
    </div>
  );
}
