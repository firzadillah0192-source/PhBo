import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui'

type Entry = [label: string, to: string]
const groups: Array<{ title: string; items: Entry[] }> = [
  { title: 'Design System', items: [['Foundations, icons, components', '/design-system']] },
  {
    title: 'Customer web (mobile 390 · desktop 1440)',
    items: [
      ['1 · Home', '/app'], ['2 · Photo', '/app/create/photo'], ['3/4 · Style', '/app/create/style'], ['5a · Classic layout', '/app/create/layout'],
      ['5b · Classic photos', '/app/create/classic-photos'], ['6 · Review', '/app/create/review'],
      ['7a · Queued', '/app/processing?state=queued&hold'], ['7b · Processing', '/app/processing?state=processing&hold'], ['7c · Failed', '/app/processing?state=failed'],
      ['8a · Result — AI', '/app/result/ai'], ['8b · Result — Classic', '/app/result/classic'], ['8c · Share sheet', '/app/result/ai?sheet=share'],
      ['8d · Link exists (409)', '/app/result/ai?sheet=exists'], ['8e · Delete confirm', '/app/result/ai?sheet=delete'],
      ['10a · Sign in', '/app/signin'], ['10b · Sign up (error)', '/app/signup'],
      ['11a · Creations', '/app/account/creations'], ['11b · Credits & plan', '/app/account/credits'], ['11c · Profile', '/app/account/profile'],
      ['11d · Security', '/app/account/security'], ['11e · Privacy', '/app/account/privacy'],
      ['/r/:token · Available', '/r/9fK2xQ'], ['/r/:token · Unavailable', '/r/expired'],
    ],
  },
  {
    title: 'Kiosk QR claim — /claim/:code (mobile 390)',
    items: [
      ['a · Claiming', '/claim/abc123?step=claiming&hold'], ['b · Session home', '/claim/abc123?step=home'], ['c · Choose photo (AI)', '/claim/abc123?step=photo'],
      ['c2 · Choose photos (Classic)', '/claim/abc123?step=photos'], ['d · Style (event-limited)', '/claim/abc123?step=style'], ['g · History', '/claim/abc123?step=history'],
      ['Error · 409', '/claim/used'], ['Error · 410', '/claim/old'], ['Error · 403', '/claim/bad'],
    ],
  },
]

export function ScreenIndex() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <PageHeader title="All screens" subtitle="Every customer-side route in this prototype." />
      {groups.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="t-h4">{g.title}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map(([label, to]) => (
              <li key={label}>
                <Link to={to} className="t-body-s block rounded-md border border-border bg-surface px-3 py-2.5 hover:border-primary hover:text-primary">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
