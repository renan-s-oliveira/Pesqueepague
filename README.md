# Pesque e Pague — pescaria 3D no navegador

Jogo de pescaria em primeira pessoa num lago ao fim da tarde, feito com Three.js, TypeScript estrito e Vite. Roda inteiro no navegador, sem backend: você arremessa do píer, espera a mordida, fisga e recolhe a linha controlando a tensão.

## Menu, álbum e sala de troféus

### Três expedições e 54 espécies

Em **Selecionar cenário**, escolha o Lago Tropical (18 espécies), o Lago da Serra (18) ou o Lago do Igapó (17). São 53 espécies regulares: as três originais e 50 novas. A distribuição é exclusiva de cada lago e balanceada para o jogo. O atlas informa onde encontrar cada espécie; o lago selecionado e o local das capturas ficam salvos.

O **Guardião Abissal** é a 54ª espécie, secreta e exclusiva do Igapó. Cada arremesso válido nesse lago faz uma única tentativa independente de **1 em 1.000.000.000**, usando aleatoriedade do navegador e rejeição para evitar viés. Esperar ou receber novas beliscadas não faz sorteios adicionais. A entrada dura oito segundos: apenas uma sombra atravessa a água, com trilha original de percussão, baixo e cordas sintetizadas. A mordida aguarda o fim da entrada; a trilha continua durante o encontro e respeita pausa e volume da música. Não existe um contador de garantia.

### Carretilha

O modelo tem carretel transversal sobre a vara e manivela dupla. Durante a briga, role o mouse **para cima** ou gire a manivela na tela no sentido horário para recolher. **C** alterna o cursor livre para acessar a manivela. Segure **E** ou **Liberar linha** para destravar o carretel e aliviar a tensão; solte para frear. **R**, botão esquerdo e Espaço continuam disponíveis para recolher continuamente. Os indicadores mostram distância, velocidade, drag e fôlego.

O menu do Pesque & Pague abre sobre o lago e oferece acesso direto ao álbum e à sala de troféus. Na galeria, o atlas apresenta habitat, profundidade, temperatura e iscas favoritas de cada espécie, incluindo as que você ainda não capturou. Os cards abrem fichas com foto, medidas, comparação com seu recorde e navegação entre capturas. Use **Só recordes**, busca e filtros para explorar a coleção.

Na sala de troféus, clique em um exemplar ou em seu nome para observar de perto. Arraste para orbitar, use a roda do mouse ou os botões para aproximar e afastar, e alterne o giro automático. **Visão geral** reenquadra a coleção; **Esc** fecha a sala. As conquistas têm filtros por estado, detalhes de desbloqueio e um próximo desafio sugerido.

A vara usa 12 segmentos com molas amortecidas e torque que considera sua curvatura. A linha tem restrições com pontas fixas, arrasto na água e folga que diminui conforme a tensão da briga; novos arremessos reiniciam a simulação para não carregar energia da linha anterior.

## Requisitos de execução

- **Node.js** com npm. O projeto usa Vite 8 (veja `package.json`); use uma versão de Node aceita por ele (20.19+ ou 22.12+).
- **Navegador com WebGL2** (Chrome, Edge, Firefox ou Safari atuais). Sem WebGL2 o jogo não inicia e mostra a mensagem “Este navegador não oferece WebGL2. Atualize o navegador ou ative a aceleração de hardware.”, com um botão para tentar de novo.
- Para os testes E2E: o Chromium do Playwright (`npx playwright install chromium`).

## Começando

```bash
npm install
npm run dev
```

Abra o endereço que o Vite mostrar no terminal (por padrão `http://localhost:5173`), clique em **Jogar** e depois no lago para travar o cursor.

## Comandos

| Comando | O que faz |
|---|---|
| `npm install` | Instala as dependências do `package-lock.json`. |
| `npm run dev` | Servidor de desenvolvimento do Vite, com recarga automática. |
| `npm run build` | Verifica os tipos (`tsc --noEmit`) e gera o build de produção em `dist/`. |
| `npm run preview` | Serve o conteúdo de `dist/` localmente (rode `npm run build` antes). |
| `npm run test` | Testes unitários com Vitest (`vitest run`). |
| `npm run test:e2e` | Testes E2E com Playwright no Chromium, excluindo os marcados `@perf`. |
| `npm run perf` | Só os testes Playwright marcados `@perf` (medição de performance). |
| `npm run typecheck` | Só a verificação de tipos. |

