// Mock data for the WiFi Near Me demo.
// Shape follows the planned data model: places -> wifi_entries.
// All passwords and instructions are FAKE and for demo only.

window.MOCK_CITIES = [
  { name: "Istanbul", lat: 41.0136, lng: 28.9784, zoom: 11.5 },
  { name: "Antalya", lat: 36.8841, lng: 30.7056, zoom: 11.5 },
];

window.MOCK_PLACES = [
  {
    id: 1, osm_type: "way", osm_id: 100001, name: "Istanbul Airport (IST)", category: "airport", city: "Istanbul",
    lat: 41.2753, lng: 28.7519,
    entries: [
      { id: 101, label: "Airport Free WiFi", access_type: "portal", language: "en",
        steps_text: "Connect to the network 'IST Free WiFi'. A page opens. Tap 'Connect'. Free access lasts 2 hours. After that, scan your boarding pass at a kiosk to get more time.",
        password: null, password_policy: "none", works: 41, broken: 3, last_confirmed: "2 days ago" },
      { id: 102, label: "Lounge", access_type: "password", language: "en",
        steps_text: "Lounge guests only. The password is printed on the card at your table.",
        password: "LoungeDemo-2026", password_policy: "posted_publicly", works: 9, broken: 1, last_confirmed: "1 week ago" },
    ],
  },
  {
    id: 2, osm_type: "way", osm_id: 100002, name: "Sabiha Gökçen Airport (SAW)", category: "airport", city: "Istanbul",
    lat: 40.8986, lng: 29.3092,
    entries: [
      { id: 103, label: "SAW Free WiFi", access_type: "sms", language: "tr",
        steps_text: "Connect to 'SAW Free'. Enter your phone number on the page. You get a code by SMS. Foreign numbers can fail. If it fails, ask at the information desk for a voucher.",
        password: null, password_policy: "none", works: 22, broken: 11, last_confirmed: "3 days ago" },
    ],
  },
  {
    id: 3, osm_type: "way", osm_id: 100003, name: "Sirkeci Railway Station", category: "station", city: "Istanbul",
    lat: 41.0170, lng: 28.9770, entries: [],
  },
  {
    id: 4, osm_type: "node", osm_id: 100004, name: "Hagia Sophia Area Cafe", category: "cafe", city: "Istanbul",
    lat: 41.0086, lng: 28.9795,
    entries: [
      { id: 104, label: "Cafe WiFi", access_type: "ask_staff", language: "en",
        steps_text: "Buy a drink. Ask the staff for the WiFi code. The code changes each day.",
        password: "(changes daily)", password_policy: "ask_staff", works: 14, broken: 0, last_confirmed: "yesterday" },
    ],
  },
  {
    id: 5, osm_type: "node", osm_id: 100005, name: "Grand Bazaar Tea House", category: "cafe", city: "Istanbul",
    lat: 41.0107, lng: 28.9680,
    entries: [
      { id: 105, label: "Guest", access_type: "password", language: "tr",
        steps_text: "The password is written on a small sign near the cash desk.",
        password: "cay1234demo", password_policy: "posted_publicly", works: 6, broken: 2, last_confirmed: "5 days ago" },
    ],
  },
  { id: 6, osm_type: "node", osm_id: 100006, name: "Galata Tower Cafe", category: "cafe", city: "Istanbul", lat: 41.0256, lng: 28.9744, entries: [] },
  {
    id: 7, osm_type: "node", osm_id: 100007, name: "Karaköy Coworking Hub", category: "coworking", city: "Istanbul",
    lat: 41.0230, lng: 28.9775,
    entries: [
      { id: 106, label: "Day pass WiFi", access_type: "paid", language: "en",
        steps_text: "A day pass costs about 300 TL (demo value). Staff give you a personal login at the front desk. Speed is fast.",
        password: null, password_policy: "none", works: 18, broken: 0, last_confirmed: "today" },
    ],
  },
  {
    id: 8, osm_type: "node", osm_id: 100008, name: "Taksim Square Hotel", category: "hotel", city: "Istanbul",
    lat: 41.0370, lng: 28.9850,
    entries: [
      { id: 107, label: "Hotel guest WiFi", access_type: "id_required", language: "en",
        steps_text: "Open the network 'TaksimHotel'. Enter your room number and last name on the page. Non-guests cannot connect.",
        password: null, password_policy: "none", works: 12, broken: 1, last_confirmed: "4 days ago" },
      { id: 108, label: "Lobby bar", access_type: "open", language: "en",
        steps_text: "Network 'TaksimHotel-Lobby' is open. No password. Speed is slow at busy times.",
        password: null, password_policy: "none", works: 7, broken: 2, last_confirmed: "2 weeks ago" },
    ],
  },
  { id: 9, osm_type: "node", osm_id: 100009, name: "Istiklal Street Burger Place", category: "restaurant", city: "Istanbul", lat: 41.0335, lng: 28.9770, entries: [] },
  {
    id: 10, osm_type: "node", osm_id: 100010, name: "Kadıköy Public Library", category: "library", city: "Istanbul",
    lat: 40.9908, lng: 29.0290,
    entries: [
      { id: 109, label: "Library WiFi", access_type: "open", language: "tr",
        steps_text: "Open network. Connect to 'Kutuphane'. A page may ask you to accept the rules. Tap 'Accept'.",
        password: null, password_policy: "none", works: 25, broken: 1, last_confirmed: "3 days ago" },
    ],
  },
  { id: 11, osm_type: "node", osm_id: 100011, name: "Kadıköy Market Cafe", category: "cafe", city: "Istanbul", lat: 40.9892, lng: 29.0255, entries: [] },
  { id: 12, osm_type: "node", osm_id: 100012, name: "Üsküdar Ferry Terminal", category: "station", city: "Istanbul", lat: 41.0255, lng: 29.0150, entries: [] },
  {
    id: 13, osm_type: "node", osm_id: 100013, name: "Beşiktaş Waterfront Cafe", category: "cafe", city: "Istanbul",
    lat: 41.0422, lng: 29.0067,
    entries: [
      { id: 110, label: "Cafe WiFi", access_type: "password", language: "en",
        steps_text: "Password is on the receipt after you order.",
        password: "receipt-demo", password_policy: "posted_publicly", works: 10, broken: 1, last_confirmed: "6 days ago" },
    ],
  },
  { id: 14, osm_type: "node", osm_id: 100014, name: "Sultanahmet Backpacker Hostel", category: "hostel", city: "Istanbul", lat: 41.0058, lng: 28.9760,
    entries: [
      { id: 111, label: "Hostel WiFi", access_type: "password", language: "en",
        steps_text: "Password is on the board in the common room. Guests only.",
        password: "hostel-demo-77", password_policy: "posted_publicly", works: 15, broken: 0, last_confirmed: "yesterday" },
    ] },
  { id: 15, osm_type: "node", osm_id: 100015, name: "Eminönü Simit Bakery", category: "cafe", city: "Istanbul", lat: 41.0170, lng: 28.9707, entries: [] },
  { id: 16, osm_type: "node", osm_id: 100016, name: "Nişantaşı Mall Food Court", category: "restaurant", city: "Istanbul", lat: 41.0478, lng: 28.9937,
    entries: [
      { id: 112, label: "Mall WiFi", access_type: "sms", language: "tr",
        steps_text: "Connect to 'MallFree'. You need a Turkish phone number for the SMS code. Without one, ask at the customer desk on level 1.",
        password: null, password_policy: "none", works: 8, broken: 9, last_confirmed: "1 week ago" },
    ] },

  // Antalya
  {
    id: 20, osm_type: "way", osm_id: 200001, name: "Antalya Airport (AYT)", category: "airport", city: "Antalya",
    lat: 36.8987, lng: 30.8005,
    entries: [
      { id: 201, label: "Airport Free WiFi", access_type: "portal", language: "en",
        steps_text: "Connect to 'AYT Free'. Tap 'Connect' on the page. Free access for 1 hour. Then wait or watch a short video for more time.",
        password: null, password_policy: "none", works: 30, broken: 4, last_confirmed: "2 days ago" },
    ],
  },
  { id: 21, osm_type: "node", osm_id: 200002, name: "Kaleiçi Old Town Cafe", category: "cafe", city: "Antalya", lat: 36.8848, lng: 30.7060,
    entries: [
      { id: 202, label: "Cafe WiFi", access_type: "password", language: "en",
        steps_text: "Password is on the menu, last page.",
        password: "kaleici-demo", password_policy: "posted_publicly", works: 11, broken: 0, last_confirmed: "3 days ago" },
    ] },
  { id: 22, osm_type: "node", osm_id: 200003, name: "Hadrian's Gate Restaurant", category: "restaurant", city: "Antalya", lat: 36.8872, lng: 30.7092, entries: [] },
  { id: 23, osm_type: "node", osm_id: 200004, name: "Konyaaltı Beach Hotel", category: "hotel", city: "Antalya", lat: 36.8700, lng: 30.6400,
    entries: [
      { id: 203, label: "Hotel guest WiFi", access_type: "password", language: "en",
        steps_text: "Ask at reception for the daily password. It is also on your key card sleeve.",
        password: "(on key card)", password_policy: "ask_staff", works: 13, broken: 1, last_confirmed: "4 days ago" },
      { id: 204, label: "Beach area", access_type: "customers_only", language: "en",
        steps_text: "Available only on the beach terrace if you order food. Ask the waiter.",
        password: null, password_policy: "none", works: 5, broken: 2, last_confirmed: "2 weeks ago" },
    ] },
  { id: 24, osm_type: "node", osm_id: 200005, name: "Lara Shopping Centre", category: "restaurant", city: "Antalya", lat: 36.8500, lng: 30.7900, entries: [] },
  { id: 25, osm_type: "node", osm_id: 200006, name: "Antalya Central Bus Station", category: "station", city: "Antalya", lat: 36.9186, lng: 30.6850, entries: [] },
  { id: 26, osm_type: "node", osm_id: 200007, name: "Marina Coffee Roasters", category: "cafe", city: "Antalya", lat: 36.8820, lng: 30.7030,
    entries: [
      { id: 205, label: "Cafe WiFi", access_type: "open", language: "en",
        steps_text: "Open network 'MarinaCoffee'. No password. Good speed in the morning.",
        password: null, password_policy: "none", works: 17, broken: 1, last_confirmed: "yesterday" },
    ] },
  { id: 27, osm_type: "node", osm_id: 200008, name: "Antalya City Library", category: "library", city: "Antalya", lat: 36.8905, lng: 30.6950, entries: [] },
];
