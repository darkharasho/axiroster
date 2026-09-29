import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// The renderer suite runs in the node environment (see vitest.config.ts), so the
// two browser globals the theme module touches are stubbed here rather than
// pulled in with jsdom for the sake of one file.
type FakeRoot = {
  attrs: Record<string, string>
  classes: Set<string>
  setAttribute: (k: string, v: string) => void
  removeAttribute: (k: string) => void
  classList: { add: (c: string) => void; remove: (c: string) => void }
}

function fakeRoot(): FakeRoot {
  const attrs: Record<string, string> = {}
  const classes = new Set<string>()
  return {
    attrs,
    classes,
    setAttribute: (k, v) => {
      attrs[k] = v
    },
    removeAttribute: (k) => {
      delete attrs[k]
    },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }
  }
}

let root: FakeRoot
let store: Map<string, string>

beforeEach(async () => {
  vi.resetModules()
  root = fakeRoot()
  store = new Map()
  vi.stubGlobal('document', { documentElement: root })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function load() {
  return import('./applyTheme')
}

describe('resolveSurfaceId', () => {
  it('defaults to flat when nothing is given', async () => {
    const { resolveSurfaceId, DEFAULT_SURFACE_ID } = await load()
    expect(DEFAULT_SURFACE_ID).toBe('flat')
    expect(resolveSurfaceId(null)).toBe('flat')
    expect(resolveSurfaceId(undefined)).toBe('flat')
  })

  it('passes through the ids the design language defines', async () => {
    const { resolveSurfaceId } = await load()
    expect(resolveSurfaceId('flat')).toBe('flat')
    expect(resolveSurfaceId('glass')).toBe('glass')
  })

  it('falls back to flat for a value it does not recognise', async () => {
    const { resolveSurfaceId } = await load()
    expect(resolveSurfaceId('frosted')).toBe('flat')
  })
})

describe('readSurface', () => {
  it('is flat when nothing has been stored', async () => {
    const { readSurface } = await load()
    expect(readSurface()).toBe('flat')
  })

  it('reads back a stored surface', async () => {
    store.set('axiroster.surface', 'glass')
    const { readSurface } = await load()
    expect(readSurface()).toBe('glass')
  })

  it('is flat when storage holds a value it does not recognise', async () => {
    store.set('axiroster.surface', 'frosted')
    const { readSurface } = await load()
    expect(readSurface()).toBe('flat')
  })

  it('is flat when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      }
    })
    const { readSurface } = await load()
    expect(readSurface()).toBe('flat')
  })
})

describe('applySurface', () => {
  it('puts glass on <html> and remembers it', async () => {
    const { applySurface } = await load()
    expect(applySurface('glass')).toBe('glass')
    expect(root.attrs['data-axi-theme']).toBe('glass')
    expect(store.get('axiroster.surface')).toBe('glass')
  })

  it('removes the attribute for flat rather than naming the main theme', async () => {
    const { applySurface } = await load()
    applySurface('glass')
    expect(applySurface('flat')).toBe('flat')
    expect(root.attrs['data-axi-theme']).toBeUndefined()
    expect(store.get('axiroster.surface')).toBe('flat')
  })

  it('crossfades so the whole app repaints together', async () => {
    const { applySurface } = await load()
    applySurface('glass')
    expect(root.classes.has('theme-transitioning')).toBe(true)
  })

  it('still applies the surface when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage disabled')
      }
    })
    const { applySurface } = await load()
    expect(applySurface('glass')).toBe('glass')
    expect(root.attrs['data-axi-theme']).toBe('glass')
  })
})
