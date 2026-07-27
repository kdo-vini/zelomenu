import { BookOpen, ShoppingBag, Tags, Package } from 'lucide-react';

const actions = [
  { label: 'Cardápio Digital', icon: BookOpen, desc: 'Veja o cardápio completo', href: '#empresas' },
  { label: 'Pedidos Online', icon: ShoppingBag, desc: 'Peça direto pelo app', href: '#empresas' },
  { label: 'Destaques', icon: Tags, desc: 'Escolhas especiais das empresas', href: '#destaques' },
  { label: 'Acompanhar Pedido', icon: Package, desc: 'Acompanhe em tempo real', href: '#' },
];

export function QuickActions() {
  return (
    <div className="home-quick-actions" role="group" aria-label="Ações rápidas">
      {actions.map((action) => (
        <a key={action.href + action.label} className="home-quick-action" href={action.href}>
          <div className="home-quick-action__icon">
            <action.icon size={22} strokeWidth={1.5} />
          </div>
          <div className="home-quick-action__body">
            <strong>{action.label}</strong>
            <span>{action.desc}</span>
          </div>
        </a>
      ))}
    </div>
  );
}
