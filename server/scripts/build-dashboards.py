#!/usr/bin/env python3
"""Gera os dashboards JSON do Grafana em grafana/dashboards/.

Editar aqui e rodar `python3 scripts/build-dashboards.py` mantém o JSON
consistente. Edições feitas na tela do Grafana não são salvas (provisionado).
"""
import json
from pathlib import Path

PROM = {"type": "prometheus", "uid": "prometheus"}
LOKI = {"type": "loki", "uid": "loki"}
TEMPO = {"type": "tempo", "uid": "tempo"}

SEL = 'deployment_environment_name="$env", service_name=~"$service"'
REQ = f"http_server_request_duration_seconds_count{{{SEL}}}"
ERR = f'http_server_request_duration_seconds_count{{{SEL}, http_response_status_code=~"5.."}}'
BUCKET = f"http_server_request_duration_seconds_bucket{{{SEL}}}"
RI = "$__rate_interval"

_next_id = 0


def pid():
    global _next_id
    _next_id += 1
    return _next_id


def target(expr, legend="", ref="A", instant=False, fmt="time_series"):
    t = {"datasource": PROM, "expr": expr, "refId": ref, "legendFormat": legend, "format": fmt}
    if instant:
        t.update(instant=True, range=False)
    return t


def stat(title, expr, unit, x, w=6, thresholds=None, decimals=None):
    steps = thresholds or [{"color": "green", "value": None}]
    p = {
        "id": pid(), "type": "stat", "title": title, "datasource": PROM,
        "gridPos": {"x": x, "y": 0, "w": w, "h": 4},
        "targets": [target(expr)],
        "fieldConfig": {"defaults": {"unit": unit, "thresholds": {"mode": "absolute", "steps": steps}}, "overrides": []},
        "options": {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "background", "graphMode": "area"},
    }
    if decimals is not None:
        p["fieldConfig"]["defaults"]["decimals"] = decimals
    return p


def series(title, targets, unit, x, y, w=8, h=8, desc=""):
    return {
        "id": pid(), "type": "timeseries", "title": title, "description": desc, "datasource": PROM,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": targets,
        "fieldConfig": {"defaults": {"unit": unit, "custom": {"fillOpacity": 10, "showPoints": "never"}}, "overrides": []},
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi", "sort": "desc"}},
    }


def row(title, y):
    return {"id": pid(), "type": "row", "title": title, "collapsed": False, "gridPos": {"x": 0, "y": y, "w": 24, "h": 1}, "panels": []}


