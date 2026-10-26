// The Reef Dex v2 — real-species catalog (approved 2026-08-27, roster review
// in docs/reef-dex-roster.md, art direction in the "Reef Dex" artifact).
//
// 48 real species × real variant entries = 256 catalog slots. Entry index IS
// the `species` column in cc_catches — indices are permanent. Rarity is
// explicit per entry (real color morphs ARE the rarity ladder); pigment
// morphs recolor the species' standard palette deterministically.

import { ENTRIES, type CatalogEntryData } from './fishCatalogEntries.ts';

export type Water = 'fresh' | 'salt' | 'anadromous';

export interface Palette {
  back: string;
  mid: string;
  belly: string;
  fin: string;
  mark: string;
  accent?: string;
  iris?: string;
  pupil?: string;
  bar?: string;
  edge?: string;
}

export interface FishSpeciesDef {
  name: string;
  sci: string;
  water: Water;
  plan: string;
  planOpts?: Record<string, unknown>;
  palette: Palette;
  /** Field marks — the one-liner shown in the collection detail. */
  marks: string;
  /** Typical adult total length in cm (rays: disc width); drives relative tank size. */
  lengthCm: number;
  /** One true, plain-language fact shown on the tank plaque. */
  fact: string;
}

export type MorphRecolor =
  | 'pale' | 'dark' | 'melanistic' | 'golden' | 'piebald' | 'leucistic' | 'albino';

export { ENTRIES, type CatalogEntryData };

// ---------------------------------------------------------------------------
// The 48 species. Order is permanent (ENTRIES references by index).

