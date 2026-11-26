import * as React from "react";
import { dateLabel, fmtTokens, KEY_USAGE_RANGES } from "@/lib/format";
import type { ClientKeyUsageBucket, HistoryHours } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ChartModelSeries {
  id: string | null;
  name: string;
  color: string;
}

export interface KeyUsageChartProps {
  buckets: ClientKeyUsageBucket[];
  models: ChartModelSeries[];
  hours: HistoryHours;
  unit: "hour" | "day";
}

interface ChartSlot {
  ts: number;
  end: number;
  parts: number[];
  tokens: number;
  requests: number;
  failed: number;
}

const CHART_LEFT = 48;
const CHART_RIGHT = 12;
const CHART_TOP = 10;
const CHART_BOTTOM = 24;

function formatClock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function slotLabel(slot: ChartSlot, daily: boolean): string {
  return daily
    ? dateLabel(slot.ts, false)
    : `${dateLabel(slot.ts, false)} · ${formatClock(slot.ts)} – ${formatClock(slot.end)}`;
}

export function KeyUsageChart({
  buckets,
  models,
  hours,
  unit,
}: KeyUsageChartProps) {
  const plotRef = React.useRef<HTMLDivElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);

  const [plotWidth, setPlotWidth] = React.useState(660);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [tooltipWidth, setTooltipWidth] = React.useState(220);

  const daily = unit === "day" || hours > 336;
  const daysCount = Math.max(1, Math.round(hours / 24));
  const rangeLabel = KEY_USAGE_RANGES[hours] ?? `last ${daysCount} days`;

  // Track plot container width for crisp SVG coordinates and tooltip clamping.
  React.useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setPlotWidth(Math.max(280, w));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset active hover/scrubbing when range or granularity changes.
  React.useEffect(() => {
    setActiveIndex(null);
  }, [hours, unit, buckets]);

  // Measure rendered tooltip width so it stays strictly inside plot bounds.
  React.useLayoutEffect(() => {
    if (activeIndex === null) return;
    const tw = tooltipRef.current?.offsetWidth;
    if (tw && tw > 0 && Math.abs(tw - tooltipWidth) > 2) {
      setTooltipWidth(tw);
    }
  }, [activeIndex, tooltipWidth]);

  const chart = React.useMemo(() => {
    const hourSec = 3600;
    const now = Date.now() / 1000;
    let start: number;
    let end: number;

    if (daily) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      end = today.getTime() / 1000 + 86400;
      start = end - daysCount * 86400;
    } else {
      end = Math.floor(now / hourSec) * hourSec + hourSec;
      start = end - hours * hourSec;
    }

    // Local days can be 23 or 25 hours long across DST; place each bucket by its own boundaries.
    const slots: ChartSlot[] = [];
    for (let t = start; t < end; ) {
      const next = daily
        ? (() => {
            const d = new Date(t * 1000);
            d.setDate(d.getDate() + 1);
            return d.getTime() / 1000;
          })()
        : t + hourSec;
      slots.push({
        ts: t,
        end: next,
        parts: models.map(() => 0),
        tokens: 0,
        requests: 0,
        failed: 0,
      });
      t = next;
    }

    const modelIndex = new Map<string | null, number>();
    models.forEach((m, i) => modelIndex.set(m.id, i));

    for (const b of buckets) {
      if (b.hour === null) continue;
      const slot = slots.find((s) => b.hour! >= s.ts && b.hour! < s.end);
      if (!slot) continue;
      const idx = modelIndex.get(b.model) ?? Math.max(0, models.length - 1);
      if (idx < slot.parts.length) {
        slot.parts[idx] += b.tokens;
      }
      slot.tokens += b.tokens;
      slot.requests += b.requests;
      slot.failed += b.failed;
    }

    const peak = Math.max(0, ...slots.map((s) => s.tokens));
    const magnitude = 10 ** Math.floor(Math.log10(peak || 1));
    const step =
      [1, 2, 5, 10]
        .map((m) => m * magnitude)
        .find((v) => peak <= v) ?? 10 * magnitude;

    const quiet = !slots.some((s) => s.tokens > 0);
    return { slots, start, end, step, quiet };
  }, [buckets, models, hours, daily, daysCount]);

  const W = plotWidth;
  const H = W < 480 ? 156 : 188;
  const innerWidth = Math.max(1, W - CHART_LEFT - CHART_RIGHT);
  const innerHeight = Math.max(1, H - CHART_TOP - CHART_BOTTOM);

  const x = (t: number) =>
    CHART_LEFT + ((t - chart.start) / Math.max(1, chart.end - chart.start)) * innerWidth;
  const y = (v: number) =>
    H - CHART_BOTTOM - (v / Math.max(1, chart.step)) * innerHeight;

  const dayTicks = React.useMemo(() => {
    const candidates = chart.slots.filter(
      (s) => daily || new Date(s.ts * 1000).getHours() === 0,
    );
    const ticks: { lx: number; anchor: "start" | "middle" | "end"; text: string }[] = [];
    let lastLabel = -Infinity;
    for (const s of candidates) {
      const cx = daily ? (x(s.ts) + x(s.end)) / 2 : x(s.ts);
      const anchor: "start" | "middle" | "end" =
        cx > W - CHART_RIGHT - 42 ? "end" : daily ? "middle" : "start";
      const lx = anchor === "end" ? W - CHART_RIGHT : cx;
      if (lx - lastLabel < (anchor === "end" ? 105 : 64)) continue;
      lastLabel = lx;
      ticks.push({ lx, anchor, text: dateLabel(s.ts, false) });
    }
    return ticks;
  }, [chart.slots, chart.start, chart.end, daily, W]);

  const gap = daily ? (chart.slots.length > 30 ? 1 : 4) : 1;

  const activeSlot =
    activeIndex !== null && activeIndex >= 0 && activeIndex < chart.slots.length
      ? chart.slots[activeIndex]
      : null;

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const svg = svgRef.current;
    if (!svg || !chart.slots.length) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const ratio = (px - CHART_LEFT) / innerWidth;
    const ts = chart.start + ratio * (chart.end - chart.start);
    const clamped = Math.min(chart.end - 1, Math.max(chart.start, ts));
    const idx = chart.slots.findIndex((s) => clamped >= s.ts && clamped < s.end);
    if (idx >= 0) {
      setActiveIndex(idx);
    }
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.currentTarget.contains(document.activeElement) &&
      document.activeElement?.hasAttribute("data-key-chart-focus")
    ) {
      return;
    }
    setActiveIndex(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!chart.slots.length) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const len = chart.slots.length;
    const cur = activeIndex ?? -1;
    let next = len - 1;
    if (event.key === "ArrowLeft") {
      next = cur < 0 ? len - 1 : Math.max(0, cur - 1);
    } else if (event.key === "ArrowRight") {
      next = cur < 0 ? len - 1 : Math.min(len - 1, cur + 1);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = len - 1;
    }
    setActiveIndex(next);
  }

  // Compute tooltip X position strictly clamped within [8, W - tooltipWidth - 8]
  // and anchored near the top inside the chart plot container so it never overlaps metrics above.
  const tooltipLeft = React.useMemo(() => {
    if (!activeSlot) return 8;
    const center = (x(activeSlot.ts) + x(activeSlot.end)) / 2;
    const pad = 8;
    let candidate = center + 12;
    if (candidate + tooltipWidth > W - pad) {
      candidate = center - 12 - tooltipWidth;
    }
    return Math.max(pad, Math.min(W - tooltipWidth - pad, candidate));
  }, [activeSlot, tooltipWidth, W, chart.start, chart.end]);

  const activeText = activeSlot ? slotLabel(activeSlot, daily) : null;

  return (
    <figure
      tabIndex={0}
      data-key-chart-focus=""
      aria-label={`Tokens per ${daily ? "day" : "hour"} over the ${rangeLabel}, by model. Use left and right arrows to inspect.`}
      onKeyDown={handleKeyDown}
      onBlur={() => setActiveIndex(null)}
      className={cn(
        "m-0 flex flex-col gap-2.5 rounded-lg border border-border bg-background/50 p-3 outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
    >
      {/* Plot container isolates SVG + tooltip strictly inside chart bounds */}
      <div
        ref={plotRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="relative w-full overflow-hidden select-none"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          style={{ height: H }}
          role="img"
        >
          {/* Top gridline + peak label */}
          <line
            x1={CHART_LEFT}
            x2={W - CHART_RIGHT}
            y1={y(chart.step)}
            y2={y(chart.step)}
            stroke="var(--border)"
            strokeDasharray="3 3"
          />
          <text
            x={CHART_LEFT - 8}
            y={y(chart.step) + 4}
            textAnchor="end"
            fill="var(--muted-foreground)"
            fontSize={11}
            className="tabular-nums"
          >
            {fmtTokens(chart.step)}
          </text>

          {/* Mid gridline */}
          {chart.step >= 2 ? (
            <>
              <line
                x1={CHART_LEFT}
                x2={W - CHART_RIGHT}
                y1={y(chart.step / 2)}
                y2={y(chart.step / 2)}
                stroke="var(--border)"
                strokeOpacity={0.5}
                strokeDasharray="3 3"
              />
              <text
                x={CHART_LEFT - 8}
                y={y(chart.step / 2) + 4}
                textAnchor="end"
                fill="var(--muted-foreground)"
                fontSize={11}
                className="tabular-nums"
              >
                {fmtTokens(chart.step / 2)}
              </text>
            </>
          ) : null}

          {/* Baseline */}
          <line
            x1={CHART_LEFT}
            x2={W - CHART_RIGHT}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--border)"
          />

          {/* X-axis day ticks */}
          {dayTicks.map((tick, idx) => (
            <text
              key={`${tick.text}-${idx}`}
              x={tick.lx}
              y={H - 6}
              textAnchor={tick.anchor}
              fill="var(--muted-foreground)"
              fontSize={11}
            >
              {tick.text}
            </text>
          ))}

          {/* Active hover band */}
          {activeSlot ? (
            <rect
              x={x(activeSlot.ts)}
              y={CHART_TOP}
              width={Math.max(2, x(activeSlot.end) - x(activeSlot.ts))}
              height={H - CHART_TOP - CHART_BOTTOM}
              fill="rgba(255, 255, 255, 0.08)"
              rx={2}
            />
          ) : null}

          {/* Stacked bars */}
          <g>
            {chart.slots.map((slot) => {
              const x0 = x(slot.ts);
              const barWidth = Math.max(1.5, x(slot.end) - x0 - gap * 2);
              let acc = 0;
              return models.map((model, mIdx) => {
                const value = slot.parts[mIdx] ?? 0;
                if (value <= 0) return null;
                const prevAcc = acc;
                const nextAcc = acc + value;
                acc = nextAcc;
                const rawH = y(prevAcc) - y(nextAcc);
                const rectH = Math.max(1.5, prevAcc > 0 ? rawH - 1 : rawH);
                return (
                  <rect
                    key={`${slot.ts}-${model.id ?? "other"}`}
                    x={x0 + gap}
                    y={y(nextAcc)}
                    width={barWidth}
                    height={rectH}
                    rx={1.5}
                    fill={model.color}
                  />
                );
              });
            })}
          </g>
        </svg>

        {/* Empty usage overlay */}
        {chart.quiet ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-5 text-xs text-muted-foreground">
            No tokens used in the {rangeLabel}
          </div>
        ) : null}

        {/* Tooltip strictly constrained inside the plot area */}
        {activeSlot && activeText ? (
          <div
            ref={tooltipRef}
            className={cn(
              "pointer-events-none absolute top-2 left-0 z-10 max-h-[calc(100%-30px)] max-w-[min(280px,calc(100%-16px))] overflow-hidden",
              "rounded-md border border-border bg-popover/95 px-2.5 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur-xs",
            )}
            style={{
              transform: `translate3d(${tooltipLeft}px, 0, 0)`,
            }}
          >
            <div className="mb-1 font-medium text-foreground">{activeText}</div>
            <div className="flex flex-col gap-0.5">
              {models.map((m, idx) => {
                const part = activeSlot.parts[idx] ?? 0;
                if (part <= 0) return null;
                return (
                  <div
                    key={m.id ?? "other"}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                      <span className="truncate">{m.name}</span>
                    </span>
                    <strong className="shrink-0 font-medium tabular-nums text-foreground">
                      {fmtTokens(part)}
                    </strong>
                  </div>
                );
              })}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1 text-[11px]">
                <span className="text-muted-foreground">
                  {activeSlot.requests.toLocaleString()} request
                  {activeSlot.requests === 1 ? "" : "s"}
                  {activeSlot.failed ? ` · ${activeSlot.failed} failed` : ""}
                </span>
                <strong className="shrink-0 font-medium tabular-nums text-foreground">
                  {activeSlot.tokens.toLocaleString()} tokens
                </strong>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Caption & legend */}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/85">
          Tokens per {daily ? "day" : "hour"}
        </span>
        {models.length > 1
          ? models.map((m) => (
              <span
                key={m.id ?? "other"}
                className="inline-flex items-center gap-1.5"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: m.color }}
                />
                <span>{m.name}</span>
              </span>
            ))
          : null}
        <span className="ml-auto tabular-nums" aria-live="polite">
          {activeSlot && activeText
            ? `${activeText} · ${activeSlot.tokens.toLocaleString()} tokens, ${activeSlot.requests} requests`
            : "Input and output; cache reads excluded"}
        </span>
      </figcaption>
    </figure>
  );
}
