# Evolução do realismo — auditoria e desenho (t001)

Autor: tarefa t001 (software-architect). Data: 2026-10-15.
Escopo auditado: `src/engine`, `src/world`, `src/scenes/lakeScene.ts`, `src/fish` (incl. `visual/`), `src/fishing` (incl. `visuals/fishingVisuals.ts`), `src/gameplay/fishingSession.ts`, `src/ui/gameUI.ts`, `src/audio`, `src/config/persistence.ts`, `PERFORMANCE.md`.

Pilha provada pelos manifestos: Vite ^8.3.4, TypeScript ^7.0.2, Vitest ^4.1.11, Playwright ^1.64.1 (`package.json`). Renderização via Three.js (WebGL2) com pós-processamento de `three/addons` (`src/engine/postprocessing.ts:2-9`).

Este documento é o contrato que as demais tarefas consomem: problemas com evidência, gargalos, mapa de módulos com interfaces públicas, decisões registradas e orçamento por preset.

---

## 1. Estado atual (com evidência)

- **Loop e render**: `EngineRenderer` (WebGL2, ACES, sRGB, shadow map PCF) roda `setAnimationLoop` e delega ao `PostProcessingPipeline` quando anexado (`src/engine/renderer.ts:44-53`, `src/engine/postprocessing.ts:32`). A cadeia é RenderPass → GTAO → Bloom → OutputPass → FXAA/SMAA (`src/engine/postprocessing.ts:83-101`).
- **Qualidade**: `GraphicsQualityManager` com presets `low/medium/high/ultra/auto`, histerese e resolução dinâmica no auto (`src/engine/GraphicsQualityManager.ts:32-74`, `:96-109`).
- **Cena**: `LakeScene` monta céu, luz, terreno, lago (Gerstner + reflexo planar), vegetação instanciada com LOD, fauna, partículas, chuva e splash; o frame não aloca (`src/scenes/lakeScene.ts:154-168`, `:244-266`).
- **Jogo**: `GameStateMachine` com 11 estados e 15 eventos, transições fixas e dedupe por id (`src/core/stateMachine.ts:1-33`, `:54-65`); `FishingSession` liga as regras de pesca à máquina com passo fixo (`src/gameplay/fishingSession.ts:95`, `:279-291`).
- **Persistência**: save v2 em `localStorage`, com migração de v1 e validação fail-closed (`src/config/persistence.ts:9-11`, `:238-245`). **Não existe uso de IndexedDB no código hoje** (busca por `indexedDB` em `src/` sem ocorrência — auditoria determinística desta tarefa).
- **Áudio**: síntese procedural ligada às transições da stateMachine (`src/audio/gameAudio.ts:48-63`).

---

## 2. Problemas visuais e técnicos encontrados

Cada item cita caminho:linha real verificado nesta auditoria.

### Técnicos

