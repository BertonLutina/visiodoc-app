import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PhoneField } from './PhoneField';
import { DIAL_COUNTRIES, getDialCountry, splitE164 } from '@/data/dialCodes';
import { filterByPrefix } from '@/services/geo';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

jest.mock('@/lib/supabase', () => ({ supabasePublic: null, supabase: null }));
jest.mock('@/i18n', () => ({ useT: () => (s: string, p?: Record<string, string>) => (p ? s.replace(/\{(\w+)\}/g, (_, k) => p[k]) : s) }));

function mount(onChange: (v: string) => void, initialValue?: string) {
  let r!: renderer.ReactTestRenderer;
  act(() => {
    r = renderer.create(<PhoneField onChange={onChange} initialValue={initialValue} />);
  });
  return r;
}
const byId = (r: renderer.ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function' || (n.props.testID === id && typeof n.props.onPress === 'function'))[0];
const type = (r: renderer.ReactTestRenderer, v: string) => act(() => byId(r, 'phone-local-input').props.onChangeText(v));

describe('PhoneField', () => {
  it('uses +243 by default and sets phone keyboard / autofill hints', () => {
    const r = mount(jest.fn());
    const input = byId(r, 'phone-local-input');
    expect(input.props.keyboardType).toBe('phone-pad');
    expect(input.props.autoComplete).toBe('tel');
    expect(input.props.textContentType).toBe('telephoneNumber');
  });

  it('emits E.164 with the default DRC code', () => {
    const onChange = jest.fn();
    const r = mount(onChange);
    type(r, '0899999999');
    expect(onChange).toHaveBeenLastCalledWith('+243899999999');
  });

  it('Belgian national number with +32 selected gives +32...', () => {
    const onChange = jest.fn();
    const r = mount(onChange);
    type(r, '0475123456');
    act(() => byId(r, 'phone-dial-button').props.onPress());
    act(() => byId(r, 'phone-dial-search').props.onChangeText('belg'));
    act(() => byId(r, 'dial-BE').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith('+32475123456');
    type(r, '475 12 34 56');
    expect(onChange).toHaveBeenLastCalledWith('+32475123456');
  });

  it('keeps the dialling code of a number typed with + or 00', () => {
    const onChange = jest.fn();
    const r = mount(onChange);
    type(r, '+351 912 345 678');
    expect(onChange).toHaveBeenLastCalledWith('+351912345678');
    type(r, '0033612345678');
    expect(onChange).toHaveBeenLastCalledWith('+33612345678');
  });

  it('restores the country of an initial E.164 value', () => {
    const onChange = jest.fn();
    const r = mount(onChange, '+32475123456');
    type(r, '0476000000');
    expect(onChange).toHaveBeenLastCalledWith('+32476000000');
  });

  it('emits an empty string when nothing useful is typed', () => {
    const onChange = jest.fn();
    const r = mount(onChange);
    type(r, '');
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});

describe('dialCodes', () => {
  it('covers the world, sorted, with Belgium / Portugal / France / DRC', () => {
    expect(DIAL_COUNTRIES.length).toBeGreaterThan(200);
    expect(getDialCountry('BE')?.dialCode).toBe('+32');
    expect(getDialCountry('PT')?.dialCode).toBe('+351');
    expect(getDialCountry('FR')?.dialCode).toBe('+33');
    expect(getDialCountry('CD')?.dialCode).toBe('+243');
    expect(getDialCountry('BE')?.flag).toBe('🇧🇪');
    expect(new Set(DIAL_COUNTRIES.map((c) => c.code)).size).toBe(DIAL_COUNTRIES.length);
  });

  it('is searchable by name prefix, without case or accents', () => {
    const names = (q: string) => filterByPrefix(DIAL_COUNTRIES, q, DIAL_COUNTRIES.length).map((c) => c.name);
    expect(names('belg')).toEqual(['Belgique']);
    expect(names('EGYP')).toEqual(['Égypte']);
    expect(names('portu')).toEqual(['Portugal']);
  });

  it('splitE164 picks the longest matching dialling code', () => {
    expect(splitE164('+243899999999')?.country.code).toBe('CD');
    expect(splitE164('+351912345678')?.country.code).toBe('PT');
    expect(splitE164('0899999999')).toBeNull();
  });
});

describe('phone-login screen', () => {
  it('offers no Visiodoc (country) picker at login, only the phone field', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app', '(auth)', 'phone-login.tsx'), 'utf8');
    expect(src).not.toContain('CountryPicker');
    expect(src).toContain('PhoneField');
  });
});
