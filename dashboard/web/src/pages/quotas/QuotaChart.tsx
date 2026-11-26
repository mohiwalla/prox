import * as React from "react";
import { dateLabel, fmtPct } from "@/lib/format";
import type { HistoryHours } from "@/lib/types";
import { monotonePath, seriesAt, type ChartPoint } from "./model";

export interface QuotaChartProps {
  label: string;
  color: string;
  points: ChartPoint[];
  forecast: ChartPoint[];
  resetAt: number | null;
  now: number;
  start: number;
  end: number;
  hours: HistoryHours;
  forecastEnabled: boolean;
}

const PAD_LEFT = 46;
const PAD_RIGHT = 12;
const PAD_TOP = 28;
const PAD_BOTTOM = 30;

export function QuotaChart({
  label,
  color,
  points,
  forecast,
  resetAt,
  now,
  start,
  end,
  hours,
  forecastEnabled,
}: QuotaChartProps) {
  const uid = React.useId().replace(/:/g, "");
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number>(0);

  const [width, setWidth] = React.useState(760);
  const [inspected, setInspected] = React.useState<ChartPoint | null>(null);
  const [tooltipSize, setTooltipSize] = React.useState({ w: 164, h: 52 });

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.max(280, Math.round(el.clientWidth));
      setWidth((prev) => (prev === next ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  React.useEffect(() => {
    setInspected(null);
  }, [hours, forecastEnabled]);

  // Keep inspected point valid if the visible time window shifts out from under it.
  const activeInspected = React.useMemo(() => {
    if (!inspected) return null;
    if (inspected.ts < start || inspected.ts > end) return null;
    return inspected;
  }, [inspected, start, end]);

  // Measure tooltip box whenever inspected point appears/updates so clamping is exact.
  React.useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!activeInspected || !el) return;
    const nextW = el.offsetWidth;
    const nextH = el.offsetHeight;
    if (nextW > 0 && nextH > 0) {
      setTooltipSize((prev) =>
        prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH },
      );
    }
  }, [activeInspected]);

  const isCompact = width <= 540;
  const height = isCompact ? 200 : 240;
  const span = Math.max(1, end - start);
  const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const plotH = Math.max(1, height - PAD_TOP - PAD_BOTTOM);

  const xScale = React.useCallback(
    (ts: number) => PAD_LEFT + ((ts - start) / span) * plotW,
    [start, span, plotW],
  );
  const yScale = React.useCallback(
    (v: number) => PAD_TOP + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH,
    [plotH],
  );

  const historyPath = React.useMemo(
    () => monotonePath(points, xScale, yScale),
    [points, xScale, yScale],
  );

  const areaPath = React.useMemo(() => {
    if (points.length < 2 || !historyPath) return "";
    const last = points[points.length - 1];
    const first = points[0];
    return `${historyPath} L${xScale(last.ts).toFixed(2)},${yScale(0).toFixed(2)} L${xScale(first.ts).toFixed(2)},${yScale(0).toFixed(2)} Z`;
  }, [points, historyPath, xScale, yScale]);

  const forecastPath = React.useMemo(
    () => monotonePath(forecast, xScale, yScale),
    [forecast, xScale, yScale],
  );

  const yTicks = [0, 50, 100] as const;
  const xTickCount = isCompact ? 3 : 6;
  const xTicks = React.useMemo(() => {
    const list: { ts: number; x: number; text: string; anchor: "start" | "middle" | "end" }[] = [];
    for (let i = 0; i <= xTickCount; i++) {
      const ts = start + (span * i) / xTickCount;
      const text = new Date(ts * 1000).toLocaleString(
        undefined,
        hours === 24 ? { hour: "numeric" } : { month: "short", day: "numeric" },
      );
      list.push({
        ts,
        x: xScale(ts),
        text,
        anchor: i === 0 ? "start" : i === xTickCount ? "end" : "middle",
      });
    }
    return list;
  }, [xTickCount, start, span, hours, xScale]);

  const showReset = Boolean(resetAt && resetAt > now + 600 && resetAt < end);
  const resetX = showReset && resetAt ? xScale(resetAt) : 0;
  const nowX = xScale(now);

  const latestPoint = points[points.length - 1];
  const latestX = latestPoint ? xScale(latestPoint.ts) : 0;
  const latestY = latestPoint ? yScale(latestPoint.value) : 0;
  const latestLabelFlip = latestX > width - 68;

  const allSeriesPoints = React.useMemo(
    () => [
      ...points.map((p) => ({ ...p, projected: false })),
      ...forecast.map((p) => ({ ...p, projected: true })),
    ],
    [points, forecast],
  );

  const scrubToClientX = React.useCallback(
    (clientX: number) => {
      if (!points.length && !forecast.length) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relX = ((clientX - rect.left) / rect.width) * width;
      const ts = start + ((relX - PAD_LEFT) / plotW) * span;
      const next = seriesAt(points, forecast, ts);
      setInspected(next);
    },
    [points, forecast, width, start, plotW, span],
  );

  const handlePointer = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const clientX = event.clientX;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        scrubToClientX(clientX);
      });
    },
    [scrubToClientX],
  );

  const clearInspection = React.useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setInspected(null);
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!allSeriesPoints.length) return;
      if (event.key === "Escape") {
        if (inspected) {
          event.preventDefault();
          clearInspection();
        }
        return;
      }
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      event.preventDefault();

      if (event.key === "Home") {
        setInspected(allSeriesPoints[0]);
        return;
      }
      if (event.key === "End") {
        setInspected(allSeriesPoints[allSeriesPoints.length - 1]);
        return;
      }

      let currentIdx = allSeriesPoints.length - 1;
      if (inspected) {
        let best = 0;
        let bestDist = Math.abs(allSeriesPoints[0].ts - inspected.ts);
        for (let i = 1; i < allSeriesPoints.length; i++) {
          const dist = Math.abs(allSeriesPoints[i].ts - inspected.ts);
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        }
        currentIdx = best;
      }

      const nextIdx = Math.min(
        allSeriesPoints.length - 1,
        Math.max(0, currentIdx + (event.key === "ArrowLeft" ? -1 : 1)),
      );
      setInspected(allSeriesPoints[nextIdx]);
    },
    [allSeriesPoints, inspected, clearInspection],
  );

  const inspectedIsFuture = activeInspected
    ? Boolean(activeInspected.projected ?? activeInspected.ts > now)
    : false;
  const inspectedX = activeInspected ? xScale(activeInspected.ts) : 0;
  const inspectedY = activeInspected ? yScale(activeInspected.value) : 0;

  // Position tooltip strictly inside the SVG chart box (never overlapping metrics above).
  const tooltipPos = React.useMemo(() => {
    if (!activeInspected) return { left: 0, top: 0 };
    const margin = 8;
    const gap = 14;
    const tw = tooltipSize.w;
    const th = tooltipSize.h;

    let left = inspectedX + gap;
    if (left + tw > width - margin) {
      left = inspectedX - gap - tw;
    }
    left = Math.max(margin, Math.min(width - tw - margin, left));

    // Prefer above the point if it stays cleanly inside the chart plot top; otherwise place below.
    let top = inspectedY - th - 12;
    if (top < margin) {
      top = inspectedY + 14;
    }
    top = Math.max(margin, Math.min(height - th - margin, top));

    return { left, top };
  }, [activeInspected, inspectedX, inspectedY, tooltipSize, width, height]);

  const statusLine = activeInspected
    ? `${dateLabel(activeInspected.ts)} · ${fmtPct(activeInspected.value)} ${inspectedIsFuture ? "projected" : "recorded"}`
    : forecast.length
      ? "Estimate from recent usage"
      : !forecastEnabled
        ? "Forecast hidden"
        : "Forecast needs 10+ minutes of recent samples";

  return (
    <figure
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          clearInspection();
        }
      }}
      aria-label={`${label} quota history and forecast. Use left, right, Home, and End keys to inspect samples.`}
      className="mt-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {/* Isolated relative container wrapping ONLY the SVG so the tooltip stays strictly inside chart bounds */}
      <div
        ref={containerRef}
        className="relative w-full select-none overflow-hidden rounded-md"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          style={{ height }}
          className="block w-full touch-pan-y cursor-crosshair"
          role="img"
          aria-label={`${points.length} recorded samples${forecast.length ? ", estimated future usage" : ""}`}
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={clearInspection}
          onPointerCancel={clearInspection}
        >
          <defs>
            <linearGradient
              id={`quota-fill-${uid}`}
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal grid & Y-axis labels */}
          {yTicks.map((v) => {
            const y = yScale(v);
            return (
              <g key={`y-${v}`}>
                <line
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="rgba(255, 255, 255, 0.06)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground font-mono text-[11px]"
                >
                  {v}%
                </text>
              </g>
            );
          })}

          {/* Vertical grid & X-axis labels */}
          {xTicks.map((tick, idx) => (
            <g key={`x-${idx}`}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={PAD_TOP}
                y2={height - PAD_BOTTOM}
                stroke="rgba(255, 255, 255, 0.06)"
                strokeWidth={1}
              />
              <text
                x={tick.x}
                y={height - 8}
                textAnchor={tick.anchor}
                className="fill-muted-foreground font-mono text-[11px]"
              >
                {tick.text}
              </text>
            </g>
          ))}

          {/* Upcoming reset marker */}
          {showReset ? (
            <g>
              <line
                x1={resetX}
                x2={resetX}
                y1={PAD_TOP}
                y2={height - PAD_BOTTOM}
                stroke="rgba(255, 255, 255, 0.22)"
                strokeDasharray="3 5"
                strokeWidth={1}
              />
              <text
                x={Math.min(width - 22, Math.max(PAD_LEFT + 18, resetX))}
                y={15}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[11px]"
              >
                Reset
              </text>
            </g>
          ) : null}

          {/* Now marker */}
          <g>
            <line
              x1={nowX}
              x2={nowX}
              y1={PAD_TOP - 4}
              y2={height - PAD_BOTTOM + 2}
              stroke="#686868"
              strokeWidth={1}
            />
            <text
              x={Math.min(width - 16, Math.max(PAD_LEFT + 14, nowX))}
              y={15}
              textAnchor="middle"
              className="fill-foreground font-mono text-[11px]"
            >
              Now
            </text>
          </g>

          {/* Recorded area + history line + forecast line + latest value dot */}
          <g>
            {areaPath ? (
              <path d={areaPath} fill={`url(#quota-fill-${uid})`} />
            ) : null}
            {points.length > 1 && historyPath ? (
              <path
                d={historyPath}
                stroke={color}
                strokeWidth={3.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null}
            {forecast.length > 1 && forecastPath ? (
              <path
                d={forecastPath}
                stroke={color}
                strokeOpacity={0.7}
                strokeWidth={3.25}
                strokeLinecap="round"
                strokeDasharray="4 9"
                fill="none"
              />
            ) : null}
            {latestPoint ? (
              <g>
                <circle
                  cx={latestX}
                  cy={latestY}
                  r={5.5}
                  fill={color}
                  stroke="var(--card)"
                  strokeWidth={2.5}
                />
                <text
                  x={latestLabelFlip ? latestX - 11 : latestX + 11}
                  y={Math.max(PAD_TOP + 12, latestY - 8)}
                  textAnchor={latestLabelFlip ? "end" : "start"}
                  fill={color}
                  className="font-mono text-[11px] font-medium"
                >
                  {fmtPct(latestPoint.value)}
                </text>
              </g>
            ) : null}
          </g>

          {/* Interactive crosshair */}
          {activeInspected ? (
            <g className="pointer-events-none">
              <line
                x1={inspectedX}
                x2={inspectedX}
                y1={PAD_TOP}
                y2={height - PAD_BOTTOM}
                stroke="rgba(255, 255, 255, 0.24)"
                strokeWidth={1}
              />
              <circle
                cx={inspectedX}
                cy={inspectedY}
                r={11}
                fill={color}
                opacity={0.2}
              />
              <circle
                cx={inspectedX}
                cy={inspectedY}
                r={5.5}
                fill={color}
                stroke="var(--card)"
                strokeWidth={2.5}
              />
            </g>
          ) : null}
        </svg>

        {/* Tooltip strictly contained inside the chart container */}
        {activeInspected ? (
          <div
            ref={tooltipRef}
            style={{
              transform: `translate3d(${tooltipPos.left}px, ${tooltipPos.top}px, 0)`,
            }}
            className="pointer-events-none absolute top-0 left-0 z-10 grid min-w-[144px] gap-1 rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-xs leading-4 whitespace-nowrap shadow-xl backdrop-blur-xs"
          >
            <div className="font-medium text-foreground">
              {dateLabel(activeInspected.ts)}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-[2px]"
                style={
                  inspectedIsFuture
                    ? {
                        border: `1.5px dashed ${color}`,
                        backgroundColor: "transparent",
                      }
                    : { backgroundColor: color }
                }
              />
              <span>{inspectedIsFuture ? "Projected" : "Recorded"}</span>
              <strong className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">
                {fmtPct(activeInspected.value)}
              </strong>
            </div>
          </div>
        ) : null}

        {/* Empty history hint */}
        {points.length < 2 ? (
          <div className="pointer-events-none absolute inset-x-[10%] top-[28%] text-center">
            <strong className="mb-1 block text-sm font-medium text-foreground">
              History starts here
            </strong>
            <p className="mx-auto max-w-[360px] text-[13px] leading-5 text-muted-foreground">
              Quotas are recorded every 30 seconds, even with this page closed.
              Your usage curve will build over time.
            </p>
          </div>
        ) : null}
      </div>

      {/* Legend & live scrub caption */}
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs leading-4 text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1 w-4 rounded-xs"
            style={{ backgroundColor: color }}
          />
          Recorded
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1 w-4 opacity-70"
            style={{
              backgroundImage: `radial-gradient(circle, ${color} 1.8px, transparent 2.2px)`,
              backgroundSize: "7px 4px",
              backgroundPosition: "0 50%",
              backgroundRepeat: "repeat-x",
            }}
          />
          Projected
        </span>
        <span
          className="ml-auto tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {statusLine}
        </span>
      </figcaption>
    </figure>
  );
}