| # | Problema | Evidência | Custo/risco |
|---|---|---|---|
| T1 | `antialias: true` no canvas convive com FXAA/SMAA no composer; o MSAA do contexto não age nos render targets do EffectComposer, só no blit final — custo de memória/fill sem ganho visual | `src/engine/renderer.ts:44` + `src/engine/postprocessing.ts:94` | fill rate e VRAM desperdiçados |
| T2 | Ultra difere do Alto quase só na sombra 4096 e no GTAO/bloom; `particleCount` é idêntico (300) — o preset mais caro não entrega diferencial proporcional | `src/engine/GraphicsQualityManager.ts:67`, `:58` e `:68` | 4× memória de shadow map por ganho marginal |
| T3 | `configure()` descarta e recria GTAO/Bloom/AA a cada troca de preset (realocação de render targets no meio do jogo) | `src/engine/postprocessing.ts:83-101` | hitch na troca de qualidade |
| T4 | Reflexo planar renderiza a cena uma segunda vez por frame em Alto/Ultra; a chamada é incondicional no frame e inclui `traverseVisible` da cena para gerir sombras | `src/scenes/lakeScene.ts:262`, `:302`, `src/world/lake.ts:377`, `:432` | ~2× draw calls nos presets altos |
| T5 | PMREM do ambiente é regenerado em degraus de 0,25 h / 0,1 de cobertura — pico de frame time no degrau | `src/scenes/lakeScene.ts:41-43`, `:354` | stutter periódico com tempo acelerado |
| T6 | Vegetação inteira com `DoubleSide` e geometria `toNonIndexed()` (cores por vértice): dobra rasterização e aumenta vértices | `src/world/vegetation.ts:186`, `:234` | custo de raster em todos os presets |
| T7 | LOD/culling da vegetação é estático, calculado uma vez contra o ponto de vista fixo do píer, não contra a câmera | `src/world/vegetation.ts:56`, `:170-174` | não escala para câmera livre/gamepad/celular |
| T8 | Chuva com buffer fixo de 4000 gotas alocado sempre, mesmo em tempo limpo e no preset Baixo | `src/scenes/lakeScene.ts:36` | memória e update desnecessários |
| T9 | `frustumCulled = false` em sky, partículas, splash, fauna, luz e linha de pesca — nenhum desses objetos é cortado nunca | `src/world/particles.ts:55`, `:130`, `src/world/splash.ts:67`, `src/world/fauna.ts:72`, `src/world/sky.ts:113`, `src/fishing/visuals/fishingVisuals.ts:109` | draw calls fixos fora do campo de visão |
| T10 | Rótulos de qualidade duplicados em dois mapas que podem divergir | `src/engine/GraphicsQualityManager.ts:10-16` e `src/ui/gameUI.ts:26-32` | manutenção/i18n |
| T11 | `DISPLAY_FISH` é um `Record` fixo de 3 espécies no módulo visual da pesca: cada espécie nova exige editar este arquivo (dependência aponta para fora do domínio estável) | `src/fishing/visuals/fishingVisuals.ts:47-51` | acoplamento contra a direção do domínio |
| T12 | Todo o progresso (stats, bestCatch) vive no mesmo blob de `localStorage` das configurações; não há armazenamento estruturado para galeria/capturas | `src/config/persistence.ts:9`, `:41-47`, `:241` | bloqueia a galeria (MVP exige IndexedDB com versão e migrações) |

### Visuais

| # | Problema | Evidência | Efeito |
|---|---|---|---|
| V1 | Linha de pesca em `LineBasicMaterial`: espessura fixa de 1 px no WebGL, invisível em DPR alto e sem oclusão convincente | `src/fishing/visuals/fishingVisuals.ts:108` | quebra de realismo no elemento central do jogo |
| V2 | Linha ponta-da-vara→boia é uma Bézier quadrática com barriga fixa; não reage a vento nem à física da linha já existente em `src/fishing/linePhysics.ts` | `src/fishing/visuals/fishingVisuals.ts:211-230` | catenária artificial; física calculada e não exibida |
| V3 | Mapa de profundidade da água gerado na CPU com 128×128 para o lago inteiro: transição rasa/funda serrilhada perto da margem | `src/world/lake.ts:32`, `:193` | banding na cor da água |
| V4 | Máximo de 8 ondulações simultâneas via uniform array: splashes extras são descartados em cenas movimentadas | `src/world/lake.ts:29` | feedback visual perdido em sequência de eventos |
| V5 | Peixe capturado gira em rotação contínua na frente da câmera (`rotation.y = elapsed * 0.8`), apresentação de vitrine, não de mão segurando o peixe | `src/fishing/visuals/fishingVisuals.ts:178-183` | cena de captura pouco crível |
| V6 | Névoa inicial fixa de fim de tarde (0xd9a77c) criada antes do timeOfDay assumir; cor correta só após o primeiro `updateAtmosphere` | `src/scenes/lakeScene.ts:118` | primeiro frame com atmosfera inconsistente |
| V7 | Flores (600) e serapilheira (500) são quads/cones minúsculos com LOD único até 60 m: contribuem instâncias sem leitura visual à distância | `src/world/vegetation.ts:372-373` | custo sem retorno visual |

