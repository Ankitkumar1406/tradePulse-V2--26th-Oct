"use client";

import { Fragment, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Activity, ArrowRight, BadgePercent, BarChart3, Bell, BookOpen, CalendarDays, CheckCircle2,
  ChevronRight, ClipboardList, Gift, LineChart, Lock, Radar, ScanSearch, SlidersHorizontal, Star, Target, TrendingUp, Wallet, X,
} from "lucide-react";
import { CYCLES, PRO_PLANS, PRO_FEATURES, BASIC_FEATURES, FEATURE_MATRIX, TOTAL_SCANS, TOTAL_CATEGORIES, BASIC_SCANS, formatINR, type Cycle, type PlanValue } from "@/lib/pricing";
import { emailIssue, nameIssue, passwordIssue, phoneIssue } from "@/lib/validation";
import { COMPANY } from "@/lib/company";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- helpers

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------- landing

export function Landing() {
  const [authOpen, setAuthOpen] = useState(false);

  const openAuthWith = () => setAuthOpen(true);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <LandingNav onLogin={openAuthWith} />
      <Hero onStart={openAuthWith} />
      <Features />
      <HowItWorks />
      <ScreensShowcase />
      <EodResearch />
      <Pricing onStart={openAuthWith} />
      <Reviews />
      <Faq />
      <Footer onStart={openAuthWith} />
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}

// ---------------------------------------------------------------- nav

