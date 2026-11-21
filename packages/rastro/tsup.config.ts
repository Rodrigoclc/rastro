import { readFileSync } from 'node:fs'
import { defineConfig, type Options } from 'tsup'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

const shared: Options = {
  entry: ['src/index.ts', 'src/register.ts', 'src/adonis.ts'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  splitting: false,
  shims: false,
}

export default defineConfig([
  {
    ...shared,
    format: 'esm',
    dts: true,
    clean: true,
    define: { __ESM_BUILD__: 'true', __LIBRARY_VERSION__: JSON.stringify(version) },
  },
  {
    ...shared,
    format: 'cjs',
    dts: true, // gera os .d.cts: sem eles, quem usa require (Adonis 5) fica sem tipos
    define: { __ESM_BUILD__: 'false', __LIBRARY_VERSION__: JSON.stringify(version) },
  },
])
