import type { LucideIcon } from 'lucide-react';
import { Pizza, Beef, Coffee, Fish, Flame, Cake, Utensils, Croissant, Salad, Sparkles } from 'lucide-react';

export interface Category {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const categories: Category[] = [
  { id: 'all', label: 'Todas', icon: Sparkles },
  { id: 'pizzarias', label: 'Pizzarias', icon: Pizza },
  { id: 'hamburguerias', label: 'Hamburguerias', icon: Beef },
  { id: 'cafeterias', label: 'Cafeterias', icon: Coffee },
  { id: 'japonesa', label: 'Japonesa', icon: Fish },
  { id: 'churrascarias', label: 'Churrascarias', icon: Flame },
  { id: 'confeitarias', label: 'Confeitarias', icon: Cake },
  { id: 'marmitas', label: 'Marmitas', icon: Utensils },
  { id: 'padarias', label: 'Padarias', icon: Croissant },
  { id: 'saudavel', label: 'Saudável', icon: Salad },
];