export const SPECIES_DEFS: FishSpeciesDef[] = [
  { name: 'Largemouth Bass', sci: 'Micropterus nigricans', water: 'fresh', plan: 'bass',
    palette: { back: '#3d5a2f', mid: '#6c8f4b', belly: '#e8e6c8', fin: '#55703d', mark: '#26331c', iris: '#c9a23c' },
    marks: 'Jaw hinge extends past the eye; broken dark lateral blotch-stripe; notched spiny-then-soft dorsal.',
    lengthCm: 40, fact: 'Males sweep out a nest on the bottom and guard the eggs and newly hatched fry for weeks.' },
  { name: 'Smallmouth Bass', sci: 'Micropterus dolomieu', water: 'fresh', plan: 'bass', planOpts: { vbars: true },
    palette: { back: '#5a4a2c', mid: '#8a6f42', belly: '#e9dfc4', fin: '#6d5a35', mark: '#33291a', iris: '#c94f2e' },
    marks: 'Bronze flanks with faint vertical bars; red eye; jaw stops below the eye.',
    lengthCm: 35, fact: 'Prefers cooler, clearer, rockier lakes and streams than its largemouth cousin.' },
  { name: 'Bluegill', sci: 'Lepomis macrochirus', water: 'fresh', plan: 'panfish',
    palette: { back: '#3f5d46', mid: '#6d8f68', belly: '#cfd3ae', fin: '#4e6b52', mark: '#22301f', accent: '#d9772f' },
    marks: 'Deep plate-shaped body; black opercular ear flap; dusky vertical bars; rusty-orange breast.',
    lengthCm: 19, fact: 'Males build saucer-shaped nests side by side in shallow colonies and guard the eggs.' },
  { name: 'Pumpkinseed', sci: 'Lepomis gibbosus', water: 'fresh', plan: 'panfish',
    palette: { back: '#4a6247', mid: '#7d9a62', belly: '#e3d9a8', fin: '#5a7350', mark: '#2a3620', accent: '#e08a3c' },
    marks: 'Sunfish disc speckled orange and olive; ear flap with a red crescent edge.',
    lengthCm: 15, fact: 'Strong throat teeth let it crush snail shells, one of its favorite foods.' },
  { name: 'Black Crappie', sci: 'Pomoxis nigromaculatus', water: 'fresh', plan: 'panfish', planOpts: { speckles: true },
    palette: { back: '#4b5a50', mid: '#8fa08f', belly: '#e8ead8', fin: '#5d6f61', mark: '#22281f' },
    marks: 'Silvery panfish stippled with irregular black flecks; big dorsal and anal fins nearly mirror-imaged.',
    lengthCm: 25, fact: 'Feeds most at dawn, dusk and night, often schooling around sunken brush and timber.' },
  { name: 'Yellow Perch', sci: 'Perca flavescens', water: 'fresh', plan: 'bass', planOpts: { vbars: true },
    palette: { back: '#6b7c3a', mid: '#c9b34a', belly: '#f2e9c0', fin: '#d9832f', mark: '#3f4522' },
    marks: 'Brassy gold flanks with bold dark vertical bars; orange lower fins.',
    lengthCm: 20, fact: 'Females lay their eggs in long, jelly-like ribbons draped over plants and branches.' },
  { name: 'Walleye', sci: 'Sander vitreus', water: 'fresh', plan: 'bass',
    palette: { back: '#5c6236', mid: '#a89a55', belly: '#efe6c2', fin: '#6d6b3a', mark: '#2f321c', iris: '#d8c66a' },
    marks: 'Olive-gold torpedo; huge glassy reflective eye; white tip on the lower tail lobe.',
    lengthCm: 50, fact: 'A reflective layer behind the retina, like a cat’s, lets it hunt well in dim light.' },
  { name: 'Northern Pike', sci: 'Esox lucius', water: 'fresh', plan: 'pike',
    palette: { back: '#3a5230', mid: '#5f7d43', belly: '#d9dcb8', fin: '#4c6636', mark: '#26361e', bar: '#d7e0a8' },
    marks: 'Duckbill snout; dorsal set far back by the tail; rows of light bean-shaped spots on dark green.',
    lengthCm: 50, fact: 'An ambush hunter of weedy shallows, found across North America, Europe and Asia.' },
  { name: 'Muskellunge', sci: 'Esox masquinongy', water: 'fresh', plan: 'pike',
    palette: { back: '#4f5a38', mid: '#8a935c', belly: '#e5e3c0', fin: '#5c6840', mark: '#2e351f', bar: '#33391f' },
    marks: 'Pike-shaped but light-bodied with dark markings (the pike’s negative); pointed tail lobes.',
    lengthCm: 90, fact: 'Nicknamed “the fish of 10,000 casts” because it is so hard to catch.' },
  { name: 'Channel Catfish', sci: 'Ictalurus punctatus', water: 'fresh', plan: 'catfish',
    palette: { back: '#4c5a66', mid: '#7d8b95', belly: '#dfe4e6', fin: '#5b6974', mark: '#39434c' },
    marks: 'Barbels; scaleless blue-grey skin; scattered small dark spots; deeply forked tail.',
    lengthCm: 55, fact: 'Taste buds cover its whole body, so it can find food by taste in muddy water.' },
  { name: 'Blue Catfish', sci: 'Ictalurus furcatus', water: 'fresh', plan: 'catfish', planOpts: { nospots: true },
    palette: { back: '#47586b', mid: '#82929f', belly: '#e2e7ea', fin: '#56626e', mark: '#333d47' },
    marks: 'Slate-blue, unspotted, humped back ahead of the dorsal; deeply forked tail.',
    lengthCm: 75, fact: 'The largest North American catfish; the record fish weighed 143 lb (65 kg).' },
  { name: 'Flathead Catfish', sci: 'Pylodictis olivaris', water: 'fresh', plan: 'catfish', planOpts: { flat: true },
    palette: { back: '#5c5233', mid: '#8f7d47', belly: '#e8d9a8', fin: '#6a5f3a', mark: '#362f1c' },
    marks: 'Flattened shovel head with underbite; mottled yellow-brown; squared tail.',
    lengthCm: 65, fact: 'Unlike most catfish, adults eat almost only live prey, mainly other fish.' },
  { name: 'Common Carp', sci: 'Cyprinus carpio', water: 'fresh', plan: 'carp',
    palette: { back: '#6b5a2e', mid: '#a8863e', belly: '#ead9b0', fin: '#7d6a38', mark: '#453a1e', accent: '#c99a4a' },
    marks: 'Heavy golden-bronze body with big round scales; tall sawtoothed dorsal; downturned barbeled mouth.',
    lengthCm: 45, fact: 'Native to Europe and Asia and farmed for food for centuries; koi were bred from carp.' },
  { name: 'Rainbow Trout', sci: 'Oncorhynchus mykiss', water: 'fresh', plan: 'salmonid', planOpts: { band: true },
    palette: { back: '#55693f', mid: '#c7d2c8', belly: '#f4f6f0', fin: '#8a9878', mark: '#262a1e', accent: '#e0708f' },
    marks: 'Pink lateral band cheek-to-tail; black speckling over back, dorsal, and tail; adipose fin.',
    lengthCm: 45, fact: 'Native to Pacific-draining waters, it has been stocked on every continent but Antarctica.' },
  { name: 'Brook Trout', sci: 'Salvelinus fontinalis', water: 'fresh', plan: 'salmonid', planOpts: { lightSpots: true },
    palette: { back: '#3d4f38', mid: '#6b7a52', belly: '#f0e0c0', fin: '#d9632e', mark: '#e8d9a0', accent: '#e8a04a' },
    marks: 'Dark back with light worm-track vermiculation; red-orange lower fins edged in white.',
    lengthCm: 25, fact: 'Actually a char, not a true trout; it needs cold, clean, oxygen-rich water.' },
  { name: 'Brown Trout', sci: 'Salmo trutta', water: 'fresh', plan: 'salmonid', planOpts: { redSpots: true },
    palette: { back: '#6b5a30', mid: '#b39a5c', belly: '#f2e8c8', fin: '#7d6a3a', mark: '#2e2814', accent: '#c9452e' },
    marks: 'Buttery brown flanks with haloed red and black spots; square tail.',
    lengthCm: 40, fact: 'Native to Europe, western Asia and North Africa; first brought to the US in the 1880s.' },
  { name: 'Lake Sturgeon', sci: 'Acipenser fulvescens', water: 'fresh', plan: 'sturgeon',
    palette: { back: '#55565c', mid: '#8a8b90', belly: '#d9dadc', fin: '#64656b', mark: '#3a3b40' },
    marks: 'Prehistoric: shovel snout with four barbels; rows of bony scutes; shark-like tail.',
    lengthCm: 140, fact: 'Can live more than 100 years, and females often do not spawn until age 20 or older.' },
  { name: 'American Eel', sci: 'Anguilla rostrata', water: 'fresh', plan: 'eel',
    palette: { back: '#4a5236', mid: '#7d8455', belly: '#e0ddb8', fin: '#565e3c', mark: '#2c3120' },
    marks: 'Serpentine; one continuous fin ribbon from back around the tail; olive-yellow.',
    lengthCm: 60, fact: 'Hatches in the Sargasso Sea and drifts to North American rivers; adults return there to spawn.' },
  { name: 'Alligator Gar', sci: 'Atractosteus spatula', water: 'fresh', plan: 'gar',
    palette: { back: '#4a5638', mid: '#7a8a55', belly: '#dcdcb8', fin: '#586446', mark: '#2c341e' },
    marks: 'Long toothy alligator snout; armored diamond scales; fins set far back.',
    lengthCm: 180, fact: 'A lung-like swim bladder lets it gulp air, so it survives in warm, low-oxygen water.' },
  { name: 'Chinook Salmon', sci: 'Oncorhynchus tshawytscha', water: 'anadromous', plan: 'salmonid',
    palette: { back: '#4a5a68', mid: '#9aa8b0', belly: '#eef0f0', fin: '#5c6a76', mark: '#22282e' },
    marks: 'Chrome king salmon; black spots on back and BOTH tail lobes; black gumline.',
    lengthCm: 85, fact: 'The largest Pacific salmon; the record fish weighed 126 lb (57 kg).' },
  { name: 'Sockeye Salmon', sci: 'Oncorhynchus nerka', water: 'anadromous', plan: 'salmonid',
    palette: { back: '#4c5c66', mid: '#a8b4b8', belly: '#f0f2f2', fin: '#5c6a72', mark: '#262c30' },
    marks: 'Sleek and nearly spotless ocean silver; famous crimson spawning dress.',
    lengthCm: 55, fact: 'Young sockeye usually spend one to three years in a lake before heading to sea.' },
  { name: 'Atlantic Salmon', sci: 'Salmo salar', water: 'anadromous', plan: 'salmonid',
    palette: { back: '#4c5f6b', mid: '#b0bcc2', belly: '#f2f4f4', fin: '#5e6e7a', mark: '#242a30' },
    marks: 'The leaper: silver with sparse X-shaped black spots; slim tail wrist.',
    lengthCm: 75, fact: 'Unlike Pacific salmon, it can survive spawning; some return to sea and come back to spawn again.' },
  { name: 'Striped Bass', sci: 'Morone saxatilis', water: 'anadromous', plan: 'bass', planOpts: { hstripes: true },
    palette: { back: '#47555f', mid: '#a8b4ba', belly: '#eef1f2', fin: '#56636d', mark: '#2b333b' },
    marks: 'Seven or eight unbroken dark horizontal stripes on silver flanks.',
    lengthCm: 75, fact: 'Lives at sea but swims up East Coast rivers to spawn; landlocked stocks thrive in reservoirs.' },
  { name: 'Red Drum', sci: 'Sciaenops ocellatus', water: 'salt', plan: 'heavy', planOpts: { tailSpot: true },
    palette: { back: '#8a5638', mid: '#c98a5c', belly: '#f2e0c8', fin: '#9a6540', mark: '#4a2e1c', accent: '#d9a06a' },
    marks: 'Coppery red-bronze; black ocellated spot at the upper tail base.',
    lengthCm: 70, fact: 'Named for the drumming sound it makes by vibrating muscles against its swim bladder.' },
  { name: 'Atlantic Cod', sci: 'Gadus morhua', water: 'salt', plan: 'heavy', planOpts: { chinBarbel: true, triDorsal: true },
    palette: { back: '#6b5f3a', mid: '#a89566', belly: '#e9e0c2', fin: '#766a42', mark: '#3d3520', bar: '#e8ddb8' },
    marks: 'Three rounded dorsal fins; single chin barbel; pale curved lateral line over mottled olive.',
    lengthCm: 80, fact: 'Overfishing collapsed the cod stocks off Newfoundland, leading to a fishing ban in 1992.' },
  { name: 'Pacific Halibut', sci: 'Hippoglossus stenolepis', water: 'salt', plan: 'flatfish',
    palette: { back: '#5a5240', mid: '#8a8060', belly: '#e0dcc8', fin: '#665e48', mark: '#363022' },
    marks: 'Huge diamond flatfish; both eyes on the dark side; white underside.',
    lengthCm: 120, fact: 'Hatches upright with an eye on each side; one eye migrates over the head as it grows.' },
  { name: 'Summer Flounder', sci: 'Paralichthys dentatus', water: 'salt', plan: 'flatfish',
    palette: { back: '#6b5e42', mid: '#9a8a62', belly: '#e8e2cc', fin: '#776a4c', mark: '#3a3424' },
    marks: 'Left-eyed fluke; ocellated eye-spots scattered over a sand-mimic body.',
    lengthCm: 40, fact: 'Changes color to match the seafloor, then buries itself in sand to ambush prey.' },
  { name: 'Yellowfin Tuna', sci: 'Thunnus albacares', water: 'salt', plan: 'pelagic',
    palette: { back: '#24455f', mid: '#9fb3bd', belly: '#eef2f2', fin: '#37525f', mark: '#22394a', accent: '#ecc43f' },
    marks: 'Sickle-shaped yellow second dorsal and anal fins; yellow finlets to a crescent tail.',
    lengthCm: 150, fact: 'Often schools with dolphins in the eastern Pacific, which led to “dolphin-safe” tuna labels.' },
  { name: 'Atlantic Bluefin Tuna', sci: 'Thunnus thynnus', water: 'salt', plan: 'pelagic',
    palette: { back: '#1f3a55', mid: '#8fa5b5', belly: '#eaf0f2', fin: '#2e4a5f', mark: '#1c3145', accent: '#7d8a94' },
    marks: 'Massive steel-blue torpedo; short pectorals; dusky (not yellow) fins.',
    lengthCm: 200, fact: 'Keeps its body warmer than the surrounding water, so it can hunt in cold seas.' },
  { name: 'Mahi-Mahi', sci: 'Coryphaena hippurus', water: 'salt', plan: 'mahi',
    palette: { back: '#2e7a5c', mid: '#7dc93e', belly: '#f2e88a', fin: '#3a8a5c', mark: '#26512e', accent: '#ecd43f' },
    marks: 'Blunt vertical bull forehead; electric green-gold; single dorsal running the whole back.',
    lengthCm: 100, fact: 'Also called dolphinfish or dorado, though it is not related to dolphins at all.' },
  { name: 'Swordfish', sci: 'Xiphias gladius', water: 'salt', plan: 'billfish', planOpts: { swordLong: true },
    palette: { back: '#3a4a5c', mid: '#8f9aa5', belly: '#e8ecee', fin: '#46586a', mark: '#26323e' },
    marks: 'Flat broadsword bill; tall crescent dorsal; no pelvic fins; keeled tail wrist.',
    lengthCm: 300, fact: 'A special heater organ warms its eyes and brain, sharpening its vision in cold, deep water.' },
  { name: 'Blue Marlin', sci: 'Makaira nigricans', water: 'salt', plan: 'billfish',
    palette: { back: '#26456b', mid: '#8fa8bd', belly: '#eef2f4', fin: '#2e4a66', mark: '#1c3550', bar: '#9db8d0' },
    marks: 'Round spear bill; cobalt back with faint pale vertical bars; pointed dorsal.',
    lengthCm: 300, fact: 'Females grow much larger than males; the biggest top 1,000 lb (450 kg).' },
  { name: 'Sailfish', sci: 'Istiophorus platypterus', water: 'salt', plan: 'billfish', planOpts: { sail: true },
    palette: { back: '#2e4a66', mid: '#90a8ba', belly: '#eef2f4', fin: '#3a5a7d', mark: '#203850', bar: '#a5bdd2' },
    marks: 'The huge speckled sail dorsal; slim bill; body bars that light up neon when hunting.',
    lengthCm: 250, fact: 'Hunts sardines in groups, slashing its bill through the school to stun and injure prey.' },
  { name: 'Great Barracuda', sci: 'Sphyraena barracuda', water: 'salt', plan: 'pike', planOpts: { snout: 'barracuda' },
    palette: { back: '#4c5a62', mid: '#a5b1b6', belly: '#eef1f2', fin: '#5a6870', mark: '#2e3a40' },
    marks: 'Chrome torpedo with an underbite of visible teeth; scattered dark blotches low on the flank.',
    lengthCm: 100, fact: 'Large ones can carry ciguatera toxin, so eating them can make people sick.' },
  { name: 'Red Snapper', sci: 'Lutjanus campechanus', water: 'salt', plan: 'heavy',
    palette: { back: '#a53f30', mid: '#d97a5c', belly: '#f6e3d0', fin: '#b04a36', mark: '#5c241a' },
    marks: 'Rose-red all over with a pale belly; pointed anal fin; red eye.',
    lengthCm: 60, fact: 'Can live more than 50 years; gathers around reefs, wrecks and oil platforms.' },
  { name: 'Goliath Grouper', sci: 'Epinephelus itajara', water: 'salt', plan: 'heavy', planOpts: { grouper: true },
    palette: { back: '#6b5c3a', mid: '#9a8756', belly: '#e3d9b8', fin: '#776440', mark: '#3a3220' },
    marks: 'Vast round-tailed grouper; mottled brown-gold with small dark spots; enormous mouth.',
    lengthCm: 200, fact: 'Can top 360 kg (800 lb); protected from harvest in US waters since 1990.' },
  { name: 'Ocellaris Clownfish', sci: 'Amphiprion ocellaris', water: 'salt', plan: 'reef',
    palette: { back: '#ef8f2f', mid: '#f29c3e', belly: '#f7ae56', fin: '#f29c3e', mark: '#1d1a16', bar: '#fbf7ee', edge: '#1d1a16' },
    marks: 'Three white bars edged in black; every fin rimmed black.',
    lengthCm: 8, fact: 'Born male; when a group’s female dies, the largest male changes sex to replace her.' },
  { name: 'Blue Tang', sci: 'Paracanthurus hepatus', water: 'salt', plan: 'reef', planOpts: { tang: true },
    palette: { back: '#2456b8', mid: '#3a77d4', belly: '#6aa3e8', fin: '#ecd43f', mark: '#16214a', accent: '#ecd43f' },
    marks: 'Royal blue with the black painter’s-palette flank marking; yellow tail.',
    lengthCm: 25, fact: 'A surgeonfish: a sharp, scalpel-like spine at the base of its tail is its defense.' },
  { name: 'Emperor Angelfish', sci: 'Pomacanthus imperator', water: 'salt', plan: 'reef', planOpts: { angel: true },
    palette: { back: '#2e4a8a', mid: '#4a6ab0', belly: '#8aa3cc', fin: '#ecc43f', mark: '#1a2a55', bar: '#ecd45c' },
    marks: 'Diagonal yellow-on-blue stripes; black eye mask; trailing dorsal tip.',
    lengthCm: 30, fact: 'Juveniles look like a different fish, with white rings on navy, until they mature.' },
  { name: 'Stoplight Parrotfish', sci: 'Sparisoma viride', water: 'salt', plan: 'wrasse',
    palette: { back: '#2e8a72', mid: '#4ab08a', belly: '#a8dcc0', fin: '#3a9a7d', mark: '#1c5040', accent: '#e07a5c', bar: '#d9e8b0' },
    marks: 'Beak mouth; emerald body with a yellow tail-base spot and pink cheek crescent.',
    lengthCm: 35, fact: 'Scrapes algae off coral and rock with its beak, grinding it up and passing it out as fine sand.' },
  { name: 'Humphead Wrasse', sci: 'Cheilinus undulatus', water: 'salt', plan: 'wrasse', planOpts: { hump: true },
    palette: { back: '#2e7a8a', mid: '#4aa3a8', belly: '#a8d9d0', fin: '#3a8a94', mark: '#1c4a52' },
    marks: 'Forehead hump; thick lips; maze of fine facial squiggles on teal.',
    lengthCm: 100, fact: 'Endangered; one of the few predators that eats toxic crown-of-thorns starfish.' },
  { name: 'Red Lionfish', sci: 'Pterois volitans', water: 'salt', plan: 'lionfish',
    palette: { back: '#8a3a2e', mid: '#c9705c', belly: '#f2dcc8', fin: '#a5462e', mark: '#4a1f16', bar: '#f2e3d0' },
    marks: 'Fan of long venomous dorsal spines; huge banded wing-like pectorals; maroon candy stripes.',
    lengthCm: 30, fact: 'Native to the Indo-Pacific, it has become a damaging invasive species in the Atlantic and Caribbean.' },
  { name: 'Porcupine Pufferfish', sci: 'Diodon holocanthus', water: 'salt', plan: 'puffer',
    palette: { back: '#8a7a4a', mid: '#c9b380', belly: '#f2ecd0', fin: '#9a8a56', mark: '#3a3220' },
    marks: 'Round body covered in spines; huge eyes; dark blotches; comically small fins.',
    lengthCm: 25, fact: 'Gulps water to swell into a spiky ball when threatened, too big for most predators to swallow.' },
  { name: 'Green Moray', sci: 'Gymnothorax funebris', water: 'salt', plan: 'eel', planOpts: { moray: true },
    palette: { back: '#3a6b3a', mid: '#5c9a4a', belly: '#b8d9a0', fin: '#468046', mark: '#22401f' },
    marks: 'Thick uniform-green eel; gaping toothy jaw; fin ribbon head to tail.',
    lengthCm: 180, fact: 'Its skin is actually brown; a yellow mucus coating makes it look green.' },
  { name: 'Blacktip Reef Shark', sci: 'Carcharhinus melanopterus', water: 'salt', plan: 'shark', planOpts: { blacktip: true },
    palette: { back: '#5a6b78', mid: '#9aacb8', belly: '#eef2f4', fin: '#66788a', mark: '#2e3a44', edge: '#16202a' },
    marks: 'Black tips on first dorsal, pectorals, and tail; hard countershading line; five gill slits.',
    lengthCm: 160, fact: 'Often cruises over shallow reef flats, sometimes with its dorsal fin above the surface.' },
  { name: 'Scalloped Hammerhead', sci: 'Sphyrna lewini', water: 'salt', plan: 'shark', planOpts: { hammer: true },
    palette: { back: '#62707c', mid: '#a3b1bc', belly: '#edf1f3', fin: '#6e7e8c', mark: '#323e48' },
    marks: 'The cephalofoil hammer head with eyes at the tips; tall first dorsal.',
    lengthCm: 250, fact: 'Forms large daytime schools around seamounts and islands such as the Galápagos.' },
  { name: 'Giant Manta Ray', sci: 'Mobula birostris', water: 'salt', plan: 'ray',
    palette: { back: '#22282e', mid: '#3a444c', belly: '#e8ecee', fin: '#2c343c', mark: '#161c22', bar: '#d9e0e4' },
    marks: 'Gliding diamond wings; forward cephalic lobes framing a square mouth; white shoulder patches.',
    lengthCm: 450, fact: 'Has one of the largest brain-to-body size ratios of any fish.' },
  { name: 'Lined Seahorse', sci: 'Hippocampus erectus', water: 'salt', plan: 'seahorse',
    palette: { back: '#c9a03a', mid: '#e0bc5c', belly: '#f2e0a8', fin: '#d0aa46', mark: '#6b5220', bar: '#f6ecd0' },
    marks: 'Upright horse profile; tubular snout and coronet; bony body rings; curled tail.',
    lengthCm: 12, fact: 'The male carries the eggs in a brood pouch and gives birth to the young.' },
];

