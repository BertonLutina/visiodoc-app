import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BootSplash, POWERED_BY_TEXT, BOOT_WORDMARK_SIZE } from './BootSplash';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/BrandLogo', () => ({ BrandLogo: () => null, wordmarkColor: () => '#0F6E5E' }));

const texts = (node: renderer.ReactTestInstance): string[] =>
  node.findAllByType(require('react-native').Text).map((n: renderer.ReactTestInstance) => [n.props.children].flat().join(''));

describe('BootSplash', () => {
  it('affiche VisioDoc en grand et Powered by Neotech, sans slogan', () => {
    let r!: renderer.ReactTestRenderer;
    act(() => {
      r = renderer.create(<BootSplash />);
    });
    const t = texts(r.root);
    expect(t).toEqual(['VisioDoc', 'Powered by Neotech']);
    expect(POWERED_BY_TEXT).toBe('Powered by Neotech');
    expect(BOOT_WORDMARK_SIZE).toBeGreaterThanOrEqual(52);
  });
});