const NAV_LINKS = [
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How it works" },
  { id: "screens", label: "Product tour" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
  { id: "reviews", label: "Reviews" },
];

function LandingNav({ onLogin }: { onLogin: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <button className="flex items-center gap-2" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand shadow-md shadow-brand/25">
            <Activity className="h-4 w-4 text-white" />
          </span>
          <span className="text-sm font-bold tracking-tight text-zinc-50">
            Trade<span className="text-brand-text">Pulse</span>
          </span>
        </button>
        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((l) => (
            <button
              key={l.id}
              onClick={() => scrollToId(l.id)}
              className="text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-100"
            >
              {l.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            size="sm"
            onClick={onLogin}
            className="h-8 rounded-full bg-brand px-4 text-xs font-semibold text-white shadow-md shadow-brand/25 hover:bg-brand-hover"
          >
            Login
          </Button>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- hero

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.12),transparent_55%)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-brand-text">
            <Radar className="h-3.5 w-3.5" />
            End-of-day research platform · All NSE 3,500+ stocks
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-zinc-50 sm:text-5xl lg:text-6xl">
            Research after the close.
            <br />
            <span className="bg-gradient-to-r from-brand-text via-gold-text to-brand-text bg-clip-text text-transparent">
              Execute with clarity.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            TradePulse auto-updates every NSE-listed stock at{" "}
            <span className="font-semibold text-zinc-200">4:00 pm IST</span> — no live-market screen time needed. Run {TOTAL_SCANS}{" "}
            one-click scanners on finalized daily data, shortlist the best setups, and build a precise watchlist before
            the next open. The method pro traders use: clarity, conviction and execution speed — without sitting in
            front of a screen all day.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              onClick={onStart}
              className="h-11 w-full rounded-full bg-brand px-7 text-sm font-semibold text-white shadow-lg shadow-brand/25 hover:bg-brand-hover sm:w-auto"
            >
              Start your 15-day free trial <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => scrollToId("how-it-works")}
              className="h-11 w-full rounded-full border-zinc-700 bg-transparent px-7 text-sm font-medium text-zinc-200 hover:bg-zinc-800/60 sm:w-auto"
            >
              See how it works
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-text" /> No credit card required · pay only on day 15, if you continue</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-text" /> {TOTAL_SCANS} scanners · {TOTAL_CATEGORIES} categories · 7 Trader Choice templates</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-brand-text" /> RS · EPS · A/D ratings on every result</span>
          </div>
        </div>

        {/* floating chips */}
        <div className="relative mt-14 hidden justify-center gap-3 lg:flex" aria-hidden="true">
          <HeroChip icon={<ScanSearch className="h-4 w-4 text-brand-text" />} title="EOD scanners" sub={`${TOTAL_SCANS} one-click scans`} />
          <HeroChip icon={<BarChart3 className="h-4 w-4 text-gold-text" />} title="Market breadth" sub="Advances · declines · participation" />
          <HeroChip icon={<TrendingUp className="h-4 w-4 text-brand-text" />} title="Sector momentum" sub="Daily · weekly · monthly RSI" />
          <HeroChip icon={<BookOpen className="h-4 w-4 text-gold-text" />} title="Trading journal" sub="Every trade & lesson logged" />
        </div>
      </div>
    </section>
  );
}

function HeroChip({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 shadow-xl shadow-black/20">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800/80">{icon}</span>
      <span>
        <span className="block text-xs font-semibold text-zinc-100">{title}</span>
        <span className="block text-[10px] text-zinc-500">{sub}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- features

const FEATURES = [
  { icon: ScanSearch, title: `${TOTAL_SCANS} one-click scanners`, text: `A pro-grade EOD suite across ${TOTAL_CATEGORIES} categories — chart patterns, shakeouts, gaps & earnings, volume, relative strength, the multi-timeframe RSI extra and all seven Trader Choice templates. Every result carries MarketSmith-style RS rating, EPS score & A/D rating — sort by RS, change %, market cap or 1M/3M/6M performance and star the best charts straight into your watchlist. Every scan returns every matching stock on the exchange — full results, never a truncated top-N sample.` },
  { icon: SlidersHorizontal, title: "Pro screener & multi-scan confluence", text: "Quick filters across price, valuation, momentum, volume and technicals — then run up to 8 scans together and rank stocks by how many they fire on. Save your screens for one-click re-runs and export any result table to CSV." },
  { icon: BarChart3, title: "Market breadth & sector rotation", text: "A-D line, new highs vs new lows, participation above every key average, sector breadth grid, the RS × momentum rotation quadrant and sector strength — know the market's real mood in one glance before you plan the next session." },
  { icon: TrendingUp, title: "Sector momentum, three timeframes", text: "Daily, weekly and monthly RSI for every index and sector — spot high-strength rotations early and avoid sectors that only look strong on the daily chart." },
  { icon: Target, title: "Watchlists & smart price alerts", text: "Star stocks from any scan, screener result or chart tile into a dedicated watchlist with entry, stop and target levels — then let smart price alerts do the monitoring for you." },
  { icon: BookOpen, title: "Professional trading journal", text: "Log every trade with auto-computed P&L, R-multiple and win rate — plus market notes and key learnings that compound into an edge." },
  { icon: CalendarDays, title: "Market calendar", text: "NSE holidays, F&O expiries, RBI MPC, FOMC, Budget and earnings windows — with what-it-means and how-to-prepare notes for traders." },
  { icon: LineChart, title: "Clean charts & stock detail", text: "Two-year candlesticks with SMA overlays, in-pane volume, RSI, MACD, Bollinger Bands and full fundamentals for every stock — all of the 3,500+ NSE-listed names." },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text">Features</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
          Everything an end-of-day trader needs
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          One workspace that replaces a screener, a charting tool, a calendar and a diary — and actually fits around
          your job or your classes.
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10">
              <f.icon className="h-4.5 w-4.5 text-brand-text" />
            </span>
            <h3 className="mt-3 text-sm font-semibold text-zinc-100">{f.title}</h3>
            <p className="mt-1.5 text-xs leading-5 text-zinc-400">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- how it works

const STEPS = [
  { n: "1", title: "Sync the whole market", text: "4:00 pm IST, TradePulse auto-refreshes all 3,500+ NSE stocks — prices, indicators, bars. Zero effort on your side." },
  { n: "2", title: "Run your scans", text: `${TOTAL_SCANS} one-click scanners on finalized data. Horizontal resistance, tight setups, shakeouts, volume footprints, the Trader Choice templates — pick your favourites and run them in seconds.` },
  { n: "3", title: "Build the watchlist", text: "Sort the results by RS or momentum, star the best setups straight from the table, then decide entry, stop and target calmly while the market is closed." },
  { n: "4", title: "Execute the plan", text: "Tomorrow at 9:15, you're not reacting — you're executing a prepared plan. Then journal the result and compound the learning." },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y border-zinc-800/70 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-text">How it works</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            30 focused minutes a night. That&apos;s the whole method.
          </h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-sm font-bold text-brand-text">
                {s.n}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-zinc-100">{s.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-zinc-400">{s.text}</p>
              <ChevronRight className="absolute -right-2.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-zinc-700 md:block" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- product tour (real screenshots)

const SCREENS: {
  slug: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
}[] = [
  {
    slug: "scanners",
    eyebrow: "Scanners",
    title: "39 one-click scanners with RS, EPS score & A/D rating",
    text: "Pick a scan — from horizontal resistance breakouts to the seven multi-condition Trader Choice templates — hit run, and every NSE stock that matches appears as a clean candlestick tile, two charts per row, never a wall of noise. Each result carries its RS rating, EPS score, EPS change % and A/D rating (MarketSmith-style), plus the consolidation base overlay; re-sort by any of them, and star any stock straight into your watchlist. The full match list is always shown — hundreds of hits if that's what the logic finds, with long tables paginated so nothing is hidden.",
    points: ["RS · EPS score · EPS change % · A/D rating on every output", "All 7 Trader Choice templates — momentum, price action, breakout, volume, low-base, confluence & fundamentals", "Full results, no caps — every matching stock returned, long tables paginated", "Base overlay with formation duration on each tile", "Sort by RS, EPS score, change %, mcap or 1M/3M/6M"],
  },
  {
    slug: "screener",
    eyebrow: "Screener",
    title: "A pro screener built for confluence",
    text: "Filter all 3,500+ NSE stocks by price, valuation, momentum, volume and technicals in seconds — then fire up to 8 ready-made scans at once and rank stocks by how many they confluence on. Load a saved screen in one click, re-run it any day and export the table to CSV.",
    points: ["Quick filters across price, momentum, volume & valuation", "Multi-scan confluence — up to 8 scans at once", "Saved screens, one-click re-runs & CSV export"],
  },
  {
    slug: "chart",
    eyebrow: "Charts & overlays",
    title: "Every stock, annotated like a pro chart",
    text: "Open any of the 3,500+ NSE stocks for a two-year candlestick with the 20 MA, volume drawn inside the price pane, and the consolidation base overlaid with how long it has been forming and how deep it is. Timeframe, EMA length and RS-strength filters are one click away — MACD, Bollinger Bands and RSI stay optional to keep the default view clean.",
    points: ["20 MA + in-pane volume by default", "Base overlay: sessions forming & depth", "MACD / Bollinger / RSI as opt-in filters"],
  },
  {
    slug: "breadth",
    eyebrow: "Market analytics",
    title: "The market's mood, in one glance",
    text: "The professional-grade breadth dashboard tracks the advance-decline line, new highs vs new lows and participation above every key average — then maps every industry on the RS × momentum rotation quadrant, ranks sector strength by what's strongest now and what's changing fastest, and scores sector momentum on daily, weekly and monthly RSI.",
    points: ["A-D line · NH-NL · participation above key averages", "Sector rotation quadrant — industries & subgroups", "Sector momentum: daily / weekly / monthly RSI per index"],
  },
  {
    slug: "journal",
    eyebrow: "Journal",
    title: "A journal that compounds your edge",
    text: "Log every trade with automatic P&L, return % and R-multiple, then review what went well, what went wrong and the one lesson worth keeping. Stats, win rate and profit factor update as you write — this is where a good trader becomes a consistent one.",
    points: ["Auto P&L, R-multiple & win rate", "Filter by setup, outcome or keyword", "One-click CSV export"],
  },
];

function ScreenshotFrame({ slug, alt }: { slug: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-2xl shadow-black/30">
      <div className="flex items-center gap-1.5 border-b border-zinc-800/80 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="ml-3 rounded-md bg-zinc-800/70 px-2.5 py-0.5 text-[10px] font-medium text-zinc-500">
          tradepulse.in
        </span>
      </div>
      <Image
        src={`/screenshots/shot-${slug}-light.png`}
        alt={alt}
        width={1440}
        height={900}
        unoptimized
        className="block h-auto w-full dark:hidden"
        sizes="(min-width: 1024px) 640px, 100vw"
      />
      <Image
        src={`/screenshots/shot-${slug}-dark.png`}
        alt=""
        aria-hidden="true"
        width={1440}
        height={900}
        unoptimized
        className="hidden h-auto w-full dark:block"
        sizes="(min-width: 1024px) 640px, 100vw"
      />
    </div>
  );
}

function ScreensShowcase() {
  return (
    <section id="screens" className="border-y border-zinc-800/70 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-text">Product tour</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            See it before you sign up
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Real screens from the app — no mock-ups. Run the scans, read the charts, keep the journal. Everything
            below is included in your 15-day Pro trial.
          </p>
        </div>

        <div className="mt-12 space-y-14">
          {SCREENS.map((s, i) => (
            <div
              key={s.slug}
              className={`grid items-center gap-8 lg:grid-cols-2 lg:gap-12 ${i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}
            >
              <ScreenshotFrame slug={s.slug} alt={`${s.title} — TradePulse screenshot`} />
              <div className={i % 2 === 1 ? "lg:order-1" : ""}>
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-text">{s.eyebrow}</p>
                <h3 className="mt-2 text-2xl font-bold tracking-tight text-zinc-50">{s.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{s.text}</p>
                <ul className="mt-4 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-zinc-300">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- why EOD

const EOD_POINTS = [
  { icon: CalendarDays, title: "Scan after the close, on final data", text: "Intraday signals repaint; the daily close doesn't. Every indicator in TradePulse is computed on finalized EOD data you can trust." },
  { icon: Target, title: "Find the best setups, not the loudest ones", text: `${TOTAL_SCANS} scanners surface only the stocks that match your playbook — so your attention goes to five good charts, not five hundred.` },
  { icon: ClipboardList, title: "A dedicated watchlist with precise levels", text: "Entry, stop, target — decided the night before. Execution speed comes from preparation, not from watching the tape." },
  { icon: Wallet, title: "Your day job stays your day job", text: "No PAY-ing for a terminal, no second monitor at work. The full routine fits in 30 minutes after dinner — from a laptop or your phone." },
];

const EOD_TIMELINE = [
  { time: "9:15 AM", label: "Market opens", text: "You're at work or in class. The plan is already written — alerts are set, nothing needs watching." },
  { time: "4:00 PM", label: "The close + auto-update", text: "By 4:00 pm TradePulse auto-updates every NSE stock — all 3,500+ of them — with zero effort on your side." },
  { time: "Tonight", label: "30 focused minutes", text: "Run your scans, review breadth and sector momentum, update the watchlist, journal what you learned." },
  { time: "Tomorrow 9:15", label: "Execute", text: "Clarity, conviction, speed. The plan does the heavy lifting — you just place the trades you prepared." },
];

const EOD_CHIPS = [
  "No full-time screen sitting",
  "Zero intraday noise & FOMO",
  "Fits a 9-to-5 or college day",
  "Perfect for swing & positional trades",
  "The method pro traders actually use",
];

function EodResearch() {
  return (
    <section id="eod-research" className="mx-auto max-w-6xl px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text">Why end-of-day</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
          The end-of-day method, done properly
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Pro traders don&apos;t watch more — they watch less, but better. Here&apos;s what that looks like on
          TradePulse.
        </p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-zinc-50">The end-of-day method</h3>
          <ul className="mt-5 space-y-5">
            {EOD_POINTS.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10">
                  <p.icon className="h-4.5 w-4.5 text-brand-text" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-zinc-100">{p.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-400">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-gold/25 bg-gradient-to-b from-gold/10 via-zinc-900/60 to-zinc-900/40 p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-zinc-50">A day with TradePulse</h3>
          <ol className="mt-5 space-y-0">
            {EOD_TIMELINE.map((t, i) => (
              <li key={t.time} className="relative flex gap-4 pb-6 last:pb-0">
                {i < EOD_TIMELINE.length - 1 && <span className="absolute left-[7px] top-5 h-full w-px bg-gold/25" aria-hidden="true" />}
                <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-gold bg-zinc-950" aria-hidden="true" />
                <span>
                  <span className="text-xs font-bold uppercase tracking-wider text-gold-text">{t.time}</span>
                  <span className="block text-sm font-semibold text-zinc-100">{t.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-zinc-400">{t.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 rounded-2xl border border-gold/25 bg-gold/10 px-4 py-3 text-xs font-medium leading-5 text-gold-text">
            Research when the market is closed. Execute when it&apos;s open. That&apos;s the whole edge — and anyone
            with a job, a degree and 30 minutes a day can run it.
          </div>
        </div>
      </div>

      {/* Benefit chips */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
        {EOD_CHIPS.map((c) => (
          <span
            key={c}
            className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 py-1.5 text-xs font-medium text-zinc-300"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-brand-text" />
            {c}
          </span>
        ))}
      </div>

      {/* Who it's for */}
      <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-7 text-zinc-400">
        Built for <span className="font-semibold text-zinc-200">working professionals</span>,{" "}
        <span className="font-semibold text-zinc-200">students</span>, swing and positional traders — anyone who refuses
        to sacrifice their day to the tape. Scan after market, pick only the best setups, keep a precise watchlist, and
        let the plan do the heavy lifting.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- pricing

/** Basic vs Pro matrix cell — check, dash or text value. */
function MatrixCell({ v, pro }: { v: PlanValue; pro?: boolean }) {
  if (v === true) {
    return <CheckCircle2 className={cn("mx-auto h-4 w-4", pro ? "text-brand-text" : "text-zinc-500")} aria-label="Included" />;
  }
  if (v === false) {
    return <X className="mx-auto h-4 w-4 text-zinc-700" aria-label="Not included" />;
  }
  return <span className={cn("text-[11px] leading-4", pro ? "text-zinc-200" : "text-zinc-400")}>{v}</span>;
}

function FeatureComparison() {
  return (
    <div data-feature-matrix className="mx-auto mt-12 max-w-4xl">
      <h3 className="text-center text-lg font-semibold text-zinc-50">Basic vs Pro — every feature, spelled out</h3>
      <p className="mt-1.5 text-center text-xs text-zinc-500">
        The same split the app enforces: {TOTAL_SCANS - BASIC_SCANS} of {TOTAL_SCANS} scanners, the chart grid and all
        sector analytics are Pro; the essentials stay free forever.
      </p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800/80">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-900/80 text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3 font-medium">Feature</th>
              <th className="w-28 px-3 py-3 text-center font-medium">Basic</th>
              <th className="w-28 bg-brand/8 px-3 py-3 text-center font-semibold text-brand-text">Pro</th>
            </tr>
          </thead>
          <tbody>
            {FEATURE_MATRIX.map((g) => (
              <Fragment key={g.group}>
                <tr className="bg-zinc-900/40">
                  <td colSpan={3} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-gold-text">
                    {g.group}
                  </td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={g.group + r.feature} className="border-t border-zinc-800/50">
                    <td className="px-4 py-2.5 text-xs leading-5 text-zinc-300">{r.feature}</td>
                    <td className="px-3 py-2.5 text-center"><MatrixCell v={r.basic} /></td>
                    <td className="bg-brand/5 px-3 py-2.5 text-center"><MatrixCell v={r.pro} pro /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pricing({ onStart }: { onStart: () => void }) {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const pro = PRO_PLANS[cycle];
  const inr = formatINR;

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-gold-text">Pricing</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
          Start free. Upgrade when you&apos;re ready.
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Every new account starts with a <span className="font-semibold text-brand-text">15-day free trial of Pro</span> —
          no payment details asked, nothing to cancel. We&apos;ll remind you before it ends, and on day 15 you simply
          choose: subscribe to Pro, or keep using Basic for free.
        </p>
      </div>

      {/* Free-trial banner */}
      <div className="mt-6 flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-gold/35 bg-gold/10 px-4 py-2 text-xs font-medium text-gold-text sm:text-sm">
          <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
          15-day free trial on every new sign-up — no credit card, no UPI mandate, nothing auto-charged. You decide on day 15.
        </div>
      </div>

      {/* Billing cycle toggle */}
      <div className="mt-8 flex justify-center">
        <div
          role="group"
          aria-label="Billing cycle"
          className="inline-flex flex-wrap justify-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 p-1"
        >
          {CYCLES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCycle(c.id)}
              aria-pressed={cycle === c.id}
              className={`rounded-full px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors sm:px-5 sm:text-sm ${
                cycle === c.id ? "bg-brand text-white shadow-md shadow-brand/25" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {c.label}
              {c.note && (
                <span
                  className={`ml-1.5 hidden rounded-full px-1.5 py-0.5 text-[10px] font-semibold sm:inline ${
                    cycle === c.id ? "bg-white/15 text-white" : "bg-gold/15 text-gold-text"
                  }`}
                >
                  {c.note}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plans */}
      <div className="mx-auto mt-10 grid max-w-4xl gap-5 lg:grid-cols-2">
        {/* Basic */}
        <div className="flex flex-col rounded-3xl border border-zinc-800/80 bg-zinc-900/40 p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-zinc-50">Basic</h3>
            <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
              Free forever
            </span>
          </div>
          <p className="mt-1.5 text-sm text-zinc-400">The essentials to keep a finger on the market&apos;s pulse.</p>

          <div className="mt-6 flex items-end gap-2">
            <span className="text-4xl font-bold tracking-tight text-zinc-50">₹0</span>
            <span className="pb-1.5 text-sm text-zinc-500">/ forever</span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">Just create a free login — no card, no trial clock.</p>

          <ul className="mt-6 space-y-2.5 text-sm">
            {BASIC_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                <span className="text-zinc-300">{f}</span>
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-8">
            <Button
              type="button"
              onClick={onStart}
              className="h-11 w-full rounded-full border border-zinc-700 bg-transparent text-sm font-medium text-zinc-200 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              Start for free
            </Button>
            <p className="mt-2.5 text-center text-[11px] text-zinc-500">Included with every account, trial or not</p>
          </div>
        </div>

        {/* Pro */}
        <div className="relative flex flex-col rounded-3xl border-2 border-brand/60 bg-gradient-to-b from-brand/12 via-zinc-900/60 to-zinc-900/40 p-6 shadow-xl shadow-brand/10 sm:p-8">
          <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gold px-3.5 py-1 text-[11px] font-bold uppercase tracking-widest text-zinc-950 shadow-lg">
            Most popular
          </span>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-zinc-50">Pro</h3>
            <span className="rounded-full bg-brand/15 px-2.5 py-1 text-[11px] font-semibold text-brand-text ring-1 ring-brand/30">
              Everything unlocked
            </span>
          </div>
          <p className="mt-1.5 text-sm text-zinc-400">The complete scanning toolkit for serious traders.</p>

          <div className="mt-6 flex items-end gap-2">
            <span className="text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">{inr(pro.price)}</span>
            <span className="pb-1.5 text-sm text-zinc-500">/ {pro.per}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500 line-through">{inr(pro.was)}</span>
            <span className="flex items-center gap-1 rounded-full bg-gold/12 px-2 py-0.5 font-semibold text-gold-text">
              <BadgePercent className="h-3 w-3" aria-hidden="true" />
              Save {pro.savePct}% · introductory offer
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {pro.effective} · {pro.billed}
          </p>

          <div className="mt-5 rounded-xl border border-brand/25 bg-brand/10 px-3.5 py-2.5 text-xs font-medium leading-5 text-brand-text">
            Your first 15 days are free — full Pro access, and no card or UPI mandate is taken to start it. Payment is
            asked only on day 15, and only if you choose to continue.
          </div>

          <ul className="mt-6 space-y-2.5 text-sm">
            <li className="font-medium text-zinc-200">Everything in Basic, plus:</li>
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" />
                <span className="text-zinc-300">{f}</span>
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-8">
            <Button
              type="button"
              onClick={onStart}
              className="h-11 w-full rounded-full bg-brand text-sm font-semibold text-white shadow-lg shadow-brand/25 hover:bg-brand-hover"
            >
              Start 15-day free trial
            </Button>
            <p className="mt-2.5 text-center text-[11px] text-zinc-500">
              Free for 15 days — no card today. On day 15 you choose: subscribe from {inr(pro.price)}/{pro.per}, or stay
              on Basic free.
            </p>
          </div>
        </div>
      </div>

      {/* Full Basic vs Pro comparison */}
      <FeatureComparison />

      <p className="mt-8 text-center text-xs leading-5 text-zinc-500">
        Prices in INR, inclusive of all taxes. The 15-day trial is genuinely card-free — nothing is ever auto-charged,
        and payment details are asked only when you subscribe from day 15 onwards. Paid plans renew via UPI Autopay or
        card mandate, cancel anytime, with access till the period you paid for.
        <br />
        Introductory launch pricing — when your trial ends without subscribing, keep market breadth &amp; basic
        scanners on Basic, free forever.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- reviews

const REVIEW_ASPECTS = [
  { label: "Features", score: 4.9 },
  { label: "Usability", score: 4.8 },
  { label: "Affordability", score: 4.9 },
  { label: "Functionality", score: 4.7 },
];

const REVIEWS = [
  {
    name: "Rohit Malhotra",
    role: "Swing trader · Pune",
    aspects: ["Features", "Functionality"],
    quote:
      `The ${TOTAL_SCANS} scanners are the real deal — I dropped two other subscriptions the week I switched. The volume shakeout scan alone caught three of my best trades this quarter.`,
  },
  {
    name: "Ananya Iyer",
    role: "First-time investor · Chennai",
    aspects: ["Affordability", "Usability"],
    quote:
      "At ₹250 a month on the annual plan, it costs less than one careless trade. Everything is on one screen and I never feel lost, even as a beginner.",
  },
  {
    name: "Karan Deshmukh",
    role: "Intraday trader · Mumbai",
    aspects: ["Usability", "Functionality"],
    quote:
      "9:15 open, run my preset, done in four minutes. Scans to chart to alert without ever leaving the page — that flow is exactly what a morning scanner should be.",
  },
  {
    name: "Sneha Reddy",
    role: "Part-time trader · Hyderabad",
    aspects: ["Affordability", "Features"],
    quote:
      "I was paying for a screener, a charting tool and an alert app separately. TradePulse does all three for a fraction of the total — the 15-day trial had me convinced by day three.",
  },
  {
    name: "Vikram Singh",
    role: "Futures trader · Delhi",
    aspects: ["Features", "Usability"],
    quote:
      "Market breadth and the new sector momentum view tell me the mood before I place anything. Monthly, weekly and daily RSI on every index — I check it before every session.",
  },
  {
    name: "Meera Krishnan",
    role: "Working professional · Bengaluru",
    aspects: ["Functionality", "Affordability"],
    quote:
      "Works on my phone during the commute and my laptop at home, same watchlists, same alerts. Full 3,545-stock coverage at this price — nothing else comes close.",
  },
];

function Stars({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label="Rated 5 out of 5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`${className} fill-gold text-gold`} aria-hidden="true" />
      ))}
    </div>
  );
}

function Reviews() {
  return (
    <section id="reviews" className="border-t border-zinc-800/70 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-gold-text">Reviews</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            Traders who got their evenings back
          </h2>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Stars />
            <span className="text-sm font-semibold text-zinc-200">4.8 / 5</span>
            <span className="text-xs text-zinc-500">from 2,100+ ratings</span>
          </div>
        </div>

        <div className="mx-auto mt-8 grid max-w-5xl gap-3 sm:grid-cols-4">
          {REVIEW_ASPECTS.map((a) => (
            <div key={a.label} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{a.label}</div>
              <div className="mt-0.5 text-lg font-bold text-zinc-100">{a.score.toFixed(1)}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((r) => (
            <figure key={r.name} className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
              <Stars className="h-3.5 w-3.5" />
              <blockquote className="mt-3 flex-1 text-sm leading-6 text-zinc-300">&ldquo;{r.quote}&rdquo;</blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand-text">
                  {r.name.split(" ").map((p) => p[0]).join("")}
                </span>
                <span>
                  <span className="block text-xs font-semibold text-zinc-100">{r.name}</span>
                  <span className="block text-[10px] text-zinc-500">{r.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- FAQ

const FAQ_ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is TradePulse investment advice? Is it SEBI-registered?",
    a: (
      <>
        No. TradePulse is a research and analytics tool, not a SEBI-registered investment adviser or research
        analyst, and nothing in the app — scan results, RS scores, sector views, alerts or journal insights — is a
        recommendation to buy or sell anything. Every output is a mechanical computation on historical end-of-day
        data and can be wrong. You make the final call on every trade, and we always recommend doing your own
        research or consulting a SEBI-registered adviser.
      </>
    ),
  },
  {
    q: "Do I need a credit card for the 15-day trial? What happens when it ends?",
    a: (
      <>
        No card, no UPI mandate, no payment details of any kind — the trial is genuinely free and starts the moment
        you create an account. When it ends, nothing is auto-charged (there is no mandate to charge). You get a
        reminder, and you choose: subscribe to Pro from your account menu, or keep using the free Basic plan for as
        long as you like.
      </>
    ),
  },
  {
    q: "How is the EOD data sourced and verified?",
    a: (
      <>
        The platform works on official end-of-day market data covering all 3,545 NSE-listed stocks. TradePulse
        auto-updates every stock once per trading day at around 4:00 pm IST, right after the NSE close, so every
        price, indicator and scan is computed on finalised daily bars — never on intraday data that can repaint. The
        header shows exactly when the last update ran, and scans re-run instantly on that finalised data.
      </>
    ),
  },
  {
    q: "What happens to my watchlists and journal if I cancel or delete my account?",
    a: (
      <>
        Cancelling auto-renewal changes nothing about your data — you keep Pro access till the period you paid for,
        and then your watchlists, alerts and journal stay intact on the free Basic plan. If you ask us to delete
        your account entirely, we erase your profile and research data from production within 30 days (backups
        within 90), and we offer you a CSV export of your journal and watchlists first so nothing is lost.
      </>
    ),
  },
  {
    q: "Can I switch between Basic and Pro?",
    a: (
      <>
        Anytime, in both directions. Subscribing to Pro takes about a minute and Pro validity stacks on top of any
        time you already have. If you cancel, you simply drop to Basic at the end of the paid period — no lock-in,
        no penalty, and you can re-subscribe whenever you want. Monthly, 3-month, 6-month and annual cycles are all
        the same plan; only the commitment differs.
      </>
    ),
  },
  {
    q: "Will I be charged after the trial? What if something goes wrong — do you refund?",
    a: (
      <>
        You are never charged without an explicit action: because the trial takes no payment details, day 15 can
        only begin a charge if you personally subscribe. Once subscribed, you can cancel auto-renewal any time and
        keep access till the period you paid for. If a duplicate or incorrect charge ever happens, or you forget to
        cancel within 7 days of a first renewal, write to {COMPANY.supportEmail} — refunds are issued to the
        original payment method in 5–7 business days (full policy on the Refund &amp; Cancellation page).
      </>
    ),
  },
];

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text">FAQ</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
          Straight answers before you commit
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          The questions traders ask us most — about advice, data, trials and your data rights.
        </p>
      </div>
      <Accordion type="single" collapsible className="mt-8">
        {FAQ_ITEMS.map((item, i) => (
          <AccordionItem key={i} value={`item-${i}`} className="border-zinc-800/80">
            <AccordionTrigger className="py-4 text-left text-sm font-semibold text-zinc-100 hover:no-underline [&>svg]:text-zinc-500">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="pb-5 text-sm leading-6 text-zinc-400">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

// ---------------------------------------------------------------- footer

function Footer({ onStart }: { onStart: () => void }) {
  return (
    <footer className="mt-auto border-t border-zinc-800/70 bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.4fr]">
          {/* brand */}
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand">
                <Activity className="h-4 w-4 text-white" />
              </span>
              <span className="text-sm font-bold text-zinc-50">Trade<span className="text-brand-text">Pulse</span></span>
            </div>
            <p className="mt-3 max-w-sm text-xs leading-5 text-zinc-500">
              End-of-day research &amp; scanners covering all NSE-listed equities. Built for working professionals and
              students — clarity, conviction and execution speed without the screen time.
            </p>
            <p className="mt-4 text-xs text-zinc-500">
              Support:{" "}
              <a href={`mailto:${COMPANY.supportEmail}`} className="text-zinc-300 underline-offset-2 transition-colors hover:text-zinc-100 hover:underline">
                {COMPANY.supportEmail}
              </a>
              <span className="mt-0.5 block text-[11px] text-zinc-600">{COMPANY.supportHours}</span>
            </p>
          </div>

          {/* product */}
          <nav aria-label="Product">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Product</h3>
            <ul className="mt-3 space-y-2 text-xs">
              {NAV_LINKS.map((l) => (
                <li key={l.id}>
                  <button onClick={() => scrollToId(l.id)} className="text-zinc-500 transition-colors hover:text-zinc-200">
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* legal */}
          <nav aria-label="Legal">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Legal</h3>
            <ul className="mt-3 space-y-2 text-xs">
              <li><Link href="/terms" className="text-zinc-500 transition-colors hover:text-zinc-200">Terms of Service</Link></li>
              <li><Link href="/privacy" className="text-zinc-500 transition-colors hover:text-zinc-200">Privacy Policy</Link></li>
              <li><Link href="/refund-policy" className="text-zinc-500 transition-colors hover:text-zinc-200">Refund &amp; Cancellation Policy</Link></li>
            </ul>
          </nav>

          {/* company + CTA */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Company</h3>
            <p className="mt-3 text-xs font-semibold text-zinc-300">{COMPANY.legalName}</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">{COMPANY.registeredAddress}</p>
            <div className="mt-4 flex flex-col items-start gap-2.5">
              <Button
                onClick={onStart}
                className="h-9 rounded-full bg-brand px-5 text-xs font-semibold text-white shadow-lg shadow-brand/25 hover:bg-brand-hover"
              >
                Start your free trial <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
              <p className="text-[11px] text-zinc-600">
                15 days free, no card needed · {TOTAL_SCANS} scanners · cancel anytime
              </p>
            </div>
          </div>
        </div>

        {/* SEBI / not-investment-advice disclaimer */}
        <div className="mt-10 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Disclaimer</p>
          <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
            TradePulse is a market-research and analytics tool and is <span className="font-semibold text-zinc-400">not
            investment advice</span>. We are not a SEBI-registered investment adviser or research analyst. Scan
            results, ratings, charts and all other outputs are mechanical computations on historical end-of-day data,
            are provided for education and research only, and can be wrong or incomplete. Trading in securities
            involves substantial risk of loss — do your own research and consult a SEBI-registered investment adviser
            before making any investment decision. Market data is end-of-day, refreshed after the NSE close, and may
            be delayed or revised.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-2 border-t border-zinc-800/70 pt-6 text-[11px] text-zinc-600 sm:flex-row sm:items-center">
          <p>© 2026 {COMPANY.legalName}. All rights reserved.</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/terms" className="transition-colors hover:text-zinc-400">Terms</Link>
            <span aria-hidden="true">·</span>
            <Link href="/privacy" className="transition-colors hover:text-zinc-400">Privacy</Link>
            <span aria-hidden="true">·</span>
            <Link href="/refund-policy" className="transition-colors hover:text-zinc-400">Refunds</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------- auth dialog

function AuthDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md border-zinc-800 bg-zinc-950 p-0 text-zinc-200 sm:max-w-md">
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="p-6 pt-7">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand shadow-md shadow-brand/25">
              <Activity className="h-4 w-4 text-white" />
            </span>
            <span className="text-sm font-bold text-zinc-50">Trade<span className="text-brand-text">Pulse</span></span>
          </div>
          <DialogHeader className="mt-3 text-left">
            <DialogTitle className="text-lg text-zinc-50">Welcome to TradePulse</DialogTitle>
            <DialogDescription className="text-xs leading-5">
              Sign in to your account, or create one — every new account gets a{" "}
              <span className="font-semibold text-gold-text">15-day Pro trial</span>. No card is needed to start — you
              decide on day 15.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="signin" className="mt-4">
            <TabsList className="grid w-full grid-cols-2 bg-zinc-900">
              <TabsTrigger value="signin" className="text-xs">Sign in</TabsTrigger>
              <TabsTrigger value="signup" className="text-xs">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4">
              <SignInForm onSuccess={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="signup" className="mt-4">
              <SignUpForm onSuccess={() => onOpenChange(false)} />
            </TabsContent>
          </Tabs>

          <DemoButton onSuccess={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (res?.error) setError("Email or password is incorrect");
      else onSuccess();
    } catch {
      setError("Something went wrong — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="si-email" className="text-xs text-zinc-400">Email</Label>
        <Input
          id="si-email" type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1 h-10 border-zinc-800 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>
      <div>
        <Label htmlFor="si-password" className="text-xs text-zinc-400">Password</Label>
        <Input
          id="si-password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="mt-1 h-10 border-zinc-800 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>
      {error && (
        <p className="flex items-center gap-1.5 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
          <Lock className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-10 w-full rounded-lg bg-brand text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // name, email, phone number and password are ALL mandatory
  const issues = useMemo(() => {
    return {
      name: nameIssue(name),
      email: emailIssue(email),
      phone: phoneIssue(phone),
      password: passwordIssue(password),
    };
  }, [name, email, phone, password]);

  const submitDisabled = busy || Object.values(issues).some(Boolean) || !name || !email || !phone || !password;

  const onPhoneChange = (v: string) => {
    // keep digits and separators only; client-side hint — server re-validates
    setPhone(v.replace(/[^\d+\-\s]/g, "").slice(0, 16));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
      if (!res.ok) {
        setServerError(j.error ?? "Could not create the account");
        if (j.errors) setFieldErrors(j.errors);
        return;
      }
      const signInRes = await signIn("credentials", { email, password, redirect: false });
      if (signInRes?.error) {
        setServerError("Account created — sign in manually from the Sign in tab");
        return;
      }
      onSuccess();
    } catch {
      setServerError("Something went wrong — try again");
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = "mt-1 h-10 border-zinc-800 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600";
  const err = (k: string) => fieldErrors[k] ?? null;

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor="su-name" className="text-xs text-zinc-400">Full name <span className="text-loss">*</span></Label>
        <Input
          id="su-name" type="text" autoComplete="name" required value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className={fieldCls}
        />
        {(issues.name || err("name")) && <p className="mt-1 text-[10px] text-loss">{issues.name ?? err("name")}</p>}
      </div>
      <div>
        <Label htmlFor="su-email" className="text-xs text-zinc-400">Email id <span className="text-loss">*</span></Label>
        <Input
          id="su-email" type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={fieldCls}
        />
        {(issues.email || err("email")) && <p className="mt-1 text-[10px] text-loss">{issues.email ?? err("email")}</p>}
      </div>
      <div>
        <Label htmlFor="su-phone" className="text-xs text-zinc-400">Phone number <span className="text-loss">*</span></Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">+91</span>
          <Input
            id="su-phone" type="tel" autoComplete="tel-national" required value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="98765 43210"
            className={`${fieldCls} pl-11`}
          />
        </div>
        {(issues.phone || err("phone")) && <p className="mt-1 text-[10px] text-loss">{issues.phone ?? err("phone")}</p>}
      </div>
      <div>
        <Label htmlFor="su-password" className="text-xs text-zinc-400">Password <span className="text-loss">*</span></Label>
        <Input
          id="su-password" type="password" autoComplete="new-password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          className={fieldCls}
        />
        {(issues.password || err("password")) && <p className="mt-1 text-[10px] text-loss">{issues.password ?? err("password")}</p>}
      </div>
      <p className="text-[10px] leading-4 text-zinc-600">
        All fields are required. Your phone number is used only for account &amp; billing communication — never shared,
        never spammed.
      </p>
      {serverError && (
        <p className="flex items-center gap-1.5 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
          <Lock className="h-3.5 w-3.5 shrink-0" /> {serverError}
        </p>
      )}
      <Button
        type="submit"
        disabled={submitDisabled}
        className="h-10 w-full rounded-lg bg-brand text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        title={submitDisabled ? "Fill every field correctly to continue" : undefined}
      >
        {busy ? "Creating account…" : "Create account & start free trial"}
      </Button>
    </form>
  );
}

function DemoButton({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 border-t border-zinc-800/80 pt-4">
      {error && <p className="mb-2 text-center text-xs text-loss">{error}</p>}
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await signIn("credentials", { demo: "1", redirect: false });
            if (res?.error) {
              setError("Demo login failed — please try again");
              return;
            }
            onSuccess();
          } catch {
            setError("Something went wrong — try again");
          } finally {
            setBusy(false);
          }
        }}
        className="h-9 w-full rounded-lg border-zinc-700 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      >
        {busy ? "Loading demo…" : "or explore with the demo account →"}
      </Button>
    </div>
  );
}
