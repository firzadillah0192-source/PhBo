import { type ReactNode, useState } from 'react'
import {
  AlertCircle, BarChart3, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, CreditCard, Download, FileText, Film, Grid3x3, Home, Image as ImageIcon, Info,
  List, LogOut, MoreHorizontal, Plus, RefreshCw, Search, Share2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Upload, User, Users, X, Zap, type LucideIcon,
} from 'lucide-react'
import { Button, Chip, cn, Field, StatTile, type Tone } from '../components/ui'
import { CatalogCard, CreditsPill, FilterChip, ModeCard, PhotoDropzone, Stepper, ToastCard } from '../components/customer'

const light: Array<[string, string]> = [
  ['bg', '#F7F7FB'], ['surface', '#FFFFFF'], ['surface-2', '#EEF0F6'], ['border', '#DDE0EA'], ['text', '#12131F'], ['text-muted', '#5A5F73'],
  ['primary', '#5B3DF5'], ['primary-hover', '#4A2EDB'], ['primary-soft', '#EEEBFE'], ['accent', '#F5A524'], ['accent-soft', '#FEF3DD'],
  ['success', '#15803D'], ['success-soft', '#E3F3E8'], ['warning', '#B45309'], ['warning-soft', '#FBEEDD'], ['danger', '#C62828'], ['danger-soft', '#FBE6E6'],
  ['info', '#1D4ED8'], ['info-soft', '#E4ECFC'], ['mode-classic', '#E0703A'], ['mode-basic', '#0F9D8A'], ['mode-advanced', '#5B3DF5'],
]
const dark: Array<[string, string]> = [
  ['bg', '#0E0F1A'], ['surface', '#171927'], ['surface-2', '#22253A'], ['border', '#2F3350'], ['text', '#F4F5FA'], ['text-muted', '#A8ADC4'],
  ['primary', '#8C78FF'], ['primary-hover', '#A194FF'], ['primary-soft', '#26224A'], ['accent', '#FFB84D'], ['accent-soft', '#3A2C12'],
  ['success', '#4ADE80'], ['success-soft', '#14301F'], ['warning', '#FBBF24'], ['warning-soft', '#3A2D10'], ['danger', '#F87171'], ['danger-soft', '#3D1A1A'],
  ['info', '#60A5FA'], ['info-soft', '#172B4D'], ['mode-classic', '#F08A57'], ['mode-basic', '#2CC4AF'], ['mode-advanced', '#8C78FF'],
]

const typeScale: Array<[string, string, string]> = [
  ['Display · 48/56', 't-display', 'Make your photobooth moment'],
  ['H1 · 36/44', 't-h1', 'Make your photobooth moment'],
  ['H2 · 28/36', 't-h2', 'Make your photobooth moment'],
  ['H3 · 22/30', 't-h3', 'Make your photobooth moment'],
  ['H4 · 18/26', 't-h4', 'Make your photobooth moment'],
  ['Body L · 18/28', 't-body-l', 'Make your photobooth moment'],
  ['Body · 16/24', 't-body', 'Make your photobooth moment'],
  ['Body S · 14/20', 't-body-s', 'Make your photobooth moment'],
  ['Caption · 12/16', 't-caption', 'Make your photobooth moment'],
  ['Label · 16/24', 't-label', 'Make your photobooth moment'],
  ['Label S · 14/20', 't-label-s', 'Make your photobooth moment'],
  ['Label XS · 12/16', 't-label-xs', 'Make your photobooth moment'],
  ['Mono · 13/20', 't-mono', 'job_8f2c41a9 · req-7d1e'],
]
const kioskScale: Array<[string, string, string]> = [
  ['Kiosk Display · 72/84', 'font-display text-[72px] font-extrabold leading-[84px]', 'Make your photobooth moment'],
  ['Kiosk H1 · 54/66', 'font-display text-[54px] font-bold leading-[66px]', 'Make your photobooth moment'],
  ['Kiosk H2 · 42/54', 'font-display text-[42px] font-bold leading-[54px]', 'Make your photobooth moment'],
  ['Kiosk H3 · 32/44', 'font-display text-[32px] font-semibold leading-[44px]', 'Make your photobooth moment'],
  ['Kiosk Body · 24/36', 'text-2xl leading-9', 'Make your photobooth moment'],
  ['Kiosk Label · 24/36', 'text-2xl font-semibold leading-9', 'Make your photobooth moment'],
]

