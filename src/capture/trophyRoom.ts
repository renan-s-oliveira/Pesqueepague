import {
  AmbientLight,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SpotLight,
  WebGLRenderer,
} from 'three';
import { getSpecies } from '../fish/species.ts';
import { biggestBySpecies, personalRecord } from '../progression/achievements.ts';
import type { CatchRecord } from '../progression/types.ts';
import { FishModel } from '../fish/visual/fishModel.ts';

export interface TrophyRoomHandlers {
  readonly onClose: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function formatKg(kg: number): string {
  return kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(2).replace('.', ',')} kg`;
}

/** Semente estável a partir do id da captura, para o mesmo troféu ter sempre a mesma pele. */
function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Sala de troféus 3D: uma sala renderizada de verdade (chão, parede, pedestais iluminados),
 * com o maior exemplar de cada espécie girando sobre o próprio pedestal e um painel de
 * estatísticas ao lado. Os dados vêm do catchRepository; sem recordes, a sala abre vazia
 * com o convite para pescar. Esc ou o botão Fechar devolvem ao menu; com
 * prefers-reduced-motion os troféus ficam parados.
 */
export class TrophyRoom {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly trophies: { group: Group; model: FishModel }[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly reducedMotion: boolean;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.handlers.onClose();
    }
  };
  private raf = 0;
  private lastT: number | null = null;
  private disposed = false;

  constructor(
    container: HTMLElement,
    records: readonly CatchRecord[],
    private readonly handlers: TrophyRoomHandlers,
  ) {
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.root = el('section', 'trophy-room');
    this.root.dataset['testid'] = 'trophy-room';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Sala de troféus');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'trophy-canvas';
    this.canvas.setAttribute('aria-label', 'Sala 3D com os recordes girando sobre pedestais');
    this.root.append(this.canvas, this.buildStats(records));

    const close = el('button', 'ui-btn primary trophy-close', 'Fechar');
    close.type = 'button';
    close.dataset['testid'] = 'trophy-close';
    close.addEventListener('click', () => handlers.onClose());
    this.root.append(close);

    this.buildScene(records);
    this.camera = new PerspectiveCamera(42, 1, 0.01, 60);
    this.camera.position.set(0, 1.35, 3.4);
    this.camera.lookAt(0, 0.9, 0);

    container.appendChild(this.root);
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    window.addEventListener('keydown', this.onKeyDown, true);
    close.focus();
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Painel com os números do museu: totais, recorde pessoal e o recorde de cada espécie. */
  private buildStats(records: readonly CatchRecord[]): HTMLElement {
    const panel = el('div', 'panel trophy-stats');
    panel.dataset['testid'] = 'trophy-stats';
    panel.append(el('h2', '', 'Sala de troféus'));
    if (records.length === 0) {
      panel.append(el('p', 'note', 'Nenhum recorde ainda. Capture o primeiro peixe e ele vira o seu primeiro troféu.'));
      return panel;
    }
    const totalKg = records.reduce((sum, r) => sum + r.weightKg, 0);
    const released = records.filter((r) => r.disposition === 'released').length;
    const best = personalRecord(records);
    const rows = el('dl', 'catch-rows');
    const add = (label: string, value: string): void => {
      rows.append(el('dt', '', label), el('dd', '', value));
    };
    add('Capturas', String(records.length));
    add('Peso somado', formatKg(Math.round(totalKg * 1000) / 1000));
    add('Soltos de volta', String(released));
    if (best) add('Recorde pessoal', `${getSpecies(best.speciesId).name} — ${formatKg(best.weightKg)}`);
    panel.append(rows, el('h3', '', 'Recordes por espécie'));
    const list = el('ul', 'trophy-records');
    for (const [, record] of biggestBySpecies(records)) {
      const sp = getSpecies(record.speciesId);
      const item = el('li', '', `${sp.name} — ${formatKg(record.weightKg)} · ${record.lengthCm.toFixed(1).replace('.', ',')} cm`);
      item.dataset['testid'] = 'trophy-record';
      list.append(item);
    }
    panel.append(list);
    return panel;
  }

  /** A sala: chão e parede escuros, luz quente de museu e um pedestal por recorde. */
  private buildScene(records: readonly CatchRecord[]): void {
    const mat = (color: number, roughness: number): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color, roughness, metalness: 0.08 });
      this.materials.push(m);
      return m;
    };
    const floor = new Mesh(new PlaneGeometry(14, 10), mat(0x2a2f33, 0.9));
    floor.rotation.x = -Math.PI / 2;
    const wall = new Mesh(new PlaneGeometry(14, 6), mat(0x1c2a33, 1));
    wall.position.set(0, 3, -3.2);
    this.scene.add(floor, wall);
    this.scene.add(new AmbientLight(0x45505a, 0.9));
    const key = new DirectionalLight(0xffe6c0, 1.6);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);

    const bests = [...biggestBySpecies(records).values()].sort((a, b) => b.weightKg - a.weightKg).slice(0, 5);
    const span = Math.max(1, bests.length - 1);
    bests.forEach((record, i) => {
      const x = bests.length === 1 ? 0 : (i / span - 0.5) * 3.6;
      const pedestal = new Mesh(new CylinderGeometry(0.34, 0.42, 0.9, 24), mat(0x6b5a3e, 0.6));
      pedestal.position.set(x, 0.45, 0);
      const spot = new SpotLight(0xfff2d8, 6, 8, 0.5, 0.5);
      spot.position.set(x, 3.2, 1.2);
      spot.target = pedestal;
      const sp = getSpecies(record.speciesId);
      const lengthM = Math.min(0.9, Math.max(0.12, record.lengthCm / 100));
      const model = new FishModel(record.speciesId, {
        seed: seedFromId(record.id),
        lengthM,
        color: { hueShiftDeg: 0, lightnessShift: 0, spotSeed: seedFromId(`${record.id}:${sp.id}`) },
      });
      model.setWetness(0);
      const group = new Group();
      group.position.set(x, 0.9 + lengthM * 0.35, 0);
      group.add(model.root);
      this.scene.add(pedestal, spot, group);
      this.trophies.push({ group, model });
    });
  }

  private resize(): void {
    const w = this.root.clientWidth || 1;
    const h = this.root.clientHeight || 1;
    if (this.canvas.clientWidth !== w || this.canvas.clientHeight !== h || this.camera.aspect !== w / h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const dt = this.lastT === null ? 16 : Math.min(100, now - this.lastT);
    this.lastT = now;
    this.resize();
    if (!this.reducedMotion) {
      for (const t of this.trophies) t.group.rotation.y += dt * 0.0006;
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown, true);
    for (const t of this.trophies) t.model.dispose();
    for (const m of this.materials) m.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
