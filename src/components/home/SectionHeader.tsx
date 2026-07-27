import { ArrowRight } from 'lucide-react';

export function SectionHeader({ title, description, actionLabel, actionHref = '#empresas' }: {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="home-section-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actionLabel ? (
        <a href={actionHref}>
          {actionLabel}
          <ArrowRight size={18} strokeWidth={2} />
        </a>
      ) : null}
    </div>
  );
}