---

## 3. Gargalos de performance (a partir de PERFORMANCE.md)

A linha de base existente mede **SwiftShader headless (CPU)**, não GPU real (`PERFORMANCE.md:8`, `:37`): Baixa 14,01 FPS médios, Média 8,83, Alta 7,18 (`PERFORMANCE.md:21-23`), e a meta de 60 FPS está explicitamente não atingida nessa medição (`PERFORMANCE.md:38`). Heap: +1,26 MB em 5 ciclos, inconclusivo para vazamento (`PERFORMANCE.md:31-33`, `:41`).

O que esses números implicam, ligado ao código:

1. **Custo de cena dobrado nos presets altos** — reflexo planar re-renderiza a cena (`src/scenes/lakeScene.ts:262`; `src/world/lake.ts:377`). Em SwiftShader isso é devastador; em GPU real continua sendo o maior multiplicador de draw calls. Mitigação desenhada: resolução do reflexo já é escalada (0.5 em Alto, 1.0 em Ultra, `src/scenes/lakeScene.ts:302`) — manter e acrescentar layer mask (só céu+terreno+vegetação LOD alto no reflexo).
2. **Overdraw de vegetação** — `DoubleSide` + não-indexado (`src/world/vegetation.ts:186`, `:234`) e 2 240+ instâncias potenciais somando as regras (`src/world/vegetation.ts:366-373`). Mitigação: `FrontSide` onde a geometria fecha, LOD pela câmera, cortar flower/leaf-litter no Baixo.
3. **Pós-processamento em todos os presets** — GTAO (`src/engine/postprocessing.ts:83`) é o passe mais caro da cadeia; já desligado no Baixo/Médio (`src/engine/GraphicsQualityManager.ts:41`, `:51`) — manter esse corte como contrato do orçamento.
4. **Dupla AA** — MSAA do canvas + FXAA/SMAA (`src/engine/renderer.ts:44`): remover `antialias: true` quando o composer está ativo.
5. **Picos pontuais** — PMREM em degraus (`src/scenes/lakeScene.ts:354`) e recriação de passes na troca de preset (`src/engine/postprocessing.ts:83-101`): espalhar o PMREM por frames ou pré-computar paleta de env maps.
6. **Medição** — a única linha de base é software render; o orçamento da seção 6 define alvos por preset e exige validação com `npm run perf` em hardware com GPU antes de declarar meta atingida (limitação registrada em `PERFORMANCE.md:37-41`).

---

## 4. Mapa de módulos-alvo (seção 15 do pedido)

Direção de dependências: tudo aponta para o domínio estável (`src/fish/species.ts`, `src/progression/types.ts`, `src/core/stateMachine.ts`); UI, visuais e persistência são bordas. `CatchRecord` já existe como contrato comum de save/galeria/progresso (`src/progression/types.ts:15-28`) — os módulos novos consomem esse tipo, não o duplicam.

| Módulo-alvo | Pasta | Estado | Responsabilidade |
|---|---|---|---|
| Save | `src/save/` | **nova** | IndexedDB versionado com migrações: capturas (galeria), progresso durável. `localStorage` continua em `src/config/persistence.ts` só para Settings/Volumes |
| Progressão | `src/progression/` | existente (`types.ts`, `achievements.ts`, `inventory.ts`) | regras de nível/conquista/inventário; recebe `CatchRecord`, não conhece DOM nem three |
| Captura | `src/capture/` | **nova** | fluxo pós-FISH_LANDED: montar `CatchRecord` a partir de `CaughtFish` (`src/gameplay/fishingSession.ts:36-43`), decidir kept/released, foto (futuro), entregar ao save e à progressão |
| Visual do peixe | `src/fish/visual/` | existente (`fishModel.ts`, `fishAnimator.ts`, `fishTextures.ts`) | malha, textura e animação procedurais por espécie+indivíduo; único lugar que traduz `ColorVariation` em material |

