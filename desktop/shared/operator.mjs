import {scryptSync,randomBytes,timingSafeEqual} from 'node:crypto';
export const PIN_ID='6f70657261746f722d70696e2d303031'; // fixed id of the staff PIN record in the credential store
export const KEY_ID='6b696f736b2d6170692d6b6579303031'; // fixed id of the staff-entered kiosk key
export const validPin=pin=>typeof pin==='string'&&pin.length>=4&&pin.length<=128;
export function hashPin(pin){
  if(!validPin(pin))throw new Error('PIN_INVALID');
  const salt=randomBytes(16);return {salt:salt.toString('hex'),hash:scryptSync(pin,salt,32).toString('hex')};
}
export function checkPin(pin,record){
  if(!validPin(pin)||!record?.salt||!record?.hash)return false;
  const wanted=Buffer.from(record.hash,'hex'),got=scryptSync(pin,Buffer.from(record.salt,'hex'),32);
  return wanted.length===got.length&&timingSafeEqual(wanted,got);
}
