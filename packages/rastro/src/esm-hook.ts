import * as nodeModule from 'node:module'

declare const __ESM_BUILD__: boolean

/**
 * Em ESM, as instrumentações só conseguem interceptar módulos importados
 * se o loader hook do import-in-the-middle estiver registrado. Em CommonJS
 * (Adonis 5) não é necessário: o hook de require já cobre tudo.
 */
export function registerEsmHook() {
  if (!__ESM_BUILD__) return
  if (process.env.RASTRO_ESM_HOOK === 'false') return
  const register = (nodeModule as { register?: (specifier: string, parentURL: string) => void }).register
  if (typeof register !== 'function') return
  // import.meta só existe no build ESM; o define do tsup remove este ramo no CJS.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)
}
