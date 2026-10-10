import { type Mode, usageGenerations } from './mock'

/* ───────────── Overview ───────────── */

export const overview = {
  users: { total: 12480, new_today: 128, active_30d: 4912 },
  generations: { completed: 38204, failed: 412, queued: 7, processing: 3, advanced_today: 214 },
  business: { credits_consumed: 41870, active_subscriptions: 0 },
  catalog: { published: 24, draft: 6, disabled: 2, missing_previews: 4 },
  system: [
    { name: 'Database', status: 'ok' },
    { name: 'Redis', status: 'ok' },
    { name: 'Storage', status: 'ok' },
    { name: 'Queue', status: 'ok' },
    { name: 'AI provider', status: 'degraded' },
  ] as Array<{ name: string; status: 'ok' | 'degraded' | 'down' }>,
}

/* ───────────── Generations ───────────── */

export type GenState = 'queued' | 'processing' | 'completed' | 'failed'
export type CreditState = 'not_applicable' | 'reserved' | 'spent' | 'refunded'

export type GenRow = {
  job_id: string
  user: string
  mode: Mode
  style: string
  state: GenState
  credit: CreditState
  created: string
  duration_s: number | null
}

const figmaRows: GenRow[] = [
  { job_id: 'job_8f2c41a9', user: 'ayu.rahma@example.com', mode: 'advanced', style: 'Space Commander', state: 'completed', credit: 'spent', created: '10 Oct 17:42', duration_s: 48 },
  { job_id: 'job_7b1d09ce', user: 'Guest', mode: 'basic', style: 'Garden Party', state: 'processing', credit: 'reserved', created: '10 Oct 17:41', duration_s: null },
  { job_id: 'job_6a90e3f2', user: 'dimas.p@example.com', mode: 'classic', style: 'Retro Film Strip', state: 'completed', credit: 'not_applicable', created: '10 Oct 17:39', duration_s: 3 },
  { job_id: 'job_5e77c1b4', user: 'Guest', mode: 'advanced', style: 'Noir Detective', state: 'failed', credit: 'refunded', created: '10 Oct 17:31', duration_s: 301 },
  { job_id: 'job_4d2ab880', user: 'sari.w@example.com', mode: 'basic', style: 'Winter Gala', state: 'queued', credit: 'reserved', created: '10 Oct 17:30', duration_s: null },
  { job_id: 'job_3c19f7a6', user: 'Guest', mode: 'classic', style: 'Confetti Pop', state: 'completed', credit: 'not_applicable', created: '10 Oct 17:28', duration_s: 2 },
  { job_id: 'job_2b08e695', user: 'rio.h@example.com', mode: 'advanced', style: 'Watercolor Portrait', state: 'completed', credit: 'spent', created: '10 Oct 17:25', duration_s: 52 },
]

