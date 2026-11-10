import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/** Side-on view of a ball flight. Points are in yards (x downrange, y height). */
export function TrajectoryChart({ points, height = 160 }: { points: { x: number; y: number }[]; height?: number }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const pad = 24;
  const maxX = Math.max(50, ...points.map((p) => p.x));
  // Keep a little vertical exaggeration so flat shots are still readable.
  const maxY = Math.max(10, ...points.map((p) => p.y)) * 1.2;
  const sx = (x: number) => pad + (x / maxX) * (width - pad * 2);
  const sy = (y: number) => height - pad - (y / maxY) * (height - pad * 2);
  const gridStep = maxX > 200 ? 50 : 25;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={pad} y1={sy(0)} x2={width - pad} y2={sy(0)} stroke={theme.border} strokeWidth={1} />
          {Array.from({ length: Math.floor(maxX / gridStep) }, (_, i) => (i + 1) * gridStep).map((x) => (
            <SvgText key={x} x={sx(x)} y={height - 6} fontSize={10} fill={theme.textSecondary} textAnchor="middle">
              {x}
            </SvgText>
          ))}
          <Polyline
            points={points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
            fill="none"
            stroke={theme.tint}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}
