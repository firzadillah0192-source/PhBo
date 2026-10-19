import React from 'react'
import ModeCards, { CatalogImage } from './ModeCards.jsx'
import LandingReel from './LandingReel.jsx'
import PricingSection from './PricingSection.jsx'
import ContactSection from './ContactSection.jsx'
import { BUSINESS, phoneDisplay, phoneHref } from '../../businessInfo.js'
import { featuredPreviews, modePreviews } from './landingCatalog.js'
import { modeRoute } from '../../customerRoute.js'
import { useT } from '../../i18n.js'
import './landing.css'

const STEPS = [
  [['Pilih dunia', 'Choose a world'], ['Photo Booth, Scene Remix, atau Creative Studio: tiga pintu menuju cerita Anda.', 'Photo Booth, Scene Remix, or Creative Studio: three doors into your story.']],
  [['Hadirkan diri', 'Show up'], ['Unggah foto atau buka kamera. Satu wajah sudah cukup untuk memulai.', 'Upload a photo or open your camera. One face is enough to begin.']],
  [['Biarkan ia berubah', 'Let it transform'], ['Pilih bingkai atau pengalaman, lalu saksikan potret Anda menjelma.', 'Choose a frame or an experience, then watch your portrait come to life.']],
  [['Bawa pulang', 'Take it home'], ['Lihat pratinjaunya, unduh, dan simpan sebagai kenangan.', 'Preview it, download it, and keep it as a memory.']],
]
const CAPTIONS = { 'Creative world': ['Dunia kreatif', 'Creative world'], 'Curated transformation': ['Transformasi pilihan', 'Curated transformation'] }

function Actions({ signedIn, onStart }) {
  const t = useT()
  return signedIn
    ? <div className="landing-actions">
      <a className="landing-primary" href="/create">{t('Buat Potret Baru', 'Create a New Portrait')} <span aria-hidden="true">↗</span></a>
      <a className="landing-secondary" href="/account?tab=creations">{t('Lihat Kreasi Saya', 'See My Creations')} <span aria-hidden="true">→</span></a>
    </div>
    : <div className="landing-actions">
      <a className="landing-primary" href="/create" onClick={(event) => { if (onStart) { event.preventDefault(); onStart() } }}>{t('Coba NXBooth Gratis', 'Try NXBooth Free')} <span aria-hidden="true">↗</span></a>
      <a className="landing-secondary" href="#experiences">{t('Jelajahi Pengalaman', 'Explore Experiences')} <span aria-hidden="true">↓</span></a>
    </div>
}

