# Performance — Pesque e Pague

Números de uma única execução de `npm run perf` (`playwright test --grep @perf`, teste `e2e/performance.e2e.ts`), copiados da linha `PERF_RESULT` do stdout. Exit code 0, 1 teste passou (3,0 min).

## Ambiente

- **Execução:** Chromium headless do Playwright (`Chrome/156.0.8078.4`), viewport 1280×720, jogo servido pelo Vite em `--mode e2e` com `?seed=20261014&clock=manual&pointerlock=off`.
- **Renderizador WebGL:** `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`. É rasterização por **software** (SwiftShader) na CPU, sem GPU.
- **SO:** Windows 10 Pro 10.0.19045, x64 (o user agent informa `Windows NT 10.0; Win64; x64`).
- **Hardware:** o modelo de CPU, a quantidade de RAM e a GPU da máquina **não foram coletados** nesta medição (nenhuma ferramenta disponível nesta rodada lia esses dados). Com SwiftShader, a GPU física não interfere no resultado.

## Método

- Para cada preset, `__fp.setQuality(preset)`, seguido de 1 000 ms de aquecimento e de uma janela fixa de 5 000 ms. Em cada callback de `requestAnimationFrame` é gravado o intervalo entre timestamps (o timestamp do navegador, não o relógio manual do jogo). Com esses intervalos o teste calcula média, p50, p95, p99 e máximo. Percentil pelo método nearest-rank.
- **Heap:** com o preset Média, medido antes e depois de 5 ciclos completos de pesca (arremesso, mordida com `advance`, fisgada, recolhimento e tela de resultado). Antes de cada leitura o teste força GC por CDP (`HeapProfiler.collectGarbage`) e então lê `Runtime.getHeapUsage` (CDP) e `performance.memory.usedJSHeapSize`.

## Frame time por preset (headless/SwiftShader)

| Preset | Frames na janela | Média (ms) | p50 (ms) | **p95 (ms)** | p99 (ms) | Máx (ms) | FPS médio |
|---|---|---|---|---|---|---|---|
| Baixa | 71 | 71,36 | 66,7 | **133,3** | 150 | 150 | 14,01 |
| Média | 44 | 113,25 | 116,7 | **200,1** | 233,3 | 233,3 | 8,83 |
| Alta | 36 | 139,35 | 150 | **166,7** | 300 | 300 | 7,18 |

## Heap (5 ciclos de pesca, preset Média)

Resultado dos ciclos: CAUGHT, CAUGHT, CAUGHT, CAUGHT, CAUGHT.

| Medida | Antes | Depois | Δ |
|---|---|---|---|
| heap usado (CDP `Runtime.getHeapUsage`) | 9,89 MB | 11,15 MB | +1,26 MB |
| heap total (CDP) | 10,32 MB | 11,89 MB | +1,57 MB |
| `performance.memory.usedJSHeapSize` | 28,04 MB | 28,04 MB | 0 |

## Limitações

- **Headless não equivale a GPU real.** Todo o render passou pelo SwiftShader, na CPU. Os frame times acima medem esse caminho de software e não servem para estimar o desempenho com uma GPU de verdade.
- **A meta de 60 FPS não está declarada como atingida.** Nesta medição nenhum preset chegou perto dela (o melhor foi Baixa, com 14,01 FPS médios). Só uma medição em hardware real, com GPU e navegador com aceleração, pode confirmar ou descartar a meta.
- Os intervalos saem em múltiplos de ~16,7 ms, porque o compositor headless agenda os frames de forma quantizada. Por isso os percentis são grosseiros, e na Alta o p95 (166,7) ficou abaixo do da Média (200,1), com amostra pequena (36 frames).
- É uma única execução, sem repetições. Não há como estimar a variância entre execuções. Os números servem de linha de base, não de garantia.
- `performance.memory` é quantizado pelo Chrome quando falta a flag `--enable-precise-memory-info`. Por isso não mudou. O valor confiável é o do CDP. Um Δ de +1,26 MB em 5 ciclos é pequeno demais para provar ou descartar um vazamento: seria preciso rodar mais ciclos.
- O relógio do jogo é manual (`clock=manual`) e a mordida é antecipada por `advance`. O heap foi medido em ciclos encurtados, e não na duração de uma sessão real.
- Hardware (CPU/RAM) não registrado, como dito em Ambiente.
