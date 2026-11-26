import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const crosshairRef = useRef<SVGGElement | null>(null);
  const lineRef = useRef<SVGLineElement | null>(null);
  const haloRef = useRef<SVGCircleElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tipLabelRef = useRef<HTMLDivElement | null>(null);
  const tipSwatchRef = useRef<HTMLElement | null>(null);
  const tipKindRef = useRef<HTMLSpanElement | null>(null);
  const tipValueRef = useRef<HTMLElement | null>(null);
  const inspectRef = useRef<HTMLSpanElement | null>(null);

  const drawnRef = useRef(false);
  const rafRef = useRef(0);
  const lastClientXRef = useRef(0);
  const inspectedAtRef = useRef<number | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    const mobile = typeof window !== "undefined" && window.innerWidth <= 760;
    return { w: mobile ? 340 : 950, h: mobile ? 200 : 240 };
  });

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

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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
    const y = (v: number) => H - bottom - (v / cap) * (H - top - bottom);

    const yTicks = [0, 1, 2].map((i) => {
      const v = (cap * i) / 2;
      return { v, py: y(v) };
    });

    const tickCount =
      typeof window !== "undefined" && window.innerWidth <= 760 ? 3 : 6;
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
    const idleCaption = forecast.length
      ? "Estimate from recent usage"
      : !showForecast
        ? "Forecast hidden"
        : "Forecast needs 10+ minutes of recent samples";

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
      idleCaption,
    };
  }, [data, items, metric, hours, burn, showForecast, size]);

  const computedRef = useRef(computed);
  computedRef.current = computed;

  const clearInspection = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    inspectedAtRef.current = null;
    if (figRef.current) delete figRef.current.dataset.inspectedAt;
    if (crosshairRef.current) crosshairRef.current.setAttribute("hidden", "");
    if (tooltipRef.current) tooltipRef.current.hidden = true;
    if (inspectRef.current) {
      inspectRef.current.textContent = computedRef.current.idleCaption;
    }
  }, []);

  // Clear inspection when metric/range/forecast changes.
  useEffect(() => {
    clearInspection();
  }, [metric, hours, showForecast, burn, clearInspection]);

  // Direct DOM lockstep update matching vanilla index.html:
  // appear in place (fade only), then glide smoothly together at 140ms ease-out.
  const inspectPoint = useCallback((point: ChartPoint) => {
    const c = computedRef.current;
    const fig = figRef.current;
    const svg = svgRef.current;
    const group = crosshairRef.current;
    const line = lineRef.current;
    const halo = haloRef.current;
    const dot = dotRef.current;
    const tooltip = tooltipRef.current;
    if (!fig || !svg || !group || !line || !halo || !dot || !tooltip) return;

    inspectedAtRef.current = point.ts;
    fig.dataset.inspectedAt = String(point.ts);

    const isFuture = point.projected ?? point.ts > c.now;
    const px = c.x(point.ts);
    const py = c.y(point.value);
    const entering = group.hasAttribute("hidden");

    const dateText = dateLabel(point.ts);
    const valueText = fmtPct(point.value);
    if (tipLabelRef.current) tipLabelRef.current.textContent = dateText;
    if (tipSwatchRef.current)
      tipSwatchRef.current.className = isFuture
        ? "tip-swatch dashed"
        : "tip-swatch";
    if (tipKindRef.current)
      tipKindRef.current.textContent = isFuture ? "Projected" : "Recorded";
    if (tipValueRef.current) tipValueRef.current.textContent = valueText;

    const width = svg.clientWidth || c.W;
    const height = svg.clientHeight || c.H;
    const ax = (px / c.W) * width;
    const ay = (py / c.H) * height;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let tipLeft = ax + 16;
    let tipTop = ay - th - 12;
    if (tipLeft + tw > width) tipLeft = ax - 16 - tw;
    if (tipTop < 0) tipTop = ay + 12;

    const moving: (HTMLElement | SVGElement)[] = [line, halo, dot, tooltip];
    if (entering) {
      moving.forEach((el) => {
        el.style.transitionProperty = "opacity";
      });
    }
    line.style.transform = `translateX(${px}px)`;
    halo.style.transform = `translate(${px}px, ${py}px)`;
    dot.style.transform = `translate(${px}px, ${py}px)`;
    tooltip.style.transform = `translate3d(${Math.max(0, tipLeft)}px, ${tipTop}px, 0)`;
    group.removeAttribute("hidden");
    tooltip.hidden = false;
    if (entering) {
      group.getBoundingClientRect();
      moving.forEach((el) => {
        el.style.transitionProperty = "";
      });
    }
    if (inspectRef.current) {
      inspectRef.current.textContent = `${dateText} · ${valueText} ${isFuture ? "projected" : "recorded"}`;
    }
  }, []);

  const staticLayers = useMemo(
    () => (
      <>
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
            <text
              className="reset-label"
              x={computed.x(t)}
              y={16}
              textAnchor="middle"
            >
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
                y={Math.max(
                  computed.top + 12,
                  computed.y(computed.latest.value) - 9,
                )}
              >
                {fmtPct(computed.latest.value)}
              </text>
            </>
          )}
        </g>
      </>
    ),
    [chartKey, computed],
  );

  function handlePointer(e: React.PointerEvent<HTMLElement>) {
    const c = computedRef.current;
    if (!c.points.length && !c.forecast.length) return;
    lastClientXRef.current = e.clientX;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const cur = computedRef.current;
      const svg = svgRef.current;
      if (!svg || !(cur.points.length || cur.forecast.length)) return;
      const rect = svg.getBoundingClientRect();
      const rel = ((lastClientXRef.current - rect.left) / rect.width) * cur.W;
      const ts =
        cur.start +
        ((rel - cur.left) / (cur.W - cur.left - cur.right)) *
          (cur.end - cur.start);
      inspectPoint(seriesAt(cur.points, cur.forecast, ts));
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const c = computedRef.current;
    const all = [...c.points, ...c.forecast];
    if (!all.length) return;
    e.preventDefault();
    const prevTs = inspectedAtRef.current;
    let idx =
      prevTs === null
        ? all.length - 1
        : all.reduce(
            (nearest, pt, i) =>
              Math.abs(pt.ts - prevTs) < Math.abs(all[nearest].ts - prevTs)
                ? i
                : nearest,
            0,
          );
    idx = Math.min(
      all.length - 1,
      Math.max(0, idx + (e.key === "ArrowLeft" ? -1 : 1)),
    );
    const target = all[idx];
    inspectPoint({
      ...target,
      projected: target.projected ?? target.ts > c.now,
    });
  }

  return (
    <figure
      ref={figRef}
      className="plot"
      tabIndex={0}
      data-chart={chartKey}
      aria-label={`${label} quota history and forecast. Use left and right arrows to inspect recorded samples.`}
      onPointerMove={handlePointer}
      onPointerDown={handlePointer}
      onPointerLeave={clearInspection}
      onBlur={clearInspection}
      onKeyDown={handleKeyDown}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${computed.W} ${computed.H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${computed.points.length} recorded samples${computed.forecast.length ? ", estimated future usage" : ""}`}
      >
        {staticLayers}
        <g
          ref={crosshairRef}
          className="chart-crosshair"
          {...({ hidden: true } as Record<string, unknown>)}
        >
          <line
            ref={lineRef}
            x1="0"
            x2="0"
            y1={computed.top}
            y2={computed.H - computed.bottom}
          />
          <circle ref={haloRef} className="halo" r="12" />
          <circle ref={dotRef} className="dot" r="6" />
        </g>
      </svg>

      <div ref={tooltipRef} className="chart-tooltip" hidden>
        <div ref={tipLabelRef} className="tip-label" />
        <div className="tip-row">
          <i ref={tipSwatchRef} className="tip-swatch" />
          <span ref={tipKindRef} />
          <strong ref={tipValueRef} />
        </div>
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
        <span ref={inspectRef} className="chart-inspect" aria-live="polite">
          {computed.idleCaption}
        </span>
      </figcaption>
    </figure>
  );
}
