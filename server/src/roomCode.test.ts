import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateRoomCode, isValidRoomCode } from './roomCode.js'

test('generateRoomCode builds a letter-digit code from the random source', () => {
  assert.equal(generateRoomCode(() => 0), 'A0A0A')
  assert.equal(generateRoomCode(() => 0.999), 'Z9Z9Z')
  assert.equal(isValidRoomCode(generateRoomCode()), true)
})

test('isValidRoomCode accepts only five-character codes like A1B2C', () => {
  assert.equal(isValidRoomCode('A1B2C'), true)
  assert.equal(isValidRoomCode('a1b2c'), false)
  assert.equal(isValidRoomCode('A1B2'), false)
  assert.equal(isValidRoomCode('11B2C'), false)
})
