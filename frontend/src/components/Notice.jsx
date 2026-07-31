export default function Notice({ tone = 'error', children }) {
  if (!children) return null;
  const style = tone === 'success'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : 'border-red-500/20 bg-red-500/10 text-red-200';
  return <div className={`rounded-xl border px-4 py-3 text-sm ${style}`}>{children}</div>;
}
