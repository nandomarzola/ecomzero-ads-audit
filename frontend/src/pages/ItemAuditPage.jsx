import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Notice from '../components/Notice';
import ScoreBadge from '../components/ScoreBadge';
import { api, apiErrorMessage } from '../services/api';

export default function ItemAuditPage() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [audits, setAudits] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api.get(`/items/${id}`), api.get(`/items/${id}/audits`)])
      .then(([itemResponse, auditResponse]) => {
        setItem(itemResponse.data.item);
        setAudits(auditResponse.data.audits);
      })
      .catch((requestError) => setError(apiErrorMessage(requestError)));
  }, [id]);
  const audit = item?.latestAudit;
  return (
    <AppShell>
      <Link to={item ? `/stores/${item.storeId ?? ''}` : '/'} className="text-sm text-slate-400 hover:text-white">← Voltar</Link>
      <Notice>{error}</Notice>
      {!item ? <p className="mt-8 text-slate-500">Carregando anúncio…</p> : (
        <>
          <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="eyebrow">Item Shopee {item.shopeeItemId}</p><h1 className="page-title max-w-4xl">{item.title}</h1></div><ScoreBadge score={audit?.score} /></div>
          {!audit ? <div className="panel mt-8 text-slate-400">Este anúncio ainda não possui auditoria.</div> : (
            <>
              <section className="mt-8"><h2 className="section-title">Problemas encontrados</h2><div className="mt-4 grid gap-3">{audit.issues.map((issue, index) => <div key={`${issue.field}-${index}`} className="panel flex items-start gap-4"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${issue.severity === 'critical' ? 'bg-red-400' : issue.severity === 'warning' ? 'bg-amber-400' : 'bg-sky-400'}`} /><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{issue.field} · {issue.severity}</p><p className="mt-1 text-slate-200">{issue.message}</p></div></div>)}</div></section>
              <section className="mt-10"><h2 className="section-title">Atual × sugerido</h2><div className="mt-4 grid gap-5 lg:grid-cols-2"><Comparison title="Título atual" value={item.title} /><Comparison title="Título sugerido" value={audit.suggestedTitle} highlight /><Comparison title="Descrição atual" value={item.description} /><Comparison title="Descrição sugerida" value={audit.suggestedDesc} highlight /></div></section>
            </>
          )}
          <section className="mt-10"><h2 className="section-title">Histórico</h2><div className="mt-4 space-y-3">{audits.map((entry) => <div key={entry.id} className="panel flex items-center justify-between"><span className="text-sm text-slate-400">{new Date(entry.createdAt).toLocaleString('pt-BR')}</span><ScoreBadge score={entry.score} /></div>)}</div></section>
        </>
      )}
    </AppShell>
  );
}

function Comparison({ title, value, highlight = false }) {
  return <article className={`rounded-2xl border p-5 ${highlight ? 'border-lime-400/20 bg-lime-400/[.04]' : 'border-white/10 bg-[#0d121a]'}`}><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h3><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{value || 'Sem sugestão'}</p></article>;
}
