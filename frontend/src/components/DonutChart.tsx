/** 正确率环形图：纯 SVG，无图表库依赖。 */
export function DonutChart({
  correct,
  total,
  size = 64,
}: {
  correct: number
  total: number
  size?: number
}) {
  const pct = total > 0 ? correct / total : 0
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="8"
        className="stroke-slate-200 dark:stroke-slate-700"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        className="stroke-emerald-500 transition-[stroke-dasharray] duration-700"
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90 fill-slate-700 text-sm font-bold dark:fill-slate-200"
        style={{ transformOrigin: 'center' }}
      >
        {total > 0 ? Math.round(pct * 100) + '%' : '—'}
      </text>
    </svg>
  )
}