def overview():
    panels = [
        stat("Requisições/s", f"sum(rate({REQ}[{RI}]))", "reqps", 0),
        stat(
            "Taxa de erro 5xx",
            f"sum(rate({ERR}[{RI}])) / sum(rate({REQ}[{RI}])) or vector(0)",
            "percentunit", 6, decimals=2,
            thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 0.01}, {"color": "red", "value": 0.05}],
        ),
        stat(
            "Latência p95",
            f"histogram_quantile(0.95, sum by (le) (rate({BUCKET}[{RI}])))",
            "s", 12,
            thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 2}],
        ),
        stat(
            "Instâncias enviando dados",
            f'count(count by (service_instance_id) (nodejs_eventloop_utilization_ratio{{{SEL}}}))',
            "none", 18,
        ),
        row("Tráfego por serviço", 4),
        series("Requisições/s", [target(f"sum by (service_name) (rate({REQ}[{RI}]))", "{{service_name}}")], "reqps", 0, 5),
        series(
            "Taxa de erro 5xx",
            [target(f"sum by (service_name) (rate({ERR}[{RI}])) / sum by (service_name) (rate({REQ}[{RI}]))", "{{service_name}}")],
            "percentunit", 8, 5,
        ),
        series(
            "Latência p95",
            [target(f"histogram_quantile(0.95, sum by (le, service_name) (rate({BUCKET}[{RI}])))", "{{service_name}}")],
            "s", 16, 5,
        ),
        row("Rotas", 13),
        {
            "id": pid(), "type": "table", "title": "Rotas (período selecionado)", "datasource": PROM,
            "description": "Ordene pelas colunas para achar as rotas mais lentas ou com mais erro.",
            "gridPos": {"x": 0, "y": 14, "w": 24, "h": 9},
            "targets": [
                target(f"sum by (service_name, http_route) (increase({REQ}[$__range]))", ref="A", instant=True, fmt="table"),
                target(
                    # "or 0 * total" faz rotas sem nenhum erro aparecerem com 0% em vez de vazio.
                    f"(sum by (service_name, http_route) (increase({ERR}[$__range])) or 0 * sum by (service_name, http_route) (increase({REQ}[$__range])))"
                    f" / sum by (service_name, http_route) (increase({REQ}[$__range]))",
                    ref="B", instant=True, fmt="table",
                ),
                target(
                    f"histogram_quantile(0.95, sum by (le, service_name, http_route) (increase({BUCKET}[$__range])))",
                    ref="C", instant=True, fmt="table",
                ),
            ],
            "transformations": [
                {"id": "merge", "options": {}},
                {"id": "organize", "options": {
                    "excludeByName": {"Time": True},
                    "renameByName": {"service_name": "Serviço", "http_route": "Rota", "Value #A": "Requisições", "Value #B": "Erro 5xx", "Value #C": "p95"},
                }},
                {"id": "sortBy", "options": {"sort": [{"field": "p95", "desc": True}]}},
            ],
            "fieldConfig": {
                "defaults": {},
                "overrides": [
                    {"matcher": {"id": "byName", "options": "Requisições"}, "properties": [{"id": "unit", "value": "short"}, {"id": "decimals", "value": 0}]},
                    {"matcher": {"id": "byName", "options": "Erro 5xx"}, "properties": [
                        {"id": "unit", "value": "percentunit"}, {"id": "decimals", "value": 2},
                        {"id": "custom.cellOptions", "value": {"type": "color-text"}},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [{"color": "green", "value": None}, {"color": "orange", "value": 0.01}, {"color": "red", "value": 0.05}]}},
                    ]},
                    {"matcher": {"id": "byName", "options": "p95"}, "properties": [{"id": "unit", "value": "s"}]},
                ],
            },
        },
        row("Processos", 23),
        series(
            "CPU por instância",
            [target(f'sum by (service_name, service_instance_id) (process_cpu_utilization{{{SEL}}})', "{{service_name}} · {{service_instance_id}}")],
            "percentunit", 0, 24, w=6,
            desc="Fração de um núcleo usada pelo processo. Num servidor compartilhado, compara as apps do mesmo host.",
        ),
        series(
            "Memória (RSS)",
            [target(f'sum by (service_name, service_instance_id) (process_memory_usage{{{SEL}}})', "{{service_name}} · {{service_instance_id}}")],
            "bytes", 6, 24, w=6,
        ),
        series(
            "Event loop p99",
            [target(f'max by (service_name, service_instance_id) (nodejs_eventloop_delay_p99_seconds{{{SEL}}})', "{{service_name}} · {{service_instance_id}}")],
            "s", 12, 24, w=6,
            desc="Atraso do event loop. Acima de 100ms indica código síncrono pesado travando as requisições.",
        ),
        series(
            "Heap V8 usado",
            [target(f'sum by (service_name, service_instance_id) (v8js_memory_heap_used_bytes{{{SEL}}})', "{{service_name}} · {{service_instance_id}}")],
            "bytes", 18, 24, w=6,
        ),
        row("Erros", 32),
        {
            "id": pid(), "type": "logs", "title": "Logs de erro", "datasource": LOKI,
            "gridPos": {"x": 0, "y": 33, "w": 12, "h": 12},
            "targets": [{
                "datasource": LOKI, "refId": "A",
                "expr": '{deployment_environment_name="$env", service_name=~"${service:regex}"} | detected_level=~"error|fatal|critical"',
            }],
            "options": {"showTime": True, "wrapLogMessage": True, "enableLogDetails": True, "sortOrder": "Descending", "dedupStrategy": "none"},
        },
        {
            "id": pid(), "type": "table", "title": "Traces com erro", "datasource": TEMPO,
            "description": "Clique no Trace ID para abrir a linha do tempo da requisição.",
            "gridPos": {"x": 12, "y": 33, "w": 12, "h": 12},
            "targets": [{
                "datasource": TEMPO, "refId": "A", "queryType": "traceql", "limit": 50, "tableType": "traces",
                "query": '{resource.deployment.environment.name="$env" && resource.service.name=~"${service:regex}" && status=error}',
            }],
        },
    ]
    return {
        "uid": "rastro-apis-overview",
        "title": "APIs · Visão geral",
        "tags": ["rastro", "apis"],
        "timezone": "browser",
        "schemaVersion": 41,
        "version": 1,
        "editable": False,
        "refresh": "30s",
        "time": {"from": "now-3h", "to": "now"},
        "templating": {"list": [
            {
                "name": "env", "label": "Ambiente", "type": "query", "datasource": PROM,
                "query": {"query": "label_values(http_server_request_duration_seconds_count, deployment_environment_name)", "refId": "env"},
                "definition": "label_values(http_server_request_duration_seconds_count, deployment_environment_name)",
                "current": {"text": "production", "value": "production"}, "refresh": 2, "sort": 1,
            },
            {
                "name": "service", "label": "Serviço", "type": "query", "datasource": PROM,
                "query": {"query": 'label_values(http_server_request_duration_seconds_count{deployment_environment_name="$env"}, service_name)', "refId": "service"},
                "definition": 'label_values(http_server_request_duration_seconds_count{deployment_environment_name="$env"}, service_name)',
                "multi": True, "includeAll": True, "allValue": ".*",
                "current": {"text": "All", "value": "$__all"}, "refresh": 2, "sort": 1,
            },
        ]},
        "panels": panels,
    }


out = Path(__file__).resolve().parent.parent / "grafana" / "dashboards"
out.mkdir(parents=True, exist_ok=True)
(out / "apis-overview.json").write_text(json.dumps(overview(), indent=2, ensure_ascii=False) + "\n")
print("ok:", out / "apis-overview.json")
