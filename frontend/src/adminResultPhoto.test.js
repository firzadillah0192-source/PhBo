import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('Admin result controls follow available and deleted Express result metadata', async () => {
 const vite=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
 try {
  const {default:Photo}=await vite.ssrLoadModule('/src/components/admin/AdminResultPhoto.jsx')
  const generation={job_id:'job',result_id:'result',result_image_url:'/api/admin/usage/generations/job/result/image',result_download_url:'/api/admin/usage/generations/job/result/download'}
  const render=g=>renderToStaticMarkup(React.createElement(Photo,{generation:g,onDeleted:()=>{}}))
  assert.match(render(generation),/Hapus foto/);assert.match(render(generation),/Download foto/)
  assert.doesNotMatch(render({job_id:'pending'}),/Hapus foto|Download foto|<img/)
  const deleted=render({...generation,result_deleted_at:'2026-10-07'})
  assert.match(deleted,/Foto sudah dihapus/);assert.doesNotMatch(deleted,/Hapus foto|Download foto|<img/)
 } finally {await vite.close()}
})
