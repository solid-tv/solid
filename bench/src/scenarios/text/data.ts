// Deterministic strings for the text scenarios: invented titles, metadata and
// synopses of realistic length. No network and no randomness, so every arm
// lays out exactly the same text. ASCII only: the bench's Roboto MSDF atlases
// have printable ASCII and curly quotes, no bullet or accented letters.

/** 50 base titles, 10 to 22 characters. */
const BASE_TITLES = [
  'The Silent Harbor',
  'Midnight in Lisbon',
  'Echoes of the Valley',
  'Paper Kingdoms',
  'The Last Lighthouse',
  'Northbound Express',
  'A Winter in Kyoto',
  'Glass Houses',
  'The Cartographer',
  'Saltwater Hearts',
  'Neon Prairie',
  'The Quiet Hours',
  'Iron and Ivy',
  'Beneath the Aurora',
  'The Weekend Detectives',
  'Copper Canyon',
  'Small Town Signals',
  'The Orchard Keeper',
  'Moonlight Bakery',
  'Fault Lines',
  'The Ninth Passenger',
  'Harbor Lights',
  'Summer of Static',
  'The Long Exposure',
  'Wild Coast Rescue',
  'The Velvet Kitchen',
  'Starfall Academy',
  'Under the Same Sky',
  'The Brass Compass',
  'Rivers of Gold',
  'City of Lanterns',
  'The Forgotten Shore',
  'Cold Case Chronicles',
  'Highland Rangers',
  "The Tinker's Daughter",
  'Desert Bloom',
  'Signal and Noise',
  'The Glass Orchard',
  'Thunder Road Diaries',
  'Little Fires',
  'The Archivist',
  'Open Water',
  'Pacific Standard',
  'Shadows of Verona',
  "The Clockmaker's Son",
  'Blue Ridge Nights',
  'Emerald Coast',
  'The Winter Garden',
  'Lost in Transit',
  'Kingdom of Salt',
];

/** Appended per block of 50, so titles stay unique up to 400 (at most 38 characters). */
const TITLE_SUFFIXES = [
  '',
  ': Season 2',
  ': The Return',
  " (Director's Cut)",
  ': Origins',
  ' Live',
  ': Part Two',
  ' Revisited',
];

const GENRES = [
  'Drama',
  'Comedy',
  'Thriller',
  'Documentary',
  'Sci-Fi',
  'Romance',
  'Animation',
  'Crime',
  'Family',
  'Mystery',
  'Adventure',
  'Reality',
];

/** A tile's two lines: a title and a "year | genre" subtitle. */
export interface TileText {
  title: string;
  subtitle: string;
}

/** Number of distinct tiles {@link tileText} can make. */
export const TILE_TEXT_COUNT = BASE_TITLES.length * TITLE_SUFFIXES.length;

/**
 * Tile `n`, for 0 <= n < TILE_TEXT_COUNT: every title and every subtitle is
 * distinct (35 years and 12 genres are coprime, so the pair repeats only
 * every 420).
 */
export function tileText(n: number): TileText {
  return {
    title:
      BASE_TITLES[n % BASE_TITLES.length]! +
      TITLE_SUFFIXES[Math.floor(n / BASE_TITLES.length)]!,
    subtitle: `${1990 + (n % 35)} | ${GENRES[n % GENRES.length]!}`,
  };
}

/** What a details panel shows for one item. */
export interface Details {
  title: string;
  year: string;
  runtime: string;
  genres: string;
  rating: string;
  description: string;
  cast: string;
}

/**
 * Eight items for the details panel. Synopses run from 150 to 400
 * characters, so at the panel's width they wrap to two or three lines and
 * the longer ones are cut by maxLines.
 */
export const DETAILS: Details[] = [
  {
    title: 'The Silent Harbor',
    year: '2024',
    runtime: '2h 15m',
    genres: 'Drama, Mystery',
    rating: 'PG-13',
    description:
      'A retired lighthouse keeper returns to the fishing town she left thirty years ago and finds that the harbor has kept every secret she tried to forget.',
    cast: 'Mara Ellison, Tom Achebe, Lucia Fernandez',
  },
  {
    title: 'Midnight in Lisbon',
    year: '2019',
    runtime: '1h 48m',
    genres: 'Romance, Comedy',
    rating: 'PG',
    description:
      'Two strangers miss the last tram up the hill and spend one long night walking the city, trading stories in cafes, dodging a wedding party and arguing about whether a single evening is ever enough to change a life.',
    cast: 'Daniel Okafor, Ines Moreira, Paul Brandt',
  },
  {
    title: 'Echoes of the Valley',
    year: '2021',
    runtime: '52m',
    genres: 'Documentary',
    rating: 'TV-G',
    description:
      'Over four seasons in a remote mountain valley, a small team of naturalists follows the wolves, eagles and red deer that share one river, recording how a single hard winter reshapes the lives of every animal that depends on it, from the smallest vole to the oldest stag.',
    cast: 'Narrated by Helen Marsh',
  },
  {
    title: 'The Weekend Detectives',
    year: '2023',
    runtime: '44m',
    genres: 'Crime, Comedy',
    rating: 'TV-14',
    description:
      'Three retired schoolteachers who meet every Saturday for crosswords stumble onto a real case when a library book comes back with a ransom note tucked inside. Armed with reading glasses, a minivan and a suspicious amount of free time, they set out to solve it before the police notice.',
    cast: 'Rosa Delgado, Martin Hale, Judith Kim, Owen Price',
  },
  {
    title: "The Tinker's Daughter (Director's Cut)",
    year: '2016',
    runtime: '2h 41m',
    genres: 'Adventure, Family',
    rating: 'PG',
    description:
      'When her father vanishes on the road between two feuding kingdoms, a young apprentice mechanic sets out with his unfinished clockwork bird, a stolen map and a goat who will not stop following her. Along the way she learns that the machines her father built were never meant to be toys, and that both kingdoms want them back.',
    cast: 'Ada Whitfield, Ravi Menon, Clara Svensson',
  },
  {
    title: 'Starfall Academy',
    year: '2022',
    runtime: '3 Seasons',
    genres: 'Science Fiction',
    rating: 'TV-PG',
    description:
      'At a training school on the edge of the solar system, a class of first-year pilots discovers that the academy is not preparing them for exploration at all. As the final exams approach, rival cadets must decide whether to trust the instructors who raised them or the strange signal that has started repeating their names from somewhere beyond the outer beacons, growing a little louder every night.',
    cast: 'Jonah Reyes, Priya Natarajan, Leo Fischer, Amara Osei',
  },
  {
    title: 'Copper Canyon',
    year: '2012',
    runtime: '1h 56m',
    genres: 'Western, Thriller',
    rating: 'R',
    description:
      'A disgraced surveyor takes one last job mapping a canyon claimed by three families, and finds the old boundary stones have all been moved in the same night.',
    cast: 'Wade Turner, Elena Ruiz, Sam Holloway',
  },
  {
    title: 'Moonlight Bakery',
    year: '2020',
    runtime: '1h 32m',
    genres: 'Comedy, Family',
    rating: 'G',
    description:
      "A night-shift baker who has never seen a sunrise inherits her grandmother's shop and its eccentric regulars, then has one month to win the town's pie contest or lose the building to a coffee chain.",
    cast: 'Grace Liu, Bernard Cole, Nina Patel',
  },
];
