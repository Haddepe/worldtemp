/**
 * Registre des pages d'entrée (lot G). Source unique : les HTML générés, le sitemap, le tiroir
 * et la bascule d'adresse en dérivent. Tous les textes sont livrés tels quels, en anglais.
 */

export interface PageView { lon: number; lat: number; d: number }

export interface PageDef {
  /** "" pour l'accueil, sinon "temperature-map"… */
  slug: string;
  kind: "home" | "layer" | "region";
  /** Id de LAYERS, ou null (aucune couche). */
  layer: string | null;
  /** true : vent allumé sauf reduced-motion (spec §5) ; false : éteint, sauf l'accueil (défaut du site). */
  windForced: boolean;
  /** null : vue par défaut du site. */
  view: PageView | null;
  title: string;
  description: string;
  h1: string;
  summary: string;
  /** Paragraphes du « Read more », texte brut. */
  body: string[];
  menuLabel: string;
  /** Chemin absolu depuis la racine. */
  ogImage: string;
  ogAlt: string;
  /** Slugs liés, en fin de « Read more ». */
  related: string[];
}

export const SITE = "https://globelayers.com";

export function pagePath(p: PageDef): string {
  return p.slug === "" ? "/" : `/${p.slug}/`;
}

const OG = "/og.jpg";

