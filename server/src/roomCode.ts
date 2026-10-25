const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const ROOM_CODE_PATTERN = /^[A-Z][0-9][A-Z][0-9][A-Z]$/

export function generateRoomCode(random: () => number = Math.random): string {
  const pick = (alphabet: string) => {
    const index = Math.floor(random() * alphabet.length)
    return alphabet[index] ?? alphabet[0]
  }

  return `${pick(LETTERS)}${pick(DIGITS)}${pick(LETTERS)}${pick(DIGITS)}${pick(LETTERS)}`
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code)
}
