import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { ArrowRight, BarChart3 } from "lucide-react";
import { LeaderboardEntryRecord } from "../lib/firebase";
import { Difficulty, TOTAL_PUZZLES, getPuzzle } from "../lib/puzzles";
import { SolvedRecord, ThemeMode } from "../types/app";

interface DifficultyDistributionChartProps {
  solvedMap: Record<number, SolvedRecord>;
  globalEntries: LeaderboardEntryRecord[];
  userUid: string | null;
  activePuzzleId: number;
  theme: ThemeMode;
  onOpenWorkbench: (puzzleId: number) => void;
}

type ChartMode = "period" | "cumulative";

interface SolvedEvent {
  puzzleId: number;
  difficulty: Difficulty;
  timestampMs: number;
}

interface TimeBucket {
  key: string;
  label: string;
  sortMs: number;
  Apprentice: number;
  Journeyman: number;
  Master: number;
  Grandmaster: number;
  total: number;
}

const DIFFICULTIES: Difficulty[] = [
  "Apprentice",
  "Journeyman",
  "Master",
  "Grandmaster",
];

function getDifficultyMeta(isDark: boolean): Record<
  Difficulty,
  { label: string; shortLabel: string; color: string }
> {
  return {
    Apprentice: {
      label: "Apprentice (Easy)",
      shortLabel: "Apprentice",
      color: isDark ? "#34d399" : "#10b981",
    },
    Journeyman: {
      label: "Journeyman (Medium)",
      shortLabel: "Journeyman",
      color: isDark ? "#38bdf8" : "#0284c7",
    },
    Master: {
      label: "Master (Hard)",
      shortLabel: "Master",
      color: isDark ? "#fbbf24" : "#d97706",
    },
    Grandmaster: {
      label: "Grandmaster (Master)",
      shortLabel: "Grandmaster",
      color: isDark ? "#e2e8f0" : "#0f172a",
    },
  };
}

function parseValidTimestamp(isoOrMs: string | number | undefined): number {
  if (typeof isoOrMs === "number" && Number.isFinite(isoOrMs)) {
    return isoOrMs;
  }
  if (typeof isoOrMs === "string") {
    const parsed = Date.parse(isoOrMs);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function getBucketInfo(
  ms: number,
  granularity: "day" | "hour" | "minute"
): { key: string; label: string; sortMs: number } {
  const d = new Date(ms);
  if (granularity === "day") {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return {
      key: `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`,
      label: start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      sortMs: start.getTime(),
    };
  }
  if (granularity === "hour") {
    const start = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours()
    );
    return {
      key: `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}-${start.getHours()}`,
      label: start.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      sortMs: start.getTime(),
    };
  }
  const start = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes()
  );
  return {
    key: `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}-${start.getHours()}-${start.getMinutes()}`,
    label: start.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    sortMs: start.getTime(),
  };
}

export const DifficultyDistributionChart: React.FC<
  DifficultyDistributionChartProps