### Interfaces públicas (assinaturas TypeScript)

```ts
// src/save/db.ts — IndexedDB com versão e migrações (decisão D4)
export const DB_NAME = 'pesqueepague';
export const DB_VERSION = 1; // migrações numeradas, uma função por versão

export interface Migration {
  readonly toVersion: number;
  apply(db: IDBDatabase, tx: IDBTransaction): void;
}

export interface CatchQuery {
  readonly speciesId?: SpeciesId;
  readonly disposition?: CatchDisposition;
  readonly limit?: number;        // paginação da galeria
  readonly afterTimestamp?: number;
}

export interface SaveDb {
  open(): Promise<void>;                                   // cria/migra o schema
  addCatch(record: CatchRecord): Promise<void>;            // idempotente por record.id
  getCatch(id: string): Promise<CatchRecord | null>;
  listCatches(query?: CatchQuery): Promise<readonly CatchRecord[]>;
  countBySpecies(): Promise<ReadonlyMap<SpeciesId, number>>;
  getProgress(): Promise<ProgressSnapshot>;                // stats agregadas duráveis
  putProgress(next: ProgressSnapshot): Promise<void>;
  close(): void;
}

export function openSaveDb(factory?: IDBFactory): Promise<SaveDb>; // injeção p/ teste (fake-indexeddb)

// src/save/progress.ts
export interface ProgressSnapshot {
  readonly version: number;
  readonly stats: Stats;                 // de src/config/persistence.ts
  readonly bestCatch: BestCatch | null;  // idem
  readonly unlockedAchievements: readonly string[];
}
```

```ts
// src/capture/captureFlow.ts — orquestra CAUGHT sem conhecer DOM nem three
export interface CaptureDeps {
  readonly save: SaveDb;
  readonly progression: ProgressionService;
  readonly now: () => number;            // relógio injetado (determinismo nos testes)
  readonly newId: () => string;
}

export class CaptureFlow {
  constructor(deps: CaptureDeps);
  /** Converte CaughtFish (fishingSession) em CatchRecord, grava e notifica. Nunca lança no caminho do frame. */
  handleCatch(fish: CaughtFish, disposition: CatchDisposition): Promise<CatchRecord>;
  onRecorded(listener: (record: CatchRecord) => void): () => void;
}
```

```ts
// src/progression/service.ts — fachada do que já existe em achievements.ts/inventory.ts
export interface ProgressionService {
  recordCatch(record: CatchRecord): ProgressionDelta;      // puro: mesmo input, mesmo delta
  recordEscape(speciesId: SpeciesId): ProgressionDelta;
  snapshot(): ProgressSnapshot;
}
export interface ProgressionDelta {
  readonly pointsAwarded: number;
  readonly achievementsUnlocked: readonly string[];
  readonly isPersonalRecord: boolean;
}
```

```ts
// src/fish/visual/ — contrato consumido por fishingVisuals (remove o DISPLAY_FISH fixo, problema T11)
export interface FishVisualFactory {
  /** Modelo procedural do indivíduo; texturas só do manifesto same-origin (src/assets/textures.ts). */
  create(individual: FishIndividual): FishModel;
  dispose(): void;
}

export interface FishModelApi {       // já implementado em fishModel.ts; formalizado como contrato
  readonly root: Object3D;
  animate(elapsedSeconds: number, intensity: number): void;
  setWetness(value: number): void;
  dispose(): void;
}
```

```ts
// src/engine — contrato de qualidade que o orçamento (seção 6) governa; já existe, fica congelado
export interface QualitySettings { /* src/engine/GraphicsQualityManager.ts:18-30 */ }
export interface PostProcessingSettings { /* src/engine/postprocessing.ts:13-20 */ }
```

### Eventos trocados com a stateMachine

