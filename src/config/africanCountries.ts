/**
 * Liste des 54 pays d'Afrique (membres de l'UA reconnus à l'ONU) pour le
 * sélecteur de pays à l'inscription. Données légères (drapeau + indicatif).
 * La config riche par marché actif (devise, paiements…) reste dans countries.ts.
 */
export type AfricanCountry = {
  /** ISO 3166-1 alpha-2 */
  code: string;
  /** Nom en français */
  name: string;
  /** Emoji drapeau */
  flag: string;
  /** Indicatif téléphonique */
  dialCode: string;
};

export const AFRICAN_COUNTRIES: AfricanCountry[] = [
  { code: 'ZA', name: 'Afrique du Sud', flag: '🇿🇦', dialCode: '+27' },
  { code: 'DZ', name: 'Algérie', flag: '🇩🇿', dialCode: '+213' },
  { code: 'AO', name: 'Angola', flag: '🇦🇴', dialCode: '+244' },
  { code: 'BJ', name: 'Bénin', flag: '🇧🇯', dialCode: '+229' },
  { code: 'BW', name: 'Botswana', flag: '🇧🇼', dialCode: '+267' },
  { code: 'BF', name: 'Burkina Faso', flag: '🇧🇫', dialCode: '+226' },
  { code: 'BI', name: 'Burundi', flag: '🇧🇮', dialCode: '+257' },
  { code: 'CM', name: 'Cameroun', flag: '🇨🇲', dialCode: '+237' },
  { code: 'CV', name: 'Cap-Vert', flag: '🇨🇻', dialCode: '+238' },
  { code: 'CF', name: 'Centrafrique', flag: '🇨🇫', dialCode: '+236' },
  { code: 'KM', name: 'Comores', flag: '🇰🇲', dialCode: '+269' },
  { code: 'CG', name: 'Congo (Brazzaville)', flag: '🇨🇬', dialCode: '+242' },
  { code: 'CD', name: 'Congo (RDC)', flag: '🇨🇩', dialCode: '+243' },
  { code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', dialCode: '+225' },
  { code: 'DJ', name: 'Djibouti', flag: '🇩🇯', dialCode: '+253' },
  { code: 'EG', name: 'Égypte', flag: '🇪🇬', dialCode: '+20' },
  { code: 'ER', name: 'Érythrée', flag: '🇪🇷', dialCode: '+291' },
  { code: 'SZ', name: 'Eswatini', flag: '🇸🇿', dialCode: '+268' },
  { code: 'ET', name: 'Éthiopie', flag: '🇪🇹', dialCode: '+251' },
  { code: 'GA', name: 'Gabon', flag: '🇬🇦', dialCode: '+241' },
  { code: 'GM', name: 'Gambie', flag: '🇬🇲', dialCode: '+220' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', dialCode: '+233' },
  { code: 'GN', name: 'Guinée', flag: '🇬🇳', dialCode: '+224' },
  { code: 'GW', name: 'Guinée-Bissau', flag: '🇬🇼', dialCode: '+245' },
  { code: 'GQ', name: 'Guinée équatoriale', flag: '🇬🇶', dialCode: '+240' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', dialCode: '+254' },
  { code: 'LS', name: 'Lesotho', flag: '🇱🇸', dialCode: '+266' },
  { code: 'LR', name: 'Liberia', flag: '🇱🇷', dialCode: '+231' },
  { code: 'LY', name: 'Libye', flag: '🇱🇾', dialCode: '+218' },
  { code: 'MG', name: 'Madagascar', flag: '🇲🇬', dialCode: '+261' },
  { code: 'MW', name: 'Malawi', flag: '🇲🇼', dialCode: '+265' },
  { code: 'ML', name: 'Mali', flag: '🇲🇱', dialCode: '+223' },
  { code: 'MA', name: 'Maroc', flag: '🇲🇦', dialCode: '+212' },
  { code: 'MU', name: 'Maurice', flag: '🇲🇺', dialCode: '+230' },
  { code: 'MR', name: 'Mauritanie', flag: '🇲🇷', dialCode: '+222' },
  { code: 'MZ', name: 'Mozambique', flag: '🇲🇿', dialCode: '+258' },
  { code: 'NA', name: 'Namibie', flag: '🇳🇦', dialCode: '+264' },
  { code: 'NE', name: 'Niger', flag: '🇳🇪', dialCode: '+227' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', dialCode: '+234' },
  { code: 'UG', name: 'Ouganda', flag: '🇺🇬', dialCode: '+256' },
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', dialCode: '+250' },
  { code: 'ST', name: 'São Tomé-et-Principe', flag: '🇸🇹', dialCode: '+239' },
  { code: 'SN', name: 'Sénégal', flag: '🇸🇳', dialCode: '+221' },
  { code: 'SC', name: 'Seychelles', flag: '🇸🇨', dialCode: '+248' },
  { code: 'SL', name: 'Sierra Leone', flag: '🇸🇱', dialCode: '+232' },
  { code: 'SO', name: 'Somalie', flag: '🇸🇴', dialCode: '+252' },
  { code: 'SD', name: 'Soudan', flag: '🇸🇩', dialCode: '+249' },
  { code: 'SS', name: 'Soudan du Sud', flag: '🇸🇸', dialCode: '+211' },
  { code: 'TZ', name: 'Tanzanie', flag: '🇹🇿', dialCode: '+255' },
  { code: 'TD', name: 'Tchad', flag: '🇹🇩', dialCode: '+235' },
  { code: 'TG', name: 'Togo', flag: '🇹🇬', dialCode: '+228' },
  { code: 'TN', name: 'Tunisie', flag: '🇹🇳', dialCode: '+216' },
  { code: 'ZM', name: 'Zambie', flag: '🇿🇲', dialCode: '+260' },
  { code: 'ZW', name: 'Zimbabwe', flag: '🇿🇼', dialCode: '+263' },
];

export function getAfricanCountry(code: string): AfricanCountry | undefined {
  return AFRICAN_COUNTRIES.find((c) => c.code === code);
}
