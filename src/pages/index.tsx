import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">CSQ</h1>
      <p className="text-sm text-muted-foreground">
        Self-hosted AI agent platform for Indonesian UMKM. (Placeholder —
        marketing pages deferred.)
      </p>
      <Button asChild>
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </main>
  );
}
