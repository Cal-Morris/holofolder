'use client';

const styles = `
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #07070a; color: #f4f3f8; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
  .retry { padding: 10px 18px; min-height: 40px; background: #b9a6ff; color: #15121f; border-radius: 999px;
    border: 0; font-size: 14px; margin-right: 8px; }
`;

// Replaces the root layout when it fails, so it brings its own document and inline styles
// (globals.css isn't loaded here). Kept dependency-free and dark to match the app's default theme.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Holo Folder</title>
        <style>{styles}</style>
        <div>
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: '0 0 16px' }}>Your collection is saved on this device.</p>
          <button type="button" onClick={() => retry()} className="retry">
            Try again
          </button>
          {/* oxlint-disable-next-line next/no-html-link-for-pages, react-doctor/nextjs-no-a-element -- the root layout failed, so a full navigation lets the service worker serve the cached shell. */}
          <a href="/app/app-shell" style={{ color: 'inherit', fontSize: 14 }}>
            Open binder
          </a>
        </div>
      </body>
    </html>
  );
}
