import { READY_SHORT, isWeekend, round0, round1 } from "./format";
import type { ChartHandle, Day } from "./types";

export function weekendBandPlugin(dayList: Day[]) {
  return {
    id: "weekendBands",
    beforeDatasetsDraw(chart: {
      scales: { x?: { getPixelForValue: (i: number) => number } };
      chartArea?: { left: number; right: number; top: number; bottom: number };
      ctx: CanvasRenderingContext2D;
    }) {
      const xScale = chart.scales.x;
      const { ctx, chartArea } = chart;
      if (!xScale || !chartArea || !dayList || !dayList.length) return;
      ctx.save();
      dayList.forEach((d, i) => {
        if (!isWeekend(d.date)) return;
        const x = xScale.getPixelForValue(i);
        let w: number;
        if (dayList.length === 1) w = Math.max(16, (chartArea.right - chartArea.left) * 0.12);
        else if (i < dayList.length - 1) w = Math.abs(xScale.getPixelForValue(i + 1) - x);
        else w = Math.abs(x - xScale.getPixelForValue(i - 1));
        ctx.fillStyle = "rgba(249,115,22,0.08)";
        ctx.fillRect(x - w / 2, chartArea.top, w, chartArea.bottom - chartArea.top);
      });
      ctx.restore();
    },
  };
}

export function meanAnnotationPlugin(yValue: number | null | undefined, label: string) {
  return {
    id: "meanLine_" + label,
    afterDatasetsDraw(chart: {
      scales: { y?: { getPixelForValue: (v: number) => number } };
      chartArea?: { left: number; right: number; top: number; bottom: number };
      ctx: CanvasRenderingContext2D;
      tooltip?: { getActiveElements?: () => unknown[] };
    }) {
      if (yValue == null || !Number.isFinite(yValue)) return;
      const yScale = chart.scales.y;
      if (!yScale) return;
      const y = yScale.getPixelForValue(yValue);
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "rgba(249,115,22,0.45)";
      ctx.lineWidth = 1.25;
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const tipOn =
        chart.tooltip &&
        chart.tooltip.getActiveElements &&
        chart.tooltip.getActiveElements().length;
      if (!tipOn) {
        ctx.font = "600 11px -apple-system,BlinkMacSystemFont,sans-serif";
        const padX = 7;
        const tw = ctx.measureText(label).width;
        const bw = tw + padX * 2;
        const bh = 18;
        const bx = chartArea.right + 6;
        const by = y - bh / 2;
        ctx.beginPath();
        ctx.moveTo(bx + bh / 2, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, bh / 2);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, bh / 2);
        ctx.arcTo(bx, by + bh, bx, by, bh / 2);
        ctx.arcTo(bx, by, bx + bw, by, bh / 2);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.96)";
        ctx.fill();
        ctx.strokeStyle = "#edd5c4";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#ea580c";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, bx + padX, y);
      }
      ctx.restore();
    },
  };
}

function techTooltip() {
  return {
    backgroundColor: "rgba(255,255,255,.98)",
    titleColor: "#0f172a",
    bodyColor: "#334155",
    borderColor: "#edd5c4",
    borderWidth: 1,
    titleFont: { size: 12 },
    bodyFont: { size: 12 },
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
  };
}

function xTicksOpts(narrow: boolean, rangeDays: number) {
  return {
    color: (ctx: { tick?: { label?: unknown } }) => {
      const v = ctx.tick && ctx.tick.label;
      if (typeof v === "string" && (v.endsWith("六") || v.endsWith("日"))) return "#ea580c";
      return "#64748b";
    },
    font: (ctx: { tick?: { label?: unknown } }) => {
      const v = ctx.tick && ctx.tick.label;
      const we = typeof v === "string" && (v.endsWith("六") || v.endsWith("日"));
      return { size: narrow ? 9 : 10, weight: we ? "700" : "400" };
    },
    maxRotation: narrow ? 45 : 0,
    minRotation: narrow ? 45 : 0,
    autoSkip: true,
    maxTicksLimit: narrow ? (rangeDays > 40 ? 7 : 6) : rangeDays > 40 ? 12 : rangeDays <= 7 ? 7 : 10,
  };
}

export function createGaugeChart(
  canvas: HTMLCanvasElement,
  readyScore: number | null,
): ChartHandle {
  const gScore = readyScore != null ? readyScore : 0;
  const gaugeRest = Math.max(0, 100 - gScore);
  return new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["得分", "余量"],
      datasets: [
        {
          data: [gScore, gaugeRest],
          backgroundColor: ["#f97316", "rgba(237,213,196,0.5)"],
          borderWidth: 0,
          hoverOffset: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "84%",
      rotation: -90,
      circumference: 360,
      layout: { padding: 6 },
      plugins: {
        legend: { display: false },
        title: { display: false },
        subtitle: { display: false },
        tooltip: {
          enabled: true,
          filter: (item: { dataIndex: number }) => item.dataIndex === 0,
          callbacks: {
            title: () => "",
            label: () => "准备度 " + (readyScore != null ? readyScore : "—"),
          },
          backgroundColor: "rgba(255,255,255,.97)",
          bodyColor: "#334155",
          borderColor: "#edd5c4",
          borderWidth: 1,
          padding: 8,
          cornerRadius: 8,
        },
      },
    },
  });
}

