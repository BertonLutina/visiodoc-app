import React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { BRAND_COLORS } from '@/theme/brand';

type Props = {
  /** Hauteur du glyphe, en points (la largeur suit le ratio 620:760 du SVG). */
  size?: number;
  /** Couleur du stéthoscope. */
  color?: string;
  /** Couleur de l'icône caméra, creusée dans la pastille (par défaut le vert du logo ; mettre la couleur du fond). */
  cameraColor?: string;
};

/** Glyphe seul du logo VisioDoc (visiodoc-glyph-white.svg, viewBox 190 150 620 760), sans tuile. */
export function BrandGlyph({ size = 56, color = BRAND_COLORS.glyph, cameraColor = '#1E9078' }: Props) {
  return (
    <Svg width={(size * 620) / 760} height={size} viewBox="190 150 620 760" accessibilityLabel="VisioDoc">
      <G fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M365 198 C300 205 262 225 258 290 C255 380 290 450 335 500 C365 530 400 545 426 545" strokeWidth={36} />
        <Path d="M487 198 C552 205 590 225 594 290 C597 380 562 450 517 500 C487 530 452 545 426 545" strokeWidth={36} />
        <Path d="M322 485 C352 522 396 545 426 545" strokeWidth={50} />
        <Path d="M530 485 C500 522 456 545 426 545" strokeWidth={56} />
        <Path d="M426 548 C426 610 440 655 495 660 C560 665 580 600 640 598 C690 598 705 640 703 705" strokeWidth={36} />
      </G>
      <Circle cx={365} cy={196} r={29} fill={color} />
      <Circle cx={487} cy={196} r={29} fill={color} />
      <Circle cx={698} cy={785} r={96} fill={color} />
      <G transform="translate(698 785) scale(1.15) translate(-698 -785)">
        <Rect x={640} y={745} width={82} height={75} rx={12} fill={cameraColor} />
        <Path d="M732 782 L762 750 Q766 747 766 752 L766 816 Q766 821 762 818 Z" fill={cameraColor} />
      </G>
    </Svg>
  );
}
