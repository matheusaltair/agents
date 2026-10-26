import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fábrica de Agentes",
  description: "Quadro Kanban e escritório virtual de agentes autônomos",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <header className="flex items-center gap-6 border-b border-black/10 px-6 py-3 dark:border-white/10">
          <span className="font-semibold">Fábrica de Agentes</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/">Kanban</Link>
            <Link href="/office">Escritório</Link>
          </nav>
        </header>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
