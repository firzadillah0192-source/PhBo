/**
 * Mock data shaped like the `/api/admin` responses in the design brief (§4.7).
 * Field names match the API so each page can swap its import for a fetch.
 * Every value here is invented sample data.
 */

export type Mode = 'classic' | 'basic' | 'advanced'

/* ── Usage ── */

export const usageOverview = {
  total_users: 12480,
  active_users: 4912,
  successful_generations: 38204,
  failed_generations: 412,
  credits_spent: 41870,
  credits_refunded: 398,
  ai_jobs: 29116,
  advanced_jobs: 17402,
  usage_coverage_percent: 96.4,
  provider_account_coverage_percent: 88.1,
  provider_distribution: [
    { provider: 'provider-a', jobs: 19840 },
    { provider: 'provider-b', jobs: 7312 },
    { provider: 'provider-c', jobs: 1964 },
  ],
}

export type UsageUser = {
  account_id: string
  email: string
  display_name: string
  account_status: 'active' | 'suspended'
  signup_date: string
  auth_provider: 'google' | 'password'
  plan: string
  subscription_status: string
  total_ai_credits_granted: number
  total_ai_credits_spent: number
  total_ai_credits_refunded: number
  current_remaining_credits: number
  successful_advanced_generations: number
  failed_advanced_generations: number
  total_basic_generations: number
  last_activity_at: string
}

const people: Array<[string, string]> = [
  ['Ayu Rahma', 'ayu.rahma'],
  ['Dimas Pratama', 'dimas.p'],
  ['Sari Wulandari', 'sari.w'],
  ['Rio Hartono', 'rio.h'],
  ['Nadia Kusuma', 'nadia.k'],
  ['Bayu Santoso', 'bayu.s'],
  ['Citra Lestari', 'citra.l'],
  ['Eko Nugroho', 'eko.n'],
  ['Fitri Handayani', 'fitri.h'],
  ['Gilang Ramadhan', 'gilang.r'],
  ['Hana Putri', 'hana.p'],
  ['Indra Wijaya', 'indra.w'],
]

export const usageUsers: UsageUser[] = people.map(([name, slug], i) => {
  const granted = 5 + (i % 4) * 5
  const spent = Math.min(granted, (i * 3) % 14)
  const refunded = i % 5 === 0 ? 1 : 0
  return {
    account_id: `usr_${(0x5c21e0 + i * 7919).toString(16)}`,
    email: `${slug}@example.com`,
    display_name: name,
    account_status: i === 2 ? 'suspended' : 'active',
    signup_date: `2026-${String(8 + (i % 3)).padStart(2, '0')}-${String(2 + i * 2).padStart(2, '0')}`,
    auth_provider: i % 2 ? 'password' : 'google',
    plan: 'free',
    subscription_status: 'none',
    total_ai_credits_granted: granted,
    total_ai_credits_spent: spent,
    total_ai_credits_refunded: refunded,
    current_remaining_credits: granted - spent + refunded,
    successful_advanced_generations: Math.floor(spent * 0.6),
    failed_advanced_generations: refunded,
    total_basic_generations: Math.ceil(spent * 0.4),
    last_activity_at: `2026-10-${String(10 - (i % 9)).padStart(2, '0')} ${String(17 - (i % 6)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`,
  }
})

export type PriceEstimate = { status: 'estimated' | 'unavailable'; low_usd: number | null; high_usd: number | null; note: string }

export type UsageGeneration = {
  job_id: string
  user: string
  mode: Mode
  style: string
  state: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  credit_state: 'not_applicable' | 'reserved' | 'spent' | 'refunded'
  provider: string | null
  model: string | null
  upstream_account: string | null
  routing_strategy: string | null
  tokens: number | null
  duration_ms: number | null
  attempts: number
  retries: number
  failovers: number
  created_at: string
  result_deleted_at: string | null
  api_price_estimate: PriceEstimate
}

