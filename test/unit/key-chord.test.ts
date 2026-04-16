import { describe, expect, test } from 'bun:test'

import type { KeyInput } from '../../src/input/modes/types'

import {
  keyInputToChord,
  parseKeyNotation,
  rawSequenceToChord,
} from '../../src/input/keymap/key-chord'

function ki(
  name: string,
  opts: { ctrl?: boolean; meta?: boolean; sequence?: string; shift?: boolean } = {}
): KeyInput {
  return {
    ctrl: opts.ctrl ?? false,
    meta: opts.meta ?? false,
    name,
    sequence: opts.sequence ?? name,
    shift: opts.shift ?? false,
  }
}

describe('keyInputToChord', () => {
  test('plain letter', () => {
    expect(keyInputToChord(ki('j'))).toBe('j')
  })

  test('shift+letter becomes uppercase', () => {
    expect(keyInputToChord(ki('j', { shift: true }))).toBe('J')
  })

  test('ctrl+letter', () => {
    expect(keyInputToChord(ki('n', { ctrl: true }))).toBe('C-n')
  })

  test('meta+letter', () => {
    expect(keyInputToChord(ki('x', { meta: true }))).toBe('M-x')
  })

  test('ctrl+meta+letter', () => {
    expect(keyInputToChord(ki('a', { ctrl: true, meta: true }))).toBe('C-M-a')
  })

  test('ctrl+shift+letter keeps S- prefix (not uppercase)', () => {
    // ctrl+shift combinations use the base name, ctrl prefix is present
    expect(keyInputToChord(ki('j', { ctrl: true, shift: true }))).toBe('C-j')
  })

  test('special keys: escape, return, space', () => {
    expect(keyInputToChord(ki('escape'))).toBe('escape')
    expect(keyInputToChord(ki('return'))).toBe('return')
    expect(keyInputToChord(ki('space'))).toBe('space')
  })

  test('punctuation via sequence', () => {
    expect(keyInputToChord(ki('?', { sequence: '?' }))).toBe('?')
    expect(keyInputToChord(ki('|', { sequence: '|' }))).toBe('|')
    expect(keyInputToChord(ki('-', { sequence: '-' }))).toBe('-')
  })

  test('arrow keys', () => {
    expect(keyInputToChord(ki('down'))).toBe('down')
    expect(keyInputToChord(ki('up'))).toBe('up')
  })
})

describe('parseKeyNotation', () => {
  test('single bare character', () => {
    expect(parseKeyNotation('j')).toEqual(['j'])
  })

  test('multiple bare characters', () => {
    expect(parseKeyNotation('dd')).toEqual(['d', 'd'])
    expect(parseKeyNotation('gj')).toEqual(['g', 'j'])
  })

  test('angle bracket: <C-n>', () => {
    expect(parseKeyNotation('<C-n>')).toEqual(['C-n'])
  })

  test('angle bracket: <M-x>', () => {
    expect(parseKeyNotation('<M-x>')).toEqual(['M-x'])
  })

  test('angle bracket: <C-M-a>', () => {
    expect(parseKeyNotation('<C-M-a>')).toEqual(['C-M-a'])
  })

  test('special names: <CR>, <Esc>, <Space>, <BS>, <Tab>', () => {
    expect(parseKeyNotation('<CR>')).toEqual(['return'])
    expect(parseKeyNotation('<Esc>')).toEqual(['escape'])
    expect(parseKeyNotation('<Space>')).toEqual(['space'])
    expect(parseKeyNotation('<BS>')).toEqual(['backspace'])
    expect(parseKeyNotation('<Tab>')).toEqual(['tab'])
  })

  test('arrow keys: <Down>, <Up>', () => {
    expect(parseKeyNotation('<Down>')).toEqual(['down'])
    expect(parseKeyNotation('<Up>')).toEqual(['up'])
  })

  test('shift+letter: <S-g>', () => {
    expect(parseKeyNotation('<S-g>')).toEqual(['G'])
  })

  test('leader substitution', () => {
    expect(parseKeyNotation('<leader>g', 'space')).toEqual(['space', 'g'])
    expect(parseKeyNotation('<leader>tn', 'space')).toEqual(['space', 't', 'n'])
  })

  test('leader without config throws', () => {
    expect(() => parseKeyNotation('<leader>g')).toThrow()
  })

  test('mixed notation', () => {
    expect(parseKeyNotation('<C-n>j')).toEqual(['C-n', 'j'])
    expect(parseKeyNotation('g<C-n>')).toEqual(['g', 'C-n'])
  })

  test('modifier with special key: <C-Space>', () => {
    expect(parseKeyNotation('<C-Space>')).toEqual(['C-space'])
  })
})

describe('rawSequenceToChord', () => {
  test('raw Ctrl+Z (0x1a)', () => {
    expect(rawSequenceToChord('\x1a')).toBe('C-z')
  })

  test('raw Ctrl+W (0x17)', () => {
    expect(rawSequenceToChord('\x17')).toBe('C-w')
  })

  test('raw Ctrl+B (0x02)', () => {
    expect(rawSequenceToChord('\x02')).toBe('C-b')
  })

  test('raw Ctrl+A (0x01)', () => {
    expect(rawSequenceToChord('\x01')).toBe('C-a')
  })

  test('Kitty Ctrl+Z', () => {
    expect(rawSequenceToChord('\x1b[122;5u')).toBe('C-z')
  })

  test('Kitty Ctrl+W', () => {
    expect(rawSequenceToChord('\x1b[119;5u')).toBe('C-w')
  })

  test('Kitty Ctrl+B', () => {
    expect(rawSequenceToChord('\x1b[98;5u')).toBe('C-b')
  })

  test('printable lowercase letter', () => {
    expect(rawSequenceToChord('d')).toBe('d')
    expect(rawSequenceToChord('a')).toBe('a')
  })

  test('printable uppercase letter', () => {
    expect(rawSequenceToChord('A')).toBe('A')
    expect(rawSequenceToChord('D')).toBe('D')
  })

  test('printable digits and symbols', () => {
    expect(rawSequenceToChord('1')).toBe('1')
    expect(rawSequenceToChord('?')).toBe('?')
    expect(rawSequenceToChord('|')).toBe('|')
    expect(rawSequenceToChord('-')).toBe('-')
  })

  test('space returns " "', () => {
    expect(rawSequenceToChord(' ')).toBe(' ')
  })

  test('DEL byte (0x7f) maps to backspace', () => {
    expect(rawSequenceToChord('\x7f')).toBe('backspace')
  })

  test('unknown multi-byte sequences return null (arrow keys etc.)', () => {
    expect(rawSequenceToChord('\x1b[A')).toBeNull()
    expect(rawSequenceToChord('\x1b[B')).toBeNull()
    expect(rawSequenceToChord('hello')).toBeNull()
  })

  test('Kitty without ctrl modifier returns null', () => {
    expect(rawSequenceToChord('\x1b[122;1u')).toBeNull()
  })

  test('Kitty with alt modifier returns null (not supported)', () => {
    // modifier 7 = ctrl + alt + shift → has alt, so null
    expect(rawSequenceToChord('\x1b[122;7u')).toBeNull()
  })
})
