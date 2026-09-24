/**
 * Configuration multi-pays de VisioDoc.
 *
 * Lancement en RD Congo (pays par défaut), puis extension à d'autres pays
 * africains. Pour ajouter un pays, ajoute une entrée dans COUNTRIES — les
 * écrans et le formatage des montants lisent tout depuis `activeCountry`.
 */

export type CurrencyConfig = {
  /** Code ISO 4217, ex: 'CDF' */
  code: string;
  /** Symbole affiché, ex: 'FC' */
  symbol: string;
  /** Position du symbole par rapport au montant */
  position: 'prefix' | 'suffix';
  /** Taux indicatif : unités de devise locale pour 1 USD (pour l'équivalent $). À recaler. */
  usdRate: number;
};

export type CountryConfig = {
  /** UUID de la ligne dans la table Supabase `countries` (pour mapper users.country_id) */
  id?: string;
  /** Code ISO 3166-1 alpha-2, ex: 'CD' */
  code: string;
  /** Nom court, ex: 'RD Congo' */
  name: string;
  /** Nom officiel complet */
  nameLong: string;
  /** Emoji drapeau */
  flag: string;
  /** Indicatif téléphonique, ex: '+243' */
  dialCode: string;
  /** Exemple de numéro local (placeholder de champ) */
  phoneExample: string;
  /** Capitale */
  capital: string;
  /** Principales villes (pour sélecteurs / données) */
  cities: string[];
  /** Langues, la première étant la langue d'interface */
  languages: string[];
  /** Moyens de paiement mobile courants dans le pays */
  paymentMethods: string[];
  currency: CurrencyConfig;
};

export const COUNTRIES: Record<string, CountryConfig> = {
  // 🇨🇩 Marché de lancement
  CD: {
    id: '5845fc2a-0579-4604-a4cd-adcc1dabab6c', // countries.id (Supabase)
    code: 'CD',
    name: 'RD Congo',
    nameLong: 'République démocratique du Congo',
    flag: '🇨🇩',
    dialCode: '+243',
    phoneExample: '+243 81 234 5678',
    capital: 'Kinshasa',
    cities: ['Kinshasa', 'Lubumbashi', 'Goma', 'Bukavu', 'Mbuji-Mayi', 'Kisangani'],
    languages: ['Français', 'Lingala', 'Swahili', 'Kikongo', 'Tshiluba'],
    paymentMethods: ['M-Pesa', 'Orange Money', 'Airtel Money'],
    currency: { code: 'CDF', symbol: 'FC', position: 'suffix', usdRate: 2800 },
  },

  // 🇳🇪 2e pays actif (présent dans la table `countries` Supabase)
  NE: {
    id: '602311ca-5958-4877-af57-65c44d7a3031', // countries.id (Supabase)
    code: 'NE',
    name: 'Niger',
    nameLong: 'République du Niger',
    flag: '🇳🇪',
    dialCode: '+227',
    phoneExample: '+227 90 12 34 56',
    capital: 'Niamey',
    cities: ['Niamey', 'Zinder', 'Maradi', 'Agadez', 'Tahoua', 'Dosso'],
    languages: ['Français', 'Haoussa', 'Zarma'],
    paymentMethods: ['Orange Money', 'Airtel Money', 'Moov Money'],
    currency: { code: 'XOF', symbol: 'F CFA', position: 'suffix', usdRate: 600 },
  },
};

/** Retrouve un pays par son UUID `countries.id` Supabase (repli sur le pays actif). */
export function getCountryById(id?: string | null): CountryConfig {
  return Object.values(COUNTRIES).find((c) => c.id === id) ?? activeCountry;
}

/** Pays actif par défaut au lancement. */
export const DEFAULT_COUNTRY_CODE = 'CD';

/** Pays actuellement actif dans l'app. */
export const activeCountry: CountryConfig = COUNTRIES[DEFAULT_COUNTRY_CODE];

/** Récupère un pays par code, avec repli sur le pays actif. */
export function getCountry(code: string): CountryConfig {
  return COUNTRIES[code] ?? activeCountry;
}
