export interface Business {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryLabel: string;
  city: string;
  state: string;
  coverUrl: string;
  logoUrl: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  ratingCount: number;
  highlights: BusinessHighlight[];
  featured: boolean;
  sponsored: boolean;
  menuUrl: string;
}

export interface BusinessHighlight {
  id: number;
  name: string;
  price: number;
  photoUrl: string | null;
}

export interface Category {
  id: string;
  label: string;
  icon: import('lucide-react').LucideIcon;
}
