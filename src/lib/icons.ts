/**
 * Nerd Font — mapa de glyphs (Symbols Nerd Font / JetBrainsMono Nerd Font).
 * Cada entrada é o codepoint do glyph na PUA. Uso: <Icon name="play" />
 * Também aceitamos passar direto o hex ("f04b") ou o char cru.
 */
export const NF = {
  // ── controle / UI ──────────────────────────────────────────────
  play: 0xf04b, // nf-fa-play
  pause: 0xf04c, // nf-fa-pause
  stop: 0xf04d, // nf-fa-stop
  skip: 0xf051, // nf-fa-step_forward
  reset: 0xf0450, // nf-md-refresh
  gear: 0xf013, // nf-fa-gear
  sliders: 0xf1de, // nf-fa-sliders
  left: 0xf053, // nf-fa-chevron_left
  right: 0xf054, // nf-fa-chevron_right
  up: 0xf077,
  down: 0xf078,
  plus: 0xf067, // nf-fa-plus
  minus: 0xf068,
  close: 0xf00d, // nf-fa-close
  check: 0xf00c, // nf-fa-check
  trash: 0xf1f8, // nf-fa-trash
  pencil: 0xf040, // nf-fa-pencil
  save: 0xf0193, // nf-md-content_save
  upload: 0xf0552, // nf-md-upload
  search: 0xf002, // nf-fa-search
  link: 0xf0c1, // nf-fa-link
  external: 0xf08e,
  image: 0xf03e, // nf-fa-picture
  dots: 0xf142,
  drag: 0xf0dc,
  lock: 0xf023,
  key: 0xf084,
  refreshCloud: 0xf01e,
  warning: 0xf071,
  info: 0xf05a,
  circle: 0xf111,
  circleO: 0xf10c,
  star: 0xf005,
  starO: 0xf006,
  flag: 0xf024, // nf-fa-flag — prioridade
  flagO: 0xf11d,
  eye: 0xf06e,
  filter: 0xf0b0,

  // ── domínio ────────────────────────────────────────────────────
  clock: 0xf017, // nf-fa-clock_o
  calendar: 0xf073, // nf-fa-calendar
  timer: 0xf13ab, // nf-md-timer
  brain: 0xf09ff, // nf-md-brain
  coffee: 0xf0f4, // nf-fa-coffee
  bed: 0xf236, // nf-fa-bed
  tasks: 0xf0ae, // nf-fa-tasks
  checkSquare: 0xf14a,
  square: 0xf096,
  heart: 0xf004, // nf-fa-heart
  cart: 0xf07a, // nf-fa-shopping_cart
  tag: 0xf02b, // nf-fa-tag
  money: 0xf0d6,
  target: 0xf05b, // nf-fa-crosshairs
  trophy: 0xf091,
  note: 0xf0f6, // nf-fa-file_text_o
  notebook: 0xf02d, // nf-fa-book
  pin: 0xf08d,
  fire: 0xf06d,
  bolt: 0xf0e7,
  rocket: 0xf135,
  grid: 0xf00a,
  layers: 0xf0328, // nf-md-layers (0xf5fd não existe no Symbols Nerd Font)
  folder: 0xf07b,
  todoist: 0xf0ae,

  // ── categorias ─────────────────────────────────────────────────
  academic: 0xf19d, // nf-fa-graduation_cap
  work: 0xf0b1, // nf-fa-briefcase
  personal: 0xf007, // nf-fa-user
  home: 0xf015,
  game: 0xf11b,
  music: 0xf001,
  code: 0xf121,
  terminal: 0xe795, // nf-dev-terminal
  cloud: 0xf0c2,
  globe: 0xf0ac,
  mail: 0xf0e0,
  chat: 0xf075,
  camera: 0xf030,
  video: 0xf03d,
  news: 0xf1ea,
  bank: 0xf19c,
  health: 0xf21e,
  plane: 0xf072,
  bookmark: 0xf02e,
  flask: 0xf0c3,
  robot: 0xf06a9, // nf-md-robot

  // ── marcas / sites ─────────────────────────────────────────────
  github: 0xf09b,
  gitlab: 0xf296,
  youtube: 0xf167,
  google: 0xf1a0,
  gmail: 0xf0e0,
  drive: 0xf1c0,
  notion: 0xf0224, // nf-md-note_text
  discord: 0xf066f, // nf-md-discord
  spotify: 0xf1bc,
  twitter: 0xf099,
  reddit: 0xf1a1,
  linkedin: 0xf08c,
  instagram: 0xf16d,
  whatsapp: 0xf232,
  telegram: 0xf2c6,
  stackoverflow: 0xf16c,
  figma: 0xf0844, // nf-md-figma
  chatgpt: 0xf06a9,
  wikipedia: 0xf266,
  amazon: 0xf270,
  steam: 0xf1b6,
  twitch: 0xf1e8,
  netflix: 0xf16a,
  dropbox: 0xf16b,
  trello: 0xf181,
  slack: 0xf198,
  medium: 0xf23a,
  docker: 0xf308,
  linux: 0xf17c,
  windows: 0xf17a,
  apple: 0xf179,
  firefox: 0xf269,
  chrome: 0xf268,
  vscode: 0xf0a1e, // nf-md-microsoft_visual_studio_code
  obsidian: 0xf1064,
  duolingo: 0xf1ad,
} as const

