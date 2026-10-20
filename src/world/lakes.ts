import { SPECIES, type FishSpecies, type SpeciesId } from '../fish/species.ts';

export const LAKE_IDS = ['tropical', 'serra', 'igapo'] as const;
export type LakeId = (typeof LAKE_IDS)[number];
export const LAKES = [
  { id: 'tropical', name: 'Lago Tropical', locationId: 'lago-principal', subtitle: 'Sol dourado. Águas acolhedoras.', description: 'Lambaris, pacus e predadores entre as margens verdes.', hour: 17, water: '#245d48', fog: '#c9b58b', terrain: '#a2ad78' },
  { id: 'serra', name: 'Lago da Serra', locationId: 'lago-serra', subtitle: 'Água cristalina. Ar da montanha.', description: 'Trutas, carpas e esturjões em um refúgio de águas frias.', hour: 8, water: '#245d87', fog: '#a8c7de', terrain: '#a6c5bd' },
  { id: 'igapo', name: 'Lago do Igapó', locationId: 'lago-igapo', subtitle: 'Raízes antigas. Segredos profundos.', description: 'Grandes bagres e peixes amazônicos. Algo se move nas profundezas.', hour: 18.5, water: '#24382c', fog: '#65887b', terrain: '#607b56' },
] as const;
export function isLakeId(id: unknown): id is LakeId { return (LAKE_IDS as readonly unknown[]).includes(id); }
export function getLake(id: LakeId) { return LAKES.find((lake) => lake.id === id)!; }
export function speciesLake(id: SpeciesId): LakeId { return SPECIES.find((s) => s.id === id)?.lakeId ?? 'tropical'; }
export function lakeSpecies(id: LakeId): readonly FishSpecies[] { return SPECIES.filter((s) => (s.lakeId ?? 'tropical') === id && !s.secret); }
