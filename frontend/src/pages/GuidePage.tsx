import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../components/Icon'
import { useGuide } from '../components/GuideProvider'
import {
  FAQ_ITEMS,
  GUIDE_SECTIONS,
  LEARNING_CHECKLIST,
  type FaqItem,
  type GuideBlock,
  type GuideCategory,
  type GuideLink,
  type GuideRole,
  type GuideSection,
} from '../components/guideContent'

const CATEGORY_META: Record<GuideCategory, { title: string; icon: IconName }> = {
  quickstart: { title: '快速开始', icon: 'party-popper' },
  workflow: { title: '详细操作', icon: 'book-open' },
  advanced: { title: '进阶功能与统计口径', icon: 'sparkles' },
  review: { title: '复习、统计与导出', icon: 'clock' },
  account: { title: '账号、安全与隐私', icon: 'settings' },
}

const CATEGORY_ORDER: GuideCategory[] = ['quickstart', 'workflow', 'advanced', 'review', 'account']

const QUICK_ACTIONS: Record<GuideRole, GuideLink[]> = {
  teacher: [
    { label: '添加学生', to: '/students', icon: 'users' },
    { label: '录入试卷', to: '/papers', icon: 'book' },
    { label: '开始批改', to: '/', icon: 'pen' },
    { label: '错题复习', to: '/mistakes', icon: 'bookmark' },
    { label: '查看统计', to: '/stats', icon: 'chart' },
    { label: '账号设置', to: '/settings', icon: 'settings' },
  ],
  student: [
    { label: '上传作答', to: '/', icon: 'camera' },
    { label: '我的错题', to: '/mistakes', icon: 'bookmark' },
    { label: '学习统计', to: '/stats', icon: 'chart' },
    { label: '账号设置', to: '/settings', icon: 'settings' },
  ],
}

function blockSearchText(block: GuideBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'steps':
    case 'list':
      return `${block.title ?? ''} ${block.items.join(' ')}`
    case 'note':
      return `${block.title} ${block.text}`
    case 'links':
      return block.links.map((link) => link.label).join(' ')
  }
}

function matchesQuery(query: string, text: string): boolean {
  if (!query) return true
  const haystack = text.toLocaleLowerCase()
  return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))
}

function sectionSearchText(section: GuideSection): string {
  return [section.title, section.summary, ...section.keywords, ...section.blocks.map(blockSearchText)].join(' ')
}

function faqSearchText(item: FaqItem): string {
  return [item.question, item.answer, ...(item.details ?? []), ...item.keywords].join(' ')
}

function GuideLinks({ links }: { links: GuideLink[] }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link key={`${link.to}-${link.label}`} to={link.to} className="btn-outline px-3.5 py-2 text-sm">
          {link.icon && <Icon name={link.icon} size={15} />}
          {link.label}
          <Icon name="arrow-right" size={14} />
        </Link>
      ))}
    </div>
  )
}

function SectionBody({ section }: { section: GuideSection }) {
  return (
    <div className="space-y-5 text-sm leading-7 text-ink2">
      {section.blocks.map((block, index) => {
        switch (block.type) {
          case 'text':
            return <p key={index}>{block.text}</p>
          case 'steps':
            return (
              <div key={index}>
                {block.title && <h4 className="mb-3 font-semibold text-ink">{block.title}</h4>}
                <ol className="space-y-3">
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex} className="flex gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 font-serif text-xs font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                        {itemIndex + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )
          case 'list':
            return (
              <div key={index}>
                {block.title && <h4 className="mb-2 font-semibold text-ink">{block.title}</h4>}
                <ul className="list-disc space-y-1.5 pl-5 marker:text-primary-400">
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              </div>
            )
          case 'note':
            return (
              <div
                key={index}
                className={`flex gap-3 rounded-2xl border p-4 ${
                  block.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-900/20'
                    : 'border-primary-200 bg-primary-50/70 dark:border-primary-800/50 dark:bg-primary-900/20'
                }`}
              >
                <Icon
                  name={block.tone === 'warning' ? 'alert' : 'lightbulb'}
                  size={18}
                  className={`mt-1 shrink-0 ${
                    block.tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-primary-600 dark:text-primary-400'
                  }`}
                />
                <div>
                  <h4 className="font-semibold text-ink">{block.title}</h4>
                  <p className="mt-1">{block.text}</p>
                </div>
              </div>
            )
          case 'links':
            return <GuideLinks key={index} links={block.links} />
        }
      })}
    </div>
  )
}