const styles: Array<[Mode, string]> = [
  ['advanced', 'Space Commander'],
  ['basic', 'Garden Party'],
  ['classic', 'Retro Film Strip'],
  ['advanced', 'Noir Detective'],
  ['basic', 'Winter Gala'],
  ['advanced', 'Watercolor Portrait'],
  ['classic', 'Confetti Pop'],
  ['advanced', 'Enchanted Forest'],
]

const estimateNote =
  'Estimated from recorded token counts and public list prices. It is not an invoice and excludes discounts, retries billed upstream and image-output surcharges.'

export const usageGenerations: UsageGeneration[] = Array.from({ length: 28 }, (_, i) => {
  const [mode, style] = styles[i % styles.length]
  const ai = mode !== 'classic'
  const state: UsageGeneration['state'] = i % 9 === 3 ? 'FAILED' : i === 1 ? 'PROCESSING' : i === 4 ? 'QUEUED' : 'COMPLETED'
  const provider = ai ? ['provider-a', 'provider-b', 'provider-c'][i % 3] : null
  const tokens = ai && state !== 'QUEUED' ? 1800 + ((i * 937) % 4200) : null
  const done = state === 'COMPLETED' || state === 'FAILED'
  return {
    job_id: `job_${(0x8f2c41a9 - i * 0x10f3a7).toString(16)}`,
    user: i % 3 === 1 ? 'Guest' : `${people[i % people.length][1]}@example.com`,
    mode,
    style,
    state,
    credit_state: !ai ? 'not_applicable' : state === 'FAILED' ? 'refunded' : state === 'COMPLETED' ? 'spent' : 'reserved',
    provider,
    model: provider ? `${provider.replace('provider', 'image')}-v${2 + (i % 2)}` : null,
    upstream_account: provider ? `acct-${String.fromCharCode(97 + (i % 4))}${(i % 3) + 1}` : null,
    routing_strategy: provider ? (i % 4 === 0 ? 'failover' : 'round_robin') : null,
    tokens,
    duration_ms: done ? (ai ? (state === 'FAILED' ? 301000 : 38000 + ((i * 3100) % 40000)) : 2400) : null,
    attempts: ai ? (state === 'FAILED' ? 3 : 1 + (i % 4 === 0 ? 1 : 0)) : 0,
    retries: ai && state === 'FAILED' ? 2 : 0,
    failovers: ai && i % 4 === 0 ? 1 : 0,
    created_at: `2026-10-${String(10 - Math.floor(i / 6)).padStart(2, '0')} ${String(17 - (i % 8)).padStart(2, '0')}:${String(42 - (i % 6) * 7).padStart(2, '0')}`,
    result_deleted_at: null,
    api_price_estimate:
      tokens && state === 'COMPLETED'
        ? { status: 'estimated', low_usd: +(tokens * 0.000008).toFixed(4), high_usd: +(tokens * 0.000021).toFixed(4), note: estimateNote }
        : { status: 'unavailable', low_usd: null, high_usd: null, note: ai ? 'No completed provider run with token counts was recorded for this job.' : 'Classic strips are composed locally and make no AI provider call.' },
  }
})

export const providerOverview = {
  total_jobs: 29116,
  total_tokens: 96_402_118,
  total_attempts: 31204,
  retries: 1711,
  failovers: 377,
  average_duration_ms: 46200,
  success_rate_percent: 98.6,
  routing_strategy: 'round_robin',
  strategy_evidence: 'observed',
  strategy_message:
    'Jobs are spread evenly across the configured upstream accounts, which is consistent with round-robin routing. This is inferred from recorded provider runs, not read from provider configuration.',
}

export const providerAccounts = [
  { provider: 'provider-a', account_ref: 'acct-a1', jobs_count: 7420, success_count: 7338, failed_count: 82, last_used_at: '2026-10-10 17:42', total_tokens: 24_810_332, average_duration_ms: 44100 },
  { provider: 'provider-a', account_ref: 'acct-a2', jobs_count: 7391, success_count: 7302, failed_count: 89, last_used_at: '2026-10-10 17:41', total_tokens: 24_602_190, average_duration_ms: 45800 },
  { provider: 'provider-a', account_ref: 'acct-a3', jobs_count: 5029, success_count: 4950, failed_count: 79, last_used_at: '2026-10-10 17:39', total_tokens: 16_733_004, average_duration_ms: 47250 },
  { provider: 'provider-b', account_ref: 'acct-b1', jobs_count: 7312, success_count: 7204, failed_count: 108, last_used_at: '2026-10-10 17:40', total_tokens: 23_914_870, average_duration_ms: 48900 },
  { provider: 'provider-c', account_ref: 'acct-c1', jobs_count: 1964, success_count: 1910, failed_count: 54, last_used_at: '2026-10-09 22:15', total_tokens: 6_341_722, average_duration_ms: 51300 },
]

