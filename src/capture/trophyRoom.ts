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
  Raycaster,
  Vector2,
  Color,
  TorusGeometry,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
  private readonly trophies: { group: Group; model: FishModel; record: CatchRecord }[] = [];
  private extraTrophy: { group: Group; model: FishModel; record: CatchRecord } | null = null;
  private readonly records: readonly CatchRecord[];
  private readonly controls: OrbitControls;
  private readonly selection = el('p', 'trophy-selection', 'Selecione um recorde para observar de perto.');
  private readonly previousFocus = document.activeElement;
  private autoSpin = true;
  private pointerStart = { x: 0, y: 0 };
  private viewportW = 0;
  private viewportH = 0;
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly reducedMotion: boolean;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') {
      const focusable = [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), canvas[tabindex]')];
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? index - 1 : index + 1;
      if (index < 0 || next < 0 || next >= focusable.length) {
        e.preventDefault();
        focusable[e.shiftKey ? focusable.length - 1 : 0]?.focus();
      }
    }
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
    this.records = records;
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.root = el('section', 'trophy-room');
    this.root.dataset['testid'] = 'trophy-room';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Sala de troféus');
    this.selection.setAttribute('role', 'status');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'trophy-canvas';
    this.canvas.setAttribute('aria-label', 'Sala 3D com os recordes girando sobre pedestais');
    this.canvas.tabIndex = 0;
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
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.22;
    this.controls.maxDistance = 10;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.overview();
    const tools = el('div', 'trophy-tools');
    const action = (label: string, run: () => void): HTMLButtonElement => {
      const b = el('button', 'ui-btn compact', label);
      b.type = 'button';
      b.addEventListener('click', run);
      tools.append(b);
      return b;
    };
    action('Visão geral', () => this.overview());
    const spin = action('Giro automático', () => {
      this.autoSpin = !this.autoSpin;
      spin.setAttribute('aria-pressed', String(this.autoSpin));
    });
    spin.setAttribute('aria-pressed', 'true');
    const zoom = (factor: number): void => {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.setLength(Math.min(10, Math.max(0.22, offset.length() * factor)));
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    };
    action('Aproximar +', () => zoom(0.8));
    action('Afastar −', () => zoom(1.25));
    tools.append(el('span', 'note', 'Arraste para girar · Role para aproximar'));
    this.root.append(tools);
    this.canvas.addEventListener('pointerdown', (e) => { this.pointerStart = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y) > 5) return;
      const rect = this.canvas.getBoundingClientRect();
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const hits = ray.intersectObjects(this.trophies.map((t) => t.group), true);
      const hit = hits[0];
      if (!hit) return;
      const trophy = this.trophies.find((t) => { let node = hit.object; while (node.parent && node !== t.group) node = node.parent; return node === t.group; });
      if (trophy) this.selectTrophy(trophy.record.id);
    });
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
    panel.append(this.selection);
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
      const item = el('li');
      const select = el('button', 'trophy-pick', `${sp.name} — ${formatKg(record.weightKg)} · ${record.lengthCm.toFixed(1).replace('.', ',')} cm`);
      select.type = 'button';
      select.dataset['recordId'] = record.id;
      select.setAttribute('aria-pressed', 'false');
      select.addEventListener('click', () => this.selectTrophy(record.id));
      item.append(select);
      item.dataset['testid'] = 'trophy-record';
      list.append(item);
    }
    panel.append(list);
    return panel;
  }

  /** A sala: chão e parede escuros, luz quente de museu e um pedestal por recorde. */
  private buildScene(records: readonly CatchRecord[]): void {
    this.scene.background = new Color(0x102428);
    const mat = (color: number, roughness: number): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color, roughness, metalness: 0.08 });
      this.materials.push(m);
      return m;
    };
    const floor = new Mesh(new PlaneGeometry(14, 10), mat(0x18302e, 0.7));
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
      const pedestal = new Mesh(new CylinderGeometry(0.34, 0.42, 0.9, 32), mat(0x234b40, 0.5));
      pedestal.position.set(x, 0.45, 0);
      const rim = new Mesh(new TorusGeometry(0.34, 0.009, 6, 40), mat(0xd2ae65, 0.3));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, 0.89, 0);
      this.scene.add(rim);
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
      this.trophies.push({ group, model, record });
    });
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (this.viewportW !== w || this.viewportH !== h) {
      this.viewportW = w;
      this.viewportH = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private overview(): void {
    this.clearExtra();
    for (const trophy of this.trophies) trophy.group.visible = true;
    this.camera.position.set(0, 1.8, 5.5);
    this.controls.target.set(0, 1, 0);
    this.controls.update();
    this.selection.textContent = this.trophies.length ? 'Sua coleção em exposição. Escolha um exemplar para inspecionar.' : 'Seu primeiro troféu começa com um arremesso.';
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.trophy-pick')) button.setAttribute('aria-pressed', 'false');
  }

  private selectTrophy(id: string): void {
    this.clearExtra();
    let trophy = this.trophies.find((t) => t.record.id === id);
    if (!trophy) {
      const record = this.records.find((r) => r.id === id);
      if (!record) return;
      const model = new FishModel(record.speciesId, { seed: seedFromId(record.id), lengthM: Math.min(.9, Math.max(.12, record.lengthCm / 100)), color: { hueShiftDeg: 0, lightnessShift: 0, spotSeed: seedFromId(`${record.id}:${record.speciesId}`) } });
      model.setWetness(0);
      const group = new Group(); group.position.set(0, 1.15, 0); group.add(model.root); this.scene.add(group);
      this.extraTrophy = { group, model, record }; trophy = this.extraTrophy;
    }
    if (!trophy) return;
    for (const item of this.trophies) item.group.visible = item === trophy;
    const { record, group } = trophy;
    this.controls.target.copy(group.position);
    const size = Math.min(0.9, Math.max(0.12, record.lengthCm / 100));
    this.camera.position.set(group.position.x, group.position.y + size * 0.2, size * 2);
    this.controls.update();
    this.selection.textContent = `${getSpecies(record.speciesId).name} · ${formatKg(record.weightKg)} · ${record.lengthCm.toFixed(1).replace('.', ',')} cm · ${new Date(record.timestamp).toLocaleDateString('pt-BR')} · ${record.disposition === 'released' ? 'De volta ao lago' : 'Guardado'}`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.trophy-pick')) button.setAttribute('aria-pressed', String(button.dataset['recordId'] === id));
  }

  private clearExtra(): void {
    this.extraTrophy?.model.dispose(); this.extraTrophy?.group.removeFromParent(); this.extraTrophy = null;
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const dt = this.lastT === null ? 16 : Math.min(100, now - this.lastT);
    this.lastT = now;
    this.resize();
    this.controls.update();
    if (!this.reducedMotion && this.autoSpin) {
      for (const t of this.trophies) t.group.rotation.y += dt * 0.0006;
      if (this.extraTrophy) this.extraTrophy.group.rotation.y += dt * .0006;
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.controls.dispose();
    this.clearExtra();
    for (const t of this.trophies) t.model.dispose();
    this.scene.traverse((object) => {
      if (object instanceof Mesh && this.materials.includes(object.material as MeshStandardMaterial)) object.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.renderer.dispose();
    this.root.remove();
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) this.previousFocus.focus();
  }
}
