import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

function tags(source) {
  const result = []
  const re = /<(input|textarea)\b/g
  let match
  while ((match = re.exec(source))) {
    let index = match.index + match[0].length
    let quote = ''
    for (; index < source.length; index++) {
      const char = source[index]
      if (quote) {
        if (char === quote && source[index - 1] !== '\\') quote = ''
      } else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
    }
    result.push({ start: match.index, text: source.slice(match.index, index + 1) })
  }
  return result
}

function has(tag, name) {
  return new RegExp('\\b' + name + '(?:=|\\s|$)').test(tag)
}

function hasBare(tag, name) {
  return new RegExp('(?:^|\\s)' + name + '(?=\\s|=|/?>)').test(tag)
}

test('customer portal free-text inputs carry explicit length limits', async () => {
  const violations = []
  for (const file of await walk(new URL('.', import.meta.url).pathname)) {
    const source = await readFile(file, 'utf8')
    for (const tag of tags(source)) {
      const type = (tag.text.match(/\btype="([^"]*)"/) || [])[1] || 'text'
      if (has(tag.text, 'maxlength')) continue
      if (hasBare(tag.text, 'readonly') || hasBare(tag.text, 'disabled')) continue
      if (['checkbox', 'radio', 'file', 'date', 'datetime-local', 'number', 'hidden'].includes(type)) continue
      if (/:type="[^"]*'number'/.test(tag.text)) continue
      violations.push(file.replace(new URL('.', import.meta.url).pathname, '') + ':' + (source.slice(0, tag.start).split('\n').length) + ' ' + tag.text.replace(/\s+/g, ' ').slice(0, 140))
    }
  }
  assert.deepEqual(violations, [], 'customer portal inputs without maxlength:\n' + violations.join('\n'))
})
