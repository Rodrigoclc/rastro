import { context, trace, type Attributes } from '@opentelemetry/api'
import { getRPCMetadata, RPCType } from '@opentelemetry/core'

/**
 * Formato mínimo do HttpContext comum ao AdonisJS 5, 6 e 7.
 * Evita depender dos tipos de uma versão específica do framework.
 * Sem index signature: o `HttpContext` real (uma classe) precisa caber aqui,
 * como em `createOtelMiddleware<HttpContext>()`.
 */
export interface AdonisLikeContext {
  request: { method(): string }
  route?: { pattern?: string } | null
  auth?: { user?: { id?: unknown } | null } | null
}

export interface OtelMiddlewareOptions<Ctx extends AdonisLikeContext = AdonisLikeContext> {
  /**
   * Atributos extras de negócio adicionados ao span da requisição.
   * Roda depois do restante da cadeia, então `ctx.auth.user` já existe.
   * Não devolva dados pessoais (e-mail, CPF, nome).
   */
  attributes?: (ctx: Ctx) => Attributes | undefined
  /** Grava `enduser.id` a partir de `ctx.auth.user.id`. Padrão: true. */
  userId?: boolean
}

function userIdOf(ctx: AdonisLikeContext): string | undefined {
  try {
    const id = ctx.auth?.user?.id
    return id === undefined || id === null ? undefined : String(id)
  } catch {
    return undefined
  }
}

/**
 * Cria o middleware que dá nome de rota aos spans HTTP
 * ("GET /calculations/:id" em vez de "GET") e às métricas de latência.
 *
 * Funciona como middleware de servidor ou de router, nas versões 5, 6 e 7.
 */
export function createOtelMiddleware<Ctx extends AdonisLikeContext = AdonisLikeContext>(
  options: OtelMiddlewareOptions<Ctx> = {},
) {
  const withUserId = options.userId ?? true

  return class RastroMiddleware {
    async handle(ctx: Ctx, next: () => Promise<unknown>) {
      const span = trace.getActiveSpan()
      const rpcMetadata = getRPCMetadata(context.active())

      const applyRoute = () => {
        const pattern = ctx.route?.pattern
        if (!pattern) return
        if (rpcMetadata?.type === RPCType.HTTP) rpcMetadata.route = pattern
        span?.setAttribute('http.route', pattern)
        span?.updateName(`${ctx.request.method()} ${pattern}`)
      }

      // Middleware de router: a rota já está resolvida aqui.
      applyRoute()

      try {
        return await next()
      } finally {
        // Middleware de servidor: a rota só é resolvida depois de next().
        applyRoute()

        if (span) {
          if (withUserId) {
            const userId = userIdOf(ctx)
            if (userId) span.setAttribute('enduser.id', userId)
          }
          try {
            const extra = options.attributes?.(ctx)
            if (extra) span.setAttributes(extra)
          } catch {
            // Atributos de negócio nunca podem derrubar a requisição.
          }
        }
      }
    }
  }
}

/** Middleware pronto, com o comportamento padrão. */
const RastroMiddleware = createOtelMiddleware()
export default RastroMiddleware
