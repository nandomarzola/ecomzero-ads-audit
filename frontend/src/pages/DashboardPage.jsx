import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Notice from '../components/Notice';
import { api, apiErrorMessage, shopeeAuthorizeUrl } from '../services/api';

export default function DashboardPage() {
  const [stores, setStores] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  useEffect(() => {
    api.get('/stores')
      .then(({ data }) => setStores(data.stores))
      .catch((requestError) => setError(apiErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);
  async function connectStore() {
    setError('');
    try {
      const { data } = await api.post('/shopee/authorize-session');
      window.location.assign(shopeeAuthorizeUrl(data.state));
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'Não foi possível iniciar o vínculo com a Shopee'));
    }
  }
  return (
    <AppShell>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1 className="page-title">Suas lojas Shopee</h1>
          <p className="mt-2 text-slate-400">Conecte, sincronize e audite cada catálogo separadamente.</p>
        </div>
        <button type="button" className="primary-button" onClick={connectStore}>
          + Conectar loja Shopee
        </button>
      </div>
      <div className="mt-6 space-y-3">
        {searchParams.get('shopee') === 'connected' && <Notice tone="success">Loja conectada com sucesso.</Notice>}
        <Notice>{error}</Notice>
      </div>
      {loading ? <p className="mt-10 text-slate-500">Carregando lojas…</p> : (
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {stores.map((store) => (
            <Link key={store.id} to={`/stores/${store.id}`} className="panel block transition hover:-translate-y-0.5 hover:border-lime-400/30">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-bold">{store.shopName || `Loja ${store.shopId}`}</p>
                  <p className="mt-1 text-xs text-slate-500">Shop ID {store.shopId}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs ${store.status === 'active' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{store.status}</span>
              </div>
              <div className="mt-7 flex items-center justify-between border-t border-white/8 pt-4 text-sm">
                <span className="text-slate-400">{store._count.items} anúncios ativos</span>
                <span className="text-lime-400">Abrir →</span>
              </div>
            </Link>
          ))}
          {stores.length === 0 && <div className="panel md:col-span-2"><p className="text-slate-300">Nenhuma loja conectada.</p><p className="mt-2 text-sm text-slate-500">Use o botão acima para autorizar sua primeira loja.</p></div>}
        </div>
      )}
    </AppShell>
  );
}
