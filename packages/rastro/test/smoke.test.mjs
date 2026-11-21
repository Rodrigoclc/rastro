import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

/** Coletor OTLP falso: guarda o JSON recebido em cada sinal. */
function startCollector() {
  const received = { traces: [], metrics: [], logs: [], headers: [] }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const signal = req.url.replace('/v1/', '')
      received.headers.push(req.headers.authorization)
      if (received[signal]) received[signal].push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port })),
  )
}

function runApp(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: fixtures, env: { ...process.env, ...env }, stdio: 'pipe' })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`app não encerrou sozinha:\n${output}`))
    }, 15_000)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, output })
    })
  })
}

const spans = (received) =>
  received.traces.flatMap((t) =>
    t.resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans.map((s) => ({ ...s, resource: rs.resource })))),
  )
const attr = (item, key) => {
  const found = item.attributes?.find((a) => a.key === key)
  if (!found) return undefined
  const v = found.value
  return v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue
}
const logRecords = (received) =>
  received.logs.flatMap((l) => l.resourceLogs.flatMap((rl) => rl.scopeLogs.flatMap((sl) => sl.logRecords)))
const metricNames = (received) =>
  new Set(
    received.metrics.flatMap((m) =>
      m.resourceMetrics.flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((x) => x.name))),
    ),
  )

for (const [label, args] of [
  ['ESM (Adonis 6/7)', ['--import', '@rodrigoclc/rastro/register', 'app.mjs']],
  ['CommonJS (Adonis 5)', ['-r', '@rodrigoclc/rastro/register', 'app.cjs']],
]) {
  test(`${label}: envia traces, logs e métricas com rota e ambiente`, async () => {
    const { server, received, port } = await startCollector()
    try {
      const result = await runApp(args, {
        OTEL_SERVICE_NAME: 'smoke-api',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token-teste',
        OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=staging,team=juridico',
        RASTRO_METRICS_INTERVAL_MS: '500',
      })
      assert.equal(result.signal, 'SIGTERM', `processo deveria sair pelo SIGTERM:\n${result.output}`)

      const serverSpans = spans(received).filter((s) => s.kind === 2)
      assert.equal(serverSpans.length, 1, 'só a rota de negócio vira span; /health é ignorada')
      const [span] = serverSpans
      assert.equal(span.name, 'GET /calculations/:id')
      assert.equal(attr(span, 'http.route'), '/calculations/:id')
      assert.equal(attr(span, 'enduser.id'), '42')
      assert.equal(attr(span, 'organization.id'), '7')
      assert.equal(span.status.code, 2, 'status 500 marca o span como erro')
      assert.equal(attr(span.resource, 'service.name'), 'smoke-api')
      assert.equal(attr(span.resource, 'deployment.environment.name'), 'staging')
      assert.equal(attr(span.resource, 'team'), 'juridico', 'atributo extra de OTEL_RESOURCE_ATTRIBUTES chega ao resource')
      assert.ok(attr(span.resource, 'service.instance.id'))

      const clientSpans = spans(received).filter((s) => s.kind === 3)
      assert.ok(clientSpans.length >= 1, 'fetch de saída gera span de cliente')

      const logs = logRecords(received)
      const errorLog = logs.find((l) => l.body?.stringValue === 'falha ao gerar pdf')
      assert.ok(errorLog, `log do pino deveria chegar via OTLP:\n${result.output}`)
      assert.equal(errorLog.traceId, span.traceId, 'log carrega o trace id da requisição')

      const names = metricNames(received)
      assert.ok(names.has('http.server.request.duration'), [...names].join(', '))
      const durationPoints = received.metrics.flatMap((m) =>
        m.resourceMetrics.flatMap((rm) =>
          rm.scopeMetrics.flatMap((sm) =>
            sm.metrics.filter((x) => x.name === 'http.server.request.duration').flatMap((x) => x.histogram.dataPoints),
          ),
        ),
      )
      assert.ok(
        durationPoints.some((p) => attr(p, 'http.route') === '/calculations/:id' && attr(p, 'http.response.status_code') == 500),
        'métrica de latência sai com a rota e o status',
      )
      assert.ok(names.has('process.cpu.utilization') || names.has('process.cpu.time'), [...names].join(', '))
      assert.ok([...names].some((n) => n.startsWith('nodejs.eventloop')), [...names].join(', '))

      assert.ok(received.headers.every((h) => h === 'Bearer token-teste'))
    } finally {
      server.close()
    }
  })
}

test('OTEL_SDK_DISABLED desliga tudo sem quebrar a app', async () => {
  const { server, received, port } = await startCollector()
  try {
    const result = await runApp(['--import', '@rodrigoclc/rastro/register', 'app.mjs'], {
      OTEL_SERVICE_NAME: 'smoke-api',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_SDK_DISABLED: 'true',
    })
    assert.equal(result.signal, 'SIGTERM')
    assert.equal(received.traces.length + received.logs.length + received.metrics.length, 0)
  } finally {
    server.close()
  }
})

test('sem OTEL_SERVICE_NAME a telemetria desliga com aviso', async () => {
  const result = await runApp(['--import', '@rodrigoclc/rastro/register', 'app.mjs'], {
    OTEL_SERVICE_NAME: '',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
  })
  assert.equal(result.signal, 'SIGTERM')
  assert.match(result.output, /OTEL_SERVICE_NAME não definido/)
})

test('coletor fora do ar não derruba nem trava a app', async () => {
  const started = Date.now()
  const result = await runApp(['--import', '@rodrigoclc/rastro/register', 'app.mjs'], {
    OTEL_SERVICE_NAME: 'smoke-api',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
  })
  assert.equal(result.signal, 'SIGTERM', result.output)
  assert.ok(Date.now() - started < 5_000, 'encerramento limitado pelo timeout de shutdown')
})