Os comandos do Playwright sobem o próprio servidor (`vite --mode e2e` em `127.0.0.1:5179`) com WebGL por software (SwiftShader); não é preciso deixar o `npm run dev` aberto. Só nesse modo `e2e` o jogo aceita `?seed=` e `?clock=manual` na URL e expõe os ganchos de teste em `window.__fp`; no build de produção esse código não existe.

## Controles

| Entrada | Ação |
|---|---|
| Mouse | Olhar em volta (depois de clicar no canvas para travar o cursor). |
| Botão esquerdo **ou** Espaço — segurar e soltar | Em espera (IDLE): carrega a força e arremessa ao soltar. |
| Botão esquerdo / Espaço — clicar | Com a boia na água (WAITING): recolhe a isca sem peixe. |
| Botão esquerdo / Espaço — clicar | Quando aparece “Mordeu!” (HOOKED): fisga. |
| Botão esquerdo / Espaço — segurar | Na briga (REELING): recolhe a linha; solte quando a tensão ficar no vermelho para ela não arrebentar. |
| R — segurar | Recolhe a linha (mesma ação do botão, pela camada de ações de `src/core/input.ts`). |
| Roda do mouse para cima / manivela na tela | Gira a carretilha e recolhe linha durante a briga. |
| E — segurar | Libera linha pelo carretel e alivia a tensão. |
| C | Alterna cursor livre para operar a manivela na tela. |
| `+` / `-` | Aperta ou solta o drag do molinete. |
| 1, 2, 3 | Velocidade de recolhimento. |
| Setas / A, D | Movem a vara / mudam a direção do arremesso. |
| Botão esquerdo / Espaço — clicar | Na tela de resultado: continua pescando. |
| **ESC** | Pausa e retoma. Sair do pointer lock (o navegador consome o ESC) também pausa. |
| **H** | Mostra ou esconde a ajuda na tela durante o jogo. |

A sensibilidade do mouse vai de 0,1 a 3 em **Configurações**. O mapeamento gesto × estado está em `src/core/input.ts` (`mapInput`).

## Como o jogo funciona

### Estados

A máquina de estados explícita fica em `src/core/stateMachine.ts`. Eventos que não valem no estado atual são rejeitados, e eventos repetidos com o mesmo `id` são ignorados.

```
BOOT --BOOTED--> LOADING --LOADED--> MENU --START--> IDLE
IDLE     --CAST--------> CASTING --LURE_LANDED--> WAITING
WAITING  --BITE--------> HOOKED   | WAITING --REEL_IN--> IDLE
HOOKED   --HOOK_SET----> REELING  | HOOKED  --FISH_ESCAPED--> ESCAPED  | HOOKED  --LINE_BROKEN--> ESCAPED
REELING  --FISH_LANDED-> CAUGHT   | REELING --FISH_ESCAPED--> ESCAPED  | REELING --LINE_BROKEN--> ESCAPED
CAUGHT / ESCAPED --CONTINUE--> IDLE   (ou --QUIT--> MENU)
IDLE --QUIT--> MENU
```

`PAUSE` vale em IDLE, CASTING, WAITING, HOOKED, REELING, CAUGHT e ESCAPED e leva a `PAUSED`; `RESUME` volta exatamente ao estado anterior. De `PAUSED` também é possível `QUIT` para o menu. Em pausa o tempo de jogo não avança.

### Peixes e pontuação

Há três espécies em `src/fish/species.ts`: Lambari (comum), Tilápia (incomum) e Tucunaré (raro). Cada uma tem faixa de peso, chance de mordida, janela de fisgada e resistência próprias; a pontuação cresce com peso, raridade e dificuldade. O peixe escapa se você não fisgar a tempo ou se a linha arrebentar.

### Determinismo

Toda aleatoriedade vem de um gerador com seed (`src/utils/rng.ts`; seed padrão `20261014` em `src/config/gameConfig.ts`). A simulação da pesca avança em passos fixos de 20 ms lendo um relógio injetável (`src/utils/clock.ts`), então o mesmo seed e o mesmo tempo dão o mesmo resultado — é isso que os testes usam.

