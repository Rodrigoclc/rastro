import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Configuração resolvida a partir das variáveis de ambiente.
 *
 * As variáveis padrão do OpenTelemetry (OTEL_EXPORTER_OTLP_ENDPOINT,
 * OTEL_EXPORTER_OTLP_HEADERS, OTEL_TRACES_SAMPLER, OTEL_TRACES_SAMPLER_ARG...)
 * são lidas diretamente pelo SDK. Aqui ficam só as decisões do Rastro,
 * sempre com o prefixo RASTRO_.
 */
export interface RastroConfig {
  disabled: boolean
  serviceName: string | undefined
  serviceVersion: string | undefined
  serviceNamespace: string | undefined
  /** Atributos extras de OTEL_RESOURCE_ATTRIBUTES (ex.: team=juridico). */
  resourceAttributes: Record<string, string>
  environment: string
  traces: boolean
  metrics: boolean
  logs: boolean
  hostMetrics: boolean
  ignoreRoutes: string[]
  metricsIntervalMs: number
  shutdownTimeoutMs: number
  debug: boolean
}

export const DEFAULT_IGNORED_ROUTES = ['/health', '/healthz', '/ready', '/metrics', '/favicon.ico']

type Env = Record<string, string | undefined>

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function list(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function resourceAttributes(env: Env): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const pair of list(env.OTEL_RESOURCE_ATTRIBUTES)) {
    const index = pair.indexOf('=')
    if (index <= 0) continue
    try {
      attributes[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim())
    } catch {
      // Valor mal codificado: ignora só esse atributo.
    }
  }
  return attributes
}

function resourceAttribute(env: Env, key: string): string | undefined {
  return resourceAttributes(env)[key]
}

function packageVersion(cwd: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

export function resolveConfig(env: Env = process.env, cwd: string = process.cwd()): RastroConfig {
  const environment =
    env.RASTRO_ENVIRONMENT ||
    resourceAttribute(env, 'deployment.environment.name') ||
    resourceAttribute(env, 'deployment.environment') ||
    env.NODE_ENV ||
    'development'

  const extraIgnored = list(env.RASTRO_IGNORE_ROUTES)
  const replaceDefaults = bool(env.RASTRO_IGNORE_ROUTES_REPLACE, false)

  return {
    disabled: bool(env.OTEL_SDK_DISABLED, false) || bool(env.RASTRO_DISABLED, false),
    serviceName: env.OTEL_SERVICE_NAME || resourceAttribute(env, 'service.name'),
    serviceVersion: env.RASTRO_SERVICE_VERSION || packageVersion(cwd),
    serviceNamespace: env.RASTRO_SERVICE_NAMESPACE || resourceAttribute(env, 'service.namespace'),
    resourceAttributes: resourceAttributes(env),
    environment,
    traces: bool(env.RASTRO_TRACES, true),
    metrics: bool(env.RASTRO_METRICS, true),
    logs: bool(env.RASTRO_LOGS, true),
    hostMetrics: bool(env.RASTRO_HOST_METRICS, true),
    ignoreRoutes: replaceDefaults ? extraIgnored : [...DEFAULT_IGNORED_ROUTES, ...extraIgnored],
    metricsIntervalMs: Number(env.RASTRO_METRICS_INTERVAL_MS) || 60_000,
    shutdownTimeoutMs: Number(env.RASTRO_SHUTDOWN_TIMEOUT_MS) || 2_000,
    debug: bool(env.RASTRO_DEBUG, false),
  }
}

/**
 * Uma rota ignorada casa pelo caminho exato ou como prefixo terminado em "/*".
 * Ex.: "/health" ignora "/health" e "/health?x=1"; "/webhooks/*" ignora tudo abaixo.
 */
export function isIgnoredPath(url: string | undefined, ignored: string[]): boolean {
  if (!url) return false
  const path = url.split('?')[0]
  return ignored.some((rule) => {
    if (rule.endsWith('/*')) return path.startsWith(rule.slice(0, -1)) || path === rule.slice(0, -2)
    return path === rule
  })
}
