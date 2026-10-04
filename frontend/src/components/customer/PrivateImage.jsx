import React, { useEffect,useState } from 'react'
import { startPrivateImageDelivery } from '../../privateImageDelivery.js'

export default function PrivateImage({ id,src,resolve,onError,...props }) {
  const [url,setURL] = useState(src)
  useEffect(() => {
    setURL(src)
    return startPrivateImageDelivery({ id,src,resolve,onURL: setURL })
  },[id,src,resolve])
  return <img {...props} src={url} onError={event => { if (url!==src) setURL(src); else onError?.(event) }} />
}