// ---------------------------------------------------------------------------
// Curated morph palettes — real forms whose look a generic recolor can't
// produce. Keyed `${speciesName}|${morphLabel}`. Partial: merged over the
// species' standard palette. Morphs absent here use the entry's `rc` recolor
// or the standard palette (juveniles/trophies differ by size, not color).

export const MORPH_PALETTES: Record<string, Partial<Palette>> = {
  'Largemouth Bass|Smoke Gray': { back: '#4a545c', mid: '#7d868c', belly: '#e8eaec', fin: '#5a646c', mark: '#2e363c' },
  'Rainbow Trout|Steelhead': { back: '#5c707d', mid: '#c9d4da', belly: '#f4f7f8', fin: '#8a98a3', accent: '#e090a8' },
  'Rainbow Trout|Blue Morph': { back: '#3e5a77', mid: '#9ab4c9', belly: '#eef4f8', fin: '#4e6a85', accent: '#a8c0d4' },
  'Rainbow Trout|Palomino (Golden)': { back: '#e0a832', mid: '#f2cc5c', belly: '#fdf6dc', fin: '#e8b644', accent: '#f0876a', mark: '#8a6420' },
  'Walleye|Blue Morph': { back: '#46607d', mid: '#8aa3ba', belly: '#eef3f6', fin: '#52698a', mark: '#2a3a4c' },
  'Northern Pike|Silver Pike': { back: '#5c6a72', mid: '#a8b4ba', belly: '#eef1f2', fin: '#6a7880', bar: '#dce4e8', mark: '#3a464e' },
  'Muskellunge|Clear': { back: '#5a6640', mid: '#a3ab72', belly: '#eceada', fin: '#68744a', mark: '#5a6640' },
  'Muskellunge|Tiger Musky': { back: '#6b6234', mid: '#b3a355', belly: '#ece5c2', fin: '#77713e', mark: '#1f2416' },
  'Common Carp|Ghost Carp': { back: '#9aa0a3', mid: '#cdd3d4', belly: '#f4f6f6', fin: '#a8aeb0', mark: '#6a7275', accent: '#dce2e2' },
  'Common Carp|Kohaku Koi': { back: '#f4f0ea', mid: '#f8f4ee', belly: '#fdfbf6', fin: '#f0e8de', mark: '#d0342c', accent: '#d0342c' },
  'Common Carp|Yamabuki Ogon Koi': { back: '#e8c23a', mid: '#f2d65c', belly: '#fbf2cc', fin: '#ecc848', mark: '#a3831f', accent: '#f6e088' },
  'Brook Trout|Spawning Male': { back: '#2e4232', mid: '#5c6e48', belly: '#e8622e', fin: '#e05020', mark: '#f0dca8', accent: '#f2a03a' },
  'Brown Trout|Sea Trout': { back: '#5c6a72', mid: '#b8c2c8', belly: '#f2f4f5', fin: '#6a7880', accent: '#3a3428' },
  'Brown Trout|Ferox': { back: '#42381e', mid: '#77683c', belly: '#d9cfa8', fin: '#4e4426', accent: '#8a2e1f' },
  'Chinook Salmon|Spawning': { back: '#5a4436', mid: '#8a6250', belly: '#c9a890', fin: '#66503e', mark: '#2a2018' },
  'Sockeye Salmon|Spawning Crimson': { back: '#a32222', mid: '#c93a2e', belly: '#d96a4a', fin: '#3e5a3a', mark: '#2a4028' },
  'American Eel|Glass Eel': { back: '#c8cfc2', mid: '#e0e5da', belly: '#f6f8f2', fin: '#ced4c8', mark: '#9aa394' },
  'American Eel|Silver': { back: '#5a6670', mid: '#a3b0b8', belly: '#eef1f3', fin: '#68747e', mark: '#333d45' },
  'Atlantic Cod|Red Rock': { back: '#8a4a2e', mid: '#bd7a4a', belly: '#f0dcc2', fin: '#96552f', mark: '#4a2818' },
  'Summer Flounder|Sandy': { back: '#a39272', mid: '#c9bb9a', belly: '#f2ecd9', fin: '#af9e7c', mark: '#6b5e42' },
  'Mahi-Mahi|Lit-Up Chartreuse': { back: '#2ea3b8', mid: '#a3e83a', belly: '#f8f0a3', fin: '#3ab0a3', accent: '#f6e83a' },
  'Blue Marlin|Lit-Up Neon': { back: '#1a55a3', mid: '#6aa3d9', belly: '#eaf3fa', fin: '#2262b0', bar: '#7dd4f0' },
  'Sailfish|Lit-Up Neon': { back: '#225a9a', mid: '#7dabd0', belly: '#eaf3fa', fin: '#2e6ab0', bar: '#8adcf2' },
  'Ocellaris Clownfish|Black (Darwin)': { back: '#1f1d1a', mid: '#2c2926', belly: '#3e3a35', fin: '#2c2926', bar: '#fbf7ee' },
  'Ocellaris Clownfish|Snowflake': { back: '#f0a03e', mid: '#f2ac50', belly: '#f6bc6a', bar: '#fefcf6' },
  'Ocellaris Clownfish|Platinum': { back: '#eceff1', mid: '#f4f6f7', belly: '#fbfcfd', fin: '#e8ebed', bar: '#ffffff' },
  'Blue Tang|Yellow-Belly (Indian Ocean)': { belly: '#ecd43f' },
  'Emperor Angelfish|Ringed Juvenile': { back: '#141c46', mid: '#1f2a5c', belly: '#3a477d', fin: '#2a3566', bar: '#f0f4f8', mark: '#0c1230' },
  'Emperor Angelfish|Transitional': { back: '#22366b', mid: '#33508f', belly: '#5c74a8', bar: '#e8dc7d' },
  'Stoplight Parrotfish|Red': { back: '#8a4438', mid: '#b06452', belly: '#e0c2a8', fin: '#96503e', mark: '#4a221a', bar: '#e8d0b8' },
  'Stoplight Parrotfish|Supermale': { back: '#1f8a7d', mid: '#2eb89a', belly: '#a3e8cc', accent: '#f2555c', bar: '#f6e83a' },
  'Red Lionfish|Dark Deepwater': { back: '#4a1f1a', mid: '#77352c', belly: '#c9a08a', fin: '#5c2620', bar: '#d9bfa8' },
  'Lined Seahorse|Sunburst Gold': { back: '#f0b422', mid: '#f8cf4a', belly: '#fdf0b8', fin: '#f4c032', bar: '#fef8dc' },
};

