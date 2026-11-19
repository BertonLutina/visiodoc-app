import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { BRAND_COLORS, BRAND_WORDMARK_FONT } from '@/theme/brand';

export type BrandLogoVariant = 'light' | 'dark';

type Props = {
  /** Côté de la tuile, en points. */
  size?: number;
  /** 'light' : tuile verte, glyphe blanc (fond clair). 'dark' : tuile blanche, glyphe vert (fond sombre ou vert). */
  variant?: BrandLogoVariant;
  withWordmark?: boolean;
};

export function wordmarkColor(variant: BrandLogoVariant): string {
  return variant === 'dark' ? BRAND_COLORS.wordmarkOnDark : BRAND_COLORS.wordmarkOnLight;
}

/** Icône fidèle à visiodoc-icon.svg (viewBox 1024, reconstruction du logo du designer), avec le mot optionnel. */
export function BrandLogo({ size = 40, variant = 'light', withWordmark = false }: Props) {
  const dark = variant === 'dark';
  const glyph = dark ? BRAND_COLORS.glyphOnLight : BRAND_COLORS.glyph;
  const cameraFill = dark ? BRAND_COLORS.tileLight : BRAND_COLORS.camera;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityRole="image" accessibilityLabel="VisioDoc">
      <Svg width={size} height={size} viewBox="0 0 1024 1024">
        <Defs>
          <LinearGradient id="vdbg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={BRAND_COLORS.gradientStart} />
            <Stop offset="0.6" stopColor={BRAND_COLORS.gradientMid} />
            <Stop offset="1" stopColor={BRAND_COLORS.gradientEnd} />
          </LinearGradient>
        </Defs>
        <Rect width={1024} height={1024} rx={230} fill={dark ? BRAND_COLORS.tileLight : 'url(#vdbg)'} />
        <G fill="none" stroke={glyph} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M365 198 C300 205 262 225 258 290 C255 380 290 450 335 500 C365 530 400 545 426 545" strokeWidth={47} />
          <Path d="M487 198 C552 205 590 225 594 290 C597 380 562 450 517 500 C487 530 452 545 426 545" strokeWidth={47} />
          <Path d="M322 485 C352 522 396 545 426 545" strokeWidth={72} />
          <Path d="M530 485 C500 522 456 545 426 545" strokeWidth={72} />
          <Path d="M426 548 C426 610 440 655 495 660 C560 665 580 600 640 598 C690 598 705 640 703 705" strokeWidth={47} />
        </G>
        <Circle cx={365} cy={196} r={27} fill={glyph} />
        <Circle cx={487} cy={196} r={27} fill={glyph} />
        <Circle cx={698} cy={785} r={88} fill={glyph} />
        <Rect x={640} y={745} width={82} height={75} rx={12} fill={cameraFill} />
        <Path d="M732 782 L762 750 Q766 747 766 752 L766 816 Q766 821 762 818 Z" fill={cameraFill} />
      </Svg>
      {withWordmark ? (
        <Text
          style={{
            marginLeft: size * 0.25,
            fontFamily: BRAND_WORDMARK_FONT,
            fontSize: size * 0.58,
            color: wordmarkColor(variant),
          }}
        >
          VisioDoc
        </Text>
      ) : null}
    </View>
  );
}