const icons: Array<[string, LucideIcon]> = [
  ['check', Check], ['chevR', ChevronRight], ['chevL', ChevronLeft], ['chevD', ChevronDown], ['x', X], ['plus', Plus], ['download', Download], ['upload', Upload],
  ['share', Share2], ['camera', Camera], ['user', User], ['users', Users], ['film', Film], ['portrait', User], ['sparkles', Sparkles], ['trash', Trash2], ['search', Search],
  ['more', MoreHorizontal], ['clock', Clock], ['alert', AlertCircle], ['info', Info], ['copy', Copy], ['refresh', RefreshCw], ['zap', Zap], ['image', ImageIcon],
  ['grid', Grid3x3], ['list', List], ['sliders', SlidersHorizontal], ['shield', ShieldCheck], ['logout', LogOut], ['chart', BarChart3], ['home', Home], ['file', FileText], ['card', CreditCard],
]

const spacing = [4, 8, 12, 16, 24, 32, 48, 64, 96]
const radii: Array<[string, string]> = [['8 · inputs, chips', 'rounded-sm'], ['12 · cards', 'rounded-md'], ['20 · sheets, media', 'rounded-lg'], ['full · pills', 'rounded-full']]
const chipTones: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger', 'primary', 'accent', 'classic', 'basic']

function Section({ id, title, children, dark: d }: { id: string; title: string; children: ReactNode; dark?: boolean }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={cn('rounded-lg p-6', d ? 'bg-stage-bg text-stage-text' : 'bg-surface')}>
      <h2 id={`${id}-h`} className="t-h3 mb-5">{title}</h2>
      {children}
    </section>
  )
}

function Swatches({ colors, isDark }: { colors: Array<[string, string]>; isDark?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
      {colors.map(([name, hex]) => (
        <div key={name} className="space-y-1.5">
          <div className={cn('h-[72px] rounded-md border', isDark ? 'border-stage-border' : 'border-border')} style={{ background: hex }} />
          <p className="t-label-s">{name}</p>
          <p className={cn('t-mono !text-xs', isDark ? 'text-stage-muted' : 'text-text-muted')}>{hex}</p>
        </div>
      ))}
    </div>
  )
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="t-mono !text-xs text-text-muted">{label}</p>
      {children}
    </div>
  )
}

