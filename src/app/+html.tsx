import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Custom HTML shell for the static web build. The critical line is
 * `viewport-fit=cover`: without it, iOS Safari reports every
 * safe-area-inset-* as 0 and the bottom tab bar sits underneath the home
 * indicator / toolbar on notched iPhones.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#FFFFFF" />
        {/* Static fallback title: per-route titles are set on navigation by
            use-document-title, but the served HTML needs one for the first
            paint, link previews, and search engines. */}
        <title>Inventory Our Home</title>
        <meta
          name="description"
          content="Inventory your home together — photograph what's there, decide what to keep, and record the stories behind the things that matter."
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
