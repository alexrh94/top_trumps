import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { listDecks, loadDeck, validateDeck } from './deck.js'

const sampleDeckPath = fileURLToPath(new URL('../../decks/dinosaurs.json', import.meta.url))

const validDeck = {
  name: 'Test deck',
  attributes: ['Speed', 'Power'],
  cards: [
    { name: 'Alpha', values: [1, 2] },
    { name: 'Beta', values: [3, 4] },
  ],
}

test('validateDeck accepts a deck whose card values match its attributes', () => {
  const result = validateDeck(validDeck)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.deck.cards.length, 2)
  }
})

test('validateDeck rejects malformed decks', () => {
  assert.deepEqual(validateDeck(null), { ok: false, errors: ['Deck must be a JSON object'] })
  assert.equal(validateDeck({ ...validDeck, name: '  ' }).ok, false)
  assert.equal(validateDeck({ ...validDeck, attributes: ['Speed', 'Speed'] }).ok, false)
  assert.equal(validateDeck({ ...validDeck, attributes: [] }).ok, false)
  assert.equal(validateDeck({ ...validDeck, cards: [{ name: 'Only', values: [1, 2] }] }).ok, false)
  assert.equal(
    validateDeck({
      ...validDeck,
      cards: [
        { name: 'Alpha', values: [1] },
        { name: 'Beta', values: [Number.NaN, 2] },
      ],
    }).ok,
    false,
  )
})

test('loadDeck reads the sample dinosaur deck', () => {
  const deck = loadDeck(sampleDeckPath)
  assert.equal(deck.name, 'Dinosaurs')
  assert.equal(deck.attributes.length, 5)
  assert.ok(deck.cards.length >= 2)
})

test('listDecks reads names from a directory and skips other files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'top-trumps-decks-'))
  const deck = {
    attributes: ['Speed'],
    cards: [
      { name: 'One', values: [1] },
      { name: 'Two', values: [2] },
    ],
  }
  writeFileSync(join(directory, 'notes.txt'), 'ignore me')
  mkdirSync(join(directory, 'nested.json'))
  writeFileSync(join(directory, 'zeta.json'), JSON.stringify({ ...deck, name: 'Zeta' }))
  writeFileSync(join(directory, 'alpha.json'), JSON.stringify({ ...deck, name: 'Alpha' }))

  assert.deepEqual(listDecks(directory), [
    { id: 'alpha', name: 'Alpha' },
    { id: 'zeta', name: 'Zeta' },
  ])
})

test('listDecks includes the sample dinosaur deck', () => {
  const decks = listDecks(dirname(sampleDeckPath))
  assert.ok(decks.some((deck) => deck.id === 'dinosaurs' && deck.name === 'Dinosaurs'))
})

test('listDecks throws when a json file is not a valid deck', () => {
  const directory = mkdtempSync(join(tmpdir(), 'top-trumps-decks-'))
  writeFileSync(join(directory, 'broken.json'), '{"name":"Broken"}')
  assert.throws(() => listDecks(directory), /Invalid deck/)
})

test('loadDeck throws when the file is not a valid deck', () => {
  const directory = mkdtempSync(join(tmpdir(), 'top-trumps-deck-'))
  const invalidPath = join(directory, 'invalid.json')
  writeFileSync(invalidPath, '{"name":"Broken"}')
  assert.throws(() => loadDeck(invalidPath), /Invalid deck/)

  const brokenJson = join(directory, 'broken.json')
  writeFileSync(brokenJson, '{')
  assert.throws(() => loadDeck(brokenJson), SyntaxError)
})
