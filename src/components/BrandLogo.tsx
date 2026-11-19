import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { BRAND_COLORS, BRAND_WORDMARK_FONT } from '@/theme/brand';

export type BrandLogoVariant = 'light' | 'dark';

type Props = {
  /** Côté de la tuile, en points. */
  size?: number;
  /** 'light' : tuile verte (fond clair). 'dark' : tuile blanche (fond sombre ou vert). */
  variant?: BrandLogoVariant;
  withWordmark?: boolean;
};

export function wordmarkColor(variant: BrandLogoVariant): string {
  return variant === 'dark' ? BRAND_COLORS.wordmarkOnDark : BRAND_COLORS.wordmarkOnLight;
}

/** Icône fidèle à visiodoc-icon(.-on-dark).svg (viewBox 32), avec le mot optionnel. */
export function BrandLogo({ size = 40, variant = 'light', withWordmark = false }: Props) {
  const dark = variant === 'dark';
  const stroke = dark ? 'url(#vd)' : '#FFFFFF';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityRole="image" accessibilityLabel="VisioDoc">
      <Svg width={size} height={size} viewBox="0 0 32 32">
        <Defs>
          <LinearGradient id="vd" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={BRAND_COLORS.gradientStart} />
            <Stop offset="1" stopColor={BRAND_COLORS.gradientEnd} />
          </LinearGradient>
        </Defs>
        <Rect width={32} height={32} rx={8} fill={dark ? BRAND_COLORS.tileLight : 'url(#vd)'} />
        <G
          transform="translate(6 6) scale(0.8333)"
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
          <Path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4" />
          <Circle cx={20} cy={10} r={2} />
        </G>
      </Svg>
      {withWordmark ? (
        <Text
          style={{
            marginLeft: size * 0.3,
            fontFamily: BRAND_WORDMARK_FONT,
            fontSize: size * 0.625,
            color: wordmarkColor(variant),
          }}
        >
          VisioDoc
        </Text>
      ) : null}
    </View>
  );
}
