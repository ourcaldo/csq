import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  MagnifyingGlass,
  List,
  X,
  Copy,
  Check,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import type { DocsNav, NavGroup, NavLink } from "@/lib/docs-data";
import { API_BASE_URL, DASHBOARD_URL } from "@/lib/docs-data";
import type { TocItem } from "@/lib/toc";

// Docs shell - Mintlify-style layout: top bar with search, left sidebar with
// section groups, content column, right "On this page" TOC.

type DocsShellProps = {
  nav: DocsNav;
  eyebrow: string;
  title: string;
  description?: string;
  toc?: TocItem[];
  copyText?: string;
  children: ReactNode;
};

function NavItemLink({ item, active }: { item: NavLink; active: boolean }) {
  return (
    <Link href={item.href} className={`nav-item${active ? " active" : ""}`}>
      {item.method && (
        <span className={`method-chip ${item.method}`}>{item.method.toUpperCase()}</span>
      )}
      <span className="truncate">{item.title}</span>
    </Link>
  );
}

function SidebarGroup({ group, path }: { group: NavGroup; path: string }) {
  return (
    <div>
      <div className="nav-group-label">{group.label}</div>
      {group.items.map((item) => (
        <NavItemLink key={item.href} item={item} active={path === item.href} />
      ))}
    </div>
  );
}

export function DocsShell({
  nav,
  eyebrow,
  title,
  description,
  toc,
  copyText,
  children,
}: DocsShellProps) {
  const router = useRouter();
  const path = router.asPath.split("?")[0].split("#")[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [router.asPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
        setQuery("");
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toc || toc.length === 0) return;
    const onScroll = () => {
      let current: string | null = null;
      for (const item of toc) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top < 120) current = item.id;
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [toc]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nav.all.filter((l) => l.title.toLowerCase().includes(q)).slice(0, 12);
  }, [query, nav.all]);

  async function copyPage() {
    const text = copyText ?? title;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">C</span>
          <span className="brand-name">CSQ</span>
          <span className="brand-chip">API v1</span>
        </Link>

        <button
          type="button"
          className="search-trigger"
          onClick={() => {
            setSearchOpen(true);
            setQuery("");
          }}
          aria-label="Search documentation"
        >
          <MagnifyingGlass size={15} />
          <span>Search...</span>
          <span className="kbd">Ctrl K</span>
        </button>

        <button
          type="button"
          className="hamburger"
          aria-label="Open navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={18} /> : <List size={18} />}
        </button>

        <nav className="topnav">
          <a href={`${API_BASE_URL}/api/health`} target="_blank" rel="noreferrer">
            Status
          </a>
          <a href={DASHBOARD_URL} target="_blank" rel="noreferrer">
            Dashboard <ArrowSquareOut size={12} />
          </a>
          <a href={`${DASHBOARD_URL}/dashboard/settings`} className="cta" target="_blank" rel="noreferrer">
            Get API key
          </a>
        </nav>
      </header>

      <div className="layout">
        {menuOpen && (
          <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />
        )}
        <aside className={`sidebar${menuOpen ? " open" : ""}`}>
          {nav.guides.map((group) => (
            <SidebarGroup key={group.label} group={group} path={path} />
          ))}
          <div className="nav-group-label">API reference</div>
          <Link href="/reference" className={`nav-item${path === "/reference" ? " active" : ""}`}>
            <span className="truncate">Overview</span>
          </Link>
          {nav.reference.map((group) => (
            <SidebarGroup key={group.label} group={group} path={path} />
          ))}
        </aside>

        <main className="main">
          <div className="content">
            <div className="page-head">
              <div>
                <div className="page-eyebrow">{eyebrow}</div>
                <h1 className="page-title">{title}</h1>
                {description && <p className="page-lead">{description}</p>}
              </div>
              <button type="button" className="copy-btn" onClick={() => void copyPage()}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy page"}
              </button>
            </div>

            {children}

            <footer className="footer">
              CSQ API documentation. The reference is generated from the API
              contract and always matches <code>/api/v1/openapi</code>.
            </footer>
          </div>
        </main>

        {toc && toc.length > 0 && (
          <aside className="toc">
            <div className="toc-title">
              <List size={13} /> On this page
            </div>
            {toc.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`${item.level === 3 ? "h3" : ""}${activeId === item.id ? " active" : ""}`}
              >
                {item.text}
              </a>
            ))}
          </aside>
        )}
      </div>

      {searchOpen && (
        <div className="overlay" onClick={() => setSearchOpen(false)}>
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length > 0) {
                  setSearchOpen(false);
                  void router.push(results[0].href);
                }
              }}
              placeholder="Search guides and endpoints..."
              aria-label="Search documentation"
            />
            <div className="search-results">
              {query.trim() === "" && (
                <p className="search-empty">Type to search the documentation.</p>
              )}
              {query.trim() !== "" && results.length === 0 && (
                <p className="search-empty">No results for &quot;{query}&quot;.</p>
              )}
              {results.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="search-result"
                  onClick={() => setSearchOpen(false)}
                >
                  {item.method && (
                    <span className={`method-chip ${item.method}`}>
                      {item.method.toUpperCase()}
                    </span>
                  )}
                  {item.title}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
