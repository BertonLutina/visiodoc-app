import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { CityCommuneFields } from './CityCommuneFields';
import { resetGeoCache } from '@/services/geo';

jest.mock('@/lib/supabase', () => ({ supabasePublic: null, supabase: null }));
jest.mock('@/i18n', () => ({ useT: () => (s: string) => s }));

function Harness({ initial = { city: '', commune: '' }, cityOnly }: { initial?: { city: string; commune: string }; cityOnly?: boolean }) {
  const [city, setCity] = React.useState(initial.city);
  const [commune, setCommune] = React.useState(initial.commune);
  return (
    <CityCommuneFields city={city} commune={commune} onCityChange={setCity} onCommuneChange={setCommune} debounceMs={0} cityOnly={cityOnly} />
  );
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

async function mount(props?: React.ComponentProps<typeof Harness>) {
  let r!: renderer.ReactTestRenderer;
  await act(async () => {
    r = renderer.create(<Harness {...props} />);
  });
  await flush();
  return r;
}
const input = (r: renderer.ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function').slice(-1)[0];

beforeEach(() => resetGeoCache());

describe('CityCommuneFields', () => {
  it('disables the commune until a city is entered', async () => {
    const r = await mount();
    expect(input(r, 'geo-commune').props.editable).toBe(false);
    await act(async () => input(r, 'geo-city').props.onChangeText('Kin'));
    await flush();
    expect(input(r, 'geo-commune').props.editable).toBe(true);
  });

  it('suggests prefix matches and fills the field on selection', async () => {
    const r = await mount();
    await act(async () => {
      input(r, 'geo-city').props.onFocus();
      input(r, 'geo-city').props.onChangeText('KI');
    });
    await flush();
    expect(r.root.findAllByProps({ testID: 'geo-city-option-0' }).length).toBeGreaterThan(0);
    await act(async () => r.root.findAllByProps({ testID: 'geo-city-option-0' })[0].props.onPress());
    expect(input(r, 'geo-city').props.value).toMatch(/^Ki/);
  });

  it('clears the commune when the city changes, keeps it when only case differs', async () => {
    const r = await mount({ initial: { city: 'Kinshasa', commune: 'Gombe' } });
    await act(async () => input(r, 'geo-city').props.onChangeText('kinshasa'));
    expect(input(r, 'geo-commune').props.value).toBe('Gombe');
    await act(async () => input(r, 'geo-city').props.onChangeText('Goma'));
    expect(input(r, 'geo-commune').props.value).toBe('');
  });

  it('keeps free entry possible with an unknown city', async () => {
    const r = await mount();
    await act(async () => input(r, 'geo-city').props.onChangeText('Village inconnu'));
    await flush();
    expect(input(r, 'geo-city').props.value).toBe('Village inconnu');
    expect(input(r, 'geo-commune').props.editable).toBe(true);
    await act(async () => input(r, 'geo-commune').props.onChangeText('Quartier libre'));
    expect(input(r, 'geo-commune').props.value).toBe('Quartier libre');
  });

  it('city-only mode (provider) renders no commune field and still suggests cities', async () => {
    const r = await mount({ cityOnly: true });
    expect(r.root.findAll((n) => n.props.testID === 'geo-commune')).toHaveLength(0);
    await act(async () => {
      input(r, 'geo-city').props.onFocus();
      input(r, 'geo-city').props.onChangeText('lu');
    });
    await flush();
    expect(r.root.findAllByProps({ testID: 'geo-city-option-0' }).length).toBeGreaterThan(0);
  });
});
