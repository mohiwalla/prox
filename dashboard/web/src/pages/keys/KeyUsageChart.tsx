import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dateLabel, fmtTokens, KEY_USAGE_RANGES } from "../../lib/format";
import type { KeyUsageBucket } from "../../lib/types";

export interface ModelSeries {
  id: string | null;
  name: string;
  color: string;
}

interface UsageSlot {
  ts: number;
  end: number;
  parts: number[];
  tokens: number;
  requests: number;
  failed: number;
}

export function KeyUsageChart({
  buckets,
  models,
  hours,
  unit,
}: {
  buckets: KeyUsageBucket[];
  models: ModelSeries[];
  hours: number;
  unit: "hour" | "day";
}) {
  const figRef = useRef<HTMLElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    const mobile = typeof window !== "undefined" && window.innerWidth <= 760;
    return { w: mobile ? 300 : 680, h: mobile ? 120 : 160 };
  });
  const [activeSlotIdx, setActiveSlotIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = figRef.current;
    if (!el) return;
    const measure = () => {
      const mobile = window.innerWidth <= 760;
      const w = Math.max(280, Math.round((el.clientWidth || 680) - 4));
      const h = mobile ? 120 : 160;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    setActiveSlotIdx(null);
  }, [hours, unit, buckets]);

  const chart = useMemo(() => {
    const daily = unit === "day" || hours > 336;
    const daysCount = Math.max(1, Math.round(hours / 24));
    const rangeLabel = KEY_USAGE_RANGES[hours] || `last ${daysCount} days`;
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

    const slots: UsageSlot[] = [];
    for (let t = start; t < end; ) {
      const next = daily
        ? new Date(
            new Date(t * 1000).setDate(new Date(t * 1000).getDate() + 1),
          ).getTime() / 1000
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

    const index = new Map(models.map((m, i) => [m.id, i]));
    for (const b of buckets) {
      const slot = slots.find((s) => b.hour >= s.ts && b.hour < s.end);
      if (!slot) continue;
      const idx = index.get(b.model) ?? Math.max(0, models.length - 1);
      if (models.length > 0) slot.parts[idx] += b.tokens;
      slot.tokens += b.tokens;
      slot.requests += b.requests;
      slot.failed += b.failed;
    }

    const W = size.w;
    const H = size.h;
    const left = 46;
    const right = 10;
    const top = 8;
    const bottom = 24;
    const x = (t: number) =>
      left + ((t - start) / (end - start)) * (W - left - right);
    const peak = Math.max(0, ...slots.map((s) => s.tokens));
    const magnitude = 10 ** Math.floor(Math.log10(peak || 1));
    const step =
      [1, 2, 5, 10].map((m) => m * magnitude).find((v) => peak <= v) ||
      10 * magnitude;
    const y = (v: number) => H - bottom - (v / step) * (H - top - bottom);

    const dayMarks: { lx: number; anchor: "start" | "middle" | "end"; text: string }[] = [];
    let lastLabel = -Infinity;
    for (const s of slots) {
      if (!daily && new Date(s.ts * 1000).getHours() !== 0) continue;
      const cx = daily ? (x(s.ts) + x(s.end)) / 2 : x(s.ts);
      const anchor = cx > W - right - 40 ? "end" : daily ? "middle" : "start";
      const lx = anchor === "end" ? W - right : cx;
      if (lx - lastLabel < (anchor === "end" ? 110 : 64)) continue;
      lastLabel = lx;
      dayMarks.push({ lx, anchor, text: dateLabel(s.ts, false) });
    }

    const gap = daily ? (slots.length > 30 ? 1 : 4) : 1;
    const quiet = !slots.some((s) => s.tokens > 0);

    return {
      daily,
      rangeLabel,
      start,
      end,
      W,
      H,
      left,
      right,
      top,
      bottom,
      step,
      x,
      y,
      slots,
      dayMarks,
      gap,
      quiet,
    };
  }, [buckets, models, hours, unit, size]);

  const activeSlot = activeSlotIdx !== null ? chart.slots[activeSlotIdx] || null : null;

  const [tipTransform, setTipTransform] = useState("");
  useLayoutEffect(() => {
    if (!activeSlot || !svgRef.current || !tooltipRef.current) return;
    const svg = svgRef.current;
    const tip = tooltipRef.current;
    const x0 = chart.x(activeSlot.ts);
    const x1 = chart.x(activeSlot.end);
    const width = svg.clientWidth || chart.W;
    const ax = ((x0 + x1) / 2 / chart.W) * width;
    const tw = tip.offsetWidth;
    let tipLeft = ax + 14;
    if (tipLeft + tw > width) tipLeft = ax - 14 - tw;
    setTipTransform(`translate3d(${Math.max(0, tipLeft)}px, 8px, 0)`);
  }, [activeSlot, chart]);

  function handlePointerMove(e: React.PointerEvent<HTMLElement>) {
    const svg = svgRef.current;
    if (!svg || !chart.slots.length) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * chart.W;
    const ts =
      chart.start +
      ((px - chart.left) / (chart.W - chart.left - chart.right)) *
        (chart.end - chart.start);
    const clamped = Math.min(chart.end - 1, Math.max(chart.start, ts));
    const idx = chart.slots.findIndex((s) => clamped >= s.ts && clamped < s.end);
    setActiveSlotIdx(idx >= 0 ? idx : null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    if (!chart.slots.length) return;
    e.preventDefault();
    const cur = activeSlotIdx ?? -1;
    let next = cur;
    if (e.key === "ArrowLeft") next = cur < 0 ? chart.slots.length - 1 : cur - 1;
    else if (e.key === "ArrowRight") next = cur < 0 ? chart.slots.length - 1 : cur + 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = chart.slots.length - 1;
    setActiveSlotIdx(Math.min(chart.slots.length - 1, Math.max(0, next)));
  }

  const slotLabel = activeSlot
    ? chart.daily
      ? dateLabel(activeSlot.ts, false)
      : `${dateLabel(activeSlot.ts, false)} · ${new Date(activeSlot.ts * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${new Date(activeSlot.end * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : "";

  return (
    <figure
      ref={figRef}
      className="plot usage"
      data-key-chart=""
      data-slot={activeSlot ? String(activeSlot.ts) : undefined}
      tabIndex={0}
      aria-label={`Tokens per ${chart.daily ? "day" : "hour"} over the ${chart.rangeLabel}, by model. Use left and right arrows to inspect.`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        if (document.activeElement !== figRef.current) setActiveSlotIdx(null);
      }}
      onBlur={() => setActiveSlotIdx(null)}
      onKeyDown={handleKeyDown}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chart.W} ${chart.H}`}
        preserveAspectRatio="none"
        role="img"
      >
        <line
          className="grid-line"
          x1={chart.left}
          x2={chart.W - chart.right}
          y1={chart.y(chart.step)}
          y2={chart.y(chart.step)}
        />
        <text
          x={chart.left - 10}
          y={chart.y(chart.step) + 4}
          textAnchor="end"
        >
          {fmtTokens(chart.step)}
        </text>
        <line
          x1={chart.left}
          x2={chart.W - chart.right}
          y1={chart.y(0)}
          y2={chart.y(0)}
          stroke="var(--border)"
        />
        {chart.dayMarks.map((m, i) => (
          <text
            key={i}
            x={m.lx}
            y={chart.H - 6}
            textAnchor={m.anchor}
          >
            {m.text}
          </text>
        ))}
        <rect
          className="usage-hover"
          x={activeSlot ? chart.x(activeSlot.ts) : 0}
          y={chart.top}
          width={
            activeSlot
              ? Math.max(1, chart.x(activeSlot.end) - chart.x(activeSlot.ts))
              : 0
          }
          height={chart.H - chart.top - chart.bottom}
          {...(!activeSlot ? ({ hidden: true } as Record<string, unknown>) : {})}
        />
        <g className="chart-data">
          {chart.slots.map((s, si) => {
            const x0 = chart.x(s.ts);
            const width = Math.max(1, chart.x(s.end) - x0 - chart.gap * 2);
            let acc = 0;
            return models.map((m, k) => {
              const v = s.parts[k];
              if (v <= 0) return null;
              const h = chart.y(acc) - chart.y(acc + v);
              const rectY = chart.y(acc + v);
              const rectH = Math.max(1.5, acc ? h - 1 : h);
              acc += v;
              return (
                <rect
                  key={`${si}-${k}`}
                  x={x0 + chart.gap}
                  y={rectY}
                  width={width}
                  height={rectH}
                  rx="1.5"
                  fill={m.color}
                />
              );
            });
          })}
        </g>
      </svg>

      <div
        ref={tooltipRef}
        className="chart-tooltip"
        hidden={!activeSlot}
        style={tipTransform ? { transform: tipTransform } : undefined}
      >
        {activeSlot && (
          <>
            <div className="tip-label">{slotLabel}</div>
            {models.map((m, i) =>
              activeSlot.parts[i] > 0 ? (
                <div className="tip-row" key={m.name}>
                  <i className="tip-swatch" style={{ background: m.color }} />
                  <span>{m.name}</span>
                  <strong>{fmtTokens(activeSlot.parts[i])}</strong>
                </div>
              ) : null,
            )}
            <div className="tip-row tip-total">
              <span>
                {activeSlot.requests.toLocaleString()} request
                {activeSlot.requests === 1 ? "" : "s"}
                {activeSlot.failed ? ` · ${activeSlot.failed} failed` : ""}
              </span>
              <strong>{activeSlot.tokens.toLocaleString()} tokens</strong>
            </div>
          </>
        )}
      </div>

      {chart.quiet && (
        <div className="usage-empty">
          No tokens used in the {chart.rangeLabel}
        </div>
      )}

      <figcaption className="chart-caption">
        <span>Tokens per {chart.daily ? "day" : "hour"}</span>
        {models.length > 1 &&
          models.map((m) => (
            <span className="legend" key={m.name}>
              <i className="tip-swatch" style={{ background: m.color }} />
              {m.name}
            </span>
          ))}
        <span className="chart-inspect" aria-live="polite">
          {activeSlot
            ? `${slotLabel} · ${activeSlot.tokens.toLocaleString()} tokens, ${activeSlot.requests} requests`
            : "Input and output; cache reads excluded"}
        </span>
      </figcaption>
    </figure>
  );
}
