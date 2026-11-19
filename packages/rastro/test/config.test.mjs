import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig, isIgnoredPath, DEFAULT_IGNORED_ROUTES } from 'rastro'

test('ambiente vem de RASTRO_ENVIRONMENT, OTEL_RESOURCE_ATTRIBUTES ou NODE_ENV', () => {
  assert.equal(resolveConfig({ RASTRO_ENVIRONMENT: 'production', NODE_ENV: 'x' }).environment, 'production')
  assert.equal(resolveConfig({ OTEL_RESOURCE_ATTRIBUTES: 'a=b,deployment.environment=staging' }).environment, 'staging')
  assert.equal(resolveConfig({ NODE_ENV: 'production' }).environment, 'production')
  assert.equal(resolveConfig({}).environment, 'development')
})

test('namespace vem de RASTRO_SERVICE_NAMESPACE ou OTEL_RESOURCE_ATTRIBUTES, e é opcional', () => {
  assert.equal(resolveConfig({ RASTRO_SERVICE_NAMESPACE: 'loja' }).serviceNamespace, 'loja')
  assert.equal(resolveConfig({ OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=financeiro' }).serviceNamespace, 'financeiro')
  assert.equal(resolveConfig({}).serviceNamespace, undefined)
})

test('OTEL_RESOURCE_ATTRIBUTES vira atributos extras, ignorando pares inválidos', () => {
  assert.deepEqual(resolveConfig({ OTEL_RESOURCE_ATTRIBUTES: 'team=juridico, regiao=centro%20oeste,quebrado,x=%E0' }).resourceAttributes, {
    team: 'juridico',
    regiao: 'centro oeste',
  })
  assert.deepEqual(resolveConfig({}).resourceAttributes, {})
})

test('flags por app ligam e desligam sinais', () => {
  const config = resolveConfig({ RASTRO_LOGS: 'false', RASTRO_HOST_METRICS: '0' })
  assert.equal(config.logs, false)
  assert.equal(config.hostMetrics, false)
  assert.equal(config.traces, true)
  assert.equal(config.metrics, true)
})

test('rotas ignoradas somam ao padrão ou o substituem', () => {
  assert.deepEqual(resolveConfig({ RASTRO_IGNORE_ROUTES: '/webhook/ping' }).ignoreRoutes, [
    ...DEFAULT_IGNORED_ROUTES,
    '/webhook/ping',
  ])
  assert.deepEqual(
    resolveConfig({ RASTRO_IGNORE_ROUTES: '/x', RASTRO_IGNORE_ROUTES_REPLACE: 'true' }).ignoreRoutes,
    ['/x'],
  )
})

test('isIgnoredPath casa caminho exato e prefixo com /*', () => {
  assert.equal(isIgnoredPath('/health?probe=1', ['/health']), true)
  assert.equal(isIgnoredPath('/healthcheck', ['/health']), false)
  assert.equal(isIgnoredPath('/webhooks/a/b', ['/webhooks/*']), true)
  assert.equal(isIgnoredPath('/webhooks', ['/webhooks/*']), true)
  assert.equal(isIgnoredPath('/web', ['/webhooks/*']), false)
})
