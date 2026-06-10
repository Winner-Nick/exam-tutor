import { create } from 'zustand'

export type Theme = 'light' | 'dark'
export type Filter = 'all' | 'wrong' | 'unknown' | 'correct' | 'subjective'

function initialTheme(): Theme {
  const saved = localStorage.getItem('et-theme')
  if (saved === 'dark' || saved === 'light') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface UiState {
  theme: Theme
  toggleTheme: () => void
  selectedQid: string | null
  setSelectedQid: (qid: string | null) => void
  filter: Filter
  setFilter: (f: Filter) => void
  // 移动端结果页底部 Tab
  mobileTab: 'questions' | 'detail' | 'chat'
  setMobileTab: (t: 'questions' | 'detail' | 'chat') => void
}

export const useUi = create<UiState>((set) => ({
  theme: initialTheme(),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('et-theme', theme)
      document.documentElement.classList.toggle('dark', theme === 'dark')
      return { theme }
    }),
  selectedQid: null,
  setSelectedQid: (selectedQid) => set({ selectedQid }),
  filter: 'all',
  setFilter: (filter) => set({ filter }),
  mobileTab: 'questions',
  setMobileTab: (mobileTab) => set({ mobileTab }),
}))
