[out:json][timeout:180];
(
  nwr["amenity"~"^(cafe|restaurant|bar|library|coworking_space)$"]["name"](40.80,28.55,41.30,29.45);
  nwr["tourism"~"^(hotel|hostel|guest_house)$"]["name"](40.80,28.55,41.30,29.45);
  nwr["aeroway"="aerodrome"]["name"](40.80,28.55,41.30,29.45);
  nwr["railway"="station"]["name"](40.80,28.55,41.30,29.45);
);
out center tags;
