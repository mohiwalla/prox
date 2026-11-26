import * as React from "react";
import {
  AlertTriangleIcon,
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Toggle,
} from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api";
import { age, dateLabel, fmtSize } from "@/lib/format";
import type {
  ActivityLogResponse,
  ErrorLogEntry,
  ErrorLogFileResponse,
  ErrorLogsResponse,
  OkResponse,
  Snapshot,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LogsPageProps {
  snapshot: Snapshot | null;
  onMetaChange?: (meta: string | null) => void;
}

type LogsTab = "errors" | "activity";

const ACTIVITY_POLL_MS = 5_000;
const ACTIVITY_LIMIT = 300;
const MAX_ACTIVITY_LINES = 2_000;

const TAB_HINTS: Record<LogsTab, string> = {
  errors: "Failed requests, newest first. The proxy keeps the last 10.",
  activity: "Requests, retries and account switches as the proxy logs them.",
};

function classifyLogLine(line: string): "error" | "warn" | "normal" {
  const lower = line.toLowerCase();
  if (
    lower.includes("level=error") ||
    lower.includes("level=fatal") ||
    lower.includes("[error]") ||
    lower.includes("[fatal]") ||
    /\berror\b/.test(lower)
  ) {
    return "error";
  }
  if (
    lower.includes("level=warn") ||
    lower.includes("[warn]") ||
    lower.includes("warning")
  ) {
    return "warn";
  }
  return "normal";
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function LogsPage({ onMetaChange }: LogsPageProps) {
  const [tab, setTab] = React.useState<LogsTab>("errors");

  // ---- Failed requests state ----
  const [errorFiles, setErrorFiles] = React.useState<ErrorLogEntry[] | null>(
    null,
  );
  const [errorsLoading, setErrorsLoading] = React.useState(false);
  const [errorsError, setErrorsError] = React.useState<string | null>(null);
  const [errorQuery, setErrorQuery] = React.useState("");

  // Error log viewer dialog state
  const [selectedLog, setSelectedLog] = React.useState<ErrorLogEntry | null>(
    null,
  );
  const [logContent, setLogContent] = React.useState<string | null>(null);
  const [logTruncated, setLogTruncated] = React.useState(false);
  const [logLoading, setLogLoading] = React.useState(false);
  const [logError, setLogError] = React.useState<string | null>(null);
  const [logCopied, setLogCopied] = React.useState(false);

  // ---- Live activity state ----
  const [activityEnabled, setActivityEnabled] = React.useState<boolean | null>(
    null,
  );
  const [activityLines, setActivityLines] = React.useState<string[]>([]);
  const [activityLoading, setActivityLoading] = React.useState(false);
  const [activityError, setActivityError] = React.useState<string | null>(null);
  const [activityPaused, setActivityPaused] = React.useState(false);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [activityQuery, setActivityQuery] = React.useState("");
  const [enablingActivity, setEnablingActivity] = React.useState(false);
  const [activityCopied, setActivityCopied] = React.useState(false);

  // Refs for lifecycle, cancellation, cursor paging, and scroll management
  const errorsAbortRef = React.useRef<AbortController | null>(null);
  const logFileAbortRef = React.useRef<AbortController | null>(null);
  const activityAbortRef = React.useRef<AbortController | null>(null);
  const activityTimerRef = React.useRef<number | null>(null);
  const activityCursorRef = React.useRef<string | null>(null);
  const activityLatestRef = React.useRef<number | null>(null);
  const activityEnabledRef = React.useRef<boolean | null>(null);
  const activityPausedRef = React.useRef(false);
  const tabRef = React.useRef<LogsTab>(tab);
  const terminalRef = React.useRef<HTMLDivElement | null>(null);
  const programmaticScrollRef = React.useRef(false);
  const copyLogTimerRef = React.useRef<number | null>(null);
  const copyActivityTimerRef = React.useRef<number | null>(null);

  tabRef.current = tab;
  activityEnabledRef.current = activityEnabled;
  activityPausedRef.current = activityPaused;

  const clearActivityTimer = React.useCallback(() => {
    if (activityTimerRef.current !== null) {
      window.clearTimeout(activityTimerRef.current);
      activityTimerRef.current = null;
    }
  }, []);

  // ---- Error logs loading ----
  const loadErrorLogs = React.useCallback(async () => {
    errorsAbortRef.current?.abort();
    const controller = new AbortController();
    errorsAbortRef.current = controller;

    setErrorsLoading(true);
    try {
      const res = await apiGet<ErrorLogsResponse>(
        "logs/errors",
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const sorted = [...(res.files ?? [])].sort(
        (a, b) => (b.modified ?? 0) - (a.modified ?? 0),
      );
      setErrorFiles(sorted);
      setErrorsError(null);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      setErrorsError(
        err instanceof Error ? err.message : "Could not load error logs.",
      );
    } finally {
      if (!controller.signal.aborted) {
        setErrorsLoading(false);
      }
    }
  }, []);

  const loadErrorLogFile = React.useCallback(async (entry: ErrorLogEntry) => {
    logFileAbortRef.current?.abort();
    const controller = new AbortController();
    logFileAbortRef.current = controller;

    setSelectedLog(entry);
    setLogContent(null);
    setLogTruncated(false);
    setLogError(null);
    setLogCopied(false);
    setLogLoading(true);

    try {
      const res = await apiGet<ErrorLogFileResponse>(
        `logs/errors/file?name=${encodeURIComponent(entry.name)}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setLogContent(res.text ?? "");
      setLogTruncated(Boolean(res.truncated));
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      setLogError(
        err instanceof Error ? err.message : "Could not load this log file.",
      );
    } finally {
      if (!controller.signal.aborted) {
        setLogLoading(false);
      }
    }
  }, []);

  const closeLogDialog = React.useCallback(() => {
    logFileAbortRef.current?.abort();
    setSelectedLog(null);
    setLogContent(null);
    setLogTruncated(false);
    setLogError(null);
    setLogLoading(false);
    setLogCopied(false);
  }, []);

  // ---- Activity log polling ----
  const fetchActivity = React.useCallback(
    async (initial = false) => {
      clearActivityTimer();
      if (tabRef.current !== "activity") return;

      if (!initial && document.hidden) {
        if (activityEnabledRef.current && !activityPausedRef.current) {
          activityTimerRef.current = window.setTimeout(() => {
            void fetchActivity(false);
          }, ACTIVITY_POLL_MS);
        }
        return;
      }

      activityAbortRef.current?.abort();
      const controller = new AbortController();
      activityAbortRef.current = controller;

      if (initial) {
        activityCursorRef.current = null;
        activityLatestRef.current = null;
        setActivityLoading(true);
      }

      const params = new URLSearchParams({ limit: String(ACTIVITY_LIMIT) });
      if (!initial) {
        if (activityCursorRef.current) {
          params.set("cursor", activityCursorRef.current);
        } else if (
          activityLatestRef.current !== null &&
          activityLatestRef.current > 0
        ) {
          params.set("after", String(activityLatestRef.current));
        }
      }

      try {
        const res = await apiGet<ActivityLogResponse>(
          `logs/activity?${params.toString()}`,
          controller.signal,
        );
        if (controller.signal.aborted || tabRef.current !== "activity") return;

        const wasEnabled = activityEnabledRef.current === true;
        const enabled = Boolean(res.enabled);
        setActivityEnabled(enabled);
        activityEnabledRef.current = enabled;
        setActivityError(null);

        if (res.next_cursor) {
          activityCursorRef.current = res.next_cursor;
        }
        if (typeof res.latest === "number" && Number.isFinite(res.latest)) {
          activityLatestRef.current = res.latest;
        }

        const incoming = res.lines ?? [];
        if (!enabled) {
          setActivityLines([]);
        } else if (initial || !wasEnabled) {
          setActivityLines(incoming.slice(-MAX_ACTIVITY_LINES));
        } else if (incoming.length > 0) {
          setActivityLines((prev) =>
            [...prev, ...incoming].slice(-MAX_ACTIVITY_LINES),
          );
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        setActivityError(
          err instanceof Error ? err.message : "Could not load activity log.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setActivityLoading(false);
          if (
            tabRef.current === "activity" &&
            activityEnabledRef.current &&
            !activityPausedRef.current
          ) {
            activityTimerRef.current = window.setTimeout(() => {
              void fetchActivity(false);
            }, ACTIVITY_POLL_MS);
          }
        }
      }
    },
    [clearActivityTimer],
  );

  // Trigger tab-specific loading whenever active tab changes
  React.useEffect(() => {
    if (tab === "errors") {
      clearActivityTimer();
      activityAbortRef.current?.abort();
      void loadErrorLogs();
    } else {
      void fetchActivity(true);
    }
  }, [tab, loadErrorLogs, fetchActivity, clearActivityTimer]);

  // Resume polling immediately when browser tab returns to foreground
  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (
        !document.hidden &&
        tabRef.current === "activity" &&
        activityEnabledRef.current &&
        !activityPausedRef.current
      ) {
        void fetchActivity(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchActivity]);

  // Cleanup all in-flight requests, timers, and page header meta on unmount
  React.useEffect(() => {
    return () => {
      errorsAbortRef.current?.abort();
      logFileAbortRef.current?.abort();
      activityAbortRef.current?.abort();
      clearActivityTimer();
      if (copyLogTimerRef.current !== null) {
        window.clearTimeout(copyLogTimerRef.current);
      }
      if (copyActivityTimerRef.current !== null) {
        window.clearTimeout(copyActivityTimerRef.current);
      }
      onMetaChange?.(null);
    };
  }, [clearActivityTimer, onMetaChange]);

  // Filtered lists
  const trimmedErrorQuery = errorQuery.trim().toLowerCase();
  const filteredErrorFiles = React.useMemo(() => {
    if (!errorFiles) return [];
    if (!trimmedErrorQuery) return errorFiles;
    return errorFiles.filter((file) => {
      const timeText = dateLabel(file.modified).toLowerCase();
      return (
        file.name.toLowerCase().includes(trimmedErrorQuery) ||
        timeText.includes(trimmedErrorQuery)
      );
    });
  }, [errorFiles, trimmedErrorQuery]);

  const trimmedActivityQuery = activityQuery.trim().toLowerCase();
  const filteredActivityLines = React.useMemo(() => {
    if (!trimmedActivityQuery) return activityLines;
    return activityLines.filter((line) =>
      line.toLowerCase().includes(trimmedActivityQuery),
    );
  }, [activityLines, trimmedActivityQuery]);

  // Keep page header meta synchronized with active tab state
  React.useEffect(() => {
    if (tab === "errors") {
      if (errorsError && errorFiles === null) {
        onMetaChange?.("Error logs unavailable");
      } else if (errorFiles === null) {
        onMetaChange?.("Loading error logs…");
      } else if (errorFiles.length === 0) {
        onMetaChange?.("No failed requests");
      } else if (trimmedErrorQuery) {
        onMetaChange?.(
          `${filteredErrorFiles.length} of ${errorFiles.length} failed request${errorFiles.length === 1 ? "" : "s"}`,
        );
      } else {
        onMetaChange?.(
          `${errorFiles.length} failed request${errorFiles.length === 1 ? "" : "s"}`,
        );
      }
      return;
    }

    if (activityError && activityEnabled === null) {
      onMetaChange?.("Activity log unavailable");
    } else if (activityEnabled === null) {
      onMetaChange?.("Loading activity log…");
    } else if (!activityEnabled) {
      onMetaChange?.("Activity log off");
    } else {
      const status = activityPaused ? "Paused" : "Live";
      const total = activityLines.length;
      const lineText = trimmedActivityQuery
        ? `${filteredActivityLines.length.toLocaleString()} of ${total.toLocaleString()} lines`
        : `${total.toLocaleString()} line${total === 1 ? "" : "s"}`;
      onMetaChange?.(`${status} · ${lineText}`);
    }
  }, [
    tab,
    errorFiles,
    errorsError,
    trimmedErrorQuery,
    filteredErrorFiles.length,
    activityEnabled,
    activityError,
    activityPaused,
    activityLines.length,
    trimmedActivityQuery,
    filteredActivityLines.length,
    onMetaChange,
  ]);

  // Auto-scroll activity terminal when new lines arrive or when autoScroll is enabled
  const scrollTerminalToBottom = React.useCallback(() => {
    const el = terminalRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  React.useEffect(() => {
    if (tab === "activity" && activityEnabled && autoScroll) {
      scrollTerminalToBottom();
    }
  }, [
    tab,
    activityEnabled,
    autoScroll,
    filteredActivityLines,
    scrollTerminalToBottom,
  ]);

  function handleTerminalScroll() {
    if (programmaticScrollRef.current) return;
    const el = terminalRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 24 && autoScroll) {
      setAutoScroll(false);
    } else if (distanceFromBottom <= 8 && !autoScroll) {
      setAutoScroll(true);
    }
  }

  function handleTogglePause() {
    const nextPaused = !activityPaused;
    setActivityPaused(nextPaused);
    activityPausedRef.current = nextPaused;
    if (nextPaused) {
      clearActivityTimer();
      activityAbortRef.current?.abort();
    } else {
      void fetchActivity(false);
    }
  }

  function handleClearActivity() {
    setActivityLines([]);
    setActivityError(null);
  }

  async function handleEnableActivity() {
    if (enablingActivity) return;
    setEnablingActivity(true);
    try {
      await apiPost<OkResponse>("logs/activity/enable", {});
      toast.success("Activity log enabled", {
        description: "New proxy activity appears here.",
      });
      setActivityEnabled(null);
      activityEnabledRef.current = null;
      setActivityPaused(false);
      activityPausedRef.current = false;
      setActivityError(null);
      void fetchActivity(true);
    } catch (err) {
      toast.error("Couldn't enable activity log", {
        description:
          err instanceof Error ? err.message : "Check proxy connection.",
      });
    } finally {
      setEnablingActivity(false);
    }
  }

  async function handleCopyErrorLog() {
    if (logContent === null) return;
    try {
      await navigator.clipboard.writeText(logContent);
      setLogCopied(true);
      if (copyLogTimerRef.current !== null) {
        window.clearTimeout(copyLogTimerRef.current);
      }
      copyLogTimerRef.current = window.setTimeout(
        () => setLogCopied(false),
        2000,
      );
      toast.success("Log copied to clipboard");
    } catch {
      toast.error("Couldn't copy log", {
        description: "Select the text manually to copy it.",
      });
    }
  }

  async function handleCopyActivity() {
    if (filteredActivityLines.length === 0) return;
    try {
      await navigator.clipboard.writeText(filteredActivityLines.join("\n"));
      setActivityCopied(true);
      if (copyActivityTimerRef.current !== null) {
        window.clearTimeout(copyActivityTimerRef.current);
      }
      copyActivityTimerRef.current = window.setTimeout(
        () => setActivityCopied(false),
        2000,
      );
      toast.success("Activity output copied");
    } catch {
      toast.error("Couldn't copy output", {
        description: "Select the text manually to copy it.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs<LogsTab>
        value={tab}
        onValueChange={(next) => {
          if (next) setTab(next);
        }}
        className="gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <TabsList aria-label="Log type">
              <TabsTab value="errors">
                <FileTextIcon className="size-3.5" aria-hidden="true" />
                <span>Failed requests</span>
                {errorFiles && errorFiles.length > 0 ? (
                  <Badge
                    variant="secondary"
                    className="h-4 min-w-4 px-1.5 text-[11px] tabular-nums"
                  >
                    {errorFiles.length}
                  </Badge>
                ) : null}
              </TabsTab>
              <TabsTab value="activity">
                <TerminalIcon className="size-3.5" aria-hidden="true" />
                <span>Live activity</span>
                {activityEnabled ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full",
                      activityPaused
                        ? "bg-muted-foreground"
                        : "bg-success shadow-[0_0_0_3px_rgba(134,239,172,0.18)]",
                    )}
                  />
                ) : null}
              </TabsTab>
            </TabsList>

            <p className="text-sm text-muted-foreground">{TAB_HINTS[tab]}</p>
          </div>
        </div>

        {/* ---- Failed requests tab ---- */}
        <TabsPanel value="errors" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full max-w-sm">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={errorQuery}
                onValueChange={setErrorQuery}
                placeholder="Filter by filename or timestamp…"
                aria-label="Filter failed request logs"
                className="pl-9 pr-8"
              />
              {errorQuery ? (
                <button
                  type="button"
                  onClick={() => setErrorQuery("")}
                  aria-label="Clear filter"
                  className="absolute top-1/2 right-2 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadErrorLogs()}
              disabled={errorsLoading}
            >
              <RefreshCwIcon
                className={cn("size-3.5", errorsLoading && "animate-spin")}
                aria-hidden="true"
              />
              <span>{errorsLoading ? "Refreshing…" : "Refresh"}</span>
            </Button>
          </div>

          {errorsError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <div className="flex items-center gap-2">
                <AlertTriangleIcon
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{errorsError}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadErrorLogs()}
                disabled={errorsLoading}
              >
                Retry
              </Button>
            </div>
          ) : null}

          {errorFiles === null && !errorsError ? (
            <Card>
              <CardContent className="flex items-center gap-2.5 py-8 text-sm text-muted-foreground">
                <Loader2Icon
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                <span>Loading failed request logs…</span>
              </CardContent>
            </Card>
          ) : errorFiles !== null && errorFiles.length === 0 ? (
            <Card className="text-center">
              <CardHeader className="flex-col items-center pb-2">
                <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-border bg-secondary/50 text-muted-foreground">
                  <ScrollTextIcon className="size-5" aria-hidden="true" />
                </div>
                <CardTitle>No failed requests recorded</CardTitle>
                <CardDescription className="max-w-md">
                  When a request fails, the proxy saves its details here. It
                  keeps the last 10 files.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2" />
            </Card>
          ) : errorFiles !== null && filteredErrorFiles.length === 0 ? (
            <Card className="text-center">
              <CardHeader className="flex-col items-center pb-2">
                <CardTitle>No matching log files</CardTitle>
                <CardDescription>
                  No failed request logs matched &ldquo;{errorQuery.trim()}
                  &rdquo;.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setErrorQuery("")}
                >
                  Clear filter
                </Button>
              </CardContent>
            </Card>
          ) : errorFiles !== null ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="divide-y divide-border">
                {filteredErrorFiles.map((file) => {
                  const isOpen = selectedLog?.name === file.name;
                  return (
                    <button
                      key={file.name}
                      type="button"
                      onClick={() => void loadErrorLogFile(file)}
                      aria-current={isOpen ? "true" : undefined}
                      className={cn(
                        "grid w-full cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto_16px] items-center gap-3 px-4 py-3 text-left transition-colors sm:grid-cols-[16px_156px_minmax(0,1fr)_auto_16px]",
                        "hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                        isOpen && "bg-white/[0.05]",
                      )}
                    >
                      <FileTextIcon
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />

                      <div className="hidden min-w-0 flex-col sm:flex">
                        <span className="truncate text-sm font-medium tabular-nums text-foreground">
                          {dateLabel(file.modified)}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {age(file.modified)}
                        </span>
                      </div>

                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span
                          title={file.name}
                          className="truncate font-mono text-[13px] text-foreground sm:text-muted-foreground"
                        >
                          {file.name}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground sm:hidden">
                          {dateLabel(file.modified)} · {age(file.modified)}
                        </span>
                      </div>

                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtSize(file.size)}
                      </span>

                      <ChevronRightIcon
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </TabsPanel>

        {/* ---- Live activity tab ---- */}
        <TabsPanel value="activity" className="flex flex-col gap-4">
          {activityError && activityEnabled === null ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <div className="flex items-center gap-2">
                <AlertTriangleIcon
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{activityError}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchActivity(true)}
                disabled={activityLoading}
              >
                Retry
              </Button>
            </div>
          ) : activityEnabled === null ? (
            <Card>
              <CardContent className="flex items-center gap-2.5 py-8 text-sm text-muted-foreground">
                <Loader2Icon
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                <span>Loading live activity…</span>
              </CardContent>
            </Card>
          ) : !activityEnabled ? (
            <Card className="mx-auto w-full max-w-lg text-center">
              <CardHeader className="flex-col items-center">
                <div className="mb-1 flex size-10 items-center justify-center rounded-lg border border-border bg-secondary/50 text-muted-foreground">
                  <TerminalIcon className="size-5" aria-hidden="true" />
                </div>
                <CardTitle>Activity log is off</CardTitle>
                <CardDescription className="max-w-md">
                  The proxy isn&rsquo;t writing its activity log to disk yet.
                  Enabling this turns on proxy file logging so you can follow
                  requests, retries, and account switches live from this page.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <Button
                  variant="default"
                  onClick={() => void handleEnableActivity()}
                  disabled={enablingActivity}
                >
                  {enablingActivity ? (
                    <>
                      <Loader2Icon
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      <span>Enabling…</span>
                    </>
                  ) : (
                    "Enable activity log"
                  )}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Updates the proxy&rsquo;s{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 text-[11px] text-foreground">
                    logging-to-file
                  </code>{" "}
                  setting.
                </span>
              </CardContent>
            </Card>
          ) : (
            <section
              aria-label="Live proxy activity"
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
            >
              {/* Controls bar */}
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 rounded-full",
                        activityPaused
                          ? "bg-muted-foreground"
                          : "bg-success shadow-[0_0_0_3px_rgba(134,239,172,0.18)]",
                      )}
                    />
                    {activityPaused ? "Paused" : "Live"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {activityPaused ? "Polling paused" : "Updates every 5s"}
                  </span>
                  <Badge variant="outline" className="font-mono tabular-nums">
                    {trimmedActivityQuery
                      ? `${filteredActivityLines.length.toLocaleString()} / ${activityLines.length.toLocaleString()}`
                      : `${activityLines.length.toLocaleString()} line${activityLines.length === 1 ? "" : "s"}`}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-52 sm:w-60">
                    <SearchIcon
                      className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      type="search"
                      value={activityQuery}
                      onValueChange={setActivityQuery}
                      placeholder="Filter lines…"
                      aria-label="Filter activity log lines"
                      className="h-8 pl-8 pr-7 text-[13px]"
                    />
                    {activityQuery ? (
                      <button
                        type="button"
                        onClick={() => setActivityQuery("")}
                        aria-label="Clear line filter"
                        className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="size-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  <Toggle
                    variant="outline"
                    size="sm"
                    pressed={autoScroll}
                    onPressedChange={(pressed) => {
                      setAutoScroll(pressed);
                      if (pressed) {
                        scrollTerminalToBottom();
                      }
                    }}
                    aria-label="Toggle auto-scroll"
                    title={
                      autoScroll
                        ? "Auto-scroll is on"
                        : "Auto-scroll is off (click to follow tail)"
                    }
                  >
                    <ArrowDownToLineIcon
                      className="size-3.5"
                      aria-hidden="true"
                    />
                    <span>Auto-scroll</span>
                  </Toggle>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTogglePause}
                  >
                    {activityPaused ? (
                      <>
                        <PlayIcon className="size-3.5" aria-hidden="true" />
                        <span>Resume</span>
                      </>
                    ) : (
                      <>
                        <PauseIcon className="size-3.5" aria-hidden="true" />
                        <span>Pause</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearActivity}
                    disabled={activityLines.length === 0}
                    title="Clear displayed lines from view"
                  >
                    <Trash2Icon className="size-3.5" aria-hidden="true" />
                    <span>Clear</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void handleCopyActivity()}
                    disabled={filteredActivityLines.length === 0}
                    aria-label={
                      activityCopied
                        ? "Copied activity output"
                        : "Copy displayed activity output"
                    }
                    title="Copy displayed lines"
                  >
                    {activityCopied ? (
                      <CheckIcon
                        className="size-4 text-success"
                        aria-hidden="true"
                      />
                    ) : (
                      <CopyIcon className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </header>

              {/* Inline transient poll warning */}
              {activityError ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangleIcon
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{activityError}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void fetchActivity(false)}
                    className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                  >
                    Retry
                  </Button>
                </div>
              ) : null}

              {/* Terminal viewport */}
              <div className="relative bg-background/85">
                <div
                  ref={terminalRef}
                  tabIndex={0}
                  onScroll={handleTerminalScroll}
                  aria-label="Activity log output"
                  className="h-[60vh] min-h-[320px] overflow-auto px-4 py-3 font-mono text-xs leading-[19px] select-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                >
                  {filteredActivityLines.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm font-sans text-muted-foreground">
                      {activityLines.length === 0
                        ? "Waiting for proxy activity…"
                        : `No lines matching "${activityQuery.trim()}".`}
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {filteredActivityLines.map((line, index) => {
                        const tone = classifyLogLine(line);
                        return (
                          <div
                            key={`${index}-${line.slice(0, 32)}`}
                            className={cn(
                              "whitespace-pre-wrap break-all py-px",
                              tone === "error" && "text-destructive",
                              tone === "warn" && "text-warning",
                              tone === "normal" && "text-foreground/90",
                            )}
                          >
                            {line}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {!autoScroll && filteredActivityLines.length > 0 ? (
                  <div className="pointer-events-none absolute right-4 bottom-3 flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAutoScroll(true);
                        scrollTerminalToBottom();
                      }}
                      className="pointer-events-auto border border-border shadow-md"
                    >
                      <ArrowDownToLineIcon
                        className="size-3.5"
                        aria-hidden="true"
                      />
                      <span>Jump to latest</span>
                    </Button>
                  </div>
                ) : null}
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
                <span>
                  Keeping up to {MAX_ACTIVITY_LINES.toLocaleString()} recent
                  lines in view.
                </span>
                {trimmedActivityQuery ? (
                  <button
                    type="button"
                    onClick={() => setActivityQuery("")}
                    className="cursor-pointer text-foreground underline-offset-4 hover:underline"
                  >
                    Clear filter
                  </button>
                ) : null}
              </footer>
            </section>
          )}
        </TabsPanel>
      </Tabs>

      {/* ---- Failed request log file dialog ---- */}
      <Dialog
        open={selectedLog !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeLogDialog();
        }}
      >
        <DialogBackdrop />
        <DialogContent className="w-[min(880px,calc(100vw-32px))] gap-3">
          <DialogHeader>
            <DialogTitle className="truncate font-mono text-sm font-medium">
              {selectedLog?.name ?? "Error log"}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums">
              {selectedLog ? (
                <>
                  <span>{dateLabel(selectedLog.modified)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{fmtSize(selectedLog.size)}</span>
                  {logTruncated ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <Badge variant="warning">First 256 KB</Badge>
                    </>
                  ) : null}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {logLoading ? (
            <div className="flex h-64 items-center justify-center gap-2 rounded-lg border border-border bg-background/80 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              <span>Loading log file…</span>
            </div>
          ) : logError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <div className="flex items-center gap-2">
                <AlertTriangleIcon
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{logError}</span>
              </div>
              {selectedLog ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadErrorLogFile(selectedLog)}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : (
            <pre
              tabIndex={0}
              className="m-0 max-h-[60dvh] overflow-auto rounded-lg border border-border bg-background/85 p-4 font-mono text-xs leading-[18px] whitespace-pre-wrap break-all text-foreground/90 select-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {logContent || "(Empty log file)"}
            </pre>
          )}

          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {logTruncated
                ? "Showing the first 256 KB of this log."
                : logContent !== null
                  ? `${logContent.split("\n").length.toLocaleString()} lines`
                  : ""}
            </span>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={logContent === null || logLoading}
                onClick={() => void handleCopyErrorLog()}
              >
                {logCopied ? (
                  <>
                    <CheckIcon
                      className="size-3.5 text-success"
                      aria-hidden="true"
                    />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3.5" aria-hidden="true" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
              <Button variant="secondary" size="sm" onClick={closeLogDialog}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
