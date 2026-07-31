import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../services/api';
import Notice from '../components/Notice';

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      if (isRegister) await register(form);
      else await login({ email: form.email, password: form.password });
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'Não foi possível continuar'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#080b10] px-5 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101620] p-7 shadow-2xl shadow-black/40 sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[.25em] text-lime-400">EcomZero Ads Audit</p>
        <h1 className="mt-3 text-3xl font-black">{isRegister ? 'Crie sua conta' : 'Acesse sua conta'}</h1>
        <p className="mt-2 text-sm text-slate-400">Audite seus anúncios da Shopee com clareza e segurança.</p>
        <form className="mt-7 space-y-4" onSubmit={submit}>
          {isRegister && (
            <label className="block text-sm text-slate-300">
              Nome
              <input className="field mt-2" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          )}
          <label className="block text-sm text-slate-300">
            E-mail
            <input className="field mt-2" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block text-sm text-slate-300">
            Senha
            <input className="field mt-2" type="password" required minLength={isRegister ? 8 : 1} maxLength={128} autoComplete={isRegister ? 'new-password' : 'current-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <Notice>{error}</Notice>
          <button className="primary-button w-full" disabled={pending} type="submit">
            {pending ? 'Aguarde…' : isRegister ? 'Criar conta' : 'Entrar'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-400">
          {isRegister ? 'Já possui conta?' : 'Ainda não possui conta?'}{' '}
          <Link className="font-semibold text-lime-400 hover:text-lime-300" to={isRegister ? '/login' : '/register'}>
            {isRegister ? 'Entrar' : 'Cadastrar'}
          </Link>
        </p>
      </div>
    </div>
  );
}
