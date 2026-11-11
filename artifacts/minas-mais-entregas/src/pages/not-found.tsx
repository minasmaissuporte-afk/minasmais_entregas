import { Link } from 'wouter';
import { MapPinOff } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#f4f3f1] px-4">
      <section className="w-full max-w-md rounded-2xl border border-[#e7e4df] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#fbeaec] text-[#a91d2a]">
          <MapPinOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[#5f646b]">Erro 404</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#24272d]">Página não encontrada</h1>
        <p className="mt-2 text-sm text-[#5f646b]">
          O endereço pode ter mudado ou não existe. Volte ao início para continuar acompanhando as entregas.
        </p>
        <Link href="/" className="button-primary mt-6 inline-flex min-h-11 justify-center px-5 text-sm">
          Voltar ao início
        </Link>
      </section>
    </main>
  );
}