A `GameStateMachine` permanece a única fonte de verdade de estado; **nenhum estado ou evento novo é necessário** (GAME_STATES/GAME_EVENTS em `src/core/stateMachine.ts:1-33`). Os módulos novos acoplam-se pelos pontos de extensão já existentes:

| Produtor | Evento/callback | Consumidor novo | Quando |
|---|---|---|---|
| `FishingSession` | `onCatch(CaughtFish)` (`src/gameplay/fishingSession.ts:176`) | `CaptureFlow.handleCatch` | transição `REELING --FISH_LANDED--> CAUGHT` |
| `FishingSession` | `onOutcome(JournalEntry)` (`src/gameplay/fishingSession.ts:182`) | `ProgressionService` (escapes) | `FISH_ESCAPED` / `LINE_BROKEN` |
| `GameStateMachine` | `onTransition(from,to,event)` (`src/core/stateMachine.ts:131`) | UI da galeria (abre no MENU), áudio (padrão já usado em `src/audio/gameAudio.ts:48`) | qualquer transição |
| `CaptureFlow` | `onRecorded(CatchRecord)` | `GameUI` (tela de captura com kept/released), galeria | após gravar no IndexedDB |

Regra: escrita no IndexedDB é assíncrona e **fora do caminho do frame**; a transição `CAUGHT --CONTINUE--> IDLE` não espera o save (falha de gravação vira aviso na UI, nunca bloqueia o jogo).

---

## 5. Decisões registradas (ADRs resumidos)

**D1 — WebGL2, sem WebGPU.**
Contexto: pipeline atual inteiro em WebGLRenderer (`src/engine/renderer.ts:44`); WebGPU exigiria renderer paralelo e shaders reescritos (Gerstner e vento são GLSL injetado, `src/world/lake.ts:36`, `src/world/vegetation.ts:100-121`). Alternativa considerada: WebGPURenderer com TSL — ganho real só com compute, custo de migração alto e cobertura de dispositivos menor. Decisão: WebGL2 only. Consequência: os ganhos vêm de orçamento e corte de overdraw, não de API nova; reversível no futuro isolando o engine atrás de `EngineRenderer`.

**D2 — Pós-processamento via `three/addons`, sem dependência nova.**
Contexto: cadeia já usa EffectComposer/GTAO/Bloom/SMAA dos addons (`src/engine/postprocessing.ts:2-9`). Alternativa: `postprocessing` (pmndrs) — passes fundidos mais rápidos, porém dependência nova (restrição da tarefa: não incluir dependências; menor superfície de supply chain). Decisão: manter addons. Consequência: aceitamos passes não fundidos; compensa-se desligando GTAO abaixo do Alto (já é assim, `src/engine/GraphicsQualityManager.ts:41`, `:51`).

**D3 — Assets 100% procedurais.**
Contexto: texturas geradas em código e servidas pelo provider same-origin (`src/assets/textures.ts`, consumido em `src/scenes/lakeScene.ts:126-128`); vegetação e peixes são geometria procedural (`src/world/vegetation.ts`, `src/fish/visual/fishModel.ts`). Alternativa: assets externos (GLTF/texturas) — mais realismo bruto, mas exige manifesto de licenças, pesa no load e fere o padrão atual de carregar só o que está no manifesto. Decisão: procedural, determinístico por seed. Consequência: realismo vem de shader e iluminação; qualquer asset futuro entra só com licença compatível e registrado em manifesto.

**D4 — IndexedDB para progresso/galeria; localStorage para configurações.**
Contexto: hoje tudo vive num blob `localStorage` (`src/config/persistence.ts:9`, `:241`); galeria de capturas cresce sem limite previsível e `localStorage` é síncrono e ~5 MB. Alternativas: (a) continuar localStorage — simples, mas bloqueia a galeria e trava o main thread; (b) OPFS — overkill e suporte desigual. Decisão: `src/save` em IndexedDB com `DB_VERSION` e migrações numeradas (mesmo padrão expandir/contrair do save v1→v2 já praticado em `src/config/persistence.ts:170-190`); Settings/Volumes permanecem em localStorage (leitura síncrona no bootstrap). Consequência: duas fontes de persistência com fronteira clara: configuração = localStorage; progresso durável = IndexedDB.

