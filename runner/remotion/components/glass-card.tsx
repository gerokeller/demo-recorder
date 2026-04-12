import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../styles.ts';

interface GlassCardProps {
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Glassmorphism container with subtle border and frosted background.
 */
export function GlassCard({ children, style }: GlassCardProps) {
  return (
    <div
      style={{
        background: COLORS.surfaceGlass,
        border: `1px solid ${COLORS.surfaceBorder}`,
        borderRadius: 12,
        padding: '16px 20px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
