import type { GetServerSideProps } from "next";
import Link from "next/link";
import { withAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const SECTIONS: { href: string; title: string; description: string }[] = [
  { href: "/dashboard/products", title: "Produk", description: "Kelola katalog produk dan harga." },
  { href: "/dashboard/inventory", title: "Inventaris", description: "Pantau dan sesuaikan stok." },
  { href: "/dashboard/orders", title: "Pesanan", description: "Lihat dan ubah status pesanan." },
  { href: "/dashboard/knowledge", title: "Pengetahuan", description: "FAQ, kebijakan, info usaha." },
  { href: "/dashboard/contacts", title: "Kontak", description: "Data pelanggan dari percakapan." },
  { href: "/dashboard/tags", title: "Tag", description: "Taksonomi untuk percakapan." },
  { href: "/dashboard/memory", title: "Memori", description: "Ingatan agen per sesi." },
  { href: "/dashboard/sources", title: "Sumber Data", description: "Excel, Sheets, dan sumber lain." },
];

export default function DashboardIndex() {
  return (
    <DashboardShell title="Overview" description="Pintasan ke setiap bagian dashboard.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