function decodedAnchor(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''))
  } catch {
    return hash.replace(/^#/, '')
  }
}

export function GuidePage() {
  const { role: initialRole, checklist, toggleChecklist, startTour, openOnboarding } = useGuide()
  const [role, setRole] = useState<GuideRole>(initialRole)
  const [query, setQuery] = useState('')
  const [openItems, setOpenItems] = useState<Set<string>>(
    () => new Set([`${initialRole}-quickstart`, 'review-plan', 'faq-formats-limits']),
  )
  const location = useLocation()
  const navigate = useNavigate()
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const roleSections = useMemo(
    () => GUIDE_SECTIONS.filter((section) => section.role === 'all' || section.role === role),
    [role],
  )
  const roleFaqs = useMemo(() => FAQ_ITEMS.filter((item) => item.role === 'all' || item.role === role), [role])
  const visibleSections = useMemo(
    () => roleSections.filter((section) => matchesQuery(normalizedQuery, sectionSearchText(section))),
    [normalizedQuery, roleSections],
  )
  const visibleFaqs = useMemo(
    () => roleFaqs.filter((item) => matchesQuery(normalizedQuery, faqSearchText(item))),
    [normalizedQuery, roleFaqs],
  )
  const checklistItems = LEARNING_CHECKLIST[role]
  const checklistDone = checklistItems.filter((item) => checklist.includes(item.id)).length
  const resultCount = visibleSections.length + visibleFaqs.length

  function toggleItem(id: string) {
    setOpenItems((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function revealAnchor(anchor: string) {
    const section = GUIDE_SECTIONS.find((item) => item.id === anchor)
    const faq = FAQ_ITEMS.find((item) => item.id === anchor)
    const itemRole = section?.role ?? faq?.role
    if (itemRole && itemRole !== 'all' && itemRole !== role) setRole(itemRole)
    setQuery('')
    setOpenItems((current) => new Set(current).add(anchor))
    if (decodedAnchor(location.hash) !== anchor) navigate(`/guide#${encodeURIComponent(anchor)}`)
    window.setTimeout(() => {
      const element = document.getElementById(anchor)
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
    }, 60)
  }

  function selectRole(nextRole: GuideRole) {
    setRole(nextRole)
    if (location.hash) navigate('/guide', { replace: true })
  }

  useEffect(() => {
    const anchor = decodedAnchor(location.hash)
    if (!anchor) return
    const section = GUIDE_SECTIONS.find((item) => item.id === anchor)
    const faq = FAQ_ITEMS.find((item) => item.id === anchor)
    const itemRole = section?.role ?? faq?.role
    if (!itemRole) return
    if (itemRole !== 'all') setRole(itemRole)
    setQuery('')
    setOpenItems((current) => new Set(current).add(anchor))
    const timer = window.setTimeout(() => {
      const element = document.getElementById(anchor)
      if (!element) return
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
      element.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [location.hash])

  function expandVisible() {
    setOpenItems((current) => {
      const next = new Set(current)
      visibleSections.forEach((section) => next.add(section.id))
      visibleFaqs.forEach((item) => next.add(item.id))
      return next
    })
  }

  function collapseVisible() {
    setOpenItems((current) => {
      const next = new Set(current)
      visibleSections.forEach((section) => next.delete(section.id))
      visibleFaqs.forEach((item) => next.delete(item.id))
      return next
    })
  }

  return (
    <div className="guide-page mx-auto max-w-6xl">
      <style>{`
        @media print {
          @page { margin: 14mm; }
          body { background: #fff !important; color: #222 !important; }
          body:has(.guide-page) header { display: none !important; }
          .guide-screen { display: none !important; }
          .guide-print-root { display: block !important; background: #fff !important; color: #222 !important; }
          .guide-print-root, .guide-print-root * { color: #222 !important; box-shadow: none !important; }
          .guide-print-root section { margin: 0 0 8mm; break-inside: avoid-page; }
          .guide-print-root h1 { font-size: 25pt; margin-bottom: 4mm; }
          .guide-print-root h2 { font-size: 16pt; margin-bottom: 2mm; }
          .guide-print-root h3 { font-size: 12pt; margin: 4mm 0 2mm; }
          .guide-print-root p, .guide-print-root li { font-size: 10pt; line-height: 1.65; }
          .guide-print-root a { text-decoration: none; }
        }
      `}</style>

      <div className="guide-screen">
        <header className="card overflow-hidden">
          <div className="relative border-b border-line bg-primary-50/60 px-5 py-6 dark:bg-primary-900/20 sm:px-7 sm:py-8">
            <div className="pointer-events-none absolute -top-20 right-0 h-56 w-56 rounded-full bg-primary-200/30 blur-3xl dark:bg-primary-800/20" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-2xl">
                <p className="flex items-center gap-2 text-sm font-medium text-primary-700 dark:text-primary-300">
                  <Icon name="book-open" size={18} /> 错题家教 · 教程中心
                </p>
                <h1 className="mt-3 font-serif text-3xl font-bold sm:text-4xl">从第一次上传到真正掌握</h1>
                <p className="mt-3 text-sm leading-7 text-ink2 sm:text-base">
                  按老师或学生角色查看完整操作、AI 使用边界、失败恢复和复习方法。教程会保存在你的学习进度中，但不上传任何勾选数据。
                </p>
              </div>
              <button type="button" onClick={() => window.print()} className="btn-outline shrink-0 self-start px-4 py-2.5">
                <Icon name="download" size={17} /> 打印教程
              </button>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-7">
            <div
              role="tablist"
              aria-label="教程角色"
              className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1"
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                const nextRole = role === 'teacher' ? 'student' : 'teacher'
                selectRole(nextRole)
                document.getElementById(`guide-tab-${nextRole}`)?.focus()
              }}
            >
              {(['teacher', 'student'] as const).map((itemRole) => (
                <button
                  key={itemRole}
                  id={`guide-tab-${itemRole}`}
                  type="button"
                  role="tab"
                  aria-selected={role === itemRole}
                  aria-controls="guide-role-panel"
                  tabIndex={role === itemRole ? 0 : -1}
                  onClick={() => selectRole(itemRole)}
                  className={`rounded-xl px-4 py-3 text-left transition-colors ${
                    role === itemRole ? 'bg-surface text-primary-700 shadow-sm dark:text-primary-300' : 'text-ink2 hover:text-ink'
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon name={itemRole === 'teacher' ? 'users' : 'user'} size={18} />
                    {itemRole === 'teacher' ? '老师教程' : '学生教程'}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-dim">
                    {itemRole === 'teacher' ? '建卷、批改、复核与班级管理' : '上传、答疑、复习与账号'}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <label htmlFor="guide-search" className="sr-only">搜索当前角色教程与常见问题</label>
                <Icon name="file-text" size={17} className="pointer-events-none absolute top-3.5 left-3.5 text-dim" />
                <input
                  id="guide-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索上传、partial、复习、密码…"
                  className="input pr-11 pl-10"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="icon-btn absolute top-1 right-1" aria-label="清空搜索">
                    <Icon name="x" size={17} />
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={expandVisible} disabled={resultCount === 0} className="btn-outline flex-1 px-3 py-2.5 sm:flex-none">
                  全部展开
                </button>
                <button type="button" onClick={collapseVisible} disabled={resultCount === 0} className="btn-outline flex-1 px-3 py-2.5 sm:flex-none">
                  全部收起
                </button>
              </div>
            </div>
            <p className="mt-2 min-h-5 text-xs text-dim" aria-live="polite">
              {normalizedQuery
                ? `在${role === 'teacher' ? '老师' : '学生'}教程中找到 ${visibleSections.length} 个章节、${visibleFaqs.length} 个常见问题`
                : '搜索会同时匹配章节正文和 FAQ；多个关键词可用空格分隔。'}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={startTour} className="btn-primary px-4 py-2.5">
                <Icon name="target" size={16} /> 开始互动导览
              </button>
              <button type="button" onClick={openOnboarding} className="btn-outline px-4 py-2.5">
                <Icon name="sparkles" size={16} /> 重看首次向导
              </button>
            </div>
          </div>
        </header>

        <section aria-labelledby="quick-actions-title" className="card mt-5 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="quick-actions-title" className="section-title">快速操作</h2>
            <span className="text-xs text-dim">直达真实功能页面</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {QUICK_ACTIONS[role].map((action) => (
              <Link key={action.to + action.label} to={action.to} className="btn-outline min-h-11 px-3 py-2.5 text-center">
                {action.icon && <Icon name={action.icon} size={16} />}
                {action.label}
              </Link>
            ))}
          </div>
        </section>

        <section id="learning-checklist" aria-labelledby="checklist-title" className="card mt-5 scroll-mt-24 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="checklist-title" className="section-title flex items-center gap-2">
                <Icon name="check" size={19} className="text-primary-600 dark:text-primary-400" />
                {role === 'teacher' ? '老师' : '学生'}学习清单
              </h2>
              <p className="mt-1 text-xs text-dim">按当前账号保存在此浏览器；更换账号不会混用进度。</p>
            </div>
            <span className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              已完成 {checklistDone} / {checklistItems.length}
            </span>
          </div>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label="学习清单完成进度"
            aria-valuemin={0}
            aria-valuemax={checklistItems.length}
            aria-valuenow={checklistDone}
          >
            <div className="h-full rounded-full bg-primary-600 transition-[width]" style={{ width: `${(checklistDone / checklistItems.length) * 100}%` }} />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {checklistItems.map((item) => {
              const checked = checklist.includes(item.id)
              return (
                <div key={item.id} className={`flex gap-3 rounded-2xl border p-3.5 transition-colors ${checked ? 'border-primary-200 bg-primary-50/60 dark:border-primary-800/50 dark:bg-primary-900/20' : 'border-line bg-surface-2/40'}`}>
                  <input
                    id={`check-${item.id}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleChecklist(item.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary-600"
                  />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`check-${item.id}`} className="cursor-pointer">
                      <span className={`block font-medium ${checked ? 'text-primary-700 dark:text-primary-300' : 'text-ink'}`}>{item.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-dim">{item.description}</span>
                    </label>
                    <button type="button" onClick={() => revealAnchor(item.sectionId)} className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary-600 hover:underline dark:text-primary-400">
                      查看对应章节 <Icon name="arrow-right" size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <div
          id="guide-role-panel"
          role="tabpanel"
          aria-labelledby={`guide-tab-${role}`}
          className="mt-6 grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"
        >
          <aside className="card p-4 lg:sticky lg:top-20" aria-label="教程章节目录">
            <h2 className="flex items-center gap-2 px-2 font-serif font-bold">
              <Icon name="list" size={17} className="text-primary-600 dark:text-primary-400" /> 章节目录
            </h2>
            <nav className="mt-3 space-y-4">
              {CATEGORY_ORDER.map((category) => {
                const sections = visibleSections.filter((section) => section.category === category)
                if (sections.length === 0) return null
                return (
                  <div key={category}>
                    <p className="px-2 text-xs font-semibold tracking-wide text-dim">{CATEGORY_META[category].title}</p>
                    <div className="mt-1 space-y-0.5">
                      {sections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => revealAnchor(section.id)}
                          className="w-full rounded-lg px-2 py-1.5 text-left text-xs leading-5 text-ink2 transition-colors hover:bg-surface-2 hover:text-primary-700 dark:hover:text-primary-300"
                        >
                          {section.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {visibleFaqs.length > 0 && (
                <div>
                  <p className="px-2 text-xs font-semibold tracking-wide text-dim">FAQ / 故障排查</p>
                  <button type="button" onClick={() => revealAnchor(visibleFaqs[0].id)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink2 hover:bg-surface-2 hover:text-primary-700 dark:hover:text-primary-300">
                    {visibleFaqs.length} 个常见问题
                  </button>
                </div>
              )}
            </nav>
          </aside>

          <div className="min-w-0">
            {resultCount === 0 ? (
              <div className="card px-5 py-16 text-center">
                <Icon name="file-text" size={34} className="mx-auto text-dim" />
                <h2 className="mt-4 font-serif text-xl font-bold">没有找到相关内容</h2>
                <p className="mt-2 text-sm text-dim">试试更短的关键词，或切换老师 / 学生标签继续查找。</p>
                <button type="button" onClick={() => setQuery('')} className="btn-outline mt-5 px-4 py-2">清空搜索</button>
              </div>
            ) : (
              <>
                <div className="space-y-10">
                  {CATEGORY_ORDER.map((category) => {
                    const sections = visibleSections.filter((section) => section.category === category)
                    if (sections.length === 0) return null
                    const meta = CATEGORY_META[category]
                    return (
                      <section key={category} aria-labelledby={`guide-category-${category}`}>
                        <div className="mb-4 flex items-center gap-2.5">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
                            <Icon name={meta.icon} size={18} />
                          </span>
                          <div>
                            <h2 id={`guide-category-${category}`} className="font-serif text-xl font-bold">{meta.title}</h2>
                            <p className="text-xs text-dim">{sections.length} 个章节</p>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {sections.map((section) => {
                            const expanded = normalizedQuery ? true : openItems.has(section.id)
                            return (
                              <article key={section.id} id={section.id} className="card scroll-mt-24 overflow-hidden">
                                <div className="flex items-start gap-1 p-2">
                                  <h3 className="min-w-0 flex-1">
                                    <button
                                      type="button"
                                      onClick={() => toggleItem(section.id)}
                                      aria-expanded={expanded}
                                      aria-controls={`${section.id}-content`}
                                      className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-2/60"
                                    >
                                      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} className="mt-1 shrink-0 text-primary-600 dark:text-primary-400" />
                                      <span>
                                        <span className="block font-serif text-lg font-bold text-ink">{section.title}</span>
                                        <span className="mt-1 block text-xs font-normal leading-5 text-dim">{section.summary}</span>
                                      </span>
                                    </button>
                                  </h3>
                                  <button type="button" onClick={() => revealAnchor(section.id)} className="icon-btn mt-2" title="打开此章节锚点" aria-label={`打开「${section.title}」的锚点链接`}>
                                    <Icon name="arrow-right" size={16} />
                                  </button>
                                </div>
                                <div id={`${section.id}-content`} hidden={!expanded} className="border-t border-line px-5 py-5 sm:px-6">
                                  <SectionBody section={section} />
                                </div>
                              </article>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })}
                </div>

                {visibleFaqs.length > 0 && (
                  <section aria-labelledby="guide-faq-title" className="mt-10">
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
                        <Icon name="help-circle" size={19} />
                      </span>
                      <div>
                        <h2 id="guide-faq-title" className="font-serif text-xl font-bold">FAQ / 故障排查</h2>
                        <p className="text-xs text-dim">先按具体状态排查，避免重复上传和重复建卷</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {visibleFaqs.map((item) => {
                        const expanded = normalizedQuery ? true : openItems.has(item.id)
                        return (
                          <article key={item.id} id={item.id} className="card scroll-mt-24 overflow-hidden">
                            <h3>
                              <button
                                type="button"
                                onClick={() => toggleItem(item.id)}
                                aria-expanded={expanded}
                                aria-controls={`${item.id}-content`}
                                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2/50"
                              >
                                <Icon name="help-circle" size={17} className="shrink-0 text-primary-600 dark:text-primary-400" />
                                <span className="flex-1 font-semibold">{item.question}</span>
                                <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={17} className="shrink-0 text-dim" />
                              </button>
                            </h3>
                            <div id={`${item.id}-content`} hidden={!expanded} className="border-t border-line px-5 py-4 text-sm leading-7 text-ink2">
                              <p>{item.answer}</p>
                              {item.details && (
                                <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-primary-400">
                                  {item.details.map((detail, index) => <li key={index}>{detail}</li>)}
                                </ul>
                              )}
                              <button type="button" onClick={() => revealAnchor(item.id)} className="mt-3 inline-flex items-center gap-1 text-xs text-primary-600 hover:underline dark:text-primary-400">
                                此问题锚点 <Icon name="arrow-right" size={12} />
                              </button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                )}
              </>
            )}

            <div className="mt-8 rounded-2xl border border-primary-200 bg-primary-50/60 p-5 dark:border-primary-800/50 dark:bg-primary-900/20">
              <h2 className="font-serif text-lg font-bold">仍然找不到答案？</h2>
              <p className="mt-2 text-sm leading-6 text-ink2">先重播对应页面导览；若是具体故障，请记录页面、时间、文件格式和错误文字，再使用顶部的“问题反馈”。不要在反馈中填写密码或无关个人信息。</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={startTour} className="btn-primary px-4 py-2"><Icon name="target" size={16} /> 重播页面导览</button>
                <button type="button" onClick={() => revealAnchor('faq-weak-network')} className="btn-outline px-4 py-2">查看上传排查</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="guide-print-root hidden" aria-hidden="true">
        <h1>错题家教 · {role === 'teacher' ? '老师' : '学生'}完整教程</h1>
        <p>包含快速开始、详细操作、进阶功能、复习与导出、账号安全和 FAQ。AI 可能出错，请始终核对关键结果。</p>
        <section>
          <h2>学习清单</h2>
          <ul>
            {checklistItems.map((item) => (
              <li key={item.id}>{item.title}：{item.description}{checklist.includes(item.id) ? '（已完成）' : '（未完成）'}</li>
            ))}
          </ul>
        </section>
        {roleSections.map((section) => (
          <section key={section.id}>
            <h2>{section.title}</h2>
            <p>{section.summary}</p>
            <SectionBody section={section} />
          </section>
        ))}
        <section>
          <h2>FAQ / 故障排查</h2>
          {roleFaqs.map((item) => (
            <div key={item.id}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
              {item.details && <ul>{item.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
