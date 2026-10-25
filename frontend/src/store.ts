import { create } from 'zustand'

export type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  const saved = localStorage.getItem('et-theme')
  if (saved === 'dark' || saved === 'light') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface UiState {
  theme: Theme
  toggleTheme: () => void
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
}))
