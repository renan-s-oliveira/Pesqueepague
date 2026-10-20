import type { FishSpecies } from './species.ts';

/** Distribuição exclusiva de jogo; medidas e resistência são balanceadas para a simulação. */
export const EXTRA_FISH = [
  ['pacu', 'Pacu', 'Piaractus mesopotamicus', 'tropical', 'carp', .4, 12],
  ['tambaqui', 'Tambaqui', 'Colossoma macropomum', 'tropical', 'carp', 1, 30],
  ['pirapitinga', 'Pirapitinga', 'Piaractus brachypomus', 'tropical', 'carp', .8, 20],
  ['curimbata', 'Curimbatá', 'Prochilodus lineatus', 'tropical', 'small', .3, 7],
  ['piau', 'Piau', 'Leporinus friderici', 'tropical', 'small', .1, 3],
  ['piapara', 'Piapara', 'Megaleporinus obtusidens', 'tropical', 'carp', .4, 8],
  ['piauçu', 'Piauçu', 'Megaleporinus macrocephalus', 'tropical', 'carp', .5, 10],
  ['dourado', 'Dourado', 'Salminus brasiliensis', 'tropical', 'predator', .8, 25],
  ['matrinxa', 'Matrinxã', 'Brycon amazonicus', 'tropical', 'small', .3, 5],
  ['saicanga', 'Saicanga', 'Acestrorhynchus pantaneiro', 'tropical', 'predator', .05, .5],
  ['traira', 'Traíra', 'Hoplias malabaricus', 'tropical', 'predator', .3, 6],
  ['trairao', 'Trairão', 'Hoplias aimara', 'tropical', 'predator', 1, 35],
  ['apapa', 'Apapá', 'Pellona castelnaeana', 'tropical', 'predator', .4, 7],
  ['acara', 'Acará', 'Geophagus brasiliensis', 'tropical', 'small', .05, .8],
  ['carazinho', 'Carazinho', 'Cichlasoma paranaense', 'tropical', 'small', .02, .25],
  ['truta-arcoiris', 'Truta arco-íris', 'Oncorhynchus mykiss', 'serra', 'trout', .2, 8],
  ['truta-marrom', 'Truta marrom', 'Salmo trutta', 'serra', 'trout', .3, 12],
  ['truta-riacho', 'Truta de riacho', 'Salvelinus fontinalis', 'serra', 'trout', .15, 5],
  ['salmao-atlantico', 'Salmão do Atlântico', 'Salmo salar', 'serra', 'trout', 1, 25],
  ['salmao-chinook', 'Salmão chinook', 'Oncorhynchus tshawytscha', 'serra', 'trout', 2, 40],
  ['salvelino', 'Salvelino alpino', 'Salvelinus alpinus', 'serra', 'trout', .2, 10],
  ['carpa-comum', 'Carpa comum', 'Cyprinus carpio', 'serra', 'carp', .5, 25],
  ['carpa-amur', 'Carpa de Amur', 'Cyprinus rubrofuscus', 'serra', 'carp', .5, 18],
  ['carpa-capim', 'Carpa capim', 'Ctenopharyngodon idella', 'serra', 'carp', 1, 35],
  ['carpa-prateada', 'Carpa prateada', 'Hypophthalmichthys molitrix', 'serra', 'carp', 1, 30],
  ['carpa-cabecuda', 'Carpa cabeçuda', 'Hypophthalmichthys nobilis', 'serra', 'carp', 1, 35],
  ['tenca', 'Tenca', 'Tinca tinca', 'serra', 'carp', .2, 5],
  ['barbo', 'Barbo', 'Barbus barbus', 'serra', 'small', .3, 10],
  ['perca', 'Perca europeia', 'Perca fluviatilis', 'serra', 'predator', .1, 3],
  ['black-bass', 'Black bass', 'Micropterus salmoides', 'serra', 'predator', .3, 8],
  ['bluegill', 'Bluegill', 'Lepomis macrochirus', 'serra', 'small', .03, 1.5],
  ['esturjao-siberiano', 'Esturjão siberiano', 'Acipenser baerii', 'serra', 'ancient', 2, 60],
  ['esturjao-russo', 'Esturjão russo', 'Acipenser gueldenstaedtii', 'serra', 'ancient', 3, 70],
  ['pirarucu', 'Pirarucu', 'Arapaima gigas', 'igapo', 'ancient', 3, 90],
  ['aruana', 'Aruanã', 'Osteoglossum bicirrhosum', 'igapo', 'ancient', .5, 7],
  ['tucunare-acu', 'Tucunaré-açu', 'Cichla temensis', 'igapo', 'predator', 1, 12],
  ['pintado', 'Pintado', 'Pseudoplatystoma corruscans', 'igapo', 'catfish', 1, 50],
  ['cachara', 'Cachara', 'Pseudoplatystoma reticulatum', 'igapo', 'catfish', 1, 30],
  ['jau', 'Jaú', 'Zungaro jahu', 'igapo', 'catfish', 3, 90],
  ['pirarara', 'Pirarara', 'Phractocephalus hemioliopterus', 'igapo', 'catfish', 2, 70],
  ['surubim', 'Surubim-tigre', 'Pseudoplatystoma tigrinum', 'igapo', 'catfish', 1, 45],
  ['jurupensem', 'Jurupensém', 'Sorubim lima', 'igapo', 'catfish', .3, 5],
  ['barbado', 'Barbado', 'Pinirampus pirinampu', 'igapo', 'catfish', .5, 12],
  ['mandi', 'Mandi', 'Pimelodus maculatus', 'igapo', 'catfish', .1, 3],
  ['jundia', 'Jundiá', 'Rhamdia quelen', 'igapo', 'catfish', .2, 5],
  ['peixe-cachorro', 'Peixe-cachorro', 'Hydrolycus scomberoides', 'igapo', 'predator', .5, 15],
  ['piranha-vermelha', 'Piranha vermelha', 'Pygocentrus nattereri', 'igapo', 'predator', .1, 3],
  ['piranha-preta', 'Piranha preta', 'Serrasalmus rhombeus', 'igapo', 'predator', .2, 4],
  ['aracu', 'Aracu', 'Schizodon fasciatus', 'igapo', 'small', .2, 3],
  ['bicuda', 'Bicuda', 'Boulengerella cuvieri', 'igapo', 'predator', .3, 6],
] as const;

