import { hostname } from 'node:os'
import { diag, DiagConsoleLogger, DiagLogLevel, metrics } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { MySQL2Instrumentation } from '@opentelemetry/instrumentation-mysql2'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import { HostMetrics } from '@opentelemetry/host-metrics'
import type { Instrumentation } from '@opentelemetry/instrumentation'
import { isIgnoredPath, resolveConfig, type RastroConfig } from './config.js'
import { LIBRARY_NAME, LIBRARY_VERSION } from './version.js'

export interface StartOtelOptions {
  /** Sobrescreve valores lidos do ambiente. Útil em testes. */
  config?: Partial<RastroConfig>
  /** Instrumentações extras específicas de uma aplicação. */
  instrumentations?: Instrumentation[]
}

export interface RastroHandle {
  config: RastroConfig
  shutdown: () => Promise<void>
}

const GLOBAL_KEY = Symbol.for('rastro')
type GlobalWithOtel = typeof globalThis & { [GLOBAL_KEY]?: RastroHandle }

const noop: RastroHandle['shutdown'] = async () => {}

/**
 * Inicializa o OpenTelemetry. É idempotente: chamar duas vezes devolve a
 * mesma instância. Precisa rodar antes de o framework e os drivers de banco
 * serem importados, por isso o caminho recomendado é `--import`/`-r` do
 * `rastro/register`.
 */
export function startOtel(options: StartOtelOptions = {}): RastroHandle {
  const globalRef = globalThis as GlobalWithOtel
  const existing = globalRef[GLOBAL_KEY]
  if (existing) return existing

  const config = { ...resolveConfig(), ...options.config }

  if (config.debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)
  }

  if (config.disabled) {
    return (globalRef[GLOBAL_KEY] = { config, shutdown: noop })
  }

  if (!config.serviceName) {
    console.warn(`[${LIBRARY_NAME}] OTEL_SERVICE_NAME não definido. Telemetria desativada.`)
    return (globalRef[GLOBAL_KEY] = { config: { ...config, disabled: true }, shutdown: noop })
  }

  const instanceId = process.env.pm_id !== undefined
    ? `${hostname()}:pm2-${process.env.pm_id}`
    : `${hostname()}:${process.pid}`

  const resource = resourceFromAttributes({
    // Os detectores do SDK ficam desligados (ver resourceDetectors abaixo), então os
    // atributos de OTEL_RESOURCE_ATTRIBUTES entram aqui. Os da biblioteca vêm depois e prevalecem.
    ...config.resourceAttributes,
    'service.name': config.serviceName,
    ...(config.serviceVersion ? { 'service.version': config.serviceVersion } : {}),
    'service.instance.id': instanceId,
    ...(config.serviceNamespace ? { 'service.namespace': config.serviceNamespace } : {}),
    'deployment.environment.name': config.environment,
    // Atributo antigo mantido para dashboards e consultas que ainda o usam.
    'deployment.environment': config.environment,
    'telemetry.distro.name': LIBRARY_NAME,
    'telemetry.distro.version': LIBRARY_VERSION,
  })

  const instrumentations: Instrumentation[] = [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => isIgnoredPath(request.url, config.ignoreRoutes),
    }),
    new UndiciInstrumentation(),
    new PgInstrumentation({ requireParentSpan: true, enhancedDatabaseReporting: false }),
    new MySQL2Instrumentation(),
    new PinoInstrumentation({ disableLogSending: !config.logs }),
    ...(config.metrics ? [new RuntimeNodeInstrumentation()] : []),
    ...(options.instrumentations ?? []),
  ]

  const sdk = new NodeSDK({
    resource,
    // Só os detectores que não vazam dados sensíveis (o detector de processo
    // grava a linha de comando inteira, que pode conter segredos).
    resourceDetectors: [],
    instrumentations,
    spanProcessors: config.traces ? [new BatchSpanProcessor(new OTLPTraceExporter())] : [],
    metricReaders: config.metrics
      ? [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            exportIntervalMillis: config.metricsIntervalMs,
          }),
        ]
      : [],
    logRecordProcessors: config.logs ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })] : [],
  })

  sdk.start()

  if (config.metrics && config.hostMetrics) {
    // Só métricas do próprio processo: num servidor compartilhado, as de
    // sistema seriam repetidas por todas as apps do host.
    new HostMetrics({
      meterProvider: metrics.getMeterProvider(),
      metricGroups: ['process.cpu', 'process.memory'],
    }).start()
  }

  let stopping: Promise<void> | undefined
  const shutdown = () => {
    // Com o coletor fora do ar o flush esperaria os timeouts de exportação.
    // O encerramento da aplicação nunca deve ficar refém da telemetria.
    stopping ??= Promise.race([
      sdk.shutdown().catch((error) => {
        diag.error(`[${LIBRARY_NAME}] falha ao encerrar`, error)
      }),
      new Promise<void>((resolve) => setTimeout(resolve, config.shutdownTimeoutMs).unref()),
    ])
    return stopping
  }

  // Envia o que estiver em memória antes de o processo sair. Não chama
  // process.exit: o framework (Adonis, PM2) continua dono do encerramento.
  process.once('beforeExit', () => void shutdown())
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.prependOnceListener(signal, () => {
      // Registrar um ouvinte desliga o comportamento padrão do Node (sair).
      // Se a aplicação não trata o sinal, devolvemos o sinal após o flush.
      const appHandlesSignal = process.listenerCount(signal) > 0
      void shutdown().finally(() => {
        if (!appHandlesSignal) process.kill(process.pid, signal)
      })
    })
  }

  return (globalRef[GLOBAL_KEY] = { config, shutdown })
}

export function getOtel(): RastroHandle | undefined {
  return (globalThis as GlobalWithOtel)[GLOBAL_KEY]
}
