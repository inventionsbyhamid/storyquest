import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface IconProps {
  size: number;
  color: string;
}

export const SparkleIcon = React.memo(({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z" fill={color} />
    <Path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill={color} opacity={0.7} />
  </Svg>
));

export const PencilIcon = React.memo(({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"
      stroke={color}
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    <Path d="M13.5 6.5l4 4" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
));

export const MicIcon = React.memo(({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" fill={color} />
    <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
));

export const PlayIcon = React.memo(({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill={color} />
  </Svg>
));

export const PauseIcon = React.memo(({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M7 5h3v14H7zM14 5h3v14h-3z" fill={color} />
  </Svg>
));

export const PlusIcon = React.memo(({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
  </Svg>
));

export const PeopleIcon = React.memo(({ size, color }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={9} cy={8} r={3.2} fill={color} />
    <Circle cx={16.5} cy={9} r={2.6} fill={color} opacity={0.7} />
    <Path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5z" fill={color} />
    <Path d="M15.5 14.2c2.6-.3 4.8 1.2 5.5 4.8h-4.2" fill={color} opacity={0.7} />
  </Svg>
));
