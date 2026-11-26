import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dateLabel, fmtPct } from "../lib/format";
import {
  forecastPoints,
  historyPoints,
  monotonePath,
  seriesAt,
  type AccountWindowItem,
  type ChartPoint,
} from "../lib/quotaMath";
import type { SnapshotData } from "../lib/types";

export function QuotaChart({
  chartKey,
  label,
  data,
  items,
  metric,
  hours,
  burn,
  showForecast,
}: {
  chartKey: string;
  label: string;
  data: SnapshotData;
  items: AccountWindowItem[];
  metric: string;
  hours: number;
  burn: number;
  showForecast: boolean;
}) {
  const figRef = useRef<HTMLElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dataGroupRef = useRef<SVGGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const drawnRef = useRef(false);

  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    const mobile = typeof window !== "undefined" && window.innerWidth <= 760;
    return { w: mobile ? 340 : 950, h: mobile ? 200 : 240 };
  });
  const [inspected, setInspected] = useState<ChartPoint | null>(null);

  useEffect(() => {
    const el = figRef.current;
    if (!el) return;
    const measure = () => {
      const mobile = window.innerWidth <= 760;
      const w = Math.max(280, Math.round(el.clientWidth || (mobile ? 340 : 950)));
      const h = mobile ? 200 : 240;
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

  // Clear inspection when metric/range/forecast changes.
  useEffect(() => {
    setInspected(null);
  }, [metric, hours, showForecast, burn]);

  // Draw-in animation on first mount, respecting reduced motion.
  useEffect(() => {
    if (drawnRef.current) return;
    drawnRef.current = true;
    const g = dataGroupRef.current;
    if (
      !g ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof g.animate !== "function"
    )
      return;
    g.animate(
      [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
      { duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, []);

  const computed = useMemo(() => {
    const now = data.now;
    const range = hours * 3600;
    const start = now - range * (showForecast ? 0.3 : 1);
    const end = showForecast ? now + range * 0.7 : now;
    const cap = Math.max(items.length * 100, 100);

    const points = historyPoints(
      data,
      items.map((o) => o.a),
      metric,
    ).filter((r) => r.ts >= start);
    const actualAt = items.length
      ? Math.min(...items.map((o) => o.a.quota_at || now))
      : now;
    if (
      items.length &&
      actualAt >= start &&
      !items.some((o) => o.a.quota_error)
    ) {
      const latest = {
        ts: actualAt,
        value: items.reduce((sum, o) => sum + o.w.remaining, 0),
      };
      if (!points.length || Math.abs(points[points.length - 1].ts - latest.ts) > 1) {
        points.push(latest);
      }
    }
    const forecast = forecastPoints(
      data,
      items,
      metric,
      burn,
      showForecast,
      now,
      end,
    );
    const W = size.w;
    const H = size.h;
    const left = 46;
    const right = 10;
    const top = 30;
    const bottom = 32;
    const x = (t: number) =>
      left + ((t - start) / (end - start)) * (W - left - right);
    const y = (v: number) =>
      H - bottom - (v / cap) * (H - top - bottom);

    const yTicks = [0, 1, 2].map((i) => {
      const v = (cap * i) / 2;
      return { v, py: y(v) };
    });

    const tickCount = typeof window !== "undefined" && window.innerWidth <= 760 ? 3 : 6;
    const xTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const ts = start + ((end - start) * i) / tickCount;
      const tickLabel = new Date(ts * 1000).toLocaleString(
        undefined,
        hours === 24 ? { hour: "numeric" } : { month: "short", day: "numeric" },
      );
      const anchor = i === 0 ? "start" : i === tickCount ? "end" : "middle";
      return { ts, px: x(ts), label: tickLabel, anchor };
    });

    const resets = [
      ...new Set(
        items
          .map(({ w }) => w.reset_at)
          .filter((t): t is number => Boolean(t && t > now + 600 && t < end)),
      ),
    ].slice(0, 5);

    const recordedPath = points.length > 1 ? monotonePath(points, x, y) : "";
    const areaPath =
      points.length > 1
        ? `${recordedPath} L${x(points[points.length - 1].ts)},${y(0)} L${x(points[0].ts)},${y(0)} Z`
        : "";
    const forecastPath = forecast.length ? monotonePath(forecast, x, y) : "";
    const latest = points[points.length - 1] || null;

    return {
      now,
      start,
      end,
      W,
      H,
      left,
      right,
      top,
      bottom,
      x,
      y,
      points,
      forecast,
      yTicks,
      xTicks,
      resets,
      recordedPath,
      areaPath,
      forecastPath,
      latest,
    };
  }, [data, items, metric, hours, burn, showForecast, size]);

  // Position tooltip beside hovered/inspected point.
  const [tipTransform, setTipTransform] = useState<string>("");
  useLayoutEffect(() => {
    if (!inspected || !svgRef.current || !tooltipRef.current) return;
    const px = computed.x(inspected.ts);
    const py = computed.y(inspected.value);
    const svg = svgRef.current;
    const tip = tooltipRef.current;
    const width = svg.clientWidth || computed.W;
    const height = svg.clientHeight || computed.H;
    const ax = (px / computed.W) * width;
    const ay = (py / computed.H) * height;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let tipLeft = ax + 16;
    let tipTop = ay - th - 12;
    if (tipLeft + tw > width) tipLeft = ax - 16 - tw;
    if (tipTop < 0) tipTop = ay + 12;
    setTipTransform(`translate3d(${Math.max(0, tipLeft)}px, ${tipTop}px, 0)`);
  }, [inspected, computed]);

  function handlePointer(e: React.PointerEvent<HTMLElement>) {
    if (!computed.points.length && !computed.forecast.length) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * computed.W;
    const ts =
      computed.start +
      ((rel - computed.left) / (computed.W - computed.left - computed.right)) *
        (computed.end - computed.start);
    setInspected(seriesAt(computed.points, computed.forecast, ts));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const all = [...computed.points, ...computed.forecast];
    if (!all.length) return;
    e.preventDefault();
    let idx =
      inspected === null
        ? all.length - 1
        : all.reduce(
            (nearest, pt, i) =>
              Math.abs(pt.ts - inspected.ts) < Math.abs(all[nearest].ts - inspected.ts)
                ? i
                : nearest,
            0,
          );
    idx = Math.min(all.length - 1, Math.max(0, idx + (e.key === "ArrowLeft" ? -1 : 1)));
    const target = all[idx];
    setInspected({
      ...target,
      projected: target.projected ?? target.ts > computed.now,
    });
  }

  const isFuture = inspected
    ? (inspected.projected ?? inspected.ts > computed.now)
    : false;
  const inspectedPx = inspected ? computed.x(inspected.ts) : 0;
  const inspectedPy = inspected ? computed.y(inspected.value) : 0;

  return (
    <figure
      ref={figRef}
      className="plot"
      tabIndex={0}
      data-chart={chartKey}
      data-inspected-at={inspected ? String(inspected.ts) : undefined}
      aria-label={`${label} quota history and forecast. Use left and right arrows to inspect recorded samples.`}
      onPointerMove={handlePointer}
      onPointerDown={handlePointer}
      onPointerLeave={() => setInspected(null)}
      onBlur={() => setInspected(null)}
      onKeyDown={handleKeyDown}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${computed.W} ${computed.H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${computed.points.length} recorded samples${computed.forecast.length ? ", estimated future usage" : ""}`}
      >
        <defs>
          <linearGradient id={`fill-${chartKey}`} x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="var(--pool-color)" stopOpacity=".16" />
            <stop offset="1" stopColor="var(--pool-color)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {computed.yTicks.map((t) => (
          <g key={`y-${t.v}`}>
            <line
              className="grid-line"
              x1={computed.left}
              x2={computed.W - computed.right}
              y1={t.py}
              y2={t.py}
            />
            <text x={computed.left - 10} y={t.py + 4} textAnchor="end">
              {t.v}%
            </text>
          </g>
        ))}
        {computed.xTicks.map((t, i) => (
          <g key={`x-${i}`}>
            <line
              className="grid-line"
              x1={t.px}
              x2={t.px}
              y1={computed.top}
              y2={computed.H - computed.bottom}
            />
            <text
              x={t.px}
              y={computed.H - 9}
              textAnchor={t.anchor as "start" | "middle" | "end"}
            >
              {t.label}
            </text>
          </g>
        ))}
        {computed.resets.map((t) => (
          <g key={`r-${t}`}>
            <line
              className="chart-reset"
              x1={computed.x(t)}
              x2={computed.x(t)}
              y1={computed.top}
              y2={computed.H - computed.bottom}
            />
            <text className="reset-label" x={computed.x(t)} y={16} textAnchor="middle">
              Reset
            </text>
          </g>
        ))}
        <line
          x1={computed.x(computed.now)}
          x2={computed.x(computed.now)}
          y1={computed.top - 4}
          y2={computed.H - computed.bottom + 2}
          stroke="#686868"
        />
        <text
          className="axis-now"
          x={computed.x(computed.now)}
          y={16}
          textAnchor="middle"
        >
          Now
        </text>
        <g className="chart-data" ref={dataGroupRef}>
          {computed.areaPath && (
            <path d={computed.areaPath} fill={`url(#fill-${chartKey})`} />
          )}
          {computed.recordedPath && (
            <path
              d={computed.recordedPath}
              stroke="var(--pool-color)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
          )}
          {computed.forecastPath && (
            <path
              d={computed.forecastPath}
              stroke="var(--pool-color)"
              strokeOpacity=".7"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="4 10"
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
          )}
          {computed.latest && (
            <>
              <circle
                cx={computed.x(computed.latest.ts)}
                cy={computed.y(computed.latest.value)}
                r="6"
                fill="var(--pool-color)"
                stroke="var(--card)"
                strokeWidth="3"
              />
              <text
                className="current-value"
                x={computed.x(computed.latest.ts) + 11}
                y={Math.max(computed.top + 12, computed.y(computed.latest.value) - 9)}
              >
                {fmtPct(computed.latest.value)}
              </text>
            </>
          )}
        </g>
        <g
          className="chart-crosshair"
          {...(!inspected ? ({ hidden: true } as Record<string, unknown>) : {})}
        >
          <line
            x1="0"
            x2="0"
            y1={computed.top}
            y2={computed.H - computed.bottom}
            style={{ transform: `translateX(${inspectedPx}px)` }}
          />
          <circle
            className="halo"
            r="12"
            style={{ transform: `translate(${inspectedPx}px, ${inspectedPy}px)` }}
          />
          <circle
            className="dot"
            r="6"
            style={{ transform: `translate(${inspectedPx}px, ${inspectedPy}px)` }}
          />
        </g>
      </svg>

      <div
        ref={tooltipRef}
        className="chart-tooltip"
        hidden={!inspected}
        style={tipTransform ? { transform: tipTransform } : undefined}
      >
        {inspected && (
          <>
            <div className="tip-label">{dateLabel(inspected.ts)}</div>
            <div className="tip-row">
              <i className={`tip-swatch${isFuture ? " dashed" : ""}`} />
              <span>{isFuture ? "Projected" : "Recorded"}</span>
              <strong>{fmtPct(inspected.value)}</strong>
            </div>
          </>
        )}
      </div>

      {computed.points.length < 2 && (
        <div className="chart-empty">
          <strong>History starts here</strong>
          <p>
            Quotas are recorded every 30 seconds, even with this page closed.
            Your usage curve will build over time.
          </p>
        </div>
      )}

      <figcaption className="chart-caption">
        <span className="legend">
          <i className="legend-line" />
          Recorded
        </span>
        <span className="legend">
          <i className="legend-line dashed" />
          Projected
        </span>
        <span className="chart-inspect" aria-live="polite">
          {inspected
            ? `${dateLabel(inspected.ts)} · ${fmtPct(inspected.value)} ${isFuture ? "projected" : "recorded"}`
            : computed.forecast.length
              ? "Estimate from recent usage"
              : !showForecast
                ? "Forecast hidden"
                : "Forecast needs 10+ minutes of recent samples"}
        </span>
      </figcaption>
    </figure>
  );
}
