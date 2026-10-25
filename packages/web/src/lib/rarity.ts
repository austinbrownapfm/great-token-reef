// Rarity pill colours shared by the Collection and Inventory tabs.
export const RARITY_PILL: Record<string, string> = {
  common: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  uncommon: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  rare: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  epic: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  legendary: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
};

/** Rarities a tank fish can have (legendaries never swim), rarest first. */
export const RARITIES = ['epic', 'rare', 'uncommon', 'common'] as const;
