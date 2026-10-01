import { DemoBanner } from "@/components/demo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-sm font-semibold uppercase tracking-widest text-accent">Table Zero Bar</p>
      <DemoBanner />
      {children}
    </main>
  );
}
