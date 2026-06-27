"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const showDetails = process.env.NODE_ENV === "development";

  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-8">
          <section className="rounded-lg bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-moss">DoctorAI</p>
            <h1 className="mt-2 text-2xl font-bold text-ink">DoctorAI could not start</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink/75">
              A startup error occurred before the app shell finished loading. Check the local server logs, then retry.
            </p>
            {showDetails && (
              <pre className="mt-4 max-h-44 overflow-auto rounded-lg bg-clinic p-3 text-xs text-ink">
                {error.message || error.digest || "Unknown startup error"}
              </pre>
            )}
            <button
              type="button"
              onClick={reset}
              className="mt-4 h-11 w-full rounded-lg bg-moss text-sm font-bold text-white"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