### Qualidade gráfica

Em **Configurações** há os presets Baixa, Média e Alta (resolução interna, sombras, densidade da vegetação, partículas e detalhe da água), definidos em `src/engine/GraphicsQualityManager.ts`. O padrão é Média.

## Persistência

O jogo guarda um único item no `localStorage`, na chave `pesqueepague.save` (schema versão 2, definido em `src/config/persistence.ts`):

- configurações: qualidade, mostrar dicas e sensibilidade do mouse;
- volumes (geral, música e efeitos);
- melhor captura (espécie, peso e pontos);
- estatísticas: capturas, fugas, pontos e peso totais.

Não há dado pessoal. Ao carregar, cada campo é validado: valor fora da faixa volta ao padrão, JSON inválido ou maior que 64 KB é descartado e o save da versão 1 é migrado. Se o `localStorage` estiver bloqueado, o jogo funciona sem salvar. Para zerar tudo, apague a chave `pesqueepague.save` nas ferramentas do navegador.

### Galeria em IndexedDB (`src/save/`)

As capturas individuais (contrato `CatchRecord` de `src/progression/types.ts`), fotos como `Blob`, inventário e conquistas ficam no IndexedDB, banco `pesqueepague`:

- `db.ts`: wrapper fino sobre IndexedDB, sem dependência nova; a versão do banco é o número de migrações e o `onupgradeneeded` aplica, em ordem, só as que faltam.
- `storage.ts`: `IndexedDbAdapter` (banco real) e `MemoryAdapter` (testes), sobre a mesma interface `SaveStorage`.
- `catchRepository.ts`: CRUD de capturas com consultas por espécie, raridade, local, faixa de peso e de data, fotos, inventário e conquistas. `migrateLegacySave` copia o `bestCatch` e o `stats` do `pesqueepague.save` uma única vez (marca no store `meta`); as configurações, inclusive `settings.lureId`, continuam no `localStorage`.

Com o IndexedDB bloqueado ou indisponível, o jogo segue com um aviso no console e sem gravar capturas. No build `--mode e2e`, `window.__fp` ganha `saveCatch(record)`, `getCatch(id)` e `listCatches()` (`e2e/save.e2e.ts` grava, recarrega e encontra).

## Arquitetura (`src/`)

| Pasta | Responsabilidade |
|---|---|
| `main.ts` | Ponto de entrada: inicia o jogo, liga o áudio e mostra a tela de erro fatal. |
| `core/` | `bootstrap.ts` (monta tudo de BOOT a MENU), máquina de estados, entrada (mouse, teclado, pointer lock) e timers. |
| `config/` | Configuração validada (`gameConfig.ts`) e persistência com schema versionado (`persistence.ts`). |
| `engine/` | Renderizador WebGL2, câmera em primeira pessoa e gerenciador de qualidade gráfica. |
| `scenes/` | `lakeScene.ts`: a cena única do lago e o loop de renderização. |
| `world/` | Terreno, água (shader), céu, iluminação, vegetação instanciada, píer, partículas (pólen e chuva), ciclo de dia e noite (`timeOfDay.ts`), clima (`weather.ts`), ruído e descarte de recursos. |
| `fishing/` | Regras de arremesso (`cast.ts`) e de recolhimento/tensão (`reel.ts`); `visuals/` desenha vara, linha e boia. |
| `fish/` | Tabela de espécies e comportamento do peixe (`fishBrain.ts`: beliscada, mordida, fuga, puxão). |
| `gameplay/` | `fishingSession.ts`: liga as regras de pesca à máquina de estados, com diário e placar da sessão. |
| `ui/` | `gameUI.ts`: carregamento, menu (Jogar, Como jogar, Configurações, Diário, Créditos), HUD, pausa e resultado. |
| `audio/` | `AudioManager` (Web Audio), sons e música sintetizados em código (`synth.ts`) e ligação com os estados (`gameAudio.ts`). |
| `assets/` | `textures.ts`: texturas procedurais e o manifesto de arquivos permitidos, com fallback procedural. |
| `utils/` | RNG com seed e relógio. |
| `styles/` | CSS do jogo. |
| `tests/` | Testes unitários de integração (pesca, peixes, persistência, determinismo); outros testes ficam ao lado do módulo (`*.test.ts`). |

