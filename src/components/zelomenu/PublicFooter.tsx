export function PublicFooter() {
  return (
    <footer className="border-t border-[var(--color-line)] bg-[var(--color-surface)] py-4 text-center text-[11px] text-[var(--color-ink-muted)]">
      <p>
        ZeloMenu é um produto do{' '}
        <a
          href="https://zelopdv.com.br"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[var(--color-brand-deep)] hover:underline"
        >
          ZeloPDV
        </a>
      </p>
      <p className="mt-1">
        Feito com <span role="img" aria-label="amor">💜</span> © {new Date().getFullYear()}
      </p>
    </footer>
  );
}
