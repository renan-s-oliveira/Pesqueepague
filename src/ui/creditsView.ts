/** Apresenta o registro local de licenças sem expor a sintaxe Markdown. */
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function inline(parent: HTMLElement, text: string): void {
  for (const part of text.split(/(`[^`]+`|https:\/\/[^\s|]+)/g)) {
    if (part.startsWith('`') && part.endsWith('`')) parent.append(element('code', '', part.slice(1, -1)));
    else if (part.startsWith('https://')) {
      const link = element('a', '', part.replace('https://', ''));
      link.href = part;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      parent.append(link);
    } else parent.append(document.createTextNode(part));
  }
}

export function creditsContent(source: string): HTMLElement {
  const root = element('div', 'credits');
  root.dataset['testid'] = 'credits';
  root.append(element('p', 'menu-eyebrow', 'QUEM DÁ VIDA AO LAGO'), element('h2', '', 'Créditos & licenças'));
  if (!source.trim()) {
    root.append(element('p', 'note', 'Registro de licenças indisponível.'));
    return root;
  }
  const lines = source.trim().split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (line.startsWith('|')) {
      const cells = (row: string): string[] => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const headers = cells(line);
      const grid = element('div', 'credits-grid');
      i++;
      while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith('|')) {
        const values = cells(lines[++i]!.trim());
        const card = element('details', 'credit-card');
        const summary = element('summary');
        inline(summary, values[0] ?? 'Crédito');
        const fields = element('dl', 'credit-fields');
        for (let column = 1; column < headers.length; column++) {
          const value = values[column];
          if (!value || value === '—') continue;
          const description = element('dd');
          inline(description, value);
          fields.append(element('dt', '', headers[column]!), description);
        }
        card.append(summary, fields);
        grid.append(card);
      }
      root.append(grid);
    } else if (line.startsWith('## ')) {
      root.append(element('h3', 'credits-section-title', line.slice(3)));
    } else {
      const paragraph = element('p', line.startsWith('# ') ? 'credits-intro' : 'credits-note');
      inline(paragraph, line.replace(/^# /, ''));
      root.append(paragraph);
    }
  }
  return root;
}
