import React, { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { ParsedInstruction, SLOT_COUNT } from "../lib/elfVm";
import { ThemeMode } from "../types/app";

interface RegisterUtilizationChartProps {
  seeds: Record<number, bigint>;
  instructions: ParsedInstruction[];
  theme: ThemeMode;
}

interface UtilizationDatum {
  label: string;
  count: number;
  color: string;
}

export const RegisterUtilizationChart: React.FC<
  RegisterUtilizationChartProps
> = ({ seeds, instructions, theme }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const isDark = theme === "dark";

  const metrics = useMemo(() => {
    const seededSet = new Set<number>();
    for (const key of Object.keys(seeds)) {
      const idx = Number(key);
      if (Number.isInteger(idx) && idx >= 0 && idx < SLOT_COUNT) {
        seededSet.add(idx);
      }
    }

    const readSet = new Set<number>();
    const writtenSet = new Set<number>();
    const activeSet = new Set<number>(seededSet);

    for (const inst of instructions) {
      readSet.add(inst.srcA);
      readSet.add(inst.srcB);
      writtenSet.add(inst.dst);
      activeSet.add(inst.srcA);
      activeSet.add(inst.srcB);
      activeSet.add(inst.dst);
    }

    const activeCount = activeSet.size;
    const freeCount = SLOT_COUNT - activeCount;

    const data: UtilizationDatum[] = [
      {
        label: "Active Used",
        count: activeCount,
        color: isDark ? "#34d399" : "#047857",
      },
      {
        label: "Written (dst)",
        count: writtenSet.size,
        color: isDark ? "#e2e8f0" : "#0f172a",
      },
      {
        label: "Read (src)",
        count: readSet.size,
        color: isDark ? "#94a3b8" : "#475569",
      },
      {
        label: "Idle / Free",
        count: freeCount,
        color: isDark ? "#475569" : "#cbd5e1",
      },
    ];

    return {
      activeCount,
      utilizationPct: Math.round((activeCount / SLOT_COUNT) * 100),
      data,
    };
  }, [seeds, instructions, isDark]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = 520;
    const height = 122;
    const margin = { top: 6, right: 56, bottom: 20, left: 96 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const gridStroke = isDark ? "#1e293b" : "#e2e8f0";
    const domainStroke = isDark ? "#334155" : "#cbd5e1";
    const tickText = isDark ? "#94a3b8" : "#64748b";
    const labelText = isDark ? "#cbd5e1" : "#334155";
    const valueText = isDark ? "#f1f5f9" : "#0f172a";
    const trackFill = isDark ? "#1e293b" : "#f8fafc";

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, SLOT_COUNT]).range([0, innerWidth]);

    const y = d3
      .scaleBand<string>()
      .domain(metrics.data.map((d) => d.label))
      .range([0, innerHeight])
      .padding(0.28);

    // Reference grid lines at 0, 12, 24, 36, 48
    const ticks = [0, 12, 24, 36, 48];
    g.selectAll(".grid-line")
      .data(ticks)
      .enter()
      .append("line")
      .attr("class", "grid-line")
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", gridStroke)
      .attr("stroke-width", 1);

    // Bottom numeric tick axis
    const xAxis = d3
      .axisBottom(x)
      .tickValues(ticks)
      .tickFormat((d) => String(d))
      .tickSize(0)
      .tickPadding(6);

    const xAxisGroup = g
      .append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(xAxis);

    xAxisGroup.select(".domain").attr("stroke", domainStroke);
    xAxisGroup
      .selectAll("text")
      .attr("fill", tickText)
      .style("font-family", "IBM Plex Mono, monospace")
      .style("font-size", "10px");

    // Y-axis category labels
    const yAxis = d3.axisLeft(y).tickSize(0).tickPadding(8);
    const yAxisGroup = g.append("g").call(yAxis);
    yAxisGroup.select(".domain").remove();
    yAxisGroup
      .selectAll("text")
      .attr("fill", labelText)
      .style("font-family", "DM Sans, sans-serif")
      .style("font-size", "11px")
      .style("font-weight", "500");

    // Track backgrounds (48-slot full capacity reference)
    g.selectAll(".bar-track")
      .data(metrics.data)
      .enter()
      .append("rect")
      .attr("class", "bar-track")
      .attr("x", 0)
      .attr("y", (d) => y(d.label) ?? 0)
      .attr("width", innerWidth)
      .attr("height", y.bandwidth())
      .attr("rx", 3)
      .attr("fill", trackFill);

    // Data bars
    g.selectAll(".bar")
      .data(metrics.data)
      .enter()
      .append("rect")
      .attr("class", "bar")
      .attr("x", 0)
      .attr("y", (d) => y(d.label) ?? 0)
      .attr("width", (d) => Math.max(d.count > 0 ? 3 : 0, x(d.count)))
      .attr("height", y.bandwidth())
      .attr("rx", 3)
      .attr("fill", (d) => d.color);

    // Direct numeric labels
    g.selectAll(".bar-label")
      .data(metrics.data)
      .enter()
      .append("text")
      .attr("class", "bar-label")
      .attr("x", (d) => x(d.count) + 6)
      .attr("y", (d) => (y(d.label) ?? 0) + y.bandwidth() / 2 + 3.5)
      .attr("fill", valueText)
      .style("font-family", "IBM Plex Mono, monospace")
      .style("font-size", "10.5px")
      .style("font-weight", "600")
      .text((d) => `${d.count}/${SLOT_COUNT}`);
  }, [metrics, isDark]);

  return (
    <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
          Register Utilization
        </h3>
        <span className="font-mono text-slate-600 tabular-nums dark:text-slate-400">
          {metrics.activeCount} / {SLOT_COUNT} slots active ({metrics.utilizationPct}%)
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 520 122"
        role="img"
        aria-label={`Register utilization chart: ${metrics.activeCount} of ${SLOT_COUNT} slots actively used`}
        className="h-auto w-full"
      />
    </div>
  );
};
