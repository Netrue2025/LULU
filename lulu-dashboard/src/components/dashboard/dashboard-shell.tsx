"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Cpu,
  Home,
  LogOut,
  Menu,
  Moon,
  Music,
  Search,
  Shield,
  Sun,
  X
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/spiritual", label: "Spiritual", icon: BookOpen },
  { href: "/music", label: "Music", icon: Music }
];

export function DashboardShell({
  children,
  title,
  subtitle,
  unreadAlerts = 0,
  minimal = false
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  unreadAlerts?: number;
  minimal?: boolean;
}) {
  const [authed, setAuthed] = useState(() => (typeof window === "undefined" ? false : window.localStorage.getItem("lulu-dashboard-auth") === "true"));
  const [role, setRole] = useState(() => (typeof window === "undefined" ? "Admin" : window.localStorage.getItem("lulu-dashboard-role") ?? "Admin"));
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(() => (typeof window === "undefined" ? false : (window.localStorage.getItem("lulu-dashboard-theme") ?? "dark") === "dark"));
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const storedAuth = window.localStorage.getItem("lulu-dashboard-auth") === "true";
    const storedRole = window.localStorage.getItem("lulu-dashboard-role") ?? "Admin";
    const storedTheme = window.localStorage.getItem("lulu-dashboard-theme") ?? "dark";
    setAuthed(storedAuth);
    setRole(storedRole);
    setDark(storedTheme === "dark");
    document.documentElement.classList.toggle("dark", storedTheme === "dark");
  }, []);

  function login(nextRole: string) {
    setAuthed(true);
    setRole(nextRole);
    window.localStorage.setItem("lulu-dashboard-auth", "true");
    window.localStorage.setItem("lulu-dashboard-role", nextRole);
  }

  function logout() {
    setAuthed(false);
    window.localStorage.removeItem("lulu-dashboard-auth");
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("lulu-dashboard-theme", next ? "dark" : "light");
  }

  if (!authed) {
    return <AuthGate onLogin={login} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!minimal ? (
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r bg-card/92 backdrop-blur xl:block">
          <SidebarContent role={role} unreadAlerts={unreadAlerts} onLogout={logout} />
        </aside>
      ) : null}

      <AnimatePresence>
        {!minimal && mobileNav ? (
          <motion.div
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.aside
              className="h-full w-[82vw] max-w-80 border-r bg-card"
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
            >
              <div className="flex h-14 items-center justify-end border-b px-4">
                <Button variant="ghost" className="h-9 w-9 px-0" onClick={() => setMobileNav(false)} title="Close menu">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <SidebarContent role={role} unreadAlerts={unreadAlerts} onLogout={logout} onNavigate={() => setMobileNav(false)} />
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <main className={cn(!minimal && "xl:pl-72")}>
        <header className="sticky top-0 z-30 border-b bg-background/88 backdrop-blur">
          <div className="flex min-h-16 items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6">
            {!minimal ? (
              <Button variant="ghost" className="h-9 w-9 px-0 xl:hidden" onClick={() => setMobileNav(true)} title="Open menu">
                <Menu className="h-4 w-4" />
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
              {subtitle ? <p className="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</p> : null}
            </div>
            {!minimal ? (
              <Button variant="secondary" className="hidden sm:inline-flex" onClick={() => setPaletteOpen(true)}>
                <Search className="h-4 w-4" />
                Command
              </Button>
            ) : null}
            <Button variant="ghost" className="h-9 w-9 px-0" onClick={toggleTheme} title="Toggle theme">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        <div className="px-3 py-4 sm:px-6 sm:py-5">
          {children}
        </div>
      </main>

      {!minimal ? <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
    </div>
  );
}

function SidebarContent({
  role,
  unreadAlerts,
  onLogout,
  onNavigate
}: {
  role: string;
  unreadAlerts: number;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-pink-400 via-cyan-300 to-yellow-200 text-slate-950">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">LULU Admin</p>
            <p className="text-xs text-muted-foreground">Monitoring dashboard</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Badge tone="good">{role}</Badge>
          <Badge tone="info">Session active</Badge>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 thin-scrollbar">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={onNavigate}
              className={cn(
                "mb-1 flex h-10 items-center gap-3 rounded-md px-3 text-sm transition",
                active ? "bg-primary text-primary-foreground shadow-[0_8px_24px_rgb(236_72_153/0.22)]" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.href === "/alerts" && unreadAlerts > 0 ? <Badge tone="bad">{unreadAlerts}</Badge> : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <Button variant="ghost" className="w-full justify-start" onClick={onLogout}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

function AuthGate({ onLogin }: { onLogin: (role: string) => void }) {
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("Admin");
  const [error, setError] = useState("");

  function submit() {
    const expected = process.env.NEXT_PUBLIC_LULU_DASHBOARD_PASSWORD ?? "admin";
    if (password !== expected) {
      setError("Invalid password");
      return;
    }
    onLogin(role);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        className="w-full max-w-md rounded-lg border bg-card p-6 shadow-panel"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">LULU Admin</h1>
            <p className="text-sm text-muted-foreground">Secure dashboard session</p>
          </div>
        </div>
        <div className="space-y-3">
          <Input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
          <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value)}>
            <option>Admin</option>
            <option>Operator</option>
            <option>Viewer</option>
          </select>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" onClick={submit}>Sign in</Button>
        </div>
      </motion.div>
    </div>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const items = useMemo(
    () => navItems.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
    [query]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
      }
      if (event.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 px-4 pt-24 backdrop-blur">
      <motion.div className="w-full max-w-xl rounded-lg border bg-card shadow-panel" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="border-b p-3">
          <Input autoFocus placeholder="Search pages" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="max-h-80 overflow-y-auto p-2 thin-scrollbar">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  router.push(item.href);
                  onOpenChange(false);
                }}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