> = ({
  solvedMap,
  globalEntries,
  userUid,
  activePuzzleId,
  theme,
  onOpenWorkbench,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [mode, setMode] = useState<ChartMode>("period");
  const [hoveredBucket, setHoveredBucket] = useState<TimeBucket | null>(null);
  const isDark = theme === "dark";
  const difficultyMeta = useMemo(() => getDifficultyMeta(isDark), [isDark]);

  const solvedEvents = useMemo<SolvedEvent[]>(() => {
    const byPuzzle = new Map<number, SolvedEvent>();

    for (const rec of Object.values(solvedMap)) {
      if (
        !Number.isInteger(rec.puzzleId) ||
        rec.puzzleId < 1 ||
        rec.puzzleId > TOTAL_PUZZLES
      ) {
        continue;
      }
      const puz = getPuzzle(rec.puzzleId);
      let earliestMs = parseValidTimestamp(rec.updatedAt);
      if (Array.isArray(rec.history) && rec.history.length > 0) {
        for (const attempt of rec.history) {
          const ms = parseValidTimestamp(attempt.solvedAt);
          if (ms < earliestMs) earliestMs = ms;
        }
      }
      byPuzzle.set(rec.puzzleId, {
        puzzleId: rec.puzzleId,
        difficulty: puz.difficulty,
        timestampMs: earliestMs,
      });
    }

    if (userUid) {
      for (const entry of globalEntries) {
        if (entry.uid !== userUid) continue;
        if (
          !Number.isInteger(entry.puzzleId) ||
          entry.puzzleId < 1 ||
          entry.puzzleId > TOTAL_PUZZLES
        ) {
          continue;
        }
        const entryMs = entry.createdAtMs || entry.updatedAtMs;
        const existing = byPuzzle.get(entry.puzzleId);
        if (!existing) {
          const puz = getPuzzle(entry.puzzleId);
          byPuzzle.set(entry.puzzleId, {
            puzzleId: entry.puzzleId,
            difficulty: puz.difficulty,
            timestampMs: entryMs,
          });
        } else if (entryMs < existing.timestampMs) {
          existing.timestampMs = entryMs;
        }
      }
    }

    return Array.from(byPuzzle.values()).sort(
      (a, b) => a.timestampMs - b.timestampMs
    );
  }, [solvedMap, globalEntries, userUid]);

  const { buckets, granularityLabel, difficultyTotals } = useMemo(() => {
    const totals: Record<Difficulty, number> = {
      Apprentice: 0,
      Journeyman: 0,
      Master: 0,
      Grandmaster: 0,
    };

    for (const ev of solvedEvents) {
      totals[ev.difficulty] += 1;
    }

    if (solvedEvents.length === 0) {
      return {
        buckets: [] as TimeBucket[],
        granularityLabel: "Daily",
        difficultyTotals: totals,
      };
    }

    const minMs = solvedEvents[0].timestampMs;
    const maxMs = solvedEvents[solvedEvents.length - 1].timestampMs;
    const spanMs = Math.max(0, maxMs - minMs);

    const granularity: "day" | "hour" | "minute" =
      spanMs > 36 * 60 * 60 * 1000
        ? "day"
        : spanMs > 2 * 60 * 60 * 1000
          ? "hour"
          : "minute";

    const granularityLabel =
      granularity === "day"
        ? "Grouped by day"
        : granularity === "hour"
          ? "Grouped by hour"
          : "Grouped by minute";

    const bucketMap = new Map<string, TimeBucket>();
    for (const ev of solvedEvents) {
      const info = getBucketInfo(ev.timestampMs, granularity);
      let bucket = bucketMap.get(info.key);
      if (!bucket) {
        bucket = {
          key: info.key,
          label: info.label,
          sortMs: info.sortMs,
          Apprentice: 0,
          Journeyman: 0,
          Master: 0,
          Grandmaster: 0,
          total: 0,
        };
        bucketMap.set(info.key, bucket);
      }
      bucket[ev.difficulty] += 1;
      bucket.total += 1;
    }

    const sorted = Array.from(bucketMap.values()).sort(
      (a, b) => a.sortMs - b.sortMs
    );

    if (mode === "cumulative") {
      let runApprentice = 0;
      let runJourneyman = 0;
      let runMaster = 0;
      let runGrandmaster = 0;
      const cumulativeBuckets = sorted.map((b) => {
        runApprentice += b.Apprentice;
        runJourneyman += b.Journeyman;
        runMaster += b.Master;
        runGrandmaster += b.Grandmaster;
        return {
          ...b,
          Apprentice: runApprentice,
          Journeyman: runJourneyman,
          Master: runMaster,
          Grandmaster: runGrandmaster,
          total: runApprentice + runJourneyman + runMaster + runGrandmaster,
        };
      });
      return {
        buckets: cumulativeBuckets,
        granularityLabel,
        difficultyTotals: totals,
      };
    }

    return { buckets: sorted, granularityLabel, difficultyTotals: totals };
  }, [solvedEvents, mode]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || buckets.length === 0) return;

    const width = 880;
    const height = 228;
    const margin = { top: 14, right: 20, bottom: 32, left: 42 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const gridStroke = isDark ? "#1e293b" : "#e2e8f0";
    const domainStroke = isDark ? "#334155" : "#cbd5e1";
    const yTextColor = isDark ? "#94a3b8" : "#64748b";
    const xTextColor = isDark ? "#cbd5e1" : "#475569";
    const totalLabelColor = isDark ? "#e2e8f0" : "#334155";

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand<string>()
      .domain(buckets.map((b) => b.key))
      .range([0, innerWidth])
      .padding(buckets.length <= 4 ? 0.45 : 0.28);

    const maxTotal = Math.max(1, d3.max(buckets, (b) => b.total) ?? 1);
    const y = d3
      .scaleLinear()
      .domain([0, maxTotal])
      .nice()
      .range([innerHeight, 0]);

    const yTicks = y.ticks(Math.min(5, maxTotal)).filter(Number.isInteger);
    if (yTicks.length === 0) yTicks.push(0, maxTotal);

    // Horizontal grid lines
    g.selectAll(".y-grid")
      .data(yTicks)
      .enter()
      .append("line")
      .attr("class", "y-grid")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d))
      .attr("stroke", gridStroke)
      .attr("stroke-width", 1);

    // Y axis
    const yAxis = d3
      .axisLeft(y)
      .tickValues(yTicks)
      .tickFormat((d) => String(d))
      .tickSize(0)
      .tickPadding(8);

    const yAxisGroup = g.append("g").call(yAxis);
    yAxisGroup.select(".domain").remove();
    yAxisGroup
      .selectAll("text")
      .attr("fill", yTextColor)
      .style("font-family", "IBM Plex Mono, monospace")
      .style("font-size", "10.5px");

    // X axis with thinning when many buckets exist
    const maxLabels = 10;
    const step = Math.max(1, Math.ceil(buckets.length / maxLabels));
    const visibleKeys = new Set(
      buckets
        .filter((_, i) => i % step === 0 || i === buckets.length - 1)
        .map((b) => b.key)
    );
    const labelByKey = new Map(buckets.map((b) => [b.key, b.label]));

    const xAxis = d3
      .axisBottom(x)
      .tickValues(buckets.map((b) => b.key).filter((k) => visibleKeys.has(k)))
      .tickFormat((key) => labelByKey.get(key) ?? key)
      .tickSize(0)
      .tickPadding(8);

    const xAxisGroup = g
      .append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(xAxis);

    xAxisGroup.select(".domain").attr("stroke", domainStroke);
    xAxisGroup
      .selectAll("text")
      .attr("fill", xTextColor)
      .style("font-family", "IBM Plex Mono, monospace")
      .style("font-size", "10.5px");

    // Stack generator
    const stackGen = d3.stack<TimeBucket>().keys(DIFFICULTIES);
    const series = stackGen(buckets);

    const barWidth = Math.min(54, x.bandwidth());
    const barOffset = (x.bandwidth() - barWidth) / 2;

    // Stacked series groups
    const layerGroups = g
      .selectAll(".diff-layer")
      .data(series)
      .enter()
      .append("g")
      .attr("class", "diff-layer")
      .attr("fill", (d) => difficultyMeta[d.key as Difficulty].color);

    layerGroups
      .selectAll("rect")
      .data((d) => d)
      .enter()
      .append("rect")
      .attr("x", (d) => (x(d.data.key) ?? 0) + barOffset)
      .attr("y", (d) => y(d[1]))
      .attr("width", barWidth)
      .attr("height", (d) => Math.max(0, y(d[0]) - y(d[1])))
      .attr("rx", 2);

    // Total count label above each stacked bar
    g.selectAll(".stack-total")
      .data(buckets)
      .enter()
      .append("text")
      .attr("class", "stack-total")
      .attr("x", (d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
      .attr("y", (d) => y(d.total) - 5)
      .attr("text-anchor", "middle")
      .attr("fill", totalLabelColor)
      .style("font-family", "IBM Plex Mono, monospace")
      .style("font-size", "10px")
      .style("font-weight", "600")
      .text((d) => (d.total > 0 ? String(d.total) : ""));

    // Invisible hover hit columns for responsive bucket inspection
    g.selectAll(".hover-col")
      .data(buckets)
      .enter()
      .append("rect")
      .attr("class", "hover-col")
      .attr("x", (d) => x(d.key) ?? 0)
      .attr("y", 0)
      .attr("width", x.bandwidth())
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("mouseenter", (_, d) => setHoveredBucket(d))
      .on("mouseleave", () => setHoveredBucket(null));
  }, [buckets, isDark, difficultyMeta]);

  const totalSolved = solvedEvents.length;

  return (
    <section
      aria-label="Solved puzzle difficulty distribution over time"
      className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Card Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Solved Difficulty Distribution Over Time
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {totalSolved > 0
              ? `${totalSolved} solved puzzle${totalSolved === 1 ? "" : "s"} tracked · ${granularityLabel}`
              : "Track how your solved puzzles progress from Apprentice to Grandmaster over time."}
          </p>
        </div>

        {totalSolved > 0 && (
          <div className="flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1 sm:self-auto shrink-0 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setMode("period")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mode === "period"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              Per Period
            </button>
            <button
              type="button"
              onClick={() => setMode("cumulative")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mode === "cumulative"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              Cumulative
            </button>
          </div>
        )}
      </div>

      {totalSolved === 0 ? (
        <div className="px-5 py-10 text-center">
          <BarChart3 className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600" />
          <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
            No solved puzzles recorded yet
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Solve puzzles in the Workbench to visualize how your difficulty distribution evolves over time.
          </p>
          <button
            type="button"
            onClick={() => onOpenWorkbench(activePuzzleId)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
          >
            Open Workbench
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          {/* Legend + Overall Counts */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 text-xs dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {DIFFICULTIES.map((diff) => {
                const count = difficultyTotals[diff];
                const pct =
                  totalSolved > 0 ? Math.round((count / totalSolved) * 100) : 0;
                const meta = difficultyMeta[diff];
                return (
                  <div key={diff} className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-[2px] shrink-0"
                      style={{ backgroundColor: meta.color }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {meta.label}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {count}
                    </span>
                    <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
                      ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Hover inspection readout */}
            <div className="font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-300">
              {hoveredBucket ? (
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">
                    {hoveredBucket.label}:
                  </strong>{" "}
                  {hoveredBucket.total} total (A:{hoveredBucket.Apprentice} · J:
                  {hoveredBucket.Journeyman} · M:{hoveredBucket.Master} · G:
                  {hoveredBucket.Grandmaster})
                </span>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">
                  Hover a bar to inspect time-bucket breakdown
                </span>
              )}
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              ref={svgRef}
              viewBox="0 0 880 228"
              role="img"
              aria-label={`D3 stacked bar chart showing ${totalSolved} solved puzzles distributed across Apprentice, Journeyman, Master, and Grandmaster difficulty levels over time`}
              className="h-auto w-full min-w-[520px]"
            />
          </div>
        </div>
      )}
    </section>
  );
};
