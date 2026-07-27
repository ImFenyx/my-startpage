import type { Category, Note, PomodoroSettings, WishItem } from './types'

export const DEFAULT_POMODORO: PomodoroSettings = {
  focus: 25,
  short: 5,
  long: 15,
  longEvery: 4,
  autoStart: false,
  sound: true,
  notify: false,
}

export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'academico',
    name: 'academico',
    icon: 'academic',
    links: [
      { id: 'a1', label: 'Classroom', url: 'https://classroom.google.com', icon: 'academic' },
      { id: 'a2', label: 'Scholar', url: 'https://scholar.google.com', icon: 'flask' },
      { id: 'a3', label: 'Drive', url: 'https://drive.google.com', icon: 'drive' },
      { id: 'a4', label: 'Wikipedia', url: 'https://pt.wikipedia.org', icon: 'wikipedia' },
      { id: 'a5', label: 'Notion', url: 'https://notion.so', icon: 'notion' },
      { id: 'a6', label: 'Duolingo', url: 'https://duolingo.com', icon: 'duolingo' },
      { id: 'a7', label: 'arXiv', url: 'https://arxiv.org', icon: 'note' },
    ],
  },
  {
    id: 'work',
    name: 'work',
    icon: 'work',
    links: [
      { id: 'w1', label: 'GitHub', url: 'https://github.com', icon: 'github' },
      { id: 'w2', label: 'Gmail', url: 'https://mail.google.com', icon: 'gmail' },
      { id: 'w3', label: 'Todoist', url: 'https://app.todoist.com', icon: 'tasks' },
      { id: 'w4', label: 'Figma', url: 'https://figma.com', icon: 'figma' },
      { id: 'w5', label: 'Calendar', url: 'https://calendar.google.com', icon: 'calendar' },
      { id: 'w6', label: 'ChatGPT', url: 'https://chatgpt.com', icon: 'chatgpt' },
      { id: 'w7', label: 'Stack Overflow', url: 'https://stackoverflow.com', icon: 'stackoverflow' },
    ],
  },
  {
    id: 'pessoal',
    name: 'pessoal',
    icon: 'personal',
    links: [
      { id: 'p1', label: 'YouTube', url: 'https://youtube.com', icon: 'youtube' },
      { id: 'p2', label: 'Spotify', url: 'https://open.spotify.com', icon: 'spotify' },
      { id: 'p3', label: 'Discord', url: 'https://discord.com/app', icon: 'discord' },
      { id: 'p4', label: 'Reddit', url: 'https://reddit.com', icon: 'reddit' },
      { id: 'p5', label: 'Twitch', url: 'https://twitch.tv', icon: 'twitch' },
      { id: 'p6', label: 'WhatsApp', url: 'https://web.whatsapp.com', icon: 'whatsapp' },
    ],
  },
]

export const DEFAULT_WISHLIST: WishItem[] = [
  {
    id: 'demo1',
    name: 'Teclado mecânico 65%',
    url: '',
    price: '480,00',
    currency: 'R$',
    image: '',
    category: 'Tech',
    priority: 'Alta',
    done: false,
    createdAt: Date.now(),
  },
  {
    id: 'demo2',
    name: 'Ler 12 livros em 2026',
    url: '',
    price: '',
    image: '',
    category: 'Meta',
    priority: 'Média',
    done: false,
    createdAt: Date.now(),
  },
]

export const WISH_CATEGORIES = ['Tech', 'Roupa', 'Deco', 'Livro', 'Meta', 'Outro']

export const DEFAULT_NOTES: Note[] = [
  {
    id: 'n1',
    title: 'Foco do dia',
    body: `# Foco do dia\n\n> Uma coisa de cada vez.\n\n- [ ] Tarefa mais importante\n- [ ] Segunda prioridade\n- [ ] Se sobrar tempo…\n\n**Regra dos 2 minutos:** se leva menos de 2 min, faça agora.`,
    updatedAt: Date.now(),
    pinned: true,
  },
]
