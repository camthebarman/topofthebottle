import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-muted">It may have been removed, or it belongs to an organization you cannot see.</p>
      <Link className="mt-4 inline-block min-h-11 text-accent underline" href="/today">Go to Today</Link>
    </main>
  );
}
