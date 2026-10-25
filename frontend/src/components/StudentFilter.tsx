import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

/** 按学生筛选的下拉。value=null 表示全部学生。 */
export function StudentFilter({
  value,
  onChange,
}: {
  value: number | null
  onChange: (id: number | null) => void
}) {
  const students = useQuery({ queryKey: ['students'], queryFn: api.listStudents })
  const list = students.data?.students ?? []
  if (list.length <= 1) return null
  return (
    <select
      aria-label="按学生筛选"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="input w-auto cursor-pointer px-3 py-1.5"
    >
      <option value="">全部学生</option>
      {list.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