/* ── Catalog ── */

export type Experience = {
  id: string
  name: string
  description: string
  category: string
  status: 'draft' | 'published' | 'disabled'
  enabled: boolean
  sort_order: number
  compatible_frame_style_ids: string[]
  compatible_ornament_ids: string[]
  max_ornaments: number
  internal_prompt: string
  preview_status: 'MISSING' | 'GENERATING' | 'READY' | 'FAILED'
  preview_error: string | null
  updated_at: string
  updated_by: string
}

const exp = (id: string, name: string, description: string, category: string, status: Experience['status'], preview_status: Experience['preview_status'], sort_order: number): Experience => ({
  id,
  name,
  description,
  category,
  status,
  enabled: status !== 'disabled',
  sort_order,
  compatible_frame_style_ids: [],
  compatible_ornament_ids: [],
  max_ornaments: 3,
  internal_prompt: `Portrait of the subject as ${name.toLowerCase()}, ${description.toLowerCase()}. Keep the face recognisable.`,
  preview_status,
  preview_error: preview_status === 'FAILED' ? 'AI_PROVIDER_ERROR: the provider did not return an image before the timeout.' : null,
  updated_at: `2026-10-${String(10 - (sort_order % 8)).padStart(2, '0')} 14:${String(10 + sort_order).padStart(2, '0')}`,
  updated_by: sort_order % 2 ? 'adm_02' : 'adm_01',
})

export const experiences: Experience[] = [
  exp('space-commander', 'Space Commander', 'Cinematic sci-fi hero', 'Sci-Fi', 'published', 'READY', 1),
  exp('watercolor-portrait', 'Watercolor Portrait', 'Loose painted washes', 'Art', 'published', 'READY', 2),
  exp('enchanted-forest', 'Enchanted Forest', 'Glowing storybook light', 'Fantasy', 'published', 'READY', 3),
  exp('noir-detective', 'Noir Detective', 'Moody black and white', 'Vintage', 'published', 'READY', 4),
  exp('neon-samurai', 'Neon Samurai', 'Rain-soaked cyber alley', 'Sci-Fi', 'draft', 'READY', 5),
  exp('pop-art-icon', 'Pop Art Icon', 'Bold halftone colour', 'Art', 'draft', 'GENERATING', 6),
  exp('royal-court', 'Royal Court', 'Baroque oil portrait', 'Vintage', 'draft', 'MISSING', 7),
  exp('ice-kingdom', 'Ice Kingdom', 'Frosted crystal glow', 'Fantasy', 'draft', 'FAILED', 8),
  exp('lunar-festival', 'Lunar Festival', 'Lantern-lit night market', 'Festive', 'disabled', 'READY', 9),
]

export const experienceCategories = ['Sci-Fi', 'Fantasy', 'Art', 'Vintage', 'Festive']

export type Preset = { id: string; slug: string; name: string; description: string; prompt_fragment: string; enabled: boolean; sort_order: number }

export const frameStyles: Preset[] = [
  { id: 'fs_1', slug: 'natural', name: 'Natural', description: 'No frame, full-bleed photo', prompt_fragment: 'no border, full-bleed composition', enabled: true, sort_order: 1 },
  { id: 'fs_2', slug: 'polaroid', name: 'Polaroid', description: 'White border with caption space', prompt_fragment: 'instant-film white border with a wider bottom margin', enabled: true, sort_order: 2 },
  { id: 'fs_3', slug: 'neon-glow', name: 'Neon glow', description: 'Glowing tube-light outline', prompt_fragment: 'thin neon tube border with soft bloom', enabled: false, sort_order: 3 },
]

