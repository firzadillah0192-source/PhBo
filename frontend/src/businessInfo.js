// Public business details shown on the landing page (payment-gateway merchant review asks for them).
// Fill the empty address fields when known; empty ones are simply not rendered.
export const BUSINESS = {
  name: 'NXBooth',
  operator: 'GenNexByte',
  email: 'support@gennexbyte.com',
  phone: '081292323040',
  address: {
    street: 'Jl. TB Badaruddin No. 38',
    rtRw: '',
    kelurahan: 'Jatinegara Kaum',
    kecamatan: 'Pulogadung',
    city: 'Jakarta Timur',
    province: 'DKI Jakarta',
    postalCode: '13250',
  },
}

// 081292323040 -> 0812-9232-3040 (display) and +6281292323040 (tel: link)
export function phoneDisplay(phone = BUSINESS.phone) {
  return String(phone).replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3')
}
export function phoneHref(phone = BUSINESS.phone) {
  return 'tel:+62' + String(phone).replace(/^0/, '')
}

// Indonesian convention: street + number, RT/RW, kelurahan, kecamatan, city, province + postal code.
export function addressLines(address = BUSINESS.address) {
  // Indonesian postal convention: "Kel."/"Kec." stay as written in every UI language.
  const area = [address.kelurahan && `Kel. ${address.kelurahan}`, address.kecamatan && `Kec. ${address.kecamatan}`].filter(Boolean).join(', ')
  const region = [address.city, [address.province, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [address.street, address.rtRw, area, region, 'Indonesia'].filter(Boolean)
}
