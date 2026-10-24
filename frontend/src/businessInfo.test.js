import test from 'node:test'
import assert from 'node:assert/strict'
import { BUSINESS, addressLines, phoneDisplay, phoneHref } from './businessInfo.js'

test('business contact details are formatted for display and links', () => {
  assert.equal(phoneDisplay('081292323040'), '0812-9232-3040')
  assert.equal(phoneHref('081292323040'), 'tel:+6281292323040')
  assert.match(BUSINESS.email, /^[^@\s]+@[^@\s]+\.[a-z]+$/)
})

test('address lines follow Indonesian order and skip empty parts', () => {
  assert.deepEqual(addressLines({ street: 'Jl. A No. 1', rtRw: 'RT 01 / RW 02', kelurahan: '', kecamatan: '', city: '', province: '', postalCode: '' }), ['Jl. A No. 1', 'RT 01 / RW 02', 'Indonesia'])
  assert.deepEqual(addressLines({ street: 'Jl. A No. 1', rtRw: 'RT 01 / RW 02', kelurahan: 'Cipta', kecamatan: 'Raya', city: 'Kota X', province: 'Provinsi Y', postalCode: '12345' }),
    ['Jl. A No. 1', 'RT 01 / RW 02', 'Kel. Cipta, Kec. Raya', 'Kota X, Provinsi Y 12345', 'Indonesia'])
})

test('the published business address is complete and in Indonesian order', () => {
  assert.deepEqual(addressLines(BUSINESS.address), ['Jl. TB Badaruddin No. 38', 'Kel. Jatinegara Kaum, Kec. Pulogadung', 'Jakarta Timur, DKI Jakarta 13250', 'Indonesia'])
  assert.equal(BUSINESS.email, 'support@gennexbyte.com')
})
