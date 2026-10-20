import { type AchievementId, type AchievementState } from '../progression/achievements.ts';

export const ACHIEVEMENT_LABELS: Readonly<Record<AchievementId, { readonly title: string; readonly description: string }>> = {
  first_fish: { title: 'Primeiro peixe', description: 'Capture o primeiro peixe.' },
  over_1kg: { title: 'Mais de 1 kg', description: 'Capture um peixe com mais de 1 kg.' },
  over_5kg: { title: 'Mais de 5 kg', description: 'Capture um peixe com mais de 5 kg.' },
  over_10kg: { title: 'Mais de 10 kg', description: 'Capture um peixe com mais de 10 kg.' },
  ten_species: { title: 'Colecionador', description: 'Capture 10 espécies diferentes.' },
  catches_50: { title: '50 capturas', description: 'Some 50 capturas registradas.' },
  catches_100: { title: '100 capturas', description: 'Some 100 capturas registradas.' },
  first_rare: { title: 'Primeiro raro', description: 'Capture um exemplar raro.' },
  first_legendary: { title: 'Primeiro lendário', description: 'Capture um exemplar troféu (lendário).' },
  personal_record: { title: 'Recorde quebrado', description: 'Supere seu maior peso de uma espécie.' },
  sport_master: { title: 'Mestre da pesca esportiva', description: 'Solte 20 peixes de volta ao lago.' },
};

const STATUS_LABELS = {
  unlocked: 'Desbloqueada',
  in_progress: 'Em progresso',
  locked: 'Ainda indisponível neste lago',
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function formatProgress(a: AchievementState): string {
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
  return `${fmt(a.current)} de ${fmt(a.target)}`;
}

/**
 * Painel de conquistas: as 11 conquistas, cada uma com estado, barra e texto de progresso.
 * Quem abre sem nenhuma captura vê todas em progresso com 0, não uma tela vazia.
 */
export function achievementsContent(states: readonly AchievementState[]): HTMLElement {
  const box = el('div', 'achievements');
  box.dataset['testid'] = 'achievements';
  box.append(el('p', 'menu-eyebrow', 'PEQUENAS VITÓRIAS. GRANDES HISTÓRIAS.'), el('h2', '', 'Conquistas'));
  const unlocked = states.filter((a) => a.status === 'unlocked').length;
  box.append(el('p', 'note', `${unlocked} de ${states.length} desbloqueadas`));
  const next = states.filter((a) => a.status === 'in_progress').sort((a, b) => b.current / b.target - a.current / a.target)[0];
  if (next) {
    const goal = el('div', 'next-achievement');
    goal.append(el('span', 'menu-eyebrow', 'SEU PRÓXIMO DESAFIO'), el('h3', '', ACHIEVEMENT_LABELS[next.id].title),
      el('p', '', `${ACHIEVEMENT_LABELS[next.id].description} Progresso: ${formatProgress(next)}.`));
    box.append(goal);
  }
  const filters = el('div', 'collection-actions');
  filters.setAttribute('aria-label', 'Filtrar conquistas');
  const status = el('p', 'note');
  status.setAttribute('role', 'status');
  const list = el('ul', 'achievement-list');
  for (const a of states) {
    const labels = ACHIEVEMENT_LABELS[a.id];
    const item = el('li', `achievement-item status-${a.status}`);
    item.dataset['testid'] = 'achievement-item';
    item.dataset['status'] = a.status;
    const head = el('div', 'achievement-head');
    head.append(el('h3', 'achievement-title', labels.title), el('span', 'achievement-status', STATUS_LABELS[a.status]));
    const bar = el('div', 'achievement-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `Progresso: ${labels.title}`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(a.target));
    bar.setAttribute('aria-valuenow', String(a.current));
    const fill = el('div', 'achievement-bar-fill');
    fill.style.width = `${Math.round(Math.min(1, a.target > 0 ? a.current / a.target : 0) * 100)}%`;
    bar.append(fill);
    item.append(head, el('p', 'achievement-desc', labels.description), bar, el('p', 'achievement-progress', formatProgress(a)));
    const details = el('details', 'achievement-details');
    details.append(el('summary', '', a.status === 'unlocked' ? 'Ver conquista' : 'Como conquistar'));
    details.append(el('p', 'note', a.unlockedAt !== null
      ? `Conquistada em ${new Date(a.unlockedAt).toLocaleDateString('pt-BR')}. Um marco na sua história no lago.`
      : a.status === 'locked' ? 'Esta meta depende de espécies que ainda não estão disponíveis neste lago.'
      : a.id === 'sport_master' ? 'Na tela de captura, escolha soltar o peixe. Cada soltura registrada aproxima você da meta.'
      : a.id === 'personal_record' ? 'Capture novamente uma espécie que já está no seu álbum e supere o maior peso registrado.'
      : 'As capturas registradas no seu álbum contam automaticamente para esta meta. Experimente outras iscas em Equipamentos.'));
    item.append(details);
    list.append(item);
  }
  for (const [label, value] of [['Todas', 'all'], ['Em progresso', 'in_progress'], ['Desbloqueadas', 'unlocked']] as const) {
    const button = el('button', 'ui-btn compact', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(value === 'all'));
    button.addEventListener('click', () => {
      for (const sibling of filters.querySelectorAll('button')) sibling.setAttribute('aria-pressed', String(sibling === button));
      let count = 0;
      for (const item of list.children) {
        const row = item as HTMLElement;
        row.hidden = value !== 'all' && row.dataset['status'] !== value;
        if (!row.hidden) count++;
      }
      status.textContent = count ? `${count} conquistas nesta seleção` : 'Nenhuma conquista nesta seleção. Seu próximo arremesso pode mudar isso.';
    });
    filters.append(button);
  }
  box.append(filters, status, list);
  return box;
}

/** Estado de erro/indisponível da tela de conquistas, com o que fazer. */
export function achievementsUnavailable(message: string): HTMLElement {
  const box = el('div', 'achievements');
  box.dataset['testid'] = 'achievements';
  box.append(el('h2', '', 'Conquistas'), el('p', 'note', message));
  return box;
}
