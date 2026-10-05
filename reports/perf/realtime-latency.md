# Desempenho do gateway de tempo real

Gerado por `npm run perf:realtime` em 2026-10-03T20:32:15.990Z.

Ambiente: 13th Gen Intel(R) Core(TM) i5-1345U (12 núcleos), 31.04 GB de RAM, Node v20.19.6. Servidor e clientes na mesma máquina (rede local, sem latência de internet).

Sem carga: 200 operações enviadas uma de cada vez. Com carga: cada cliente envia 10 operações/s durante 5 s.

| Clientes | Entrada na sala p95 (ms) | Sem carga p50 (ms) | Sem carga p95 (ms) | Sem carga p99 (ms) | Com carga: entregas/s | Com carga p50 (ms) | Com carga p95 (ms) | Perdas | RSS servidor (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 25.46 | 0.38 | 0.8 | 1.74 | 19.6 | 1.13 | 2.48 | 0.0% | 155.7 |
| 5 | 32.41 | 0.54 | 1.29 | 1.55 | 195.99 | 1.82 | 2.66 | 0.0% | 159.28 |
| 10 | 18.11 | 0.4 | 1.08 | 1.53 | 880 | 1.63 | 2.33 | 0.0% | 164.28 |
| 25 | 73.25 | 0.38 | 0.76 | 1.08 | 5870.26 | 1.7 | 3.41 | 0.0% | 167.47 |
| 50 | 124.85 | 0.46 | 1.35 | 2.52 | 23967.32 | 1.47 | 4.33 | 0.0% | 177.9 |
| 100 | 193.87 | 0.56 | 1.93 | 3.4 | 96106.33 | 5.06 | 19.22 | 0.0% | 198.07 |

A latência é medida do envio pelo cliente até a chegada em cada um dos demais participantes da sala.