export const ornaments: Preset[] = [
  { id: 'or_1', slug: 'confetti', name: 'Confetti', description: 'Falling paper confetti', prompt_fragment: 'scattered paper confetti in the foreground', enabled: true, sort_order: 1 },
  { id: 'or_2', slug: 'stars', name: 'Stars', description: 'Small sparkling stars', prompt_fragment: 'small four-point star sparkles', enabled: true, sort_order: 2 },
  { id: 'or_3', slug: 'balloons', name: 'Balloons', description: 'Floating party balloons', prompt_fragment: 'pastel balloons drifting at the edges', enabled: true, sort_order: 3 },
  { id: 'or_4', slug: 'sparkle', name: 'Sparkle', description: 'Fine glitter dust', prompt_fragment: 'fine glitter particles catching the light', enabled: true, sort_order: 4 },
  { id: 'or_5', slug: 'hearts', name: 'Hearts', description: 'Floating hearts', prompt_fragment: 'small floating hearts', enabled: false, sort_order: 5 },
]

export type Template = {
  id: string
  name: string
  description: string
  enabled: boolean
  sort_order: number
  preview_missing: boolean
  processing_asset_present: boolean
  canvas_width: number
  canvas_height: number
  aspect_ratio: string
  framed: boolean
  updated_at: string
  updated_by: string
}

const tpl = (id: string, name: string, description: string, sort_order: number, o: Partial<Template> = {}): Template => ({
  id,
  name,
  description,
  enabled: true,
  sort_order,
  preview_missing: false,
  processing_asset_present: true,
  canvas_width: 2160,
  canvas_height: 3240,
  aspect_ratio: '2:3',
  framed: sort_order % 2 === 0,
  updated_at: `2026-10-0${1 + (sort_order % 8)} 11:${10 + sort_order}`,
  updated_by: 'adm_02',
  ...o,
})

export const templates: Template[] = [
  tpl('garden-party', 'Garden Party', 'Soft florals, golden hour', 1),
  tpl('neon-arcade', 'Neon Arcade', 'Glowing 80s city lights', 2),
  tpl('vintage-studio', 'Vintage Studio', 'Warm film portrait', 3),
  tpl('winter-gala', 'Winter Gala', 'Snow and silver bokeh', 4),
  tpl('beach-sunset', 'Beach Sunset', 'Tropical evening glow', 5, { preview_missing: true }),
  tpl('royal-portrait', 'Royal Portrait', 'Classic oil-paint drama', 6, { enabled: false, processing_asset_present: false, preview_missing: true }),
]

export type Slot = { x: number; y: number; width: number; height: number }

export type ClassicLayout = {
  id: string
  slug: string
  name: string
  canvas_width: number
  canvas_height: number
  shot_count: number
  slots: Slot[]
  slots_reviewed: boolean
  enabled: boolean
  sort_order: number
  frame_asset_present: boolean
  theme_slug: string
  theme_name: string
}

const slotsFor = (n: number): Slot[] => {
  const h = Math.floor((3600 - 420 - 60 * (n + 1)) / n)
  return Array.from({ length: n }, (_, i) => ({ x: 84, y: 60 + i * (h + 60), width: 1032, height: h }))
}

const lay = (slug: string, name: string, shot_count: number, theme_name: string, sort_order: number, o: Partial<ClassicLayout> = {}): ClassicLayout => ({
  id: `cl_${sort_order}`,
  slug,
  name,
  canvas_width: 1200,
  canvas_height: 3600,
  shot_count,
  slots: slotsFor(shot_count),
  slots_reviewed: true,
  enabled: true,
  sort_order,
  frame_asset_present: true,
  theme_slug: theme_name.toLowerCase(),
  theme_name,
  ...o,
})

