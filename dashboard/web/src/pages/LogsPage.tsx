import { useCallback, useEffect, useRef, useState } from "react";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Icon } from "../components/BrandSprite";
import { CopyButton } from "../components/CopyButton";
import { api, notify } from "../lib/api";
import { dateLabel, fmtSize } from "../lib/format";
import type { ActivityLogResponse, ErrorLogFile } from "../lib/types";

const LOGS_HINTS = {
  errors: "Failed requests, newest first. The proxy keeps the last 10.",
  activity: "Requests, retries and account switches as the proxy logs them.",
};

export function LogsPage({
  tab,
  onTabChange,
}: {
  tab: "errors" | "activity";
  onTabChange: (tab: "errors" | "activity") => void;
}) {
  const [files, setFiles] = useState<ErrorLogFile[] | null>(null);
  const [errorsErr, setErrorsErr] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [logTruncated, setLogTruncated] = useState(false);

  const [activityEnabled, setActivityEnabled] = useState<boolean | null>(null);
  const [activityLines, setActivityLines] = useState<string[]>([]);
  const [activityPaused, setActivityPaused] = useState(false);
  const [activityErr, setActivityErr] = useState("");
  const [enabling, setEnabling] = useState(false);

  const cursorRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const openNameRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const tabRef = useRef<"errors" | "activity">("errors");
  const viewerRef = useRef<HTMLElement | null>(null);
  const tailPreRef = useRef<HTMLPreElement | null>(null);

  openNameRef.current = openName;
  pausedRef.current = activityPaused;
  tabRef.current = tab;

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const loadErrors = useCallback(async () => {
    try {
      const r = await api<{ files?: ErrorLogFile[] }>("logs/errors");
      const list = r.files || [];
      setFiles(list);
      setErrorsErr("");
      setOpenName((prev) =>
        prev && !list.some((f) => f.name === prev) ? null : prev,
      );
    } catch (err) {
      setErrorsErr(err instanceof Error ? err.message : "Couldn't load logs.");
    }
  }, []);

  const fetchActivity = useCallback(
    async (initial = false) => {
      stopTimer();
      if (tabRef.current !== "activity") return;
      if (initial) {
        cursorRef.current = null;
        setActivityLines([]);
      }
      if (!initial && document.hidden) {
        if (!pausedRef.current) {
          timerRef.current = window.setTimeout(() => fetchActivity(false), 5000);
        }
        return;
      }
      try {
        const cursorParam = cursorRef.current
          ? `&cursor=${encodeURIComponent(cursorRef.current)}`
          : "";
        const r = await api<ActivityLogResponse>(
          `logs/activity?limit=300${cursorParam}`,
        );
        if (tabRef.current !== "activity") return;
        const enabled = Boolean(r.enabled);
        setActivityEnabled(enabled);
        setActivityErr("");
        if (r.next_cursor) cursorRef.current = r.next_cursor;
        const fresh = r.lines || [];
        if (!enabled || initial) {
          setActivityLines(fresh.slice(-2000));
        } else if (fresh.length) {
          const pre = tailPreRef.current;
          const atBottom =
            !pre || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
          setActivityLines((prev) => [...prev, ...fresh].slice(-2000));
          if (atBottom) {
            requestAnimationFrame(() => {
              if (tailPreRef.current) {
                tailPreRef.current.scrollTop = tailPreRef.current.scrollHeight;
              }
            });
          }
        }
        if (enabled && !pausedRef.current) {
          timerRef.current = window.setTimeout(() => fetchActivity(false), 5000);
        }
      } catch (err) {
        setActivityErr(
          err instanceof Error ? err.message : "Couldn't load activity.",
        );
      }
    },
    [stopTimer],
  );

  useEffect(() => {
    stopTimer();
    if (tab === "errors") {
      loadErrors();
    } else {
      fetchActivity(true);
    }
    return stopTimer;
  }, [tab, loadErrors, fetchActivity, stopTimer]);

  // Auto-scroll tail on initial activity load.
  useEffect(() => {
    if (tab === "activity" && activityEnabled && tailPreRef.current) {
      tailPreRef.current.scrollTop = tailPreRef.current.scrollHeight;
    }
  }, [tab, activityEnabled]);

  async function openLog(name: string) {
    setOpenName(name);
    setLogText(null);
    setLogTruncated(false);
    try {
      const r = await api<{ text?: string; truncated?: boolean }>(
        `logs/errors/file?name=${encodeURIComponent(name)}`,
      );
      if (openNameRef.current !== name) return;
      setLogText(r.text || "");
      setLogTruncated(Boolean(r.truncated));
      requestAnimationFrame(() => {
        viewerRef.current?.scrollIntoView({
          block: "nearest",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      });
    } catch (err) {
      if (openNameRef.current !== name) return;
      setLogText(
        `Couldn't load this log: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      setLogTruncated(false);
    }
  }

  async function onEnableActivity() {
    if (enabling) return;
    setEnabling(true);
    try {
      await api("logs/activity/enable", {});
      notify(
        "Activity log enabled",
        "success",
        "New proxy activity appears here.",
      );
      setActivityEnabled(null);
      setEnabling(false);
      fetchActivity(true);
    } catch (err) {
      setEnabling(false);
      notify(
        "Couldn't enable the activity log",
        "error",
        err instanceof Error ? err.message : "Request failed.",
      );
    }
  }

  function onTogglePause() {
    const next = !activityPaused;
    setActivityPaused(next);
    pausedRef.current = next;
    if (next) stopTimer();
    else fetchActivity(false);
  }

  return (
    <div className="logs" id="logs-live">
      <div className="logs-toolbar">
        <SegmentedControl
          className="segmented"
          aria-label="Log type"
          value={tab}
          onValueChange={(next) => {
            if (next === "errors" || next === "activity") onTabChange(next);
          }}
        >
          <SegmentedControlIndicator />
          <SegmentedControlItem value="errors" data-logs-tab="errors">
            Errors
          </SegmentedControlItem>
          <SegmentedControlItem value="activity" data-logs-tab="activity">
            Activity
          </SegmentedControlItem>
        </SegmentedControl>
        <p id="logs-hint">{LOGS_HINTS[tab]}</p>
      </div>

      <div className="logs-content" id="logs-content">
        {tab === "errors" ? (
          errorsErr ? (
            <div className="notice error">
              <Icon name="warning" />
              <span>{errorsErr}</span>
            </div>
          ) : !files ? (
            <div className="logs-loading">
              <span className="loading-mark" />
              Loading logs…
            </div>
          ) : !files.length ? (
            <div className="state-card">
              <h2>No failed requests recorded</h2>
              <p>
                When a request fails, the proxy saves its details here. It keeps
                the last 10.
              </p>
            </div>
          ) : (
            <>
              <div className="log-list">
                {files.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    className="log-row"
                    data-log-name={f.name}
                    aria-current={openName === f.name ? "true" : "false"}
                    onClick={() => openLog(f.name)}
                  >
                    <Icon name="file" />
                    <span className="log-time">{dateLabel(f.modified)}</span>
                    <span className="log-name">{f.name}</span>
                    <span className="log-size">{fmtSize(f.size)}</span>
                    <Icon name="chevron" />
                  </button>
                ))}
              </div>

              {openName && (
                <section
                  ref={viewerRef}
                  className="log-viewer"
                  aria-label={`Log ${openName}`}
                >
                  <header className="log-viewer-head">
                    <span className="log-viewer-title" title={openName}>
                      {openName}
                    </span>
                    <CopyButton
                      text={logText || ""}
                      label="Copy log"
                      disabled={logText === null}
                      extraProps={{ "data-log-copy": "" }}
                    />
                    <button
                      type="button"
                      className="ghost icon-btn sm"
                      data-log-close=""
                      aria-label="Close log"
                      onClick={() => {
                        const prev = openName;
                        setOpenName(null);
                        requestAnimationFrame(() => {
                          document
                            .querySelector<HTMLButtonElement>(
                              `[data-log-name="${CSS.escape(prev)}"]`,
                            )
                            ?.focus();
                        });
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </header>
                  {logText === null ? (
                    <div className="log-text">
                      <div className="logs-loading">
                        <span className="loading-mark" />
                        Loading log…
                      </div>
                    </div>
                  ) : (
                    <>
                      <pre className="log-text" tabIndex={0}>
                        {logText}
                      </pre>
                      {logTruncated && (
                        <p className="log-note">Showing the first 256 KB.</p>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )
        ) : activityErr && activityEnabled === null ? (
          <div className="notice error">
            <Icon name="warning" />
            <span>{activityErr}</span>
          </div>
        ) : activityEnabled === null ? (
          <div className="logs-loading">
            <span className="loading-mark" />
            Loading activity…
          </div>
        ) : !activityEnabled ? (
          <div className="state-card">
            <h2>Activity log is off</h2>
            <p>
              The proxy isn’t writing its activity log to disk. Turn it on to
              follow requests, retries and account switches here. This changes
              one proxy setting.
            </p>
            <button
              type="button"
              className="primary"
              data-logs-enable=""
              disabled={enabling}
              aria-busy={enabling || undefined}
              onClick={onEnableActivity}
            >
              {enabling ? (
                <>
                  <span className="loading-mark" />
                  Enabling…
                </>
              ) : (
                "Enable activity log"
              )}
            </button>
          </div>
        ) : (
          <section className="log-viewer">
            <header className="log-viewer-head">
              <span className={`live-dot${activityPaused ? " paused" : ""}`} />
              <span className="live-label">
                {activityPaused ? "Paused" : "Live"}
              </span>
              <span className="live-hint">Updates every 5 seconds</span>
              <button
                type="button"
                className="outline sm"
                data-logs-pause=""
                onClick={onTogglePause}
              >
                <Icon name={activityPaused ? "play" : "pause"} />
                {activityPaused ? "Resume" : "Pause"}
              </button>
            </header>
            <pre
              ref={tailPreRef}
              className="log-text log-tail"
              tabIndex={0}
              id="activity-text"
            >
              {activityLines.join("\n")}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