/** Per-entry body-plan option overrides, keyed `${speciesName}|${morphLabel}`. */
export const MORPH_PLAN_OPTS: Record<string, Record<string, unknown>> = {
  'Porcupine Pufferfish|Puffed Up': { inflated: true },
  'Common Carp|Mirror Carp': { scales: 'mirror' },
  'Common Carp|Leather Carp': { scales: 'none' },
  'Common Carp|Kohaku Koi': { scales: 'mirror' },
};

// ---------------------------------------------------------------------------
// Deterministic recolors for the universal pigment morphs.

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
}

/** Mix hex color toward target by t (0..1). */
function mix(hex: string, target: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(target.slice(1), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

function shade(hex: string, dl: number, ds = 0): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, Math.min(1, Math.max(0, s + ds)), Math.min(1, Math.max(0, l + dl)));
}

function toGold(hex: string): string {
  const [, s, l] = hexToHsl(hex);
  return hslToHex(42, Math.max(0.55, Math.min(0.85, s + 0.25)), Math.min(0.88, l + 0.08));
}

const mapColors = (p: Palette, f: (hex: string) => string): Palette => {
  const out = { ...p };
  for (const k of ['back', 'mid', 'belly', 'fin', 'mark', 'accent', 'bar', 'edge'] as const) {
    const v = out[k];
    if (v) out[k] = f(v);
  }
  return out;
};

