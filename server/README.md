# Servidor de observabilidade

Stack central que recebe a telemetria de todas as APIs e mostra no Grafana.

| Serviço | Imagem | Papel |
|---|---|---|
| `caddy` | `caddy:2.11-alpine` | HTTPS automático (Let's Encrypt). Única porta exposta. |
| `collector` | `otel/opentelemetry-collector-contrib:0.165.0` | Valida o token, descarta dados sem dono, remove headers sensíveis e repassa. |
| `lgtm` | `grafana/otel-lgtm:0.40.0` | Tempo (traces), Loki (logs), Prometheus (métricas) e Grafana (tela). |

## Servidor

- 2 vCPU, 4 GB de RAM e 60 GB de disco para começar. O disco é o que cresce.
- Docker com o plugin `compose`.
- Portas 80 e 443 abertas. Nenhuma outra.
- Preferencialmente separado das aplicações, para a observabilidade não cair junto com elas.

## Subir pela primeira vez

1. **DNS.** Crie dois registros A apontando para o servidor, por exemplo `otel.example.com` e `grafana.example.com`.
2. **Clonar e configurar.**
   ```bash
   git clone https://github.com/Rodrigoclc/rastro.git
   cd rastro/server
   cp .env.example .env
   openssl rand -hex 32   # rode duas vezes: um token para produção, outro para homologação
   ```
   Preencha o `.env` com domínios, e-mail, os dois tokens e a senha do Grafana.
3. **Subir.**
   ```bash
   docker compose up -d
   ```
4. **Conferir.** Um token válido deve receber `200`; sem token, `401`.
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://otel.example.com/v1/traces \
     -H "Authorization: Bearer $OTEL_TOKEN_PRODUCTION" -H 'content-type: application/json' -d '{}'
   ```
5. **Entrar no Grafana** em `https://grafana.example.com` com o usuário e a senha do `.env`. O dashboard fica em Dashboards > Rastro > APIs · Visão geral.
6. **Destino dos alertas.** Em Alerting > Contact points, edite o `default-email` ou crie um contact point de Slack ou Discord e coloque-o na política padrão (Alerting > Notification policies).

A senha do `.env` só vale na primeira subida. Depois, troque pela tela do Grafana.

## Alertas provisionados

Todos avaliam só `production`.

| Alerta | Condição |
|---|---|
| Taxa de erro 5xx alta | Mais de 5% de 5xx por 5 minutos, com tráfego mínimo de 3 req/min |
| Latência p95 alta | p95 acima de 2s por 10 minutos |
| Serviço parou de enviar dados | Enviou nas últimas 6h e nada nos últimos 10 minutos |

Para mudar limites, edite `grafana/provisioning/alerting/rastro.yaml` e reinicie o `lgtm`.

## Dashboards

Os dashboards são gerados por `scripts/build-dashboards.py` e ficam em `grafana/dashboards/`. Edições na tela do Grafana não são salvas, porque o dashboard é provisionado. Para mudar:

```bash
python3 scripts/build-dashboards.py
docker compose restart lgtm
```

Para experimentar um painel novo, use Dashboards > New e depois traga o JSON para o gerador.

## Retenção

| Dado | Tempo | Onde mudar |
|---|---|---|
| Traces | 7 dias | `lgtm/tempo-config.yaml`, `block_retention` |
| Logs | 15 dias | `lgtm/loki-config.yaml`, `retention_period` |
| Métricas | 30 dias | `.env`, `METRICS_RETENTION` |

## Backup

Telemetria é descartável. O que importa é o banco do Grafana: usuários, contact points e ajustes feitos na tela.

```bash
./scripts/backup-grafana.sh /caminho/do/backup
```

Agende no cron do servidor, por exemplo todo dia às 3h:

```cron
0 3 * * * cd /opt/rastro/server && ./scripts/backup-grafana.sh /var/backups/grafana
```

## Atualizar

1. Troque a tag da imagem no `docker-compose.yml`.
2. Ao atualizar o `lgtm`, compare `lgtm/tempo-config.yaml` e `lgtm/loki-config.yaml` com os da imagem nova:
   ```bash
   docker run --rm --entrypoint cat grafana/otel-lgtm:<versão> /otel-lgtm/tempo-config.yaml
   ```
3. `docker compose pull && docker compose up -d`.

As aplicações não percebem. Durante o restart, os lotes que falharem são descartados por elas.

## Rodar na sua máquina

```bash
cp .env.example .env   # preencha tokens e senha com qualquer valor
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

Collector em `http://localhost:4318` e Grafana em `http://localhost:3000`. Para apontar uma app local:

```ini
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <OTEL_TOKEN_STAGING do .env>
RASTRO_ENVIRONMENT=staging
```
