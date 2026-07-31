import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }
  return (
    <div className="min-h-screen bg-[#080b10] text-slate-100">
      <header className="border-b border-white/10 bg-[#0c1119]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link to="/" className="text-lg font-black tracking-tight">
            ECOMZERO <span className="text-lime-400">ADS AUDIT</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <NavLink to="/" className="text-slate-300 transition hover:text-white">Lojas</NavLink>
            <span className="hidden text-slate-500 sm:inline">{user?.email}</span>
            <button type="button" onClick={signOut} className="rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:bg-white/5">
              Sair
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
