import type { LucideIcon } from 'lucide-react';

interface CategoryFiltersProps {
  categories: Array<{ id: string; label: string; icon: LucideIcon }>;
  activeCategoryId: string;
  onChange: (id: string) => void;
}

export function CategoryFilters({ categories, activeCategoryId, onChange }: CategoryFiltersProps) {
  return (
    <div className="home-category-strip" role="group" aria-label="Filtrar por categoria">
      {categories.map((category) => {
        const active = category.id === activeCategoryId;
        const Icon = category.icon;
        return (
          <button
            key={category.id}
            type="button"
            className={`home-category-chip${active ? ' is-active' : ''}`}
            aria-pressed={active}
            onClick={() => onChange(category.id)}
          >
            <Icon size={18} strokeWidth={active ? 2.5 : 2} />
            {category.label}
          </button>
        );
      })}
    </div>
  );
}
