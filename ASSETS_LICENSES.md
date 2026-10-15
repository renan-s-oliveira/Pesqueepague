# Licenças de assets e dependências

Todo asset usado pelo jogo precisa estar nesta tabela, com a licença verificada individualmente antes de entrar no repositório.
Arquivos de textura só são carregados de `/assets/` (mesma origem) e só se estiverem em `TEXTURE_MANIFEST` (`src/assets/textures.ts`).
Se o arquivo faltar, o jogo usa a versão procedural.

## Assets

| Asset | Tipo | Origem | Autor | Licença | URL |
|---|---|---|---|---|---|
| Modelo dos peixes (corpo em loft com ossos, nadadeiras, olhos com íris e córnea, LOD de 2 níveis) | Geometria procedural (`src/fish/visual/fishModel.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Pele dos peixes (albedo com escamas e manchas por espécie, normal e rugosidade) | DataTexture procedural (`src/fish/visual/fishTextures.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Terreno (bacia do lago, margem irregular, morros ao fundo e montanhas) | Geometria procedural (`src/world/terrain.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Splat PBR do terreno (areia, terra, grama e pedra, rugosidade por camada) | Shader GLSL (`src/world/terrain.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Textura de detalhe do chão (`terrainDetail`: ondulação da areia, torrões, fissuras da pedra) | Textura procedural em canvas (`createTerrainDetailTexture`, `src/assets/textures.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Água do lago (ondas, fresnel, reflexo do céu, ripples) | Shader GLSL (`src/world/lake.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Céu com gradiente, sol e nuvens | Shader GLSL (`src/world/sky.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Vegetação tropical: palmeiras, árvores de copa larga, arbustos, juncos, rochas, troncos caídos com raízes, folhas no chão e flores (LOD e balanço de vento no vertex shader) | Geometria procedural instanciada + shader GLSL (`src/world/vegetation.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Pássaros e insetos (animação procedural) | Geometria procedural instanciada (`src/world/fauna.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Píer de madeira (tábuas e estacas) | Geometria procedural instanciada (`src/world/pier.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Textura de madeira | Textura procedural em canvas (`src/assets/textures.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Partículas ambientais (pólen/vaga-lumes) | Pontos procedurais (`src/world/particles.ts`) | Original, gerado em código | Equipe Pesque e Pague | Original do projeto | — |
| Ambiente de floresta e vento | Som procedural, ruído filtrado (`src/audio/synth.ts`, `generateForest`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Água do lago (marola e gotas) | Som procedural, ruído filtrado e senos (`generateWater`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Pássaros | Som procedural, osciladores com glissando (`generateBirds`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Arremesso | Efeito procedural, ruído em passa-faixa (`generateCast`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Impacto da boia | Efeito procedural (`generateSplash`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Linha / catraca do molinete | Efeito procedural (`generateLine`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Mordida | Efeito procedural (`generateBite`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Captura | Efeito procedural, arpejo (`generateCatch`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Falha | Efeito procedural (`generateFail`) | Original, sintetizado em código | Equipe Pesque e Pague | Original do projeto | — |
| Música de menu (pad) | Música procedural, acordes em senos (`generateMenuPad`) | Original, composta e sintetizada em código | Equipe Pesque e Pague | Original do projeto | — |

Nenhum arquivo de terceiros (modelo, textura, som ou fonte) está incluído nesta versão.

## Dependências

| Pacote | Uso | Origem | Autor | Licença | URL |
|---|---|---|---|---|---|
| three | Runtime (renderização WebGL2) | npm | three.js authors | MIT | https://github.com/mrdoob/three.js |
| @types/three | Desenvolvimento (tipos) | npm | DefinitelyTyped / three-types | MIT | https://github.com/three-types/three-ts-types |
| typescript | Desenvolvimento (compilador) | npm | Microsoft | Apache-2.0 | https://github.com/microsoft/TypeScript |
| vite | Desenvolvimento (build e servidor) | npm | VoidZero Inc. e contribuidores do Vite | MIT | https://github.com/vitejs/vite |
| vitest | Desenvolvimento (testes) | npm | VoidZero Inc. e contribuidores do Vitest | MIT | https://github.com/vitest-dev/vitest |
| @playwright/test | Desenvolvimento (testes end-to-end e de desempenho) | npm | Microsoft | Apache-2.0 | https://github.com/microsoft/playwright |

As dependências transitivas vêm do `package-lock.json`; nenhuma é embutida como asset.
