let n = 0;
export const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const CATS = [
  { id: 'kleding', emoji: '👕', name: 'Kleding' },
  { id: 'toilet', emoji: '🧴', name: 'Toiletspullen' },
  { id: 'gezond', emoji: '💊', name: 'Gezondheid' },
  { id: 'docs', emoji: '📄', name: 'Documenten & geld' },
  { id: 'tech', emoji: '🔌', name: 'Elektronica' },
  { id: 'onderweg', emoji: '🎒', name: 'Onderweg' },
  { id: 'strand', emoji: '🏖️', name: 'Strand & zwemmen' },
  { id: 'kamperen', emoji: '🏕️', name: 'Kamperen' },
  { id: 'winter', emoji: '⛷️', name: 'Wintersport' },
  { id: 'overig', emoji: '🧺', name: 'Overig' },
];

const G = (name, cat) => ({ id: uid(), name, cat });

export function seedGear() {
  return [
    // Kleding
    G('T-shirts', 'kleding'),
    G('Korte broeken', 'kleding'),
    G('Lange broek', 'kleding'),
    G('Ondergoed', 'kleding'),
    G('Sokken', 'kleding'),
    G('Trui / hoodie', 'kleding'),
    G('Regenjas', 'kleding'),
    G('Zwemkleding', 'kleding'),
    G('Pyjama', 'kleding'),
    G('Wandelschoenen', 'kleding'),
    G('Extra schoenen', 'kleding'),
    G('Slippers', 'kleding'),
    G('Pet / zonnehoed', 'kleding'),
    G('Nette outfit', 'kleding'),
    // Toiletspullen
    G('Tandenborstel', 'toilet'),
    G('Tandpasta', 'toilet'),
    G('Deodorant', 'toilet'),
    G('Shampoo & douchegel', 'toilet'),
    G('Zonnebrand', 'toilet'),
    G('Aftersun', 'toilet'),
    G('Scheerspullen', 'toilet'),
    G('Haarborstel / kam', 'toilet'),
    G('Lenzen / brillenspullen', 'toilet'),
    G('Nagelknipper', 'toilet'),
    // Gezondheid
    G('Paracetamol', 'gezond'),
    G('EHBO-set', 'gezond'),
    G('Pleisters', 'gezond'),
    G('Eigen medicijnen', 'gezond'),
    G('Muggenspray (DEET)', 'gezond'),
    G('Reisziektetabletten', 'gezond'),
    G('Oordopjes', 'gezond'),
    // Documenten & geld
    G('Paspoort / ID-kaart', 'docs'),
    G('Rijbewijs', 'docs'),
    G('Zorgpas / verzekeringspas', 'docs'),
    G('Bankpas / creditcard', 'docs'),
    G('Contant geld', 'docs'),
    G('Tickets / reserveringen', 'docs'),
    G('Tolvignet', 'docs'),
    // Elektronica
    G('Telefoonoplader', 'tech'),
    G('Opladertasje', 'tech'),
    G('Powerbanks', 'tech'),
    G('Airtags', 'tech'),
    G('Oortjes / koptelefoon', 'tech'),
    G('Wereldstekker', 'tech'),
    G('E-reader', 'tech'),
    G('Camera + oplader', 'tech'),
    G('Laptop / tablet + oplader', 'tech'),
    // Onderweg
    G('Rugzak (groot)', 'onderweg'),
    G('Dagrugzak', 'onderweg'),
    G('Drinkfles', 'onderweg'),
    G('Zonnebril', 'onderweg'),
    G('Nekkussen', 'onderweg'),
    G('Snacks voor onderweg', 'onderweg'),
    G('Boek / tijdschrift', 'onderweg'),
    G('Spelletjes / kaarten', 'onderweg'),
    // Strand & zwemmen
    G('Strandlaken', 'strand'),
    G('Snorkelset', 'strand'),
    G('Strandtas', 'strand'),
    G('Parasol', 'strand'),
    G('Koelbox / koeltas', 'strand'),
    G('Waterschoenen', 'strand'),
    // Kamperen
    G('Tent', 'kamperen'),
    G('Slaapzak', 'kamperen'),
    G('Slaapmatje / luchtbed', 'kamperen'),
    G('Kussen', 'kamperen'),
    G('Hoofdlamp / zaklamp', 'kamperen'),
    G('Campingstoeltjes', 'kamperen'),
    G('Campingtafeltje', 'kamperen'),
    G('Gasbrander + gas', 'kamperen'),
    G('Pannenset', 'kamperen'),
    G('Aansteker / lucifers', 'kamperen'),
    G('Zakmes / multitool', 'kamperen'),
    G('Touw', 'kamperen'),
    G('Tiewraps', 'kamperen'),
    G('Verlengsnoer (CEE)', 'kamperen'),
    // Wintersport
    G('Snowboard', 'winter'),
    G('Snowboardboots', 'winter'),
    G('Ski-jas', 'winter'),
    G('Skibroek', 'winter'),
    G('Thermoshirts', 'winter'),
    G('Thermobroeken', 'winter'),
    G('Fleecetrui / midlayer', 'winter'),
    G('Skisokken', 'winter'),
    G('Skihandschoenen', 'winter'),
    G('Onderhandschoenen', 'winter'),
    G('Muts', 'winter'),
    G('Skibril', 'winter'),
    G('Helm', 'winter'),
    G('Sjaal / col', 'winter'),
    G('Après-ski schoenen', 'winter'),
    // Overig
    G('Handdoeken', 'overig'),
    G('Wasmiddel / waslijn', 'overig'),
    G('Plastic zakken (vuile was)', 'overig'),
    G('Paraplu', 'overig'),
    G('Hangslotje', 'overig'),
  ];
}

export function seedState(email) {
  const gear = seedGear();
  const byName = (q) => gear.find((g) => g.name === q)?.id;
  const items = [
    ['T-shirts', 7],
    ['Korte broeken', 3],
    ['Ondergoed', 8],
    ['Sokken', 5],
    ['Zwemkleding', 2],
    ['Trui / hoodie', 1],
    ['Tandenborstel', 1],
    ['Tandpasta', 1],
    ['Deodorant', 1],
    ['Zonnebrand', 1],
    ['Paspoort / ID-kaart', 1],
    ['Telefoonoplader', 1],
    ['Powerbanks', 1],
    ['Zonnebril', 1],
    ['Strandlaken', 2],
  ]
    .map(([nm, qty]) => ({ gearId: byName(nm), qty, packed: false }))
    .filter((it) => it.gearId);

  return {
    v: 1,
    email,
    gear,
    lists: [
      {
        id: uid(),
        name: 'Zomervakantie (voorbeeld)',
        emoji: '🌞',
        note: 'Voorbeeldlijst — pas aan of gooi weg',
        items,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}
