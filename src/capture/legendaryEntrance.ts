import { Group, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, Vector3, Quaternion, type PerspectiveCamera, type Scene } from 'three';
import { LEGENDARY_INTRO_MS } from '../fish/legendary.ts';
import { disposeObject3D } from '../world/dispose.ts';

/** Somente uma silhueta projetada sobre a água: nenhum modelo de peixe é revelado. */
export class LegendaryEntrance {
  private readonly group = new Group();
  private readonly material = new MeshBasicMaterial({ color: '#020b10', transparent: true, opacity: 0, depthWrite: false });
  private readonly root = document.createElement('section');
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private time = 0;
  private active = false;
  private readonly subtitle = document.createElement('p');
  get isPlaying(): boolean { return this.active; }
  constructor(container: HTMLElement, private readonly scene: Scene, private readonly camera: PerspectiveCamera, private readonly onFinish: () => void = () => {}) {
    this.group.name = 'legendary-shadow';
    const outline = new Shape();
    outline.moveTo(-6, 0); outline.bezierCurveTo(-4, 1.1, 2, 1.3, 4, .2);
    outline.lineTo(6, 1.5); outline.lineTo(5.5, 0); outline.lineTo(6, -1.5); outline.lineTo(4, -.2);
    outline.bezierCurveTo(2, -1.3, -4, -1.1, -6, 0);
    const shadow = new Mesh(new ShapeGeometry(outline, 40), this.material);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .035; shadow.renderOrder = 5;
    this.group.add(shadow); this.group.visible = false; this.scene.add(this.group);
    this.root.className = 'legendary-entrance'; this.root.hidden = true;
    this.root.dataset['testid'] = 'legendary-entrance'; this.root.setAttribute('role', 'status');
    const eyebrow = document.createElement('p'); eyebrow.className = 'menu-eyebrow'; eyebrow.textContent = 'O LAGO PRENDE A RESPIRAÇÃO';
    const title = document.createElement('h2'); title.textContent = 'Uma sombra impossível';
    this.root.append(eyebrow, title, this.subtitle); container.append(this.root);
  }
  start(mode: 'opening' | 'encounter' = 'encounter'): void {
    if (this.active) return;
    this.active = true; this.time = 0; this.position.copy(this.camera.position); this.rotation.copy(this.camera.quaternion);
    this.subtitle.textContent = mode === 'opening' ? 'Nas profundezas, uma lenda aguarda o seu próximo arremesso.' : 'Uma chance em 1.000.000.000. O Guardião despertou.';
    this.root.dataset['mode'] = mode;
    this.root.hidden = false; this.group.visible = true;
  }
  update(dt: number): void {
    if (!this.active) return;
    this.time += dt * 1000;
    const t = Math.min(1, this.time / LEGENDARY_INTRO_MS);
    const fade = Math.min(1, t * 5, (1 - t) * 5);
    this.material.opacity = fade * .65;
    this.group.position.set(-7 + t * 14, 0, 10 + Math.sin(t * Math.PI) * 2);
    this.group.rotation.y = Math.sin(t * Math.PI * 2) * .15;
    this.camera.position.copy(this.position).lerp(new Vector3(0, 5, 24), fade * .7);
    this.camera.lookAt(this.group.position);
    this.camera.quaternion.slerp(this.rotation, 1 - fade);
    this.root.style.opacity = String(Math.min(1, t * 8, (1 - t) * 8));
    if (t >= 1) this.finish();
  }
  finish(): void {
    if (!this.active) return;
    this.active = false; this.root.hidden = true; this.group.visible = false;
    this.camera.position.copy(this.position); this.camera.quaternion.copy(this.rotation);
    this.onFinish();
  }
  dispose(): void { this.finish(); disposeObject3D(this.group); this.group.removeFromParent(); this.root.remove(); }
}