export type IconName = keyof typeof NF

/** Lista usada pelo picker de ícones dos links rápidos */
export const ICON_PICKER: IconName[] = [
  'link',
  'globe',
  'github',
  'gitlab',
  'youtube',
  'google',
  'gmail',
  'drive',
  'notion',
  'discord',
  'spotify',
  'twitter',
  'reddit',
  'linkedin',
  'instagram',
  'whatsapp',
  'telegram',
  'stackoverflow',
  'figma',
  'chatgpt',
  'wikipedia',
  'amazon',
  'steam',
  'twitch',
  'netflix',
  'dropbox',
  'trello',
  'slack',
  'medium',
  'docker',
  'linux',
  'vscode',
  'obsidian',
  'duolingo',
  'code',
  'terminal',
  'academic',
  'work',
  'personal',
  'home',
  'game',
  'music',
  'news',
  'bank',
  'health',
  'plane',
  'flask',
  'robot',
  'cloud',
  'mail',
  'chat',
  'camera',
  'video',
  'bookmark',
  'folder',
  'calendar',
  'clock',
  'heart',
  'cart',
  'tag',
  'star',
  'fire',
  'bolt',
  'rocket',
  'trophy',
  'target',
  'brain',
  'coffee',
  'note',
  'notebook',
  'tasks',
]

/** Resolve um nome, hex ("f09b" / "0xf09b" / "\uf09b") ou char para o glyph final. */
export function glyph(name: string): string {
  if (!name) return String.fromCodePoint(NF.link)
  if (name in NF) return String.fromCodePoint(NF[name as IconName])
  const hex = name.replace(/^(0x|U\+|\\u|#)/i, '')
  if (/^[0-9a-f]{4,6}$/i.test(hex)) {
    const cp = parseInt(hex, 16)
    if (cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp)
  }
  return name // já é o char cru
}

/** Heurística: dado um domínio, sugere um ícone Nerd Font. */
export function guessIcon(url: string): IconName {
  let host = ''
  try {
    host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
  const table: [RegExp, IconName][] = [
    [/github\.com/, 'github'],
    [/gitlab\.com/, 'gitlab'],
    [/youtube\.com|youtu\.be/, 'youtube'],
    [/mail\.google|gmail/, 'gmail'],
    [/drive\.google/, 'drive'],
    [/docs\.google|sheets\.google/, 'note'],
    [/calendar\.google/, 'calendar'],
    [/google\./, 'google'],
    [/notion\.so/, 'notion'],
    [/discord\./, 'discord'],
    [/spotify\./, 'spotify'],
    [/twitter\.com|x\.com/, 'twitter'],
    [/reddit\./, 'reddit'],
    [/linkedin\./, 'linkedin'],
    [/instagram\./, 'instagram'],
    [/(whatsapp|wa\.me)/, 'whatsapp'],
    [/(telegram|t\.me)/, 'telegram'],
    [/stackoverflow|stackexchange/, 'stackoverflow'],
    [/figma\./, 'figma'],
    [/(chatgpt|openai|claude|anthropic|gemini)/, 'chatgpt'],
    [/wikipedia\./, 'wikipedia'],
    [/amazon\./, 'amazon'],
    [/mercadolivre|shopee|aliexpress|kabum|magazineluiza/, 'cart'],
    [/steam(powered|community)/, 'steam'],
    [/twitch\./, 'twitch'],
    [/netflix\./, 'netflix'],
    [/dropbox\./, 'dropbox'],
    [/trello\./, 'trello'],
    [/slack\./, 'slack'],
    [/medium\.com|dev\.to/, 'medium'],
    [/docker\./, 'docker'],
    [/todoist\./, 'tasks'],
    [/obsidian\./, 'obsidian'],
    [/duolingo\./, 'duolingo'],
    [/(scholar|arxiv|sciencedirect|scielo|coursera|edx|classroom|moodle|usp|unesp|unicamp|\.edu)/, 'academic'],
    [/(nubank|itau|bradesco|inter|santander|banco|nomad|wise)/, 'bank'],
    [/(jira|atlassian|asana|linear\.app|clickup)/, 'work'],
    [/(twitch|itch\.io|epicgames|gog\.com)/, 'game'],
  ]
  for (const [re, ic] of table) if (re.test(host)) return ic
  return 'globe'
}