const monthDay = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${iso.slice(11, 16)}`
}

export const genRows: GenRow[] = [
  ...figmaRows,
  ...usageGenerations
    .filter((g) => !figmaRows.some((f) => f.job_id === g.job_id))
    .map<GenRow>((g) => ({
      job_id: g.job_id,
      user: g.user,
      mode: g.mode,
      style: g.style,
      state: g.state.toLowerCase() as GenState,
      credit: g.credit_state,
      created: monthDay(g.created_at),
      duration_s: g.duration_ms == null ? null : Math.round(g.duration_ms / 1000),
    })),
]

export type ShareLink = { created: string; expires: string; first_opened: string | null; downloads: number; status: 'active' | 'revoked' }

/** Extra record data the list doesn't carry. Only the two Figma jobs are hand-written. */
export const genExtras: Record<string, { experience: string; error?: { code: string; message: string }; guest_id?: string; links: ShareLink[]; events: Array<{ type: string; detail: string; at: string; tone?: 'primary' | 'accent' | 'info' | 'success' | 'danger' }> }> = {
  job_8f2c41a9: {
    experience: 'space-commander',
    links: [
      { created: '10 Oct 17:44', expires: '11 Oct 17:44', first_opened: '10 Oct 17:45', downloads: 2, status: 'active' },
      { created: '10 Oct 17:43', expires: '10 Oct 17:44', first_opened: null, downloads: 0, status: 'revoked' },
    ],
    events: [
      { type: 'Queued', detail: 'Job accepted', at: '17:42:10' },
      { type: 'Credit reserved', detail: '1 AI credit on hold', at: '17:42:10', tone: 'accent' },
      { type: 'Processing', detail: 'Worker picked up the job', at: '17:42:12', tone: 'info' },
      { type: 'Completed', detail: 'Result stored · 2160 × 3240 PNG', at: '17:42:58', tone: 'success' },
      { type: 'Credit spent', detail: 'Reservation committed', at: '17:42:58', tone: 'success' },
    ],
  },
  job_5e77c1b4: {
    experience: 'noir-detective',
    guest_id: 'gst_41ac9e',
    error: { code: 'AI_PROVIDER_ERROR', message: 'The AI provider did not return a result before the timeout. The reserved credit was refunded to the guest.' },
    links: [],
    events: [
      { type: 'Queued', detail: 'Job accepted', at: '17:31:02' },
      { type: 'Credit reserved', detail: '1 AI credit on hold', at: '17:31:02', tone: 'accent' },
      { type: 'Processing', detail: 'Worker picked up the job', at: '17:31:04', tone: 'info' },
      { type: 'Failed', detail: 'AI_PROVIDER_ERROR', at: '17:36:05', tone: 'danger' },
      { type: 'Credit refunded', detail: '1 AI credit returned', at: '17:36:05', tone: 'success' },
    ],
  },
}

/* ───────────── Users ───────────── */

export type UserRow = {
  id: string
  name: string
  initials: string
  email: string
  signin: 'Google' | 'Password'
  status: 'active' | 'suspended'
  plan: string
  credits: string
  generations: number
  last_activity: string
  joined: string
}

const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()

const figmaUsers: UserRow[] = [
  ['usr_5c21e0', 'Ayu Rahma', 'ayu.rahma@example.com', 'Google', 'active', '4 / 10', 18, 'Just now', '2 Sep 2026'],
  ['usr_7a10b3', 'Dimas Pratama', 'dimas.p@example.com', 'Password', 'active', '0 / 5', 5, '2 h ago', '28 Sep 2026'],
  ['usr_8b32f1', 'Sari Wulandari', 'sari.w@example.com', 'Google', 'suspended', '2 / 5', 3, '3 days ago', '14 Sep 2026'],
  ['usr_9d44c7', 'Rio Hartono', 'rio.h@example.com', 'Password', 'active', '12 / 25', 41, 'Yesterday', '1 Aug 2026'],
  ['usr_ae5589', 'Nadia Kusuma', 'nadia.k@example.com', 'Google', 'active', '5 / 5', 0, '5 days ago', '5 Oct 2026'],
  ['usr_bf66aa', 'Bayu Santoso', 'bayu.s@example.com', 'Password', 'active', '1 / 5', 4, '1 h ago', '9 Oct 2026'],
].map(([id, name, email, signin, status, credits, generations, last, joined]) => ({
  id: id as string,
  name: name as string,
  initials: initials(name as string),
  email: email as string,
  signin: signin as UserRow['signin'],
  status: status as UserRow['status'],
  plan: 'Free',
  credits: credits as string,
  generations: generations as number,
  last_activity: last as string,
  joined: joined as string,
}))

export const userRows: UserRow[] = [
  ...figmaUsers,
  ...[
    ['Citra Lestari', 'citra.l'],
    ['Eko Nugroho', 'eko.n'],
    ['Fitri Handayani', 'fitri.h'],
    ['Gilang Ramadhan', 'gilang.r'],
    ['Hana Putri', 'hana.p'],
    ['Indra Wijaya', 'indra.w'],
  ].map(([name, slug], i) => ({
    id: `usr_c${i}77d${i}`,
    name,
    initials: initials(name),
    email: `${slug}@example.com`,
    signin: (i % 2 ? 'Password' : 'Google') as UserRow['signin'],
    status: 'active' as const,
    plan: 'Free',
    credits: `${3 + i} / 5`,
    generations: 2 + i * 3,
    last_activity: `${i + 1} days ago`,
    joined: `${10 + i} Sep 2026`,
  })),
]

export type UserLedgerRow = { amount: number; type: string; reason: string; generation: string | null; actor: string; date: string }

export const ayuLedger: UserLedgerRow[] = [
  { amount: 5, type: 'admin_grant', reason: 'Goodwill after failed event batch', generation: null, actor: 'adm_01', date: '10 Oct 16:02' },
  { amount: -1, type: 'generation_spend', reason: 'Advanced generation', generation: 'job_8f2c41a9', actor: 'system', date: '10 Oct 17:42' },
  { amount: 1, type: 'generation_refund', reason: 'Provider error', generation: 'job_1a77d0c2', actor: 'system', date: '9 Oct 20:11' },
  { amount: -1, type: 'generation_spend', reason: 'Basic generation', generation: 'job_0f65bc91', actor: 'system', date: '9 Oct 19:58' },
  { amount: 5, type: 'signup_bonus', reason: 'Account created', generation: null, actor: 'system', date: '2 Sep 09:14' },
]

export const userSessions = [
  { id: 'ses_91a', device: 'Chrome · Windows', started: '10 Oct 2026', last_seen: 'Just now', expires: '9 Nov 2026' },
  { id: 'ses_77c', device: 'Safari · iPhone', started: '6 Oct 2026', last_seen: '2 days ago', expires: '5 Nov 2026' },
  { id: 'ses_40b', device: 'Chrome · Android', started: '28 Sep 2026', last_seen: '12 days ago', expires: '28 Oct 2026' },
]
