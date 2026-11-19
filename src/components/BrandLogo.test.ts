import { wordmarkColor } from './BrandLogo';
import { BRAND_COLORS, BRAND_WORDMARK_FONT } from '@/theme/brand';

describe('BrandLogo', () => {
  it('mot vert foncé sur fond clair, blanc sur fond sombre', () => {
    expect(wordmarkColor('light')).toBe('#0F6E5E');
    expect(wordmarkColor('dark')).toBe('#FFFFFF');
  });
  it('police du mot : Poppins Bold ; couleurs de marque conformes', () => {
    expect(BRAND_WORDMARK_FONT).toBe('Poppins-Bold');
    expect(BRAND_COLORS.gradientStart).toBe('#0E8470');
    expect(BRAND_COLORS.gradientEnd).toBe('#3BB896');
  });
});