export const classicLayouts: ClassicLayout[] = [
  lay('retro-film-strip', 'Retro Film Strip', 3, 'Retro', 1),
  lay('sepia-booth', 'Sepia Booth', 4, 'Retro', 2),
  lay('confetti-pop', 'Confetti Pop', 3, 'Party', 3),
  lay('midnight-disco', 'Midnight Disco', 2, 'Party', 4),
  lay('minimal-white', 'Minimal White', 4, 'Minimal', 5, { enabled: false, frame_asset_present: false, slots_reviewed: false }),
  lay('wedding-gold', 'Wedding Gold', 1, 'Minimal', 6, { enabled: false, canvas_width: 1200, canvas_height: 1800, slots_reviewed: false }),
]

export const previewSource = { id: 'portrait-default', source_type: 'portrait', has_asset: true, content_type: 'image/jpeg', updated_at: '2026-09-18 10:24', updated_by: 'adm_02' }

/* ── Business ── */

export type Plan = { id: string; code: string; name: string; description: string; monthly_ai_credits: number; billing_period: string; price_amount: number; currency: string; is_active: boolean }

export const plans: Plan[] = [
  { id: 'pln_1', code: 'free', name: 'Free', description: '5 AI credits on sign-up. Classic unlimited.', monthly_ai_credits: 0, billing_period: 'none', price_amount: 0, currency: 'IDR', is_active: true },
  { id: 'pln_2', code: 'plus', name: 'Plus', description: '30 AI credits each month.', monthly_ai_credits: 30, billing_period: 'monthly', price_amount: 49000, currency: 'IDR', is_active: false },
  { id: 'pln_3', code: 'pro', name: 'Pro', description: '100 AI credits each month.', monthly_ai_credits: 100, billing_period: 'monthly', price_amount: 129000, currency: 'IDR', is_active: false },
]

export const subscriptions = [
  { id: 'sub_1', user_email: 'rio.h@example.com', plan: 'plus', status: 'active', period_start: '2026-10-01', period_end: '2026-10-31', source: 'admin_assign' },
  { id: 'sub_2', user_email: 'citra.l@example.com', plan: 'pro', status: 'active', period_start: '2026-09-22', period_end: '2026-10-22', source: 'admin_assign' },
  { id: 'sub_3', user_email: 'eko.n@example.com', plan: 'plus', status: 'cancelled', period_start: '2026-09-01', period_end: '2026-09-30', source: 'admin_assign' },
  { id: 'sub_4', user_email: 'hana.p@example.com', plan: 'plus', status: 'expired', period_start: '2026-08-10', period_end: '2026-09-09', source: 'admin_assign' },
]

export type LedgerEntry = { id: string; user: string; amount: number; type: string; reason: string; related_generation_id: string | null; admin_actor_id: string | null; created_at: string }

export const ledgerTypes = ['signup_bonus', 'admin_grant', 'admin_deduct', 'generation_spend', 'generation_refund']

export const ledger: LedgerEntry[] = Array.from({ length: 34 }, (_, i) => {
  const type = ledgerTypes[[3, 3, 4, 0, 1, 3, 2][i % 7]]
  const amount = { signup_bonus: 5, admin_grant: 5, admin_deduct: -2, generation_spend: -1, generation_refund: 1 }[type]!
  const gen = type.startsWith('generation') ? `job_${(0x8f2c41a9 - i * 0x10f3a7).toString(16)}` : null
  return {
    id: `led_${String(9040 - i).padStart(5, '0')}`,
    user: i % 4 === 1 ? `Guest · gst_${(0x41ac9e + i * 311).toString(16)}` : `${people[i % people.length][1]}@example.com`,
    amount,
    type,
    reason: { signup_bonus: 'Account created', admin_grant: 'Goodwill after failed event batch', admin_deduct: 'Duplicate grant corrected', generation_spend: 'AI generation', generation_refund: 'Provider error' }[type]!,
    related_generation_id: gen,
    admin_actor_id: type.startsWith('admin') ? `adm_0${1 + (i % 2)}` : null,
    created_at: `2026-10-${String(10 - Math.floor(i / 7)).padStart(2, '0')} ${String(17 - (i % 7)).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}`,
  }
})

/* ── System ── */