export type ExtraSpeciesId = (typeof EXTRA_FISH)[number][0];
export type FishFamily = (typeof EXTRA_FISH)[number][4];
const PALETTES = [
  ['#3a564b', '#9cba86', '#e6dfbc', '#bf7945'],
  ['#2d4552', '#9bb7bf', '#e8e5d7', '#768c97'],
  ['#354737', '#b9aa58', '#f0ddb0', '#cd8546'],
  ['#483b45', '#b48d91', '#f0d6c1', '#a54d50'],
  ['#36464c', '#b3b4a0', '#eee6cc', '#677c73'],
] as const;

export function extraSpecies(): FishSpecies[] {
  return EXTRA_FISH.map(([id, name, scientificName, lakeId, family, minWeightKg, maxWeightKg], index) => {
    const predator = family === 'predator' || family === 'ancient';
    const palette = PALETTES[index % PALETTES.length]!;
    const difficulty = Math.min(.86, .22 + Math.log2(1 + maxWeightKg) * .09);
    return {
      id, name, scientificName, lakeId, family,
      habitat: lakeId === 'serra' ? 'Águas claras do Lago da Serra; explore os remansos e as áreas profundas.' : lakeId === 'igapo' ? 'Águas escuras do Lago do Igapó, entre raízes e margens alagadas.' : 'Margens vegetadas e águas quentes do Lago Tropical.',
      curiosities: [`Exclusivo do ${lakeId === 'serra' ? 'Lago da Serra' : lakeId === 'igapo' ? 'Lago do Igapó' : 'Lago Tropical'} neste jogo.`, `Uma captura pode variar de ${minWeightKg} a ${maxWeightKg} kg na simulação.`],
      lengthWeight: { a: family === 'carp' ? .025 : family === 'catfish' ? .007 : .012, b: 3 },
      depthRangeM: { min: family === 'catfish' ? 1 : 0, max: family === 'ancient' ? 8 : 4 },
      preferredTempC: lakeId === 'serra' ? { min: 8, max: 22 } : { min: 22, max: 32 },
      preferredLures: predator ? ['spinner', 'popper', 'jig'] : family === 'catfish' ? ['worm', 'pellet', 'jig'] : ['corn', 'dough', 'pellet'],
      conservationStatus: 'least_concern',
      visual: { palette: { dorsal: palette[0], flank: palette[1], belly: palette[2], fin: palette[3] },
        proportions: { bodyDepth: (family === 'carp' ? .49 : family === 'small' ? .36 : .24) + index % 3 * .02, headLength: (family === 'catfish' ? .29 : .2) + index % 4 * .01, caudalLength: (family === 'ancient' ? .17 : .21) + index % 3 * .015 },
        spots: { pattern: family === 'trout' ? 'humeral_caudal_spots' : index % 2 ? 'vertical_bars' : 'ocellated_bars', count: 3 + index % 7, color: '#233c36' } },
      minWeightKg, maxWeightKg, rarity: maxWeightKg >= 30 ? 'rare' : maxWeightKg >= 5 ? 'uncommon' : 'common',
      difficulty, spawnWeight: maxWeightKg >= 30 ? 5 : maxWeightKg >= 5 ? 18 : 40, biteChance: .7 - difficulty * .25,
      resistance: { basePull: .18 + difficulty * .5, burstPull: .5 + difficulty, burstChancePerSec: .15 + difficulty * .3, burstMs: 350 + Math.round(difficulty * 700) },
    };
  });
}
