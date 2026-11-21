# Rastro

Observabilidade pronta para APIs AdonisJS 5, 6 e 7: uma linha no PM2 e um `docker compose up`.

O repositório tem duas partes que evoluem juntas:

| Pasta | O que é | Onde roda |
|---|---|---|
| [`packages/rastro`](packages/rastro) | Biblioteca `@rodrigoclc/rastro`, que instrumenta APIs AdonisJS 5, 6 e 7 com OpenTelemetry | Em cada aplicação |
| [`server`](server) | Stack central: Caddy, OpenTelemetry Collector e Grafana LGTM, com dashboard e alertas prontos | Num servidor seu |

```
apps (Adonis 5/6/7) ──HTTPS + token──▶ Caddy ──▶ Collector ──▶ Tempo (traces)
                                                            ├─▶ Loki (logs)
                                                            └─▶ Prometheus (métricas)
equipe ──HTTPS + login──▶ Caddy ──▶ Grafana (lê os três)
```

## O que você recebe

- **Traces** de cada requisição HTTP, das queries no PostgreSQL e MySQL e das chamadas HTTP de saída.
- **Logs** do logger do Adonis (pino), com o `trace_id` da requisição em cada linha.
- **Métricas** de latência e status por rota, CPU e memória do processo, event loop, heap e GC.
- **Dashboard** "APIs · Visão geral" e **alertas** de taxa de erro 5xx, latência p95 e serviço que parou de enviar dados.

## Rastro ou `@adonisjs/otel`?

O AdonisJS tem uma integração oficial, o [`@adonisjs/otel`](https://www.npmjs.com/package/@adonisjs/otel), para Adonis 6 e 7. Se a sua aplicação está numa dessas versões e você já tem para onde mandar a telemetria, ele é uma boa escolha.

O Rastro faz sentido quando:

- você ainda tem APIs em **Adonis 5** (CommonJS) ou mistura versões, e quer a mesma instrumentação em todas;
- você quer o **servidor junto**: Collector com autenticação por token, Grafana, dashboard e alertas versionados, num `docker compose up`.

## Para conectar uma aplicação

Veja [`packages/rastro/README.md`](packages/rastro/README.md). Em resumo: instalar o pacote, preencher as variáveis de ambiente e adicionar uma flag no `ecosystem.config.js` do PM2.

## Para subir o servidor

Veja [`server/README.md`](server/README.md). Em resumo: DNS, `.env` e `docker compose up -d`.

## Onde cada decisão mora

| Quero mudar... | Onde |
|---|---|
| O que é coletado em todas as apps | `packages/rastro`, publicar versão nova |
| Um ajuste de uma app só | Variáveis `RASTRO_*` da app |
| Retenção, autenticação, filtros globais | `server/` |
| Dashboards | `server/scripts/build-dashboards.py` |
| Alertas | `server/grafana/provisioning/alerting/rastro.yaml` |
| Destino dos alertas (Slack, e-mail) | Tela do Grafana, em Alerting > Contact points |

## Decisões técnicas

- **Node 20 como piso.** O SDK OpenTelemetry mais recente exige Node 22.15. A biblioteca fica fixada na última linha compatível com Node 20.6 (SDK 0.223 / 2.12). Quando o Node 20 deixar de ser necessário, basta subir as versões em `packages/rastro/package.json`.
- **Métricas de requisição vêm da app, não dos traces.** Os traces são amostrados em produção. Métricas calculadas a partir deles contariam só a amostra. A biblioteca gera `http.server.request.duration` para todas as requisições, e é essa métrica que alimenta dashboards e alertas.
- **Tudo sai de dentro do processo.** Traces, métricas e logs vão por OTLP/HTTP. Nenhum agente é instalado nos servidores das apps, então servidor dedicado ou compartilhado não muda nada.
- **Um token por ambiente.** Produção e homologação vão para o mesmo Grafana, separadas pelo atributo `deployment.environment.name`.

## Desenvolvimento

```bash
pnpm install
pnpm test          # build + testes da biblioteca (ESM e CommonJS)

cd server
cp .env.example .env   # preencha tokens e senha
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
# Collector em http://localhost:4318 e Grafana em http://localhost:3000
```

## Licença

[MIT](LICENSE)
