import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Notice from '../components/Notice';
import ScoreBadge from '../components/ScoreBadge';
import { api, apiErrorMessage } from '../services/api';

export default function StoreDetailPage() {
  const { id } = useParams();
  const [store, setStore] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState('');
  const [auditRun, setAuditRun] = useState(null);

  const load = useCallback(async () => {
    const [{ data: storesData }, { data: itemsData }] = await Promise.all([
      api.get('/stores'),
      api.get(`/stores/${id}/items`),
    ]);
    setStore(storesData.stores.find((candidate) => candidate.id === id) ?? null);
    setItems(itemsData.items);
  }, [id]);

  useEffect(() => {
    load().catch((requestError) => setError(apiErrorMessage(requestError)));
  }, [load]);

  useEffect(() => {
    if (!store || !['queued', 'running'].includes(store.syncStatus)) return undefined;
    const timer = window.setInterval(async () => {
      const { data } = await api.get(`/stores/${id}/sync-status`);
      setStore((current) => ({ ...current, ...data }));
      if (['done', 'failed'].includes(data.syncStatus)) await load();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [id, load, store]);

  useEffect(() => {
    if (!auditRun || ['done', 'failed'].includes(auditRun.status)) return undefined;
    const timer = window.setInterval(async () => {
      const { data } = await api.get(`/stores/${id}/audit-status`, { params: { runId: auditRun.id } });
      setAuditRun(data);
      if (['done', 'failed'].includes(data.status)) await load();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [auditRun, id, load]);

  async function synchronize() {
    setPending('sync'); setError(''); setNotice('');
    try {
      await api.post(`/stores/${id}/sync`);
      setStore((current) => ({ ...current, syncStatus: 'queued', syncProgress: 0 }));
      setNotice('Sincronização enfileirada.');
    } catch (requestError) { setError(apiErrorMessage(requestError)); }
    finally { setPending(''); }
  }

  async function audit() {
    setPending('audit'); setError(''); setNotice('');
    try {
      const { data } = await api.post(`/stores/${id}/audit`);
      setAuditRun({ id: data.auditRunId, status: 'pending', totalItems: data.totalItems, processedItems: 0, failedItems: 0 });
      setNotice('Auditoria iniciada.');
    } catch (requestError) { setError(apiErrorMessage(requestError)); }
    finally { setPending(''); }
  }

  return (
    <AppShell>
      <Link to="/" className="text-sm text-slate-400 hover:text-white">← Voltar às lojas</Link>
      <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><p className="eyebrow">Catálogo conectado</p><h1 className="page-title">{store?.shopName || (store ? `Loja ${store.shopId}` : 'Carregando…')}</h1></div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="secondary-button" disabled={Boolean(pending)} onClick={synchronize}>{pending === 'sync' ? 'Enfileirando…' : 'Sincronizar'}</button>
          <button type="button" className="primary-button" disabled={Boolean(pending) || !store?.lastSyncAt} onClick={audit}>{pending === 'audit' ? 'Iniciando…' : 'Auditar loja'}</button>
        </div>
      </div>
      <div className="mt-6 space-y-3"><Notice>{error}</Notice><Notice tone="success">{notice}</Notice></div>
      {store && ['queued', 'running'].includes(store.syncStatus) && <div className="panel mt-6"><div className="flex justify-between text-sm"><span>Sincronizando anúncios</span><span>{store.syncProgress}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-lime-400 transition-all" style={{ width: `${store.syncProgress}%` }} /></div></div>}
      {auditRun && <div className="panel mt-6"><div className="flex justify-between gap-4 text-sm"><span>Auditoria: {auditRun.status}</span><span>{auditRun.processedItems + auditRun.failedItems}/{auditRun.totalItems} · {auditRun.failedItems} falhas</span></div></div>}
      <div className="mt-8 overflow-hidden rounded-2xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-white/[.04] text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-4">Anúncio</th><th className="px-5 py-4">Categoria</th><th className="px-5 py-4">Preço</th><th className="px-5 py-4">Vendas</th><th className="px-5 py-4">Score</th><th className="px-5 py-4" /></tr></thead>
            <tbody className="divide-y divide-white/8">
              {items.map((item) => <tr key={item.id} className="bg-[#0d121a]"><td className="max-w-md px-5 py-4 font-medium">{item.title}</td><td className="px-5 py-4 text-slate-400">{item.categoryName || item.categoryId}</td><td className="px-5 py-4">R$ {item.price.toFixed(2).replace('.', ',')}</td><td className="px-5 py-4 text-slate-400">{item.sold ?? '—'}</td><td className="px-5 py-4"><ScoreBadge score={item.latestAudit?.score} /></td><td className="px-5 py-4"><Link className="text-lime-400" to={`/items/${item.id}`}>Detalhes →</Link></td></tr>)}
              {items.length === 0 && <tr><td colSpan="6" className="bg-[#0d121a] px-5 py-12 text-center text-slate-500">Sincronize a loja para carregar os anúncios.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
