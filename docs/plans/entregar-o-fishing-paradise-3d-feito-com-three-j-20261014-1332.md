# Entregar o FISHING PARADISE 3D, feito com Three.js, TypeScript estrito e Vite, com um lago bonito, menu animado, ciclo completo de pescaria (arremesso, mordida, fisgada, recolhimento e captura), quali

> Plano do Orchestrator criado pelo chat do Harness em 2026-10-14T16:32:23.461Z.
> Pedido: A proposta é criar um jogo de pescaria 3D para navegador, com paisagens naturais bonitas, água realista, vegetação, iluminação cinematográfica e uma jogabilidade simples, mas envolvente. O MVP deve ser leve, rápido, visualmente agradável e ter uma arquitetura preparada para evoluir para um jogo mais completo.

Minha sugestão é utilizar Three.js + TypeScript + Vite, com bibliotecas e assets gratuitos de licenças compatíveis. A direção artística pode ser stylized realistic: um visual próximo de jogos de aventura modernos, sem exigir gráficos pesados.

[Wooden dock lake landscape panoramic | Premium Photo Illustration - rawpixel](https://images.openai.com/static-rsc-4/99_NCbU-FI0dXzMLy9QYXbbrcxgEWzKB2EcZj7gmpT05KTFuvpxeL4Hgk_CV93jlcCHsqPxyaGwsyC1yDw83JUURn15hdqiTndnYCMMjuvFde0iX5fDPip74xpUoe2GM4eWmd5eWFqi2VVhBge3hMMj1mlMrwfiGmxNBFwFqsV8?purpose=inline)

[Lake house retreat - Payhip](https://images.openai.com/static-rsc-4/69hE1Eo6dEgmnoS_1LUQNNl_Xki4dnQLoucdFc5kPXFPEWHjxH7ruMEpvAtVac4ycxbncW-8eueTc72qV7tMFhNl-ro4ny4haUZyEKC-pSAUqt5qvWySkQ8923XGgZDUpt2pLBvmuVMr8GLU9mRfhkkBPgPVCdxlGXpEmarqLyM?purpose=inline)

Referências visuais para a direção artística do MVP, não assets finais do jogo.

## Prompt completo para Claude Code / Harness

# PROJETO: FISHING 3D — JOGO DE PESCARIA PARA NAVEGADOR

## 1. Objetivo

Você é um time de desenvolvimento especializado em jogos 3D, formado por Game Developer, Game Designer, Technical Artist, UI/UX Designer, Arquiteto de Software, Engenheiro de Performance e QA.

Sua missão é **planejar, desenvolver, testar e entregar um MVP funcional de um jogo de pescaria 3D para navegador**, utilizando tecnologias open source, com prioridade para:

- Paisagens naturais visualmente impressionantes.
- Jogabilidade agradável, simples e responsiva.
- Alto desempenho e baixo consumo de memória.
- Menu principal moderno, com animações e identidade visual.
- Experiência completa de pescaria, desde o lançamento da linha até a captura.
- Arquitetura modular, preparada para expansão.
- Compatibilidade com navegadores modernos.
- Funcionamento local sem necessidade de backend.
- Assets, sprites, modelos 3D, texturas e efeitos sonoros com licenças verificadas.

O objetivo não é criar um protótipo vazio. Entregue um jogo realmente jogável, com início, interação, desafio, captura, feedback visual e possibilidade de jogar novamente.

## 2. Stack tecnológica

Priorize tecnologias maduras, gratuitas e open source.

**Engine e renderização**

- Three.js como motor gráfico WebGL.
- TypeScript com tipagem estrita.
- Vite para desenvolvimento e build.
- WebGL2 como alvo principal.
- WebGPU somente como melhoria futura e opcional.

**Interface**

- HTML5 e CSS moderno.
- Tailwind CSS, se agregar valor.
- HUD integrado à experiência visual.
- Animações CSS ou Motion, quando justificadas.

**Recursos auxiliares**

- Zustand vanilla ou máquina de estados simples, somente se necessário.
- Rapier para física apenas se houver necessidade comprovada.
- Howler.js ou Web Audio API para áudio.
- GLTFLoader para modelos GLB/glTF.
- InstancedMesh e LOD para otimização.
- Testes com Vitest e Playwright.

Evite dependências pesadas, engines redundantes, serviços pagos ou bibliotecas sem manutenção.

## 3. Direção artística

Criar uma identidade visual própria, inspirada em ambientes naturais de jogos modernos de pescaria e exploração.

Estilo: **Stylized Realistic / Cozy Fishing Adventure**.

O jogo deverá conter:

- Lago grande com água visualmente bonita.
- Montanhas ao fundo.
- Floresta com árvores variadas.
- Vegetação nas margens.
- Rochas e pequenos detalhes naturais.
- Céu com nuvens suaves.
- Iluminação de fim de tarde.
- Reflexos e ondas leves na água.
- Pequenas partículas ambientais.
- Píer de madeira como ponto inicial de pesca.
- Elementos decorativos como troncos, arbustos e flores.

A ambientação deve transmitir tranquilidade, natureza e imersão.

### Requisitos gráficos

Implementar técnicas eficientes:

- Água usando shaders leves, com movimento e reflexos aproximados.
- Sombras ajustáveis.
- Fog atmosférico.
- Tone mapping.
- Correção de cores apropriada.
- Vegetação instanciada.
- Modelos com quantidade controlada de polígonos.
- Texturas comprimidas quando houver suporte.
- Iluminação otimizada.
- Frustum culling e LOD onde agregarem valor.

Evitar ray tracing, SSR pesado, volumetria custosa e pós-processamento excessivo.

O resultado deve parecer um jogo comercial indie bem-acabado, mesmo usando recursos modestos.

## 4. Assets open source

Pesquisar e selecionar assets em fontes como:

- Kenney.nl
- Poly Haven
- Quaternius
- OpenGameArt
- itch.io, filtrando por licenças adequadas.
- Sketchfab, somente assets cuja licença permita o uso pretendido.

Priorizar CC0 ou licenças permissivas, mantendo créditos quando exigidos.

**Regras obrigatórias:**

1. Verificar a licença de cada asset individualmente.
2. Registrar origem, autor, licença e URL.
3. Não utilizar imagens ou modelos protegidos sem autorização.
4. Não copiar identidade visual de jogos comerciais.
5. Não presumir que um asset é livre apenas porque está disponível para download.
6. Armazenar os créditos em ASSETS_LICENSES.md.
7. Criar assets procedurais simples quando isso for mais eficiente.

Usar modelos GLB/glTF, texturas WebP/KTX2 quando adequado e sprites transparentes para vegetação distante, partículas ou efeitos.

Se um asset adequado não estiver disponível, criar uma alternativa procedural em vez de bloquear o projeto.

## 5. Tela de abertura e menu principal

Criar uma abertura visualmente impressionante.

### Cena inicial

- Câmera mostrando um lago entre montanhas.
- Movimento cinematográfico suave.
- Árvores e vegetação ao redor.
- Reflexos na água.
- Sons de pássaros e natureza.
- Música ambiente discreta.
- Transição elegante para o menu.

### Menu

Título provisório: **FISHING PARADISE 3D**

Opções:

- Jogar
- Como jogar
- Configurações
- Créditos

Configurações:

- Qualidade gráfica: Baixa / Média / Alta / Automática.
- Volume da música.
- Volume dos efeitos.
- Sensibilidade do mouse.
- Tela cheia.
- Ativar/desativar sombras.

O menu deve ser responsivo, com tipografia elegante, botões animados e efeitos sutis.

Evitar criar uma segunda cena 3D desnecessária: reutilizar o ambiente do jogo para a apresentação sempre que possível.

## 6. Gameplay do MVP

### 6.1 Cenário inicial

O jogador começa em um píer de madeira, olhando para o lago.

A câmera pode utilizar primeira pessoa simplificada, com a vara de pesca visível.

Não implementar movimentação livre complexa neste MVP. Priorizar a qualidade da pescaria.

Permitir movimentar a câmera horizontal e verticalmente dentro de limites adequados.

### 6.2 Sistema de arremesso

Fluxo:

1. Jogador segura o botão esquerdo do mouse.
2. Uma barra de potência começa a carregar.
3. Ao soltar, a vara executa uma animação.
4. A linha e a boia são lançadas.
5. A distância depende da potência.
6. A boia cai na água, criando pequenas ondas.
7. Inicia-se o estado de espera.

A trajetória pode utilizar uma curva balística simplificada, sem engine de física completa.

### 6.3 Sistema de peixes

Implementar inicialmente três espécies fictícias ou comuns, com modelos e comportamentos distintos:

- Lambari: pequeno, fácil de capturar.
- Tilápia: média dificuldade.
- Tucunaré: mais raro e desafiador.

Cada espécie deverá ter:

- Nome.
- Peso variável dentro de uma faixa configurável.
- Raridade.
- Dificuldade.
- Comportamento durante a fisgada.
- Modelo 3D ou representação visual.
- Probabilidade de aparecer.

Usar uma máquina de estados para o comportamento dos peixes.

Os peixes podem ser simulados de maneira econômica, sem manter centenas de entidades físicas ativas.

### 6.4 Sistema de mordida

Após um período variável:

- Um peixe pode se aproximar da isca.
- A boia começa a se movimentar.
- Pequenas ondas aparecem.
- Um efeito sonoro indica atividade.
- O jogador recebe uma janela de tempo para fisgar.

A mordida não deve ocorrer sempre no mesmo intervalo.

A lógica precisa ser determinística quando executada com uma seed fixa para facilitar testes.

### 6.5 Sistema de fisgada

Quando o peixe morder, o jogador deverá clicar no momento adequado.

Se acertar, inicia a disputa.

Se errar, o peixe escapa.

### 6.6 Minigame de recolhimento

Criar um sistema simples, divertido e visual.

- Segurar o mouse ou tecla para recolher.
- Indicador de tensão da linha.
- O peixe oferece resistência variável.
- Recolher demais aumenta a tensão.
- Pausar o recolhimento reduz a tensão.
- Se a tensão ultrapassar o limite durante determinado tempo, a linha rompe.
- Quando a distância chega a zero, o peixe é capturado.

A dificuldade deve variar conforme a espécie e o peso.

Implementar feedback visual e sonoro claro.

### 6.7 Captura

Quando o jogador captura um peixe:

- Exibir uma animação de sucesso.
- Mostrar o peixe em destaque.
- Nome da espécie.
- Peso.
- Raridade.
- Pontuação recebida.
- Botão para continuar pescando.

Adicionar um pequeno diário de capturas durante a sessão.

## 7. Interface durante o jogo

Criar um HUD moderno, discreto e elegante.

Exibir apenas o necessário em cada estado.

Durante a pescaria:

- Indicador de potência do arremesso.
- Status da boia.
- Aviso de mordida.
- Tensão da linha.
- Progresso de recolhimento.
- Mensagens curtas de orientação.

Outros elementos:

- Botão de pausa.
- Menu de configurações.
- Contador de capturas.
- Pontuação.
- Pequeno tutorial contextual.

A interface não deve esconder a paisagem.

## 8. Controles

Mouse:

- Movimentar: olhar ao redor.
- Botão esquerdo: carregar e lançar.
- Clique: fisgar.
- Segurar botão esquerdo: recolher.

Teclado:

- ESC: pausar.
- Espaço: alternativa para fisgar/recolher.
- H: mostrar ajuda.

Implementar controles de acordo com o estado atual do jogo, evitando conflitos entre ações.

Preparar abstração para suporte futuro a dispositivos móveis, sem exigir controles touch completos neste MVP.

## 9. Áudio e ambientação

Adicionar:

- Som ambiente de floresta.
- Água suave.
- Pássaros.
- Arremesso.
- Impacto da boia na água.
- Movimento da linha.
- Mordida.
- Captura.
- Falha.
- Música de menu.

Usar áudio compactado e carregar recursos sob demanda.

Respeitar as restrições de autoplay dos navegadores.

## 10. Performance

A performance é requisito crítico.

### Metas iniciais

- Alvo de 60 FPS em computadores intermediários.
- Modo econômico para GPUs integradas.
- Evitar alocações recorrentes no loop de renderização.
- Evitar garbage collection excessivo.
- Reutilizar geometrias e materiais.
- Limitar draw calls.
- Usar object pooling para partículas e efeitos.
- Utilizar instancing na vegetação.
- Carregamento progressivo dos assets.
- Controle de pixel ratio.
- Redução automática de qualidade quando necessário.
- Pausar renderização intensiva quando a aba estiver oculta.

O jogo deve ajustar sua qualidade de acordo com o dispositivo.

As metas precisam ser medidas em hardware real ou ambiente de benchmark representativo, nunca declaradas como atingidas sem testes.

### Gerenciador gráfico adaptativo

Criar um módulo GraphicsQualityManager com:

- Monitoramento de frame time.
- Média móvel de desempenho.
- Ajuste de resolução interna.
- Ajuste de sombras.
- Redução de efeitos.
- Histerese para evitar alternância contínua de qualidade.
- Limites mínimos e máximos configuráveis.

## 11. Arquitetura

Organizar o projeto em módulos claros:

src/

- core/
- engine/
- scenes/
- world/
- fishing/
- fish/
- gameplay/
- ui/
- audio/
- assets/
- config/
- utils/
- tests/

Responsabilidades:

**Core:** bootstrap, estados e ciclo de vida.

**Engine:** renderização, câmera e gerenciamento gráfico.

**World:** terreno, água, vegetação, céu e ambiente.

**Fishing:** vara, linha, arremesso, boia e recolhimento.

**Fish:** espécies, comportamento, geração e captura.

**Gameplay:** progressão da sessão e regras.

**UI:** menu, HUD, tutorial e telas.

**Audio:** sons e música.

**Assets:** carregamento, cache, descarte e licenças.

Usar interfaces e componentes desacoplados.

Não criar uma arquitetura excessivamente abstrata para um MVP.

## 12. Estados do jogo

Implementar uma máquina de estados explícita:

BOOT\
→ LOADING\
→ MAIN_MENU\
→ PLAYING\
→ CASTING\
→ WAITING\
→ BITE\
→ HOOKED\
→ REELING\
→ CAUGHT / ESCAPED\
→ PLAYING

PAUSED deve preservar e restaurar corretamente o estado anterior.

Todas as transições devem ser validadas.

Impedir eventos duplicados, arremessos simultâneos, captura dupla ou timers abandonados.

## 13. Persistência

Usar localStorage inicialmente para:

- Configurações gráficas.
- Volume.
- Preferências.
- Melhor captura.
- Estatísticas simples.

Não implementar autenticação, banco de dados ou backend no MVP.

Validar os dados carregados e prever versionamento da estrutura persistida.

## 14. Segurança e qualidade

- Não executar código remoto arbitrário.
- Evitar dependências desnecessárias.
- Não carregar assets de origens desconhecidas em produção.
- Aplicar políticas de segurança compatíveis com a hospedagem.
- Não armazenar informações pessoais desnecessárias.
- Validar entradas e configurações.
- Tratar erros de carregamento.
- Implementar fallback visual para assets ausentes.
- Evitar vazamentos de memória.
- Descartar listeners, materiais, geometrias e texturas ao desmontar cenas.

## 15. Testes

Implementar:

**Testes unitários**

- Estados do jogo.
- Potência do arremesso.
- Probabilidade de mordida.
- Dificuldade dos peixes.
- Tensão da linha.
- Regras de captura.
- Persistência.

**Testes de integração**

- Fluxo completo de pescaria.
- Pausa e retomada.
- Reinício da sessão.
- Configurações gráficas.
- Falha no carregamento de assets.

**Testes E2E**

- Abertura do jogo.
- Menu principal.
- Início de partida.
- Arremesso.
- Mordida.
- Fisgada.
- Captura.
- Retorno ao menu.

Utilizar seeds e relógio controlável nos testes para evitar instabilidade.

Não remover validações para acelerar a suíte.

## 16. Entrega do MVP

O projeto deverá conter:

1. Tela de carregamento com progresso.
2. Menu principal animado.
3. Cenário 3D completo.
4. Lago com água animada.
5. Vegetação e montanhas.
6. Câmera controlável.
7. Vara de pesca visível.
8. Arremesso funcional.
9. Sistema de mordida.
10. Três espécies de peixes.
11. Minigame de recolhimento.
12. Tela de captura.
13. Sons ambientes.
14. Configurações gráficas.
15. Sistema de qualidade adaptativa.
16. Testes automatizados.
17. README com instruções.
18. Registro de licenças dos assets.
19. Build de produção funcional.

## 17. Processo de desenvolvimento

Antes de implementar:

1. Inspecione o workspace.
2. Verifique a estrutura existente.
3. Pesquise bibliotecas e assets adequados.
4. Valide compatibilidade e licenças.
5. Defina arquitetura mínima.
6. Crie um plano incremental.
7. Identifique dependências entre tarefas.
8. Apresente o plano para aprovação.

Após aprovação, execute em etapas:

**Etapa 1 — Fundação**\
Configuração, TypeScript, Vite, renderizador, estrutura e testes básicos.

**Etapa 2 — Ambiente**\
Terreno, água, vegetação, céu, iluminação e otimização.

**Etapa 3 — Interface**\
Menu, carregamento, HUD e configurações.

**Etapa 4 — Pescaria**\
Vara, arremesso, boia, mordida e peixes.

**Etapa 5 — Gameplay**\
Fisgada, recolhimento, captura, pontuação e feedback.

**Etapa 6 — Polimento**\
Animações, áudio, partículas e experiência visual.

**Etapa 7 — Validação**\
Testes, profiling, otimização e build final.

Sempre manter uma versão executável após cada etapa.

## 18. Critérios de aceite

O MVP somente estará concluído quando:

- O jogo abrir corretamente no navegador.
- O menu estiver funcional.
- A paisagem 3D estiver completa.
- O jogador conseguir arremessar a linha.
- Os peixes apresentarem comportamento variável.
- A fisgada funcionar.
- O jogador conseguir recolher e capturar peixes.
- A interface mostrar os estados corretamente.
- O jogo puder ser pausado e reiniciado.
- O áudio funcionar após interação do usuário.
- As configurações persistirem.
- Não houver erros críticos no console.
- Não existirem vazamentos de memória conhecidos nos fluxos testados.
- O build de produção funcionar.
- As licenças dos assets estiverem documentadas.
- Os testes automatizados passarem.
- A performance for medida e documentada.

## 19. Restrições de escopo

Não implementar agora:

- Multiplayer.
- Loja de equipamentos.
- Inventário complexo.
- Mundo aberto.
- Missões extensas.
- Backend.
- Contas de usuários.
- Sistema de pagamentos.
- Inteligência artificial externa.
- Física realista completa de linha e anzol.
- Ciclo climático complexo.
- Vários mapas.

Essas funcionalidades poderão ser adicionadas futuramente.

## 20. Diretriz final

O objetivo principal é **entregar um pequeno jogo de pescaria 3D bonito, fluido e divertido**, não uma demonstração técnica.

Priorize, nesta ordem:

1. Jogabilidade funcional.
2. Performance.
3. Beleza visual.
4. Facilidade de uso.
5. Estabilidade.
6. Arquitetura extensível.

Não substitua funcionalidades reais por botões decorativos, mocks permanentes ou simulações sem interação.

Tome decisões técnicas justificadas, reutilize soluções consolidadas e evite complexidade desnecessária.

Ao finalizar, execute o jogo, valide o fluxo completo, apresente evidências dos testes, documente limitações e disponibilize os comandos para iniciar o projeto localmente.

## Sugestão de aparência das telas

[Sierra Waves | Electric Boat Charters - Sacramento River](https://images.openai.com/static-rsc-4/CE5QW7BmwcItjosoDd0i3q_0GglNN3vmrNIN0w7L8OW3g2hn595mUY6amcQwGrEza75eUDlgtgp3NM5zwuWdf51391p4OEReEx5WwDyAyStFE3ZE4uMzTRYAqNE91vG-8hTVp3Xdr6nmp4t4ZhC3-EnEXfKkvESZlx2Ic1trBKM?purpose=inline)

Menu principal

Cenário 3D ao fundo, câmera se movendo lentamente, menu com botões discretos e música relaxante.

[Call of the Wild: The Angler - Download](https://images.openai.com/static-rsc-4/lWj2vkd6hlNP-r9uq3DkTGXRTmtqu9Pn60XWuKENzsi-Q2I7KWAW0MDiAAxH8UmWCusXpof44ivLItvP3R-BHwyRs0-ndhV-jZNUXOl3x9AGlJhSnMNJ7kCdgRAUVY5_wbuZ6Yf2u_45DDA-uMx4WeQQ2RE-ausJN5RsNFirsUM?purpose=inline)

Jogabilidade

Visão em primeira pessoa, vara de pesca na tela, boia na água e HUD mínimo para preservar a paisagem.

[Buy Fishing Sim World: Pro Tour - Lake Arnold - PC (Steam) - Europe & USA & Canada](https://images.openai.com/static-rsc-4/pgMQx0suU1fxjWkrMrQzfJgpGTF9M0YmVZyuooW2BeAVkiNHXK-O8k9jQ2fJhpqAo6U_kyqG0h3uIBsFNnup75n0fi4wNQ8u6u1oc1NDs3NVmw0bc_2fh8fmudOysSHONw_zEPycR9D__HHVcuV572nH9KWj9wf2PpcqOn2XNdE?purpose=inline)

Captura

Apresentação do peixe capturado, peso, raridade e pontuação com animação de recompensa.

## Recomendações técnicas para o MVP

| Componente  | Tecnologia              | Motivo                             |
| ----------- | ----------------------- | ---------------------------------- |
| Gráficos 3D | Three.js                | Controle e leveza                  |
| Linguagem   | TypeScript              | Manutenção e segurança             |
| Build       | Vite                    | Desenvolvimento rápido             |
| Modelos 3D  | glTF / GLB              | Formato eficiente                  |
| Terreno     | Geometria procedural    | Menos downloads                    |
| Água        | Shader GLSL             | Visual bonito com custo controlado |
| Física      | Matemática simplificada | Evita engine pesada                |
| Testes      | Vitest + Playwright     | Cobertura funcional                |

Minha principal recomendação: concentrar o investimento visual em um único lago extremamente bem-feito, com uma bela iluminação de fim de tarde, em vez de construir vários cenários medianos. Para o MVP, a combinação de água animada, vegetação instanciada, céu atmosférico e uma mecânica de pesca bem ajustada tende a produzir o melhor resultado com baixo custo de processamento.

O prompt já está estruturado para ser entregue ao Claude Code ou ao orquestrador do Harness, com planejamento, execução incremental, validação e testes.
> Plano `01a13b40-1aec-774a-9434-85f3111fe0b7`, versão 1, estado `PENDING_REVIEW`.

## Tarefas

| id | tarefa | estado | agente | batch | depende de |
|----|--------|--------|--------|-------|------------|
| t001 | Fundação: scaffold Vite TS, git e núcleo de estados | PENDING_REVIEW | agent.dev.run | 1 | — |
| t002 | Mundo 3D, engine e qualidade adaptativa | PENDING_REVIEW | agent.dev.run | 2 | t001 |
| t003 | Lógica de pescaria, peixes, regras e persistência | PENDING_REVIEW | agent.dev.run | 2 | t001 |
| t004 | Interface, entrada e cena jogável integrada | PENDING_REVIEW | agent.uiux.run | 3 | t002, t003 |
| t005 | Áudio ambiente e efeitos sonoros | PENDING_REVIEW | agent.dev.run | 3 | t001, t002 |
| t006 | Ligação do áudio, E2E Playwright, medição de performance, README e build final | PENDING_REVIEW | agent.dev.run | 4 | t004, t005 |

## Execução

- batch 1: t001
- batch 2 (em paralelo): t002, t003
- batch 3 (em paralelo): t004, t005
- batch 4: t006

Os batches vêm do `executionPlan` do Core (17 §9.1): o batch é a forma da relação `needs` para
quem lê, e quem libera o próximo é o motor. Cada tarefa vira um step governado — política,
aprovações e audit por step —, e a execução só começa depois da aprovação do plano (17 §3.1).

O estado real está no plano `01a13b40-1aec-774a-9434-85f3111fe0b7`, não aqui.
