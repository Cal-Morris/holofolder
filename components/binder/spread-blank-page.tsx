'use client';

import type { BinderColorTheme } from '@/lib/binder-colors';

export interface SpreadBlankPageContext {
  getBinderThemeForPage: (pageNumber?: number | null | undefined) => BinderColorTheme;
}

export function renderSpreadBlankPageView(ctx: SpreadBlankPageContext, side: 'left' | 'right') {
  const { getBinderThemeForPage } = ctx;
  const pageTheme = getBinderThemeForPage(null);

  return (
    <div key={`spread-blank-${side}`} className="relative h-full w-full overflow-hidden rounded-2xl">
      <div
        className="absolute inset-0 rounded-2xl border"
        style={{
          background: pageTheme.background,
          borderColor: pageTheme.border,
          boxShadow: pageTheme.shadow,
        }}
      />
      <div className="absolute inset-0 rounded-2xl" style={{ background: pageTheme.gloss }} />
      <div className="relative z-10 flex h-full items-center justify-center p-4">
        <div className="border-border/45 bg-background/68 dark:bg-background/52 max-w-[16rem] rounded-[1.35rem] border px-5 py-6 text-center shadow-sm backdrop-blur-sm dark:border-white/10">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.22em] uppercase">Back Matter</p>
          <p className="mt-2 text-lg font-semibold">End of binder</p>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            The last printed page sits on the facing side of this spread.
          </p>
        </div>
      </div>
    </div>
  );
}
