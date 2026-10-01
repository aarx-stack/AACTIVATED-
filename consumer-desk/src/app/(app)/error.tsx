"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="glass glass-lit mx-auto max-w-xl p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-soft">
        The request could not be completed. No demo or cached data was substituted. If you are using the connected app, the database may be
        unreachable.
      </p>
      <button className="btn btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
