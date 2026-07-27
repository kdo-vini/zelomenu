import type { Business } from '../../data/types.ts';
import { BusinessCard } from './BusinessCard.tsx';

interface BusinessGridProps {
  businesses: Business[];
  priorityCount?: number;
}

export function BusinessGrid({ businesses, priorityCount = 0 }: BusinessGridProps) {
  return (
    <div className="home-business-grid">
      {businesses.map((business, index) => (
        <BusinessCard key={business.id} business={business} priority={index < priorityCount} />
      ))}
    </div>
  );
}
