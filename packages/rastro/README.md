# Rastro

Instrumentação OpenTelemetry plug and play para APIs AdonisJS 5, 6 e 7. Faz parte do [Rastro](https://github.com/Rodrigoclc/rastro), que traz também o servidor com Collector, Grafana, dashboards e alertas.

Sem alterar código da aplicação, ela envia:

- **Traces** de cada requisição HTTP, das queries no PostgreSQL e MySQL e das chamadas HTTP de saída (`http`, `axios`, `fetch`).
- **Logs** do logger do Adonis (pino), com o `trace_id` da requisição em cada linha.
- **Métricas** de latência e status por rota, CPU e memória do processo, event loop, heap e GC.

Requer Node 20.6 ou superior.

## 1. Instalar

```bash
pnpm add @rodrigoclc/rastro   # ou npm install @rodrigoclc/rastro / yarn add @rodrigoclc/rastro
```

## 2. Configurar o ambiente

No `.env` da aplicação:

```ini
OTEL_SERVICE_NAME=minha-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token do ambiente>
RASTRO_ENVIRONMENT=production
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

Em homologação, use o token de homologação, `RASTRO_ENVIRONMENT=staging` e `OTEL_TRACES_SAMPLER_ARG=1`.

Nos testes (`.env.test`):

```ini
OTEL_SDK_DISABLED=true
```

`OTEL_SERVICE_NAME` precisa ser único por aplicação. Sem ele, a telemetria fica desligada e a biblioteca avisa no console.

## 3. Carregar antes da aplicação

A biblioteca precisa ser carregada antes do Adonis e dos drivers de banco. No `ecosystem.config.js` do PM2:

```js
// Adonis 6 e 7 (ESM)
node_args: '--import @rodrigoclc/rastro/register',

// Adonis 5 (CommonJS)
node_args: '-r @rodrigoclc/rastro/register',
```

Sem PM2, a mesma flag vai na linha de comando: `node --import @rodrigoclc/rastro/register build/bin/server.js`.

Alternativa sem mexer no PM2, para Adonis 6 e 7: coloque como primeira linha de `bin/server.ts`:

```ts
await import('@rodrigoclc/rastro/register')
```

Pronto. Traces, logs e métricas já estão sendo enviados.

## 4. Opcional: nome de rota nos spans e métricas

Sem o middleware, os spans se chamam só `GET` e as métricas não separam por rota. Com ele, viram `GET /calculations/:id`.

**Adonis 6 e 7**, em `start/kernel.ts`:

```ts
router.use([
  () => import('@rodrigoclc/rastro/adonis'),
  // ...demais middlewares
])
```

**Adonis 5**, em `start/kernel.ts`:

```ts
Server.middleware.register([
  () => import('@rodrigoclc/rastro/adonis'),
  // ...demais middlewares
])
```

O middleware também grava `enduser.id` com o id do usuário autenticado. Para adicionar atributos de negócio, crie um middleware próprio:

```ts
// app/middleware/otel_middleware.ts
import { createOtelMiddleware } from '@rodrigoclc/rastro/adonis'

export default createOtelMiddleware({
  attributes: (ctx) => ({ 'organization.id': String(ctx.organization?.id ?? '') }),
})
```

Não envie dados pessoais como e-mail, CPF ou nome.

## 5. Opcional: spans manuais

Para medir um trecho específico, use a API padrão do OpenTelemetry. O span entra no trace da requisição sem nenhuma configuração.

```ts
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('minha-api')

await tracer.startActiveSpan('calcular-juros', async (span) => {
  try {
    span.setAttribute('calculation.id', calculation.id)
    return await calcularJuros(calculation)
  } finally {
    span.end()
  }
})
```

Jobs agendados (`node-schedule`, cron) não têm requisição HTTP. Envolva a execução em `startActiveSpan` para que as queries do job apareçam num trace.

## Variáveis de ambiente

Padrão do OpenTelemetry, lidas pelo SDK:

| Variável | Uso |
|---|---|
| `OTEL_SERVICE_NAME` | Nome do serviço. Obrigatório. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL do Collector central. |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Bearer <token>`. |
| `OTEL_TRACES_SAMPLER` | Use `parentbased_traceidratio`. |
| `OTEL_TRACES_SAMPLER_ARG` | Fração de traces guardados. `0.1` é 10%. |
| `OTEL_SDK_DISABLED` | `true` desliga tudo. |
| `OTEL_RESOURCE_ATTRIBUTES` | Atributos extras, como `team=juridico`. |

Do Rastro, para ajustes por aplicação:

| Variável | Padrão | Uso |
|---|---|---|
| `RASTRO_ENVIRONMENT` | `NODE_ENV` | `production` ou `staging`. |
| `RASTRO_TRACES` | `true` | Liga ou desliga traces. |
| `RASTRO_METRICS` | `true` | Liga ou desliga métricas. |
| `RASTRO_LOGS` | `true` | Liga ou desliga envio de logs. A correlação com o trace continua. |
| `RASTRO_HOST_METRICS` | `true` | CPU e memória do processo. |
| `RASTRO_IGNORE_ROUTES` | vazio | Caminhos a ignorar, separados por vírgula. `/webhooks/*` ignora o prefixo. Soma aos padrões `/health`, `/healthz`, `/ready`, `/metrics` e `/favicon.ico`. |
| `RASTRO_IGNORE_ROUTES_REPLACE` | `false` | `true` substitui os padrões em vez de somar. |
| `RASTRO_METRICS_INTERVAL_MS` | `60000` | Intervalo de envio de métricas. |
| `RASTRO_SHUTDOWN_TIMEOUT_MS` | `2000` | Tempo máximo esperando o envio final ao encerrar. |
| `RASTRO_SERVICE_VERSION` | `version` do `package.json` | Versão exibida nos traces. |
| `RASTRO_SERVICE_NAMESPACE` | vazio | Grupo do serviço (`service.namespace`), como o nome da empresa ou do produto. |
| `RASTRO_DISABLED` | `false` | `true` desliga tudo, como `OTEL_SDK_DISABLED`. |
| `RASTRO_DEBUG` | `false` | Log interno do SDK no console. |
| `RASTRO_ESM_HOOK` | `true` | `false` desliga o loader hook ESM, se ele conflitar com algum pacote. |

## Garantias

- **Coletor fora do ar não derruba a aplicação.** O envio é em segundo plano. Se falhar, os dados são descartados.
- **O encerramento não fica preso.** No SIGTERM, a biblioteca tenta enviar o que está em memória por no máximo 2 segundos.
- **Nada sensível por padrão.** Sem corpo de requisição, sem headers, sem parâmetros de query SQL e sem a linha de comando do processo.

## O que fica de fora

- **Knex.** As queries do Lucid já aparecem pelo driver `pg` ou `mysql2`, com o SQL completo. Instrumentar o Knex duplicaria cada query.
- **Métricas de sistema** (CPU e disco do servidor inteiro). Num servidor compartilhado, todas as apps enviariam o mesmo número. Se precisar, instale um Collector agente no host.

## Desenvolvimento

```bash
pnpm install
pnpm test   # build + testes em ESM e CommonJS com um coletor falso
```

Para publicar uma versão nova, atualize `version` no `package.json`, faça merge na `main` e crie a tag `v<versão>`. O GitHub Actions roda os testes e publica no npm.
