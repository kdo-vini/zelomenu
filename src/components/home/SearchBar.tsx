import { Search, X, ArrowRight } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onClear: () => void;
}

export function SearchBar({ value, onChange, onSubmit, onClear }: SearchBarProps) {
  return (
    <form
      className="home-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <Search size={23} className="home-search__icon" strokeWidth={2} />
      <label className="sr-only" htmlFor="business-search">
        Buscar empresa por nome, categoria ou cidade
      </label>
      <input
        id="business-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar por empresa, categoria ou cidade..."
        autoComplete="off"
        enterKeyHint="search"
      />
      {value ? (
        <button className="home-search__clear" type="button" onClick={onClear} aria-label="Limpar busca">
          <X size={18} strokeWidth={2} />
        </button>
      ) : null}
      <button className="home-search__submit" type="submit" aria-label="Pesquisar empresas">
        <ArrowRight size={22} strokeWidth={2.5} />
      </button>
    </form>
  );
}