**D5 — Um único cenário tropical.**
Contexto: layout, terreno, vegetação e clima são parametrizados para um lago (`src/world/layout.ts`, consumido por 9 módulos). Alternativa: multi-cenário — multiplicaria assets, orçamento e testes sem pedido de ninguém (não projetar para flexibilidade não pedida). Decisão: um cenário tropical; variedade vem de hora do dia (`src/world/timeOfDay.ts`) e clima (`src/world/weather.ts`). Consequência: o orçamento da seção 6 vale para esta cena; um segundo cenário exigiria novo ADR.

---

## 6. Orçamento por preset

Alvos de contrato para hardware com GPU real a 60 FPS (frame ≤ 16,7 ms; no Baixo aceita-se 30 FPS em integrada antiga). A linha de base atual é SwiftShader e não serve de referência (`PERFORMANCE.md:37`); o orçamento é verificado pelo painel F3 (`src/engine/diagnostics.ts:95-101`: draw calls, triângulos, pixel ratio) e pelo teste `@perf`. Estourar o orçamento reprova a tarefa que estourou.

| Preset | Draw calls (máx/frame, reflexo incluso) | Triângulos (máx/frame) | Resolução interna (escala sobre min(DPR, maxPixelRatio)) | Sombra | Reflexo planar | Pós |
|---|---|---|---|---|---|---|
| **Baixo** | 90 | 150 mil | 0,60 | desligada (512 reservado) | não | FXAA |
| **Médio** | 150 | 300 mil | 0,85 | 1024 | não | FXAA + bloom 0,08 |
| **Alto** | 240 | 600 mil | 1,00 | 2048 | sim, a 0,5× | SMAA + GTAO 0,6 + bloom 0,12 |
| **Ultra** | 320 | 900 mil | 1,00 | 4096 | sim, a 1,0× | SMAA + GTAO 0,85 + bloom 0,16 |

Notas de amarração com o código:

- Escalas de resolução, sombras e pós por preset já são exatamente estes valores em `src/engine/GraphicsQualityManager.ts:32-74`; o orçamento congela esse contrato e acrescenta os tetos de draw calls/triângulos que hoje não existem.
- Reflexo planar: ligado só em Alto/Ultra com 0,5×/1,0× (`src/scenes/lakeScene.ts:301-302`) — os tetos de draw calls dos presets altos já incluem a segunda passada.
- Partículas: 60/150/300/300 (`src/engine/GraphicsQualityManager.ts:38`, `:48`, `:58`, `:68`); recomendação de evolução: Ultra para 450 para diferenciar do Alto (resolve T2 sem subir sombra além de 4096).
- `maxPixelRatio` do dispositivo continua limitado pelo `EngineRenderer` (`src/engine/renderer.ts:37-39`); em celular (futuro) o teto recomendado é DPR 2.
- Modo Auto nunca sobe além do Alto (`src/engine/GraphicsQualityManager.ts:91`, `:107`): Ultra é sempre escolha manual — mantido.

### Passos de migração (expandir/contrair, convivendo com o atual)

1. `src/save` entra ao lado do `localStorage` (dual-write de stats/bestCatch); leitura continua do localStorage até a galeria existir.
2. `src/capture` assina `onCatch` sem tocar em `FishingSession`; `GameUI` ganha a ação kept/released na tela CAUGHT (botão com ação real).
3. Galeria lê só do IndexedDB; quando estável, `stats/bestCatch` param de ser escritos no localStorage (contrair), que fica só com Settings/Volumes.
4. Correções de orçamento (T1, T4, T6, T9) entram por preset, cada uma validada com teste rodado (`npm run perf` + e2e), nunca só por compilar.
