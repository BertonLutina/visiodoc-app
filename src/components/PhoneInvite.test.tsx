import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PhoneInvite, needsPhoneInvite } from './PhoneInvite';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

const mockPush = jest.fn();
let mockUser: { phone?: string } | null = null;
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/i18n', () => ({ useT: () => (s: string) => s }));
jest.mock('lucide-react-native', () => ({ Phone: () => null }));

const mount = () => {
  let r!: renderer.ReactTestRenderer;
  act(() => {
    r = renderer.create(<PhoneInvite />);
  });
  return r;
};

describe('PhoneInvite (téléphone facultatif)', () => {
  it('needsPhoneInvite is true only for a signed-in user without a number', () => {
    expect(needsPhoneInvite(null)).toBe(false);
    expect(needsPhoneInvite({})).toBe(true);
    expect(needsPhoneInvite({ phone: '  ' })).toBe(true);
    expect(needsPhoneInvite({ phone: '+243899999999' })).toBe(false);
  });

  it('shows a non-blocking invitation with a button to the profile edit', () => {
    mockUser = {};
    const r = mount();
    const btn = r.root.findAll((n) => n.props.testID === 'phone-invite-button' && typeof n.props.onPress === 'function')[0];
    act(() => btn.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/profile-edit');
  });

  it('renders nothing when the user has a number', () => {
    mockUser = { phone: '+243899999999' };
    expect(mount().toJSON()).toBeNull();
  });
});

describe('no blocking phone guard', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  it('layouts and registration screens never redirect on a missing phone', () => {
    for (const f of ['app/(patient)/_layout.tsx', 'app/(provider)/_layout.tsx', 'app/_layout.tsx', 'app/index.tsx']) {
      expect(read(f)).not.toMatch(/\.phone\b/);
    }
  });
  it('registration services no longer require the phone', () => {
    expect(read('src/services/registration.ts')).not.toContain('Le numéro de téléphone est obligatoire');
  });
});
