'use client';

import { useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { matchesWords } from '@/lib/catalogue-cards';

/**
 * A search box for a long server-rendered list (the Pokémon and set indexes). It hides the items under `#listId`
 * whose `data-filter` text doesn't match, and any `[data-filter-group]` left empty, without re-rendering the list,
 * so a thousand tiles stay plain HTML.
 */
export function PublicListFilter({
  listId,
  label,
  placeholder,
}: {
  listId: string;
  label: string;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState<number | null>(null);

  const apply = (value: string) => {
    setQuery(value);
    const list = document.getElementById(listId);
    if (!list) return;
    let count = 0;
    for (const item of list.querySelectorAll<HTMLElement>('[data-filter]')) {
      const match = matchesWords(item.dataset.filter ?? '', value);
      item.hidden = !match;
      if (match) count += 1;
    }
    for (const group of list.querySelectorAll<HTMLElement>('[data-filter-group]'))
      group.hidden = !group.querySelector('[data-filter]:not([hidden])');
    setShown(value.trim() ? count : null);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="search"
          aria-label={label}
          value={query}
          onChange={(event) => apply(event.target.value)}
          placeholder={placeholder}
          className="h-11 rounded-2xl pl-9"
        />
      </div>
      {shown !== null && (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {shown === 0 ? 'Nothing matches that search.' : `${shown} ${shown === 1 ? 'match' : 'matches'}`}
        </p>
      )}
    </div>
  );
}
