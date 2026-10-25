import { readFileSync } from 'node:fs'

export interface DeckCard {
  name: string
  values: number[]
}

export interface Deck {
  name: string
  attributes: string[]
  cards: DeckCard[]
}

export type DeckValidation =
  | { ok: true; deck: Deck }
  | { ok: false; errors: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readName(value: unknown, label: string, errors: string[]): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} must be a non-empty string`)
    return null
  }
  return value
}

function readAttributes(value: unknown, errors: string[]): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('Deck must include at least one attribute')
    return null
  }

  const attributes: string[] = []
  for (const attribute of value) {
    if (typeof attribute !== 'string' || attribute.trim() === '') {
      errors.push('Every attribute must be a non-empty string')
      return null
    }
    attributes.push(attribute)
  }

  if (new Set(attributes).size !== attributes.length) {
    errors.push('Attribute names must be unique')
    return null
  }

  return attributes
}

function readCards(value: unknown, attributeCount: number | undefined, errors: string[]): DeckCard[] | null {
  if (!Array.isArray(value) || value.length < 2) {
    errors.push('Deck must include at least two cards')
    return null
  }

  const cards: DeckCard[] = []
  for (const [index, card] of value.entries()) {
    if (!isRecord(card)) {
      errors.push(`Card ${index} must be an object`)
      continue
    }

    const name = readName(card.name, `Card ${index} name`, errors)
    const values = card.values
    const valuesMatch =
      attributeCount !== undefined &&
      Array.isArray(values) &&
      values.length === attributeCount &&
      values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))

    if (!valuesMatch) {
      errors.push(`Card ${index} must have ${attributeCount ?? 'the matching number of'} finite numeric values`)
    }

    if (name && valuesMatch && Array.isArray(values)) {
      cards.push({ name, values: values as number[] })
    }
  }

  return cards.length === value.length ? cards : null
}

export function validateDeck(input: unknown): DeckValidation {
  if (!isRecord(input)) {
    return { ok: false, errors: ['Deck must be a JSON object'] }
  }

  const errors: string[] = []
  const name = readName(input.name, 'Deck name', errors)
  const attributes = readAttributes(input.attributes, errors)
  const cards = readCards(input.cards, attributes?.length, errors)

  if (!name || !attributes || !cards) {
    return { ok: false, errors }
  }

  return { ok: true, deck: { name, attributes, cards } }
}

export function loadDeck(filePath: string): Deck {
  const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
  const result = validateDeck(raw)
  if (!result.ok) {
    throw new Error(`Invalid deck at ${filePath}: ${result.errors.join('; ')}`)
  }
  return result.deck
}
