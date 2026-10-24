import React from 'react'
import { BUSINESS, addressLines, phoneDisplay, phoneHref } from '../../businessInfo.js'
import { useT } from '../../i18n.js'

export default function ContactSection() {
  const t = useT()
  const lines = addressLines(BUSINESS.address)
  return <section id="kontak" className="landing-contact landing-container landing-section" aria-labelledby="contact-title">
    <div className="landing-section-heading">
      <p className="landing-eyebrow">{t('Kontak & dukungan', 'Contact & support')}</p>
      <h2 id="contact-title">{t('Ada pertanyaan?', 'Questions?')} <br />{t('Kami dengan senang hati membantu.', 'We are happy to help.')}</h2>
    </div>
    <div className="landing-contact-grid">
      <article className="landing-contact-card">
        <h3>{t('Email', 'Email')}</h3>
        <p><a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></p>
        <small>{t('Untuk bantuan akun, pembayaran, dan kreasi Anda.', 'For help with your account, payments, and creations.')}</small>
      </article>
      <article className="landing-contact-card">
        <h3>{t('Telepon / WhatsApp', 'Phone / WhatsApp')}</h3>
        <p><a href={phoneHref()}>{phoneDisplay()}</a></p>
        <small>{t('Hubungi kami untuk pertanyaan produk dan pembayaran.', 'Call us about products and payments.')}</small>
      </article>
      <article className="landing-contact-card landing-contact-address">
        <h3>{t('Alamat usaha', 'Business address')}</h3>
        <address>{BUSINESS.name} · {BUSINESS.operator}{lines.map((line) => <React.Fragment key={line}><br />{line}</React.Fragment>)}</address>
      </article>
    </div>
  </section>
}