export function applyRecolor(p: Palette, rc: MorphRecolor): Palette {
  switch (rc) {
    case 'pale': return mapColors(p, (c) => shade(c, 0.14, -0.18));
    case 'dark': return mapColors(p, (c) => shade(c, -0.14, -0.05));
    case 'melanistic': {
      const out = mapColors(p, (c) => mix(c, '#1a1d20', 0.72));
      out.belly = mix(p.belly, '#3a4044', 0.7);
      return out;
    }
    case 'golden': {
      const out = mapColors(p, toGold);
      out.belly = '#f8eec8';
      out.mark = mix(p.mark, '#8a6a1f', 0.7);
      return out;
    }
    case 'piebald': return mapColors(p, (c) => mix(c, '#f2efe8', 0.55));
    case 'leucistic': {
      const out = mapColors(p, (c) => mix(c, '#f4f1ea', 0.82));
      out.mark = mix(p.mark, '#f4f1ea', 0.6);
      return out;
    }
    case 'albino': {
      const out = mapColors(p, (c) => mix(c, '#f8ece6', 0.9));
      out.mark = mix(p.mark, '#e8cfc6', 0.85);
      out.iris = '#d24a4a';
      out.pupil = '#8c1f1f';
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry resolution.

export interface ResolvedEntry {
  def: FishSpeciesDef;
  entry: CatalogEntryData;
  name: string;
  palette: Palette;
  planOpts: Record<string, unknown>;
}

export function resolveEntry(index: number): ResolvedEntry {
  const entry = ENTRIES[index]!;
  const def = SPECIES_DEFS[entry.s]!;
  const key = entry.m ? `${def.name}|${entry.m}` : '';
  let palette: Palette = { ...def.palette, ...(key ? MORPH_PALETTES[key] : undefined) };
  if (entry.rc && !(key && MORPH_PALETTES[key])) palette = applyRecolor(palette, entry.rc);
  const planOpts = { ...def.planOpts, ...(key ? MORPH_PLAN_OPTS[key] : undefined) };
  const name = entry.m ? `${entry.m} ${def.name}` : def.name;
  return { def, entry, name, palette, planOpts };
}