Os testes E2E ficam em `e2e/` e a configuração em `playwright.config.ts`.

### Atmosfera: hora, clima e vento

- `world/timeOfDay.ts` (sem three): `TimeOfDay` guarda a hora em [0, 24) e avança com o delta do loop (padrão: 1 hora do jogo por minuto, começando às 16h). `paletteAt(h)`, `sunDirectionAt(h)` e `moonDirectionAt(h)` são funções puras: mesma hora, mesmo resultado.
- `world/weather.ts` (sem three): `Weather` tem os climas `clear`, `cloudy` e `rain`, com transição suave de nuvens, chuva, névoa e vento. `fogRange(densidade, luzDoDia)` dá o near/far da névoa.
- **`Weather.getWind()`** devolve o vetor de vento compartilhado `{ x, z, speed }` em m/s no plano XZ, já com a rajada. É sempre o mesmo objeto, atualizado no lugar a cada `update`, então quem lê não aloca nada. O vento é determinístico: depende só do tempo acumulado e do clima. Hoje quem lê é `lakeScene.ts`, que repassa o vento às nuvens (`Sky.update`), ao pólen (`AmbientParticles.update`) e à chuva (`RainParticles.update`). A água, a vegetação e o arremesso devem ler o vento pelo mesmo `lake.weather.getWind()`, sem criar outro.
- `scenes/lakeScene.ts` junta tudo em `updateAtmosphere`: cores do céu e da água (`SKY_COLORS`), sol ou lua como luz direcional, luz hemisférica com piso de 0,35 (para a sombra não ficar preta), `Fog` cujo alcance depende da hora e do clima, e o environment map PMREM gerado do céu (`Lighting.updateEnvironment`). O PMREM só é refeito a cada 0,25 h ou quando a cobertura de nuvens muda 0,1.
- No build `--mode e2e`, `window.__fp` ganha `setTime(h)`, `setWeather('clear' | 'cloudy' | 'rain')` e `getAtmosphere()`.

## Assets e licenças

Todos os gráficos, sons e a música desta versão são gerados em código; nenhum arquivo de terceiros está incluído. A lista completa, com a licença de cada asset e de cada dependência, está em [ASSETS_LICENSES.md](ASSETS_LICENSES.md) e também aparece em **Créditos**, no menu. Texturas em arquivo só são carregadas da mesma origem (`/assets/`) e só se estiverem no manifesto de `src/assets/textures.ts`.

## Performance

Os resultados medidos ficam em [PERFORMANCE.md](PERFORMANCE.md), gerado com `npm run perf`.

> Nesta versão o `PERFORMANCE.md` e o teste `@perf` (`e2e/performance.e2e.ts`) ainda não estão no repositório, então `npm run perf` não encontra testes. Eles fazem parte da etapa de validação.

## Limitações do MVP

- Um único mapa (o lago com píer) e câmera fixa no píer: dá para olhar, não para andar.
- Três espécies de peixe; diário e placar valem só para a sessão atual (o que persiste é a melhor captura e as estatísticas).
- A linha não tem física real: tensão e distância são um modelo simplificado em `src/fishing/reel.ts`.
- O ajuste automático de qualidade existe no motor (`GraphicsQualityManager`, preset `auto`), mas o menu só oferece Baixa, Média e Alta, e o preset salvo é sempre fixo.
- Os volumes são salvos, mas ainda não há controle de volume na tela de configurações.
- Feito para mouse e teclado; a entrada já trata toque como clique, mas não há controles touch completos.
- O áudio só começa depois da primeira interação, por regra dos navegadores.
- Os testes E2E rodam só no Chromium.

## Roadmap

Fora do escopo deste MVP, por decisão do pedido, e candidatos a versões futuras:

- vários mapas e mundo aberto;
- multiplayer, contas de usuário e backend;
- loja de equipamentos, inventário e sistema de pagamentos;
- missões extensas;
- física realista completa de linha e anzol (Rapier só se a necessidade for comprovada);
- ciclo climático complexo;
- WebGPU como melhoria opcional.

Melhorias que completam o MVP atual: qualidade **Automática** e volumes de música e efeitos na tela de configurações, e a medição de performance documentada em `PERFORMANCE.md`.