export function createDonutChart(
  canvas: HTMLCanvasElement,
  high: number,
  mid: number,
  low: number,
  narrow: boolean,
): ChartHandle {
  return new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["活跃 ≥8k", "适中 4–8k", "偏低 <4k"],
      datasets: [
        {
          data: [high, mid, low],
          backgroundColor: ["#f97316", "#fb923c", "#fed7aa"],
          borderColor: ["#ea580c", "#f97316", "#edd5c4"],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#64748b",
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: "circle",
            font: { size: narrow ? 10 : 11 },
            padding: 10,
          },
        },
        tooltip: techTooltip(),
      },
    },
  });
}

export function createRadarChart(
  canvas: HTMLCanvasElement,
  radarVals: number[],
  narrow: boolean,
): ChartHandle {
  const readyKeys = Object.keys(READY_SHORT);
  return new Chart(canvas, {
    type: "radar",
    data: {
      labels: readyKeys.map((k) => READY_SHORT[k]),
      datasets: [
        {
          label: "准备度贡献",
          data: radarVals,
          borderColor: "#f97316",
          backgroundColor: "rgba(249,115,22,0.22)",
          pointBackgroundColor: "#fdba74",
          pointBorderColor: "#f97316",
          pointRadius: narrow ? 2 : 3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: narrow ? 2 : 6 },
      plugins: {
        legend: { display: false },
        tooltip: techTooltip(),
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            display: !narrow,
            backdropColor: "transparent",
            color: "#64748b",
            font: { size: 9 },
            stepSize: 25,
          },
          grid: { color: "rgba(148,163,184,0.28)" },
          angleLines: { color: "rgba(249,115,22,0.18)" },
          pointLabels: {
            color: "#334155",
            font: { size: narrow ? 9 : 11 },
          },
        },
      },
    },
  });
}

export function createSRAChart(
  canvas: HTMLCanvasElement,
  days: Day[],
  labels: string[],
  sleepSeries: (number | null)[],
  readySeries: (number | null)[],
  actSeries: (number | null)[],
  rAvg: number | null,
  rangeDays: number,
  narrow: boolean,
): ChartHandle {
  const gridColor = "rgba(148,163,184,0.28)";
  const tickColor = "#64748b";
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "睡眠",
          data: sleepSeries,
          borderColor: "#f97316",
          backgroundColor: "rgba(249,115,22,0.12)",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          spanGaps: true,
          fill: false,
        },
        {
          label: "准备度",
          data: readySeries,
          borderColor: "#ea580c",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          spanGaps: true,
        },
        {
          label: "活动",
          data: actSeries,
          borderColor: "#fdba74",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          spanGaps: true,
          borderDash: [4, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4, right: narrow ? 52 : 60, bottom: 0, left: 0 } },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            pointStyle: "circle",
            color: tickColor,
            font: { size: narrow ? 10 : 11 },
            padding: narrow ? 8 : 12,
          },
        },
        tooltip: techTooltip(),
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: xTicksOpts(narrow, rangeDays),
          border: { display: false },
        },
        y: {
          min: 40,
          max: 100,
          grid: { color: gridColor },
          border: { display: false },
          ticks: { color: tickColor, font: { size: narrow ? 9 : 10 }, stepSize: 20 },
        },
      },
    },
    plugins: [weekendBandPlugin(days), meanAnnotationPlugin(rAvg, "均" + round1(rAvg))],
  });
}

export function createStepsChart(
  canvas: HTMLCanvasElement,
  days: Day[],
  labels: string[],
  stepsSeries: (number | null)[],
  stepsAvg: number | null,
  rangeDays: number,
  narrow: boolean,
): ChartHandle {
  const gridColor = "rgba(148,163,184,0.28)";
  const tickColor = "#64748b";
  const stepColors = stepsSeries.map((s) => {
    if (s == null || stepsAvg == null) return "rgba(249,115,22,0.45)";
    return s >= stepsAvg ? "rgba(249,115,22,0.85)" : "rgba(253,186,116,0.55)";
  });
  const nBars = Math.max(1, days.length);
  let barPct = 0.55;
  let catPct = 0.7;
  let maxThick = narrow ? 10 : 14;
  if (nBars <= 7) {
    barPct = 0.72;
    catPct = 0.88;
    maxThick = narrow ? 36 : 48;
  } else if (nBars <= 14) {
    barPct = 0.65;
    catPct = 0.8;
    maxThick = narrow ? 22 : 28;
  } else if (nBars <= 31) {
    barPct = 0.6;
    catPct = 0.75;
    maxThick = narrow ? 14 : 18;
  } else {
    barPct = 0.5;
    catPct = 0.65;
    maxThick = narrow ? 5 : 8;
  }
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "步数",
          data: stepsSeries,
          backgroundColor: stepColors,
          hoverBackgroundColor: "#ea580c",
          borderColor: "rgba(249,115,22,0.35)",
          borderWidth: 1,
          borderRadius: nBars <= 7 ? 6 : 3,
          borderSkipped: false,
          maxBarThickness: maxThick,
          categoryPercentage: catPct,
          barPercentage: barPct,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 4, right: narrow ? 48 : 56, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: techTooltip(),
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: xTicksOpts(narrow, rangeDays),
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          border: { display: false },
          ticks: {
            color: tickColor,
            font: { size: narrow ? 9 : 10 },
            callback: (v: number) => (v >= 1000 ? v / 1000 + "k" : v),
          },
        },
      },
    },
    plugins: [weekendBandPlugin(days), meanAnnotationPlugin(stepsAvg, "均" + round0(stepsAvg))],
  });
}