export type AuditEntry = { id: string; admin_actor_id: string; action: string; target_type: string; target_id: string; reason: string | null; metadata: Record<string, unknown>; created_at: string }

export const auditActions = ['user.credits.adjust', 'user.status.update', 'user.sessions.revoke', 'user.subscription.assign', 'result_claim.revoke', 'experience.update', 'experience.publish_ready', 'classic_layout.update', 'result.delete']

export const audit: AuditEntry[] = [
  { id: 'aud_2291', admin_actor_id: 'adm_01', action: 'user.credits.adjust', target_type: 'account', target_id: 'usr_5c21e0', reason: 'Goodwill after failed event batch', metadata: { amount: 5, ledger_id: 'led_09040', balance: { total: 10, used: 5, reserved: 1, remaining: 4 } }, created_at: '2026-10-10 16:02' },
  { id: 'aud_2290', admin_actor_id: 'adm_02', action: 'experience.publish_ready', target_type: 'experience', target_id: '*', reason: null, metadata: { published: 2, ids: ['space-commander', 'watercolor-portrait'] }, created_at: '2026-10-10 14:31' },
  { id: 'aud_2289', admin_actor_id: 'adm_01', action: 'result_claim.revoke', target_type: 'result_claim', target_id: 'clm_77b0e2', reason: 'Guest asked for the link to be removed', metadata: { revoked: true, job_id: 'job_8f2c41a9' }, created_at: '2026-10-10 13:12' },
  { id: 'aud_2288', admin_actor_id: 'adm_01', action: 'user.status.update', target_type: 'account', target_id: 'usr_5c5fbe', reason: 'Repeated abusive uploads', metadata: { status: 'suspended', revoked_sessions: 2 }, created_at: '2026-10-09 19:47' },
  { id: 'aud_2287', admin_actor_id: 'adm_02', action: 'classic_layout.update', target_type: 'classic_layout', target_id: 'cl_3', reason: null, metadata: { enabled: true, canvas: '1200x3600' }, created_at: '2026-10-09 11:20' },
  { id: 'aud_2286', admin_actor_id: 'adm_01', action: 'user.subscription.assign', target_type: 'account', target_id: 'usr_5c7dad', reason: 'Event partner account', metadata: { plan_id: 'pln_2', action: 'assign' }, created_at: '2026-10-08 09:05' },
  { id: 'aud_2285', admin_actor_id: 'adm_01', action: 'result.delete', target_type: 'generation', target_id: 'job_7e0e0b5b', reason: 'Takedown request', metadata: { confirm: true }, created_at: '2026-10-07 21:38' },
  { id: 'aud_2284', admin_actor_id: 'adm_02', action: 'experience.update', target_type: 'experience', target_id: 'neon-samurai', reason: null, metadata: { changed: ['description', 'max_ornaments'] }, created_at: '2026-10-07 15:02' },
  { id: 'aud_2283', admin_actor_id: 'adm_01', action: 'user.sessions.revoke', target_type: 'account', target_id: 'usr_5c9b9c', reason: 'User reported a lost phone', metadata: { revoked_sessions: 3 }, created_at: '2026-10-06 08:44' },
]

export type AdminUser = { id: string; name: string; email: string; role: 'superadmin' | 'operator' | 'content_manager'; is_active: boolean }

export const adminUsers: AdminUser[] = [
  { id: 'adm_01', name: 'Putri Anggraini', email: 'putri@example.com', role: 'superadmin', is_active: true },
  { id: 'adm_02', name: 'Yoga Permana', email: 'yoga@example.com', role: 'content_manager', is_active: true },
  { id: 'adm_03', name: 'Lina Marlina', email: 'lina@example.com', role: 'operator', is_active: true },
  { id: 'adm_04', name: 'Arif Setiawan', email: 'arif@example.com', role: 'operator', is_active: false },
]

export const settings = {
  environment: 'production',
  ai_provider: 'provider-a',
  google_configured: true,
  upload_max_bytes: 12 * 1024 * 1024,
  upload_min_dimension: 512,
  upload_max_dimension: 8000,
  admin_default_role: 'superadmin',
}
