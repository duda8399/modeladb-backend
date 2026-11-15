# Desempenho do gateway de tempo real

Gerado por `npm run perf:realtime` em 2026-11-15T22:30:44.157Z.

Ambiente: 13th Gen Intel(R) Core(TM) i5-1345U (12 núcleos), 31.04 GB de RAM, Node v20.19.6. Servidor e clientes na mesma máquina (rede local, sem latência de internet).

Cada cenário foi executado 10 vezes. Sem carga: 200 operações enviadas uma de cada vez. Com carga: cada cliente envia 10 operações/s durante 5 s.

Os valores são média ± desvio padrão amostral das 10 repetições; cada repetição contribui com um valor de cada métrica (por exemplo, o p95 daquela execução).

| Clientes | Entrada na sala p95 (ms) | Sem carga p50 (ms) | Sem carga p95 (ms) | Sem carga p99 (ms) | Com carga: entregas/s | Com carga p50 (ms) | Com carga p95 (ms) | Perdas | RSS servidor (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 15.09 ± 6.82 | 0.48 ± 0.2 | 0.96 ± 0.3 | 1.43 ± 0.41 | 19.6 ± 0 | 1.79 ± 0.19 | 2.48 ± 0.19 | 0.0% ± 0.0 | 172.74 ± 20.64 |
| 5 | 23.45 ± 3.97 | 0.23 ± 0.15 | 0.73 ± 0.15 | 1.11 ± 0.21 | 196 ± 0.02 | 1.42 ± 0.05 | 2.13 ± 0.06 | 0.0% ± 0.0 | 169.95 ± 2.63 |
| 10 | 28.26 ± 6.13 | 0.18 ± 0.11 | 0.8 ± 0.07 | 1.31 ± 0.31 | 876.72 ± 1.99 | 1.38 ± 0.02 | 2.07 ± 0.05 | 0.0% ± 0.0 | 182.38 ± 4.75 |
| 25 | 44.5 ± 9.58 | 0.36 ± 0.17 | 1.08 ± 0.12 | 1.62 ± 0.25 | 5863.91 ± 7.77 | 1.55 ± 0.04 | 2.83 ± 0.1 | 0.0% ± 0.0 | 202.72 ± 3.3 |
| 50 | 64.01 ± 12.64 | 0.31 ± 0.11 | 1.21 ± 0.19 | 2.03 ± 0.64 | 23951.29 ± 41.48 | 1.68 ± 0.4 | 4.47 ± 0.93 | 0.0% ± 0.0 | 212.18 ± 1.63 |
| 100 | 113.53 ± 15.98 | 0.43 ± 0.04 | 1.69 ± 0.33 | 2.98 ± 0.55 | 96551.37 ± 185.87 | 2.97 ± 0.49 | 10.41 ± 1.72 | 0.0% ± 0.0 | 221.54 ± 2.59 |

## Dispersão do p95 entre repetições

CV = coeficiente de variação (desvio padrão / média). IC 95% = intervalo de confiança da média pela distribuição t de Student.

| Clientes | Sem carga p95: CV | Sem carga p95: mín–máx (ms) | Sem carga p95: IC 95% (ms) | Com carga p95: CV | Com carga p95: mín–máx (ms) | Com carga p95: IC 95% (ms) |
|---|---|---|---|---|---|---|
| 2 | 31.73% | 0.59–1.61 | [0.74; 1.17] | 7.81% | 2.19–2.74 | [2.34; 2.62] |
| 5 | 20.95% | 0.42–1.04 | [0.62; 0.84] | 2.97% | 2.03–2.2 | [2.08; 2.17] |
| 10 | 9.05% | 0.71–0.96 | [0.75; 0.85] | 2.63% | 1.97–2.14 | [2.03; 2.11] |
| 25 | 10.92% | 0.89–1.27 | [1; 1.17] | 3.53% | 2.72–3.04 | [2.76; 2.9] |
| 50 | 15.75% | 0.93–1.5 | [1.07; 1.34] | 20.81% | 3.41–6.11 | [3.81; 5.14] |
| 100 | 19.65% | 1.09–2.1 | [1.45; 1.92] | 16.54% | 7.3–12.81 | [9.17; 11.64] |

A latência é medida do envio pelo cliente até a chegada em cada um dos demais participantes da sala. O resumo por repetição está em `realtime-latency-repeticoes.csv` e as estatísticas de todas as métricas em `realtime-latency.csv`.
