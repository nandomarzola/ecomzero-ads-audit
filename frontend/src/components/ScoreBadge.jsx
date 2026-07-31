export default function ScoreBadge({ score }) {
  if (typeof score !== 'number') {
    return <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-500">Sem auditoria</span>;
  }
  const style = score >= 80
    ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25'
    : score >= 50
      ? 'bg-amber-500/15 text-amber-300 ring-amber-500/25'
      : 'bg-red-500/15 text-red-300 ring-red-500/25';
  return <span className={`inline-flex min-w-12 justify-center rounded-full px-3 py-1 text-sm font-bold ring-1 ${style}`}>{score}</span>;
}
