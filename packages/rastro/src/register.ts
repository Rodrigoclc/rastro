/**
 * Ponto de entrada sem código: carregado pelo Node antes da aplicação.
 *
 *   ESM (Adonis 6/7):  node --import @rodrigoclc/rastro/register server.js
 *   CJS (Adonis 5):    node -r @rodrigoclc/rastro/register server.js
 */
import { registerEsmHook } from './esm-hook.js'
import { startOtel } from './sdk.js'

registerEsmHook()
startOtel()
