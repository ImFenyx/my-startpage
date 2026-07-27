import type { IconName } from './icons'

export type QuickLink = {
  id: string
  label: string
  url: string
  icon: string // chave do NF, hex ou char
  color?: string
}

export type Category = {
  id: string
  name: string
  icon: IconName | string
  links: QuickLink[]
}

export type Task = {
  id: string
  content: string
  done: boolean
  priority?: 1 | 2 | 3 | 4 // 4 = urgente (padrão Todoist p1)
  due?: string | null
  url?: string
  source: 'local' | 'todoist'
  createdAt: number
  /** Seção do Todoist à qual a tarefa pertence (null = solta no projeto). */
  sectionId?: string | null
  projectId?: string | null
  parentId?: string | null
  labels?: string[]
}

export type WishItem = {
  id: string
  name: string
  url?: string
  price?: string
  currency?: string
  image?: string
  category: string
  priority: 'Alta' | 'Média' | 'Baixa'
  done: boolean
  createdAt: number
  note?: string
}

export type Note = {
  id: string
  title: string
  body: string
  updatedAt: number
  pinned?: boolean
}

export type PomodoroSettings = {
  focus: number // minutos
  short: number
  long: number
  longEvery: number // ciclos até descanso longo
  autoStart: boolean
  sound: boolean
  notify: boolean
}

export type Phase = 'focus' | 'short' | 'long'
