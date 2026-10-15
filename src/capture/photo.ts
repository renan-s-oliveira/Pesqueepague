import type { CatchRepository } from '../save/catchRepository.ts';

/** Prefixo do id da foto: uma foto por captura, regravável sem acumular lixo. */
export const PHOTO_ID_PREFIX = 'foto-';

/** Converte o conteúdo atual do canvas em Blob via canvas.toBlob (chame logo após renderizar). */
export function canvasToPhotoBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error('o canvas não gerou a imagem (toBlob devolveu vazio)'));
      },
      type,
      quality,
    );
  });
}

/**
 * Guarda a foto no repositório e grava o photoId na captura correspondente.
 * Devolve o id da foto; repetir sobre a mesma captura substitui a foto anterior.
 */
export async function savePhotoForCatch(repository: CatchRepository, recordId: string, blob: Blob): Promise<string> {
  const record = await repository.get(recordId);
  if (record === undefined) throw new Error(`captura "${recordId}" não encontrada: a foto não foi salva`);
  const photoId = `${PHOTO_ID_PREFIX}${recordId}`;
  await repository.putPhoto(photoId, blob);
  if (record.photoId !== photoId) await repository.put({ ...record, photoId });
  return photoId;
}
