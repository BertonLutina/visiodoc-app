import { wordmarkColor } from './BrandLogo';
import { BRAND_COLORS, BRAND_WORDMARK_FONT } from '@/theme/brand';

describe('BrandLogo', () => {
  it('mot sombre sur fond clair, blanc sur fond sombre', () => {
    expect(wordmarkColor('light')).toBe('#111827');
    expect(wordmarkColor('dark')).toBe('#FFFFFF');
  });
  it('police du mot : repli défini, couleurs de marque conformes', () => {
    expect(BRAND_WORDMARK_FONT.length).toBeGreaterThan(0);
    expect(BRAND_COLORS.gradientStart).toBe('#059669');
    expect(BRAND_COLORS.gradientEnd).toBe('#0D9488');
  });
});
