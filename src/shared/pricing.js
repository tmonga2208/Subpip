// Premium price by region: ₹999 in India, $7 in the lower-priced countries,
// $15 everywhere else, and for one year ₹399, $3 or $6. The server
// (web/api/_lib/pricing.js) sets and checks the amount; this is for display.

export const REGIONAL_PRICES = {
  INR: { currency: 'INR', amount: 99900, label: '₹999' },
  USD: { currency: 'USD', amount: 1500, label: '$15' }
};

const INDIA_TIME_ZONES = ['Asia/Kolkata', 'Asia/Calcutta'];
// Where $15 is a lot: Indonesia, the Philippines, Vietnam, Thailand, Turkey
// and Brazil pay $7. The same list as the website's (web/script.js).
export const LOWER_PRICED_TIME_ZONES = ['Asia/Jakarta', 'Asia/Pontianak', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Manila', 'Asia/Ho_Chi_Minh', 'Asia/Saigon', 'Asia/Bangkok', 'Europe/Istanbul', 'Asia/Istanbul',
  'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Maceio', 'America/Belem', 'America/Araguaina', 'America/Santarem', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Eirunepe', 'America/Noronha'];
// Lifetime, and one year that ends by itself
export const LEVEL_LABELS = {
  INR: { currency: 'INR', tier: 'standard', lifetime: '₹999', year: '₹399' },
  LOW: { currency: 'USD', tier: 'low', lifetime: '$7', year: '$3' },
  USD: { currency: 'USD', tier: 'standard', lifetime: '$15', year: '$6' }
};

const zone = (timeZone) => timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

export function defaultCurrency(timeZone) {
  return INDIA_TIME_ZONES.includes(zone(timeZone)) ? 'INR' : 'USD';
}

export function localPrices(timeZone) {
  if (INDIA_TIME_ZONES.includes(zone(timeZone))) return LEVEL_LABELS.INR;
  return LEVEL_LABELS[LOWER_PRICED_TIME_ZONES.includes(zone(timeZone)) ? 'LOW' : 'USD'];
}

// The lifetime price here: { currency, amount, label }
export function localPrice(timeZone) {
  const standard = REGIONAL_PRICES[defaultCurrency(timeZone)];
  const here = localPrices(timeZone);
  return here.tier === 'low' ? { currency: 'USD', amount: 700, label: here.lifetime } : standard;
}