export function DesignSystem() {
  const [tab, setTab] = useState<'Creations' | 'Credits'>('Creations')
  const [chip, setChip] = useState('Fantasy')
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="t-display">NXBooth Design System</h1>
          <p className="t-body-l mt-2 text-text-muted">Event-night premium, playful but trustworthy. The photo is the hero.</p>
          <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-2">
            {[['colour', 'Colour'], ['dark', 'Dark stage'], ['type', 'Typography'], ['spacing', 'Spacing & radius'], ['icons', 'Icons'], ['components', 'Components']].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="t-label-s rounded-full bg-surface-2 px-3.5 py-1.5 hover:bg-primary-soft hover:text-primary">{label}</a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <Section id="colour" title="Colour — Light"><Swatches colors={light} /></Section>
        <Section id="dark" title="Colour — Dark “stage” (kiosk & processing)" dark><Swatches colors={dark} isDark /></Section>

        <Section id="type" title="Typography">
          <div className="space-y-4">
            {typeScale.map(([label, cls, text]) => (
              <Specimen key={label} label={label}><p className={cls}>{text}</p></Specimen>
            ))}
            <hr className="border-border" />
            {kioskScale.map(([label, cls, text]) => (
              <Specimen key={label} label={label}><p className={cls}>{text}</p></Specimen>
            ))}
          </div>
        </Section>

        <Section id="spacing" title="Spacing (4 px base) & radius">
          <div className="flex flex-wrap items-end gap-6">
            {spacing.map((s) => (
              <div key={s} className="flex flex-col items-start gap-1.5">
                <span className="bg-primary" style={{ width: s, height: s }} />
                <span className="t-mono !text-xs text-text-muted">{s}</span>
              </div>
            ))}
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {radii.map(([label, cls]) => (
              <div key={label} className="space-y-1.5">
                <div className={cn('h-20 border border-border bg-surface shadow-e1', cls)} />
                <p className="t-caption text-text-muted">{label}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="icons" title="Icons">
          <p className="t-body-s mb-4 text-text-muted">24 px grid, 2 px stroke, rounded caps. Recolour by stroke.</p>
          <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
            {icons.map(([name, Icon]) => (
              <li key={name} className="flex flex-col items-center gap-1.5 rounded-md border border-border p-3">
                <Icon size={24} strokeWidth={2} aria-hidden />
                <span className="t-caption text-text-muted">icon/{name}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="components" title="Components">
          <div className="space-y-10">
            <Specimen label="Button — Primary · Secondary · Tertiary · Destructive × Default · Disabled · Loading">
              <div className="grid gap-3 sm:grid-cols-4">
                {(['primary', 'secondary', 'tertiary', 'destructive'] as const).map((v) => (
                  <div key={v} className="flex flex-col items-start gap-3">
                    <Button variant={v}>Button</Button>
                    <Button variant={v} icon={Plus}>With icon</Button>
                    <Button variant={v} disabled>Disabled</Button>
                    <Button variant={v} loading>Loading…</Button>
                  </div>
                ))}
              </div>
            </Specimen>

            <Specimen label="Input — Default · Focus · Error · Disabled">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Label" helper="Helper text"><input className="t-body h-12 w-full rounded-sm border border-border bg-surface px-3" defaultValue="" placeholder="Default" /></Field>
                <Field label="Label" helper="Helper text"><input className="t-body h-12 w-full rounded-sm border border-primary bg-surface px-3 ring-1 ring-primary" defaultValue="Focused" /></Field>
                <Field label="Label" error="Email or password is incorrect"><input aria-invalid className="t-body h-12 w-full rounded-sm border border-danger bg-surface px-3" defaultValue="ayu@" /></Field>
                <Field label="Label" helper="Helper text"><input disabled className="t-body h-12 w-full rounded-sm border border-border bg-surface-2 px-3" defaultValue="Disabled" /></Field>
              </div>
            </Specimen>

            <Specimen label="Chip — tones">
              <div className="flex flex-wrap gap-2">{chipTones.map((t) => <Chip key={t} tone={t} icon={Check}>{t[0].toUpperCase() + t.slice(1)}</Chip>)}</div>
            </Specimen>

            <Specimen label="ModeCard — Classic · Basic · Advanced · Disabled">
              <div className="grid gap-3 md:grid-cols-3">
                <ModeCard mode="classic" /><ModeCard mode="basic" /><ModeCard mode="advanced" />
                <ModeCard mode="classic" disabledNote="No AI credits left." /><ModeCard mode="basic" disabledNote="No AI credits left." /><ModeCard mode="advanced" disabledNote="No AI credits left." />
              </div>
            </Specimen>

            <Specimen label="CreditsPill — Plenty · Low · Zero">
              <div className="flex flex-wrap gap-3"><CreditsPill credits={2} /><CreditsPill credits={1} /><CreditsPill credits={0} /></div>
            </Specimen>

            <Specimen label="CatalogCard — Template · Experience · Layout × Default · Selected · Disabled">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                <CatalogCard title="Garden Party" blurb="Soft florals" seed={0} />
                <CatalogCard title="Neon Arcade" blurb="Selected" seed={7} selected />
                <CatalogCard title="Royal Portrait" blurb="Unavailable" seed={2} disabled />
                <CatalogCard title="Space Commander" blurb="Cinematic sci-fi" seed={9} tag="Sci-Fi" />
                <CatalogCard title="Retro Film Strip" blurb="Classic · 4 shots" seed={4} tag="Retro" tall selected />
                <CatalogCard title="Midnight Disco" blurb="Classic · 3 shots" seed={8} tall disabled />
              </div>
            </Specimen>

            <Specimen label="Step · Tab · FilterChip">
              <div className="flex flex-col gap-5">
                <Stepper steps={['Photo', 'Style', 'Review']} current={1} />
                <div role="tablist" className="flex gap-6 border-b border-border">
                  {(['Creations', 'Credits'] as const).map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('t-label-s -mb-px border-b-2 px-1 pb-3 pt-2', tab === t ? 'border-primary text-primary' : 'border-transparent text-text-muted')}>{t}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {['Fantasy', 'Sci-Fi', 'Art'].map((c) => <FilterChip key={c} label={c} selected={chip === c} onClick={() => setChip(c)} />)}
                  <FilterChip label="Vintage" disabled />
                </div>
              </div>
            </Specimen>

            <Specimen label="NavItem — Default · Active">
              <div className="flex w-52 flex-col gap-1">
                <span className="t-label-s flex h-10 items-center gap-3 rounded-sm px-3 text-text"><Home size={18} className="text-text-muted" aria-hidden />Overview</span>
                <span className="t-label-s flex h-10 items-center gap-3 rounded-sm bg-primary-soft px-3 text-primary"><Home size={18} aria-hidden />Overview</span>
              </div>
            </Specimen>

            <Specimen label="StatTile"><div className="w-64"><StatTile label="Total users" value="12,480" hint="+128 today" hintTone="success" /></div></Specimen>

            <Specimen label="Toast — Success · Error · Warning · Info">
              <div className="grid gap-3 md:grid-cols-2">
                <ToastCard tone="success" title="Link copied" body="Paste it anywhere." />
                <ToastCard tone="error" title="Something went wrong" body="Reference ID: req_7d1e9a40" />
                <ToastCard tone="warning" title="1 credit left" />
                <ToastCard tone="info" title="Uploads are kept for 24 hours" />
              </div>
            </Specimen>

            <Specimen label="PhotoDropzone — Idle · Dragging · Uploading">
              <div className="grid gap-4 md:grid-cols-3"><PhotoDropzone /><PhotoDropzone state="dragging" /><PhotoDropzone state="uploading" /></div>
            </Specimen>
          </div>
        </Section>
      </main>
    </div>
  )
}