export const PAGES: readonly PageDef[] = [
  {
    slug: "", kind: "home", layer: "temp", windForced: false, view: null,
    title: "GlobeLayers — Live 3D Weather Globe",
    description: "Interactive 3D weather globe with a 48-hour forecast: temperature, wind, clouds, rain, pressure, humidity and air quality worldwide, from NOAA GFS data.",
    h1: "GlobeLayers, a live 3D weather globe",
    summary: "Pick a layer from the layer menu at the bottom, search a town with the magnifier, tap the pin for your own location, the camera to save an image, and drag the slider to move through the next 48 hours. The ? button explains the data.",
    body: [
      "GlobeLayers draws the weather of the whole planet on one rotating globe. Drag to turn it, scroll or pinch to zoom, and open the layer menu to switch between temperature, wind, clouds, rain, pressure, humidity, PM2.5 and dust.",
      "To find a place, use the magnifier: it searches every town above 1,000 inhabitants. The pin button centres the globe on where you are. Your position is read once by your browser and never leaves it, and it is never written into a link or a saved image.",
      "The slider at the bottom steps through the forecast, three hours at a time, over two days. Press play to watch the weather move. The camera button saves what you see as an image, or shares it, and the address bar keeps your view so a link opens the same place. Three switches next to the layer menu turn on the animated wind, place names and rivers.",
      "Weather fields come from the NOAA GFS model at 0.25 degree resolution, and the air quality layers from NOAA GEFS-Aerosols. The data refreshes four times a day. Each map page of this site opens the globe on one layer, and the menu in the top left lists them all.",
    ],
    menuLabel: "How to use", ogImage: OG, ogAlt: "3D globe showing world temperature and animated wind over Europe and the Atlantic",
    related: ["temperature-map", "wind-map", "rain-map"],
  },
  {
    slug: "temperature-map", kind: "layer", layer: "temp", windForced: false, view: null,
    title: "World Temperature Map: Live Forecast on a 3D Globe",
    description: "World temperature map on an interactive 3D globe: air temperature 2 m above ground, in degrees Celsius, with a 48-hour forecast from NOAA GFS.",
    h1: "World temperature map",
    summary: "Air temperature two metres above the ground, in degrees Celsius. Warm tones mark hot regions, cold tones the frozen ones; use the slider to see how the day and night cycle sweeps across the globe.",
    body: [
      "This map shows the air temperature measured two metres above the ground, the same height as a standard weather station. Values are in degrees Celsius and come from the NOAA GFS forecast model, computed on a grid of 0.25 degrees, which is roughly 28 kilometres at the equator.",
      "Read the colour bar on the side of the globe: deep blue and violet are well below freezing, green and yellow are mild, orange and red are hot. Hover or tap anywhere to read the exact value at that point.",
      "Look for the daily rhythm. As the slider moves through the forecast, a band of warmth follows the sun around the planet, and deserts swing between hot afternoons and cool nights far more than oceans do. Continental interiors in winter, such as Siberia and northern Canada, hold the lowest values outside Antarctica.",
      "The model runs four times a day. Every run covers 48 hours in steps of 3 hours, and the globe blends smoothly between those steps, so the animation looks continuous. Temperature is the starting layer of the site, which makes it a good place to learn the controls.",
    ],
    menuLabel: "Temperature", ogImage: "/og/temperature-map.jpg", ogAlt: "Temperature map on a 3D globe",
    related: ["europe-heatwave-map", "antarctica-temperature-map", "arctic-temperature-map"],
  },
  {
    slug: "wind-map", kind: "layer", layer: null, windForced: true, view: null,
    title: "Global Wind Map: Animated Streamlines on a 3D Globe",
    description: "Global wind map with animated streamlines of the wind 10 m above ground, on an interactive 3D globe with a 48-hour forecast from NOAA GFS.",
    h1: "Global wind map",
    summary: "Thousands of moving streamlines show how the air flows 10 metres above the surface. Hover over the globe to read wind speed and direction at any point, and use the slider to watch the flow change.",
    body: [
      "Each moving line on this globe follows the wind at 10 metres above the ground, the standard height for surface wind. Particles drift along the flow and leave a short trail, so fast air shows up as long, bright streaks and calm areas look almost still.",
      "Hover over the globe, or tap on a phone, to read the speed and direction of the wind at that spot. The data comes from the NOAA GFS model at 0.25 degree resolution and is updated four times a day.",
      "A few patterns are worth finding. Near the equator the trade winds blow steadily from the east. At mid-latitudes the flow turns into the strong westerlies, with waves and swirls that mark passing storms. Around the poles the circulation tightens into large vortices.",
      "Press play on the timeline to see the next 48 hours in steps of 3 hours. The motion between steps is blended, so storms appear to travel rather than jump. If your device asks for reduced animation, the wind starts switched off, and you can turn it on with the Wind switch.",
    ],
    menuLabel: "Wind", ogImage: "/og/wind-map.jpg", ogAlt: "Animated wind streamlines on a 3D globe",
    related: ["pressure-map", "atlantic-hurricane-map", "pacific-typhoon-map"],
  },
  {
    slug: "cloud-map", kind: "layer", layer: "clouds", windForced: false, view: null,
    title: "World Cloud Cover Map: Live Clouds on a 3D Globe",
    description: "World cloud cover map on a 3D globe: total cloud cover in percent, with a 48-hour forecast from NOAA GFS. See where skies are clear or overcast.",
    h1: "World cloud cover map",
    summary: "Total cloud cover as a percentage of the sky. White means overcast, transparent means clear sky. Slide through the forecast to follow fronts and storm systems as they cross the oceans.",
    body: [
      "This layer shows total cloud cover, the share of the sky covered by cloud of any height, from 0 percent for a clear sky to 100 percent for a full overcast. The values are forecast by the NOAA GFS model on a 0.25 degree grid.",
      "The more opaque the white, the thicker the cover. Hover or tap to read the percentage at one point. Keep in mind that the value says how much of the sky is covered, not whether it will rain; the rain layer answers that question.",
      "Several shapes are easy to spot. Long comma-shaped bands mark fronts attached to storm systems at mid-latitudes. A belt of cloud near the equator follows the zone where warm air rises. Large clear areas sit over the subtropical deserts and the high-pressure zones over the oceans.",
      "Each model run gives 48 hours of forecast in 3-hour steps, and there are four runs a day. Drag the slider to see cloud bands move east, or press play and watch a whole system cross an ocean in a few seconds.",
    ],
    menuLabel: "Clouds", ogImage: "/og/cloud-map.jpg", ogAlt: "Cloud cover map on a 3D globe",
    related: ["rain-map", "humidity-map", "pressure-map"],
  },
  {
    slug: "rain-map", kind: "layer", layer: "rain", windForced: false, view: null,
    title: "World Rain Map: Precipitation Forecast on a 3D Globe",
    description: "World rain map on a 3D globe: precipitation rate in mm/h with a 48-hour forecast from NOAA GFS. See where heavy rain is falling now and next.",
    h1: "World rain and precipitation map",
    summary: "Precipitation rate in millimetres per hour. Blue patches are light rain, stronger colours mean heavier downpours. Move the slider to see where the rain is heading in the next two days.",
    body: [
      "The rain layer shows the precipitation rate, in millimetres per hour, forecast by the NOAA GFS model on a 0.25 degree grid. Rain, snow and other falling water are all counted. One millimetre of rain over one hour is a light shower; ten or more is a heavy downpour.",
      "Colours start with pale blue for drizzle and move to deeper and warmer tones as the rate rises. Areas without colour have little or no precipitation at that moment. Hover or tap on the globe to read the value at a point.",
      "Look for the long rain bands of mid-latitude storms, the narrow ribbon of showers along the equator, and the seasonal monsoon systems over South and Southeast Asia. Dry zones, such as the Sahara and the Atacama, stay empty for days.",
      "The map is a forecast, not a radar. It shows what the model expects, and small, intense storms are smoothed out at this resolution. Each run covers 48 hours in 3-hour steps and is refreshed four times a day.",
    ],
    menuLabel: "Rain", ogImage: "/og/rain-map.jpg", ogAlt: "Rain and precipitation map on a 3D globe",
    related: ["amazon-rainfall-map", "atlantic-hurricane-map", "pacific-typhoon-map", "cloud-map"],
  },
  {
    slug: "pressure-map", kind: "layer", layer: "pressure", windForced: true, view: null,
    title: "Sea Level Pressure Map: Isobars on a 3D Globe",
    description: "Sea level pressure map with isobars on a 3D globe: mean sea-level pressure in hPa and a 48-hour forecast from NOAA GFS. Spot highs and lows easily.",
    h1: "Sea level pressure map",
    summary: "Mean sea-level pressure in hectopascals, drawn with isobars every 4 hPa. Tight circles of low pressure mark storms; broad highs bring settled weather. The animated wind shows how the air spirals around them.",
    body: [
      "Pressure is the weight of the air above you. To compare places at different altitudes, forecasters convert it to what it would be at sea level. This map shows that value in hectopascals, hPa, with thin isobars drawn every 4 hPa. The data comes from the NOAA GFS model on a 0.25 degree grid.",
      "Average sea-level pressure is about 1013 hPa. Values well below that mark low-pressure systems, where air rises, clouds build and rain is likely. Values well above it mark highs, which usually bring clear and calm weather.",
      "Isobars work like contour lines on a hill. The closer they are together, the steeper the pressure change and the stronger the wind. In the northern hemisphere the air circulates anticlockwise around a low and clockwise around a high; in the southern hemisphere it is the other way round.",
      "The animated wind is drawn on top, so you can watch the circulation form. Press play on the timeline to see lows deepen and move over 48 hours, with a new forecast run four times a day.",
    ],
    menuLabel: "Pressure", ogImage: "/og/pressure-map.jpg", ogAlt: "Sea level pressure and isobars on a 3D globe",
    related: ["wind-map", "atlantic-hurricane-map", "pacific-typhoon-map"],
  },
  {
    slug: "humidity-map", kind: "layer", layer: "humidity", windForced: false, view: null,
    title: "World Humidity Map: Relative Humidity on a 3D Globe",
    description: "World humidity map on a 3D globe: relative humidity 2 m above ground, in percent, with a 48-hour forecast from NOAA GFS. Find the driest and muggiest air.",
    h1: "World humidity map",
    summary: "Relative humidity two metres above the ground, in percent. Low values mean dry air, high values mean air close to saturation. Slide through the forecast to see humid air spread and dry air return.",
    body: [
      "Relative humidity tells you how much water vapour the air holds compared with the most it could hold at its current temperature. This map shows it at two metres above the ground, in percent, using the NOAA GFS forecast on a 0.25 degree grid.",
      "A value near 100 percent means the air is almost saturated, and fog, dew or cloud can form. A value under 30 percent means very dry air, which is typical of deserts and of cold continental winters. Hover or tap to read the figure at any point.",
      "Because relative humidity depends on temperature, it changes strongly over a day. Air that is nearly saturated at dawn can feel dry by mid-afternoon, even though the amount of water in it has not changed. Step through the forecast and notice the patterns follow the sun.",
      "Tropical oceans and rainforests stay humid almost all the time, while the subtropical deserts are among the driest areas. Each forecast run covers 48 hours in 3-hour steps and the data is renewed four times a day.",
    ],
    menuLabel: "Humidity", ogImage: "/og/humidity-map.jpg", ogAlt: "Relative humidity map on a 3D globe",
    related: ["cloud-map", "rain-map", "temperature-map"],
  },
  {
    slug: "air-quality-map", kind: "layer", layer: "pm25", windForced: false, view: null,
    title: "World Air Quality Map: PM2.5 Forecast on a 3D Globe",
    description: "World air quality map on a 3D globe: PM2.5 fine particles near the surface in µg/m³, with a 48-hour forecast from NOAA GEFS-Aerosols.",
    h1: "World air quality map (PM2.5)",
    summary: "Fine particles (PM2.5) near the surface, in micrograms per cubic metre. Clean air is transparent; green, yellow, orange, red and purple mark increasingly polluted air. Use the slider to follow smoke and haze as they drift.",
    body: [
      "PM2.5 means particles smaller than 2.5 micrometres, small enough to be breathed deep into the lungs. This layer shows their concentration near the surface in micrograms per cubic metre, forecast by the NOAA GEFS-Aerosols model, which simulates how particles are emitted, carried and removed.",
      "Colours begin to appear above a few micrograms and climb to deep tones for very polluted air. As a rough reference, the World Health Organization recommends an annual average below 5 micrograms per cubic metre. Hover or tap to read the value at one point.",
      "The map covers all sources the model includes, such as smoke from fires, dust, sea salt and the emissions of cities and industry. Expect hot spots over densely populated and industrial regions, plumes of smoke downwind of large fires, and haze that follows the wind for hundreds of kilometres.",
      "This is a model forecast on a coarse grid, not a measurement from a sensor, so it describes regional patterns rather than a particular street. The forecast runs four times a day, and each run reaches 48 hours in 3-hour steps.",
    ],
    menuLabel: "Air quality (PM2.5)", ogImage: "/og/air-quality-map.jpg", ogAlt: "PM2.5 air quality map on a 3D globe",
    related: ["india-air-quality-map", "dust-forecast", "wind-map"],
  },
  {
    slug: "dust-forecast", kind: "layer", layer: "dust", windForced: false, view: null,
    title: "World Dust Forecast Map: Desert Dust on a 3D Globe",
    description: "World dust forecast on a 3D globe: desert dust near the surface in µg/m³ with a 48-hour forecast from NOAA GEFS-Aerosols. Follow dust plumes across oceans.",
    h1: "World dust forecast",
    summary: "Mineral dust lifted from deserts, shown near the surface in micrograms per cubic metre. Look for plumes leaving the Sahara and the Gobi, and press play to watch them move over the next two days.",
    body: [
      "Strong winds over bare, dry ground lift fine mineral particles into the air. This layer shows that dust near the surface in micrograms per cubic metre, forecast by the NOAA GEFS-Aerosols model on a global grid.",
      "The biggest source on Earth is the Sahara, followed by the Arabian Peninsula, central Asia and the Gobi. Dust from these regions can travel thousands of kilometres. Saharan plumes cross the Atlantic towards the Caribbean and South America, while Asian dust can reach the Pacific.",
      "Dust matters for several reasons. It reduces visibility, it can trigger breathing problems, it settles on snow and darkens it, and it delivers minerals to distant oceans and forests. A strong event shows up on the map as a broad, dense tongue extending from the source.",
      "Compare this map with the animated wind to see what drives each outbreak. The forecast is refreshed four times a day and covers 48 hours in 3-hour steps, so the plume moves smoothly when you press play.",
    ],
    menuLabel: "Dust", ogImage: "/og/dust-forecast.jpg", ogAlt: "Dust forecast map on a 3D globe",
    related: ["sahara-dust-forecast", "air-quality-map", "wind-map"],
  },
  {
    slug: "sahara-dust-forecast", kind: "region", layer: "dust", windForced: false,
    view: { lon: -5, lat: 20, d: 2.0 },
    title: "Sahara Dust Forecast: Plumes Over the Atlantic",
    description: "Sahara dust forecast on a 3D globe: watch dust plumes leave West Africa and cross the Atlantic, with a 48-hour forecast from NOAA GEFS-Aerosols.",
    h1: "Sahara dust forecast",
    summary: "The globe is centred on North Africa and the eastern Atlantic. Look for tongues of dust leaving the coast of West Africa and drifting west; press play to see where they go in the next two days.",
    body: [
      "The Sahara is the largest source of mineral dust in the world, and the globe here is centred on it. Dust is lifted when strong winds blow over dry, loose ground, especially in the Bodele Depression in Chad and across Mauritania, Mali and Algeria.",
      "On the map, look for a pale-to-dense tongue that leaves the African coast between about 10 and 25 degrees north. This is the Saharan Air Layer, a mass of hot, dry, dusty air that rides above the cooler air near the sea surface and moves west across the tropical Atlantic.",
      "Plumes can reach the Caribbean, the Gulf of Mexico and northern South America in about five to seven days. Along the way they haze the sky, produce red sunsets and lower air quality. Over the Amazon, the dust brings phosphorus that fertilises the forest.",
      "Another route runs north, when southerly winds push dust over the Mediterranean towards Spain, Italy and further into Europe. Switch on Wind to see which flow carries the dust. The values are in micrograms per cubic metre, and the forecast shows 48 hours in 3-hour steps.",
    ],
    menuLabel: "Sahara dust", ogImage: "/og/sahara-dust-forecast.jpg", ogAlt: "Saharan dust plumes over the Atlantic on a 3D globe",
    related: ["dust-forecast", "air-quality-map", "wind-map"],
  },
  {
    slug: "europe-heatwave-map", kind: "region", layer: "temp", windForced: false,
    view: { lon: 12, lat: 48, d: 1.8 },
    title: "Europe Heatwave Map: Temperature Forecast on a 3D Globe",
    description: "Europe heatwave map on a 3D globe: 2 m air temperature across the continent with a 48-hour forecast from NOAA GFS. Spot hot air masses early.",
    h1: "Europe temperature and heatwave map",
    summary: "The globe is centred on Europe. Orange and red tones over the continent mark hot air masses; step through the next two days to see whether the heat is growing, shifting or fading.",
    body: [
      "This view is centred on Europe and shows the air temperature two metres above the ground, in degrees Celsius, from the NOAA GFS model. A heatwave is a spell of unusually high temperatures lasting several days, so the goal here is to recognise one forming.",
      "A typical event starts when a stable area of high pressure settles over the region and a southerly flow pulls hot air north from Africa. On the map, the first sign is a wide patch of orange and red spreading over Iberia, France or Italy, with little cloud over it.",
      "Use the slider to check how the hot air moves. Over 48 hours you can see whether the heat spreads towards Germany and Central Europe, stays in place, or is pushed away by a cooler Atlantic front. Compare daytime and night-time to spot tropical nights, when temperatures remain high after dark.",
      "Remember that the scale is in absolute temperature, not in comparison with the local average, and the grid is 0.25 degrees, so cities and valleys can be warmer than the map shows. The forecast is renewed four times a day.",
    ],
    menuLabel: "Europe heatwave", ogImage: "/og/europe-heatwave-map.jpg", ogAlt: "Europe temperature map on a 3D globe",
    related: ["temperature-map", "pressure-map", "wind-map"],
  },
  {
    slug: "atlantic-hurricane-map", kind: "region", layer: "rain", windForced: true,
    view: { lon: -55, lat: 22, d: 2.0 },
    title: "Atlantic Hurricane Map: Wind and Rain on a 3D Globe",
    description: "Atlantic hurricane map on a 3D globe: animated wind and rain over the tropical Atlantic, with a 48-hour forecast from NOAA GFS.",
    h1: "Atlantic hurricane wind and rain map",
    summary: "The globe looks at the tropical Atlantic with the wind switched on over the rain layer. A hurricane shows up as a tight spiral of fast streamlines wrapped in curved bands of heavy rain.",
    body: [
      "Hurricanes form over warm tropical water, mostly between June and November, and this view is centred on the region where they develop. It combines animated surface wind with rainfall, so you can recognise a strong system by its shape.",
      "A mature storm has two signs. In the rain layer it appears as curved bands of heavy rain spiralling into a compact centre. In the wind, streamlines circle that centre anticlockwise, and the fastest air forms a ring close to it. Switch to the Pressure layer to see the very low centre, often below 980 hPa.",
      "Weaker systems look like open waves or broad, loose swirls of scattered showers. They may or may not develop. Watch how the swirl tightens as you move through the forecast, and how the flow of the surrounding trade winds steers it west.",
      "This is a global model with a 0.25 degree grid, around 28 kilometres, which is too coarse to resolve the sharp core of a storm, so winds in the centre are underestimated. For official warnings and the position of named storms, always rely on national hurricane services.",
    ],
    menuLabel: "Atlantic hurricanes", ogImage: "/og/atlantic-hurricane-map.jpg", ogAlt: "Wind and rain over the tropical Atlantic on a 3D globe",
    related: ["wind-map", "pressure-map", "pacific-typhoon-map"],
  },
  {
    slug: "pacific-typhoon-map", kind: "region", layer: "rain", windForced: true,
    view: { lon: 135, lat: 20, d: 2.0 },
    title: "Pacific Typhoon Map: Wind and Rain on a 3D Globe",
    description: "Pacific typhoon map on a 3D globe: animated wind and rain over the western Pacific, with a 48-hour forecast from NOAA GFS.",
    h1: "Western Pacific typhoon wind and rain map",
    summary: "The globe looks at the western Pacific, with animated wind over the rain layer. A typhoon appears as a closed spiral of strong wind wrapped in curved bands of heavy rain, usually heading west or north-west.",
    body: [
      "The western Pacific is the most active region in the world for tropical cyclones, called typhoons there. They can form in any month, though most appear between July and November, over water warmer than about 26 degrees.",
      "To spot one, look for curved bands of heavy rain spiralling into a compact centre. Then look at the wind: the streamlines should turn anticlockwise around that centre, with the fastest flow packed on one side, often the side facing the direction of travel. Switch to the Pressure layer to see the deep low at its core, well under 1000 hPa.",
      "Typhoons usually move west or north-west along the southern edge of a subtropical high, then recurve towards Japan, Korea or China as they meet the westerlies. Press play on the timeline to see how the pattern shifts in the next 48 hours.",
      "The model grid is 0.25 degrees, so this map gives the broad picture, not the exact intensity at the centre. Do not use it for safety decisions; follow the bulletins of national meteorological agencies for warnings, forecasts and the official names of storms.",
    ],
    menuLabel: "Pacific typhoons", ogImage: "/og/pacific-typhoon-map.jpg", ogAlt: "Wind and rain over the western Pacific on a 3D globe",
    related: ["wind-map", "pressure-map", "atlantic-hurricane-map"],
  },
  {
    slug: "india-air-quality-map", kind: "region", layer: "pm25", windForced: false,
    view: { lon: 80, lat: 22, d: 1.8 },
    title: "India Air Quality Map: PM2.5 Forecast on a 3D Globe",
    description: "India air quality map on a 3D globe: PM2.5 fine particles across the subcontinent with a 48-hour forecast from NOAA GEFS-Aerosols.",
    h1: "India air quality map (PM2.5)",
    summary: "The globe is centred on India. The densest tones usually sit over the Indo-Gangetic Plain; slide through the forecast to see whether the haze thickens, drifts east or clears.",
    body: [
      "India is home to some of the most polluted air on Earth, and this view centres on it. The map shows PM2.5, fine particles smaller than 2.5 micrometres, near the surface in micrograms per cubic metre, forecast by the NOAA GEFS-Aerosols model.",
      "The pattern to look for is a broad band of dense colour across the Indo-Gangetic Plain, from Punjab and Delhi through Uttar Pradesh and Bihar to Bangladesh. The Himalayas on the north side and a shallow layer of cool air near the ground trap the particles, especially in winter.",
      "Seasons change the picture. From October to November smoke from crop burning in the north-west adds to city emissions. In spring, dust from the Thar Desert and the Arabian Peninsula adds more particles. In the summer monsoon, heavy rain washes the air and the map clears.",
      "The model works on a coarse grid, so it shows regional haze rather than the level on a single street, which can differ a lot. Press play to see 48 hours in steps of 3 hours, and switch on Wind to understand where the haze is travelling.",
    ],
    menuLabel: "India air quality", ogImage: "/og/india-air-quality-map.jpg", ogAlt: "PM2.5 over India on a 3D globe",
    related: ["air-quality-map", "dust-forecast", "wind-map"],
  },
  {
    slug: "antarctica-temperature-map", kind: "region", layer: "temp", windForced: false,
    view: { lon: 0, lat: -89, d: 2.2 },
    title: "Antarctica Temperature Map: Live Forecast on a 3D Globe",
    description: "Antarctica temperature map on a 3D globe: 2 m air temperature over the South Pole and the ice sheet, with a 48-hour forecast from NOAA GFS.",
    h1: "Antarctica temperature map",
    summary: "The globe looks straight down on the South Pole. The deep blue and violet over the interior is the coldest air on the planet; the coast and the sea ice edge are far milder.",
    body: [
      "Antarctica is the coldest, driest and windiest continent. The globe here looks straight down at the South Pole and shows the air temperature at two metres above the ground, in degrees Celsius, from the NOAA GFS model.",
      "Find the high plateau of East Antarctica, a dome of ice more than 3,000 metres high. Its interior holds the lowest values on the map, often below minus 50 degrees in winter. The coldest air ever measured on Earth, near minus 90 degrees, was recorded on this plateau.",
      "The coast is much milder. Around the margin and over the Antarctic Peninsula, which reaches towards South America, temperatures can sit close to freezing in summer. Notice the sharp contrast between the plateau and the sea along the edge of the continent.",
      "Because over most of the continent the sun never sets in summer and never rises in winter, the daily cycle that shapes other regions is almost absent here. Expect slow changes in the forecast rather than daily swings. Data is updated four times a day, with 48 hours of forecast.",
    ],
    menuLabel: "Antarctica", ogImage: "/og/antarctica-temperature-map.jpg", ogAlt: "Antarctica temperature seen from above the South Pole",
    related: ["temperature-map", "arctic-temperature-map", "pressure-map"],
  },
  {
    slug: "arctic-temperature-map", kind: "region", layer: "temp", windForced: false,
    view: { lon: 0, lat: 89, d: 2.2 },
    title: "Arctic Temperature Map: North Pole Forecast on a 3D Globe",
    description: "Arctic temperature map on a 3D globe: 2 m air temperature around the North Pole and Greenland with a 48-hour forecast from NOAA GFS.",
    h1: "Arctic and North Pole temperature map",
    summary: "The globe looks straight down on the North Pole. Cold air pools over Greenland and the frozen ocean, while the edges of the Arctic Ocean and northern Siberia show how fast conditions change.",
    body: [
      "This view looks down at the North Pole and shows the air temperature at two metres above the surface, in degrees Celsius, from the NOAA GFS model. Unlike Antarctica, the Arctic is an ocean covered in sea ice and surrounded by land.",
      "Because the ice sits on water, the air above it is not as cold as on the southern plateau. In winter the coldest areas lie over Siberia, northern Canada and the high ice sheet of Greenland, where values drop well below minus 40 degrees. Over open water near the ice edge, the air is much warmer.",
      "Follow the forecast for sudden changes. When a strong low-pressure system pushes into the Arctic from the Atlantic or the Pacific, a surge of mild air can raise temperatures by tens of degrees in a day or two, and the map shows it as a patch of lighter colour. Cold air can also spill south from the pole into mid-latitudes.",
      "Summer brings long days with constant sunlight and temperatures close to freezing over the ocean. The grid is 0.25 degrees, and each of the four daily runs covers 48 hours in 3-hour steps.",
    ],
    menuLabel: "Arctic", ogImage: "/og/arctic-temperature-map.jpg", ogAlt: "Arctic temperature seen from above the North Pole",
    related: ["temperature-map", "antarctica-temperature-map", "pressure-map"],
  },
  {
    slug: "amazon-rainfall-map", kind: "region", layer: "rain", windForced: false,
    view: { lon: -60, lat: -5, d: 1.8 },
    title: "Amazon Rainfall Map: Precipitation Forecast on a 3D Globe",
    description: "Amazon rainfall map on a 3D globe: precipitation rate in mm/h over the Amazon basin, with a 48-hour forecast from NOAA GFS. See storms build and move.",
    h1: "Amazon rainfall map",
    summary: "The globe is centred on the Amazon basin. Look for bright cells of heavy rain that grow in the afternoon, and for the broad band of showers that shifts north and south with the seasons.",
    body: [
      "The Amazon basin holds the largest rainforest on Earth and receives more than two metres of rain in a typical year. This view shows the precipitation rate in millimetres per hour from the NOAA GFS model, on a grid of 0.25 degrees.",
      "Most of the rain falls from towering convective storms. On the map they appear as bright, scattered cells that build in the early afternoon, when the ground is hottest, and fade in the evening. Move the slider through a full day to see that cycle repeat.",
      "Over longer periods, look at the broad band of cloud and showers called the Intertropical Convergence Zone. It lies near the equator and moves slightly north and south through the year, which gives the basin its wetter and drier seasons. In the Andes, to the west, air forced upward by the mountains produces some of the heaviest rain.",
      "The forest also makes its own rain: trees release water vapour that feeds later storms downwind. The forecast shows 48 hours in 3-hour steps, renewed four times a day.",
    ],
    menuLabel: "Amazon rainfall", ogImage: "/og/amazon-rainfall-map.jpg", ogAlt: "Rainfall over the Amazon basin on a 3D globe",
    related: ["rain-map", "cloud-map", "humidity-map"],
  },
];