export default function LandingPage({ templates = [], experiences = [], layouts = [], loading = false, error = false, onRetry, account = null, usage = null, onStart, onBuy }) {
  const t = useT()
  const signedIn = Boolean(usage?.authenticated)
  const name = account?.display_name || account?.email?.split('@')[0] || ''
  const credit = usage?.subscription?.ai?.remaining ?? usage?.ai_remaining
  const featured = featuredPreviews(experiences, templates)
  const hero = featured[0]
  const second = featured.find((item) => item.mode === 'BASIC' && item.id !== hero?.id) || featured[1]
  return <div className="nx-landing">
    <main id="studio-main" tabIndex="-1">
      <section className="landing-hero landing-container" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          {signedIn
            ? <>
              <p className="landing-eyebrow"><span className="retro-spark" aria-hidden="true">✳</span> {name ? t(`Selamat datang kembali, ${name}`, `Welcome back, ${name}`) : t('Selamat datang kembali', 'Welcome back')}</p>
              <h1 id="landing-title">{t('Cerita berikutnya', 'Your next story')}<br /><em>{t('dimulai dari sini.', 'begins here.')}</em></h1>
              <p className="landing-intro">{t('Pilih dunia, hadirkan satu foto, dan biarkan kisah Anda berlanjut.', 'Choose a world, bring one photo, and let your story go on.')}{typeof credit === 'number' ? ` ${t(`Saldo Anda ${credit.toLocaleString('id-ID')} kredit.`, `You have ${credit.toLocaleString('en-US')} credits.`)}` : ''}</p>
              <Actions signedIn />
              <p className="landing-hero-note"><span aria-hidden="true">✓</span> {t('Setiap kreasi tersimpan rapi di akun Anda.', 'Every creation is kept safely in your account.')}</p>
            </>
            : <>
              <p className="landing-eyebrow"><span className="retro-spark" aria-hidden="true">✳</span> {t('Momen yang layak dikenang', 'A moment worth remembering')}</p>
              <h1 id="landing-title">{t('Satu foto,', 'One photo,')}<br /><em>{t('seribu cerita.', 'a thousand stories.')}</em></h1>
              <p className="landing-intro">{t('Hadirkan satu potret, lalu pilih dunia tempat ia hidup: bingkai klasik, petualangan sinematik, atau gaya yang belum pernah Anda bayangkan.', 'Bring one portrait, then choose the world it lives in: a classic frame, a cinematic adventure, or a style you have never imagined.')}</p>
              <Actions onStart={onStart} />
              <p className="landing-hero-note"><span aria-hidden="true">✓</span> {t('Kamera Anda. Imajinasi Anda. Kenang-kenangan Anda.', 'Your camera. Your imagination. Your keepsake.')}</p>
            </>}
        </div>
        <div className="landing-hero-art">
          <div className="landing-scenery" aria-hidden="true"><span>✳</span></div>
          <div className="retro-window-bar"><span aria-hidden="true">● ● ●</span><span>nxbooth / preview studio</span><span aria-hidden="true">↗</span></div>
          {hero && <LandingReel previews={featured} />}
          {second && <figure className="landing-hero-print print-second">
            <CatalogImage key={second.preview} src={second.preview} alt={t(`Pratinjau pengalaman ${second.name}`, `${second.name} experience preview`)} loading="eager" />
            <figcaption>{second.name}</figcaption>
          </figure>}
          <p className="landing-art-caption">{t('Foto kecil.', 'A little photo.')}<br /><em>{t('Banyak kemungkinan.', 'A lot of possibility.')}</em></p>
          <span className="landing-art-index" aria-hidden="true">{t('PENGALAMAN NXBOOTH', 'THE NXBOOTH EXPERIENCE')} / 01</span>
        </div>
      </section>

      <section id="how-it-works" className="landing-how landing-container landing-section" aria-labelledby="how-title">
        <div className="landing-section-heading"><p className="landing-eyebrow">{t('Cara kerja', 'How it works')}</p><h2 id="how-title">{t('Sedikit imajinasi,', 'A little imagination,')} <br />{t('empat langkah menuju cerita.', 'four steps to a story.')}</h2></div>
        <ol className="landing-steps">{STEPS.map(([title, copy], index) => <li key={title[1]}>
          <span aria-hidden="true">0{index + 1}</span><h3>{t(...title)}</h3><p>{t(...copy)}</p>
        </li>)}</ol>
      </section>

      <section id="modes" className="landing-modes landing-section" aria-labelledby="modes-title">
        <div className="landing-container">
          <div className="landing-section-heading"><p className="landing-eyebrow">{t('Tiga cara berkreasi', 'Three ways to create')}</p><h2 id="modes-title">{t('Momen yang sama.', 'Same moment.')} <br />{t('Kemungkinan berbeda.', 'Different possibilities.')}</h2><p>{t('Tetap apa adanya, masuk ke dunia yang dirancang, atau ikuti imajinasi Anda.', 'Keep it real, step into a designed world, or follow your imagination.')}</p></div>
          <ModeCards previews={modePreviews({ templates, experiences, layouts })} />
        </div>
      </section>

      <section id="experiences" className="landing-featured landing-container landing-section" aria-labelledby="featured-title">
        <div className="landing-section-heading landing-heading-row"><div><p className="landing-eyebrow">{t('Temukan dunia Anda', 'Find your world')}</p><h2 id="featured-title">{t('Pengalaman Pilihan', 'Featured Experiences')}</h2></div><a className="landing-text-link" href={modeRoute('ADVANCED')}>{t('Jelajahi semua pengalaman', 'Explore all experiences')} <span aria-hidden="true">→</span></a></div>
        {loading && !featured.length ? <p className="landing-catalog-state" role="status">{t('Membuka koleksi pratinjau…', 'Opening the preview collection…')}</p> : featured.length ? <ul className="landing-featured-grid" aria-label={t('Pratinjau pengalaman yang dipublikasikan', 'Published experience previews')}>
          {featured.map((item) => <li key={`${item.mode}:${item.id}`}><a className="landing-experience-card" href={modeRoute(item.mode)}>
            <div><CatalogImage key={item.preview} src={item.preview} alt={t(`Pratinjau ${item.name}`, `${item.name} preview`)} /><span aria-hidden="true">↗</span></div>
            <p>{CAPTIONS[item.caption] ? t(...CAPTIONS[item.caption]) : item.caption}</p><h3>{item.name}</h3>
          </a></li>)}
        </ul> : <div className="landing-catalog-state"><p>{error ? t('Koleksi pratinjau butuh waktu untuk dimuat.', 'The preview collection is taking a moment to load.') : t('Dunia baru sedang disiapkan. Jelajahi studio untuk melihat yang tersedia.', 'New worlds are being prepared. Explore the studio to see what’s available.')}</p>{error && <button type="button" onClick={onRetry}>{t('Muat ulang pratinjau', 'Reload previews')} <span aria-hidden="true">↗</span></button>}</div>}
      </section>

      <PricingSection catalog={usage?.subscription?.catalog} onBuy={onBuy} />

      <section className="landing-output landing-section" aria-labelledby="output-title">
        <div className="landing-container landing-output-inner">
          <div><p className="landing-eyebrow">{t('Lebih dari sekadar potret', 'More than a portrait')}</p><h2 id="output-title">{t('Dibuat untuk keluar', 'Made to leave')}<br /><em>{t('dari layar.', 'the screen.')}</em></h2><p>{t('Lihat pratinjau kreasi Anda, lalu unduh untuk disimpan di perangkat.', 'Preview your finished creation, then download it to keep on your device.')}</p></div>
          <ul className="landing-output-list">
            <li><span>01</span><strong>{t('Pratinjau', 'Preview')}</strong><p>{t('Lihat potret jadi Anda sebelum menyimpannya.', 'See your finished portrait before saving it.')}</p></li>
            <li><span>02</span><strong>{t('Unduh', 'Download')}</strong><p>{t('Kreasi Anda, siap disimpan.', 'Your creation, ready to keep.')}</p></li>
          </ul>
        </div>
      </section>

      <section className="landing-final landing-container landing-section" aria-labelledby="final-title">
        <p className="landing-eyebrow">{signedIn ? t('Kisah Anda belum selesai', 'Your story is not finished') : t('Pintu sudah terbuka', 'The door is open')}</p>
        <h2 id="final-title">{signedIn ? t('Cerita apa yang ingin Anda', 'What story will you') : t('Siap menulis', 'Ready to write')}<br /><em>{signedIn ? t('tulis hari ini?', 'tell today?') : t('cerita berikutnya?', 'your next chapter?')}</em></h2><Actions signedIn={signedIn} onStart={onStart} />
      </section>
      <ContactSection />
    </main>
    <footer className="landing-footer landing-container">
      <div><a className="landing-footer-brand" href="/">NXBooth</a><p>{t('Ditenagai GenNexByte', 'Powered by GenNexByte')}</p><p><a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> · <a href={phoneHref()}>{phoneDisplay()}</a></p></div>
      <nav aria-label={t('Footer NXBooth', 'NXBooth footer')}><a href="#experiences">{t('Pengalaman', 'Experiences')}</a><a href="#how-it-works">{t('Cara Kerja', 'How It Works')}</a><a href="#harga">{t('Harga', 'Pricing')}</a><a href="#kontak">{t('Kontak', 'Contact')}</a><a href="/create">{t('Mulai berkreasi', 'Start creating')} <span aria-hidden="true">↗</span></a></nav>
      <small>{t('Jadikan momen ini milik Anda.', 'Make a moment your own.')}</small>
    </footer>
  </div>
}
