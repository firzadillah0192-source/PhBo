import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generationFailureAction,
  generationFailureActionLabel,
  generationFailureMessage,
} from './generationMessages.js'

test('Basic face detection failures explain the photo constraint and offer a new photo', () => {
  const noFace = { mode: 'BASIC', error_code: 'BASIC_FACE_NOT_FOUND' }
  const multipleFaces = { mode: 'BASIC', error_code: 'BASIC_MULTIPLE_FACES' }

  assert.match(generationFailureMessage(noFace), /one clear face/i)
  assert.match(generationFailureMessage(multipleFaces), /one visible face/i)
  assert.equal(generationFailureAction(noFace), 'choose-photo')
  assert.equal(generationFailureActionLabel(multipleFaces), 'Choose another photo')
})

test('expired or missing uploads offer upload recovery', () => {
  for (const error_code of ['UPLOAD_NOT_FOUND', 'UPLOAD_EXPIRED']) {
    const job = { mode: 'BASIC', error_code }
    assert.match(generationFailureMessage(job), /upload/i)
    assert.equal(generationFailureAction(job), 'upload-again')
    assert.equal(generationFailureActionLabel(job), 'Upload again')
  }
})

test('Basic template and engine errors remain distinct from photo errors', () => {
  const job = { mode: 'BASIC', error_code: 'BASIC_TEMPLATE_METADATA_MISSING' }
  assert.match(generationFailureMessage(job), /temporarily unavailable/i)
  assert.equal(generationFailureAction(job), 'retry')
  assert.equal(generationFailureActionLabel(job), 'Try again')
})
