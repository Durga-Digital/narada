import { useEffect, useRef, useState } from "react";
import type { MetricsSnapshot, MetricKey } from "@narada/core/metrics";
export function ActivityChart({
  days,
  metric,
  label,
}: {
  days: MetricsSnapshot["days"];
  metric: MetricKey;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(220, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const maximum =
    Math.ceil(Math.max(1, ...days.map((d) => d.counts[metric])) / 3) * 3;
  const plotWidth = width - 50,
    column = plotWidth / days.length;
  const labelStep = Math.max(
    1,
    Math.ceil(days.length / Math.max(2, Math.floor(plotWidth / 110))),
  );
  return (
    <div ref={container}>
      <svg
        role="img"
        aria-label={`${label} by acceptance date. Daily values are available below.`}
        viewBox={`0 0 ${width} 220`}
        className="w-full"
      >
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line
              x1="35"
              x2={width - 5}
              y1={20 + i * 55}
              y2={20 + i * 55}
              stroke="currentColor"
              strokeOpacity="0.1"
              strokeDasharray="3 4"
            />
            <text
              x="28"
              y={24 + i * 55}
              textAnchor="end"
              fontSize="11"
              fill="currentColor"
            >
              {(maximum * (3 - i)) / 3}
            </text>
          </g>
        ))}
        {days.map((day, i) => {
          const height = (day.counts[metric] / maximum) * 165;
          const last = i === days.length - 1;
          return (
            <g key={day.day}>
              <rect
                x={40 + i * column}
                y={185 - height}
                width={Math.max(1, column - Math.min(5, column / 4))}
                height={height}
                rx="2"
                fill="#355f3d"
              >
                <title>
                  {day.day}: {day.counts[metric]}
                </title>
              </rect>
              {(last ||
                (i % labelStep === 0 && i < days.length - labelStep / 2)) && (
                <text
                  x={last ? width - 5 : 40 + i * column}
                  y="210"
                  textAnchor={last ? "end" : "start"}
                  fontSize="11"
                  fill="currentColor"
                >
                  {day.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
