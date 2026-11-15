// The demo video scripts: one entry per video. Edit the words here and re-run `bun run marketing:video <clip>`.
// See README.md ("Editing a video") for how a clip is put together and what each step does.
//
// Each caption is one spoken line: the narrator says it, the footage holds until they finish, and the steps after
// it play while they talk. So write a line, then the taps it describes. Coordinates are points on the iPhone 18
// Pro Max simulator (440 x 956); find them with `--probe`, or use `tapText` to tap on-screen words instead.
export type Step =
  | { tap: [number, number]; hold?: number; after?: number }
  | { tapText: string; offset?: [number, number]; after?: number } // found on screen by OCR, then nudged by offset
  | { again: true; after?: number } // the last tapText spot again, without another OCR pass
  | { swipe: [number, number, number, number]; dur: number; after?: number }
  | { type: string; after?: number }
  | { keys: number[]; after?: number } // HID keycodes, e.g. 42 = backspace
  | { wait: number }
  | { caption: string }
  | { mark: string } // names a moment for the cold open
  // Terminal clips only: typed out, then run for real against the API as @demo; `expect` must be in its output.
  | { cmd: string; expect?: string; after?: number };

export interface Clip {
  name: string;
  hook: string; // shown over the cold open
  // The payoff, shown first: `dur` seconds from the step marked `mark`, with a slow push-in.
  coldOpen: { mark: string; dur: number };
  setup?: Step[]; // runs before recording starts
  terminal?: true; // filmed in a terminal rendered here, not in the simulator
  steps: Step[];
  post: string;
  question: string; // asked in the post copy: comments are what push a video out
  tags: string;
}

export const DOCK = {
  search: [52, 862],
  binder: [136, 862],
  inventory: [220, 862],
  wanted: [304, 862],
  browse: [388, 862],
} as const;
const HEADER = { threeD: [310, 102], show: [363, 102], more: [407, 102] } as const;

export const CLIPS: Clip[] = [
  {
    name: 'kanto-3d',
    hook: "I didn't know my binder app could do this.",
    coldOpen: { mark: '3d', dur: 1.8 },
    setup: [
      // Warm the first pages' images and the 3D view off camera, so nothing loads on screen.
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 2.5 },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 2.5 },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 2.5 },
      { swipe: [60, 470, 380, 470], dur: 0.3, after: 1.0 },
      { swipe: [60, 470, 380, 470], dur: 0.3, after: 1.0 },
      { swipe: [60, 470, 380, 470], dur: 0.3, after: 1.5 },
      { tap: [...HEADER.threeD], after: 8 },
      { tap: [...HEADER.threeD], after: 2 },
    ],
    steps: [
      { caption: 'Watch. This is my Kanto binder, all from the 151 set, page by page.' },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 0.8 },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 0.8 },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 0.8 },
      { caption: 'Only ten gaps left. Now tap 3D...' },
      { tap: [...HEADER.threeD], after: 2.0 },
      { tapText: 'pages', offset: [100, -10], after: 0.8 }, // the next-page arrow; the layout moves with the page
      { mark: '3d' },
      { caption: "And it's a proper binder. Look at it! You can actually flip the pages." },
      { again: true, after: 1.0 },
      { again: true, after: 1.0 },
      { again: true, after: 1.4 },
      { caption: "Honestly, I've spent way too long doing this." },
      { again: true, after: 1.0 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'Which empty pocket would you fill first?',
    post: 'Our Kanto binder: 141 of the 151 Kanto Pokémon, every one from the 151 set, page by page and in 3D. Ten pockets to go.',
    tags: '#pokemon151 #pokemonbinder #pokemoncards #pokemontcg #kanto #pokemoncollection',
  },
  {
    name: 'national-dex',
    hook: 'I made a binder with a pocket for every single Pokémon.',
    coldOpen: { mark: 'flip', dur: 1.8 },
    setup: [
      // Open the National Dex and flip through the first pages off camera, so their cards are loaded on screen.
      { tap: [50, 151], after: 1.0 },
      { tapText: 'National Dex', after: 3.0 },
      ...Array.from({ length: 12 }, () => ({ swipe: [380, 470, 60, 470], dur: 0.25, after: 2.0 }) as Step),
      ...Array.from({ length: 12 }, () => ({ swipe: [60, 470, 380, 470], dur: 0.25, after: 0.5 }) as Step),
      { tap: [50, 151], after: 1.0 },
      { tapText: 'Kanto', after: 3.0 },
    ],
    steps: [
      { caption: "Watch. Let's open my National Dex binder." },
      { tap: [50, 151], after: 0.8 },
      { tapText: 'National Dex', after: 1.6 },
      { mark: 'flip' },
      { caption: "Every Pokémon gets its own pocket, in Dex order, so I can see exactly what I'm missing." },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.5 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.5 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.5 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.5 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.5 },
      { caption: "Prefer a list? Tap here, and every card's in one list, with prices." },
      { tap: [...DOCK.inventory], after: 1.2 },
      { swipe: [220, 780, 220, 200], dur: 0.35, after: 0.7 },
      { swipe: [220, 780, 220, 200], dur: 0.35, after: 1.4 },
      { caption: 'My wallet is not ready for this.' },
      { swipe: [220, 780, 220, 200], dur: 0.35, after: 1.0 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'Which Pokémon would you put on page one?',
    post: 'A National Dex binder in Holo Folder: a pocket for every Pokémon in Dex order, page by page or as one list with prices.',
    tags: '#nationaldex #pokemonbinder #pokemoncards #pokemontcg #livingdex #pokemoncollection',
  },
  {
    name: 'similar-look',
    hook: "I just found cards I didn't know I wanted.",
    coldOpen: { mark: 'similar', dur: 2.0 },
    steps: [
      { caption: 'Watch. Tap any card in your binder, like this Charmander, and scroll down.' },
      { tap: [78, 445], after: 1.8 },
      { swipe: [220, 760, 220, 380], dur: 0.8, after: 1.0 },
      { mark: 'similar' },
      { caption: 'Similar look finds cards with the same vibe, from every set.' },
      { swipe: [400, 700, 60, 700], dur: 0.6, after: 1.0 },
      { swipe: [400, 700, 60, 700], dur: 0.6, after: 1.2 },
      { caption: "Ooh, that one's lovely. Tap it, and I can swap it in or add it to my want list." },
      { tap: [100, 700], after: 2.4 },
      { caption: 'There goes my weekend.' },
      { wait: 0.5 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'What card should we look up next?',
    post: 'Similar look finds cards that share a card’s feel, colours and style, across every set. Tap one to swap it into the pocket or add it to your want list.',
    tags: '#pokemoncards #pokemontcg #pokemonart #illustrationrare #pokemoncollection #tcguk',
  },
  {
    name: 'binder-worth',
    hook: "I found out what my binder's actually worth.",
    coldOpen: { mark: 'value', dur: 1.8 },
    steps: [
      { caption: 'Watch. Tap the menu, then Analytics.' },
      { tap: [...HEADER.more], after: 1.0 },
      { tapText: 'Analytics', after: 2.0 },
      { mark: 'value' },
      { caption: 'Every card in my binder, priced up. Not bad at all.' },
      { wait: 1.0 },
      { caption: 'And here are the cards doing the heavy lifting. Charmander, carrying the team.' },
      { swipe: [220, 760, 220, 420], dur: 0.8, after: 1.2 },
      { caption: "And here's what filling the last few gaps would cost. Maybe next month." },
      { swipe: [220, 760, 220, 300], dur: 0.8, after: 0.8 },
      { swipe: [220, 760, 220, 300], dur: 0.8, after: 1.6 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'Guess what yours is worth?',
    post: 'What our Kanto binder is worth, worked out card by card in pounds, plus what the last ten chase cards would cost to finish it.',
    tags: '#pokemon151 #pokemoncards #pokemontcg #pokemoncollection #tcguk #pokemonbinder',
  },
  {
    name: 'card-show-hunt',
    hook: 'This app just saved me £75 at a card show.',
    coldOpen: { mark: 'deal', dur: 2.0 },
    steps: [
      {
        caption:
          "Watch. Let's flip Holo Folder into Show mode and finally get this Blastoise I've been after for ages.",
      },
      { tap: [...HEADER.show], after: 1.2 },
      { tap: [...DOCK.search], after: 1.4 },
      { swipe: [220, 680, 220, 420], dur: 0.6, after: 0.8 },
      { tapText: 'Blastoise ex', after: 1.8 }, // by name: the hunting list's order moves with prices
      { caption: 'Look at that artwork. Gorgeous.' },
      { wait: 0.3 },
      { caption: "The seller's asking £150. £150!" },
      { tap: [220, 793], after: 0.4 },
      { type: '150', after: 0.4 },
      { caption: "Holo Folder says that's way overpriced, and honestly, so does my bank." },
      { wait: 0.3 },
      { caption: "So let's try seventy-five..." },
      { keys: [42, 42, 42], after: 0.3 },
      { type: '75', after: 0.4 },
      { mark: 'deal' },
      { caption: "And yep, it's in the green. Deal!" },
      { wait: 0.3 },
      {
        caption: "Blastoise is coming home, and I've still got money left over for a few more cards from my want list.",
      },
      { wait: 0.3 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'Would you pay £150 for it?',
    post: "Card show tip: Holo Folder's Show mode keeps your want list on screen and tells you straight away how an asking price compares with the market.",
    tags: '#pokemoncardshow #pokemoncards #pokemontcg #blastoise #pokemon151 #tcguk',
  },
  {
    name: 'set-progress',
    hook: 'I finally checked how close I am to finishing 151.',
    coldOpen: { mark: 'progress', dur: 2.0 },
    steps: [
      { caption: 'Watch. Browse, Sets, and search for it.' },
      { tapText: 'Browse', after: 1.5 }, // the dock label: a fixed tap is sometimes swallowed just after launch
      { tapText: 'Sets', after: 1.0 },
      { tap: [220, 303], after: 0.6 },
      { type: '151', after: 2.0 },
      { tapText: '165 cards', after: 2.5 },
      { mark: 'progress' },
      { caption: '141 out of 207. 68 percent! Not bad.' },
      { wait: 0.5 },
      { caption: "Scroll down, and here's what the big ones are worth. Charizard, obviously." },
      { swipe: [220, 700, 220, 380], dur: 0.6, after: 1.4 },
      { caption: 'And Breakout shows which cards are climbing right now.' },
      { swipe: [220, 380, 220, 640], dur: 0.5, after: 0.8 },
      { tapText: 'Breakout', after: 1.5 },
      { swipe: [220, 700, 220, 500], dur: 0.5, after: 1.2 },
      { caption: 'Sixty-six cards to go. Send help.' },
      { wait: 0.5 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'How far through 151 are you?',
    post: 'How close our Kanto binder is to a full 151 set, which cards are worth the most, and which are climbing, all from the Sets view in Holo Folder.',
    tags: '#pokemon151 #pokemoncards #pokemontcg #setcompletion #pokemoncollection #tcguk',
  },
  {
    name: 'want-list',
    hook: 'My want list just told me what finishing my binder will cost.',
    coldOpen: { mark: 'total', dur: 2.0 },
    steps: [
      { caption: "Watch. Here's my want list." },
      { tap: [...DOCK.wanted], after: 1.5 },
      { mark: 'total' },
      { caption: 'Ten cards, and it works out roughly what the lot would cost me.' },
      { wait: 0.4 },
      { caption: "Sorted by price, and the Charizard's right at the top. Of course it is." },
      { swipe: [220, 760, 220, 420], dur: 0.7, after: 1.0 },
      { swipe: [220, 760, 220, 420], dur: 0.7, after: 1.0 },
      { caption: 'And one tap shares the whole list with a seller.' },
      { swipe: [220, 300, 220, 800], dur: 0.5, after: 0.6 },
      { swipe: [220, 300, 220, 800], dur: 0.5, after: 0.8 },
      { tapText: 'Share', after: 2.0 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'Which card is top of your want list?',
    post: 'Our want list in Holo Folder: every missing card, roughly what finishing the binder would cost, sorted by price, and one tap to share it with a seller.',
    tags: '#pokemoncards #pokemontcg #wantlist #pokemon151 #pokemoncollection #tcguk',
  },
  {
    name: 'print-placeholders',
    hook: "I printed the cards I don't have yet.",
    coldOpen: { mark: 'print', dur: 2.0 },
    steps: [
      { caption: 'Watch. Tap the menu, then Print wanted cards.' },
      { tap: [...HEADER.more], after: 1.0 },
      { tapText: 'Print wanted', after: 1.5 },
      { mark: 'print' },
      { caption: "Card-sized placeholders for every empty pocket, with the card's picture on it." },
      { wait: 0.6 },
      { caption: 'Or the ink saver version, if your printer hates you.' },
      { tapText: 'Ink saver', after: 1.4 },
      { tapText: 'Card image', after: 0.8 },
      { caption: "Print, cut, slide them into a sleeve, and you'll never forget what you're hunting." },
      { wait: 0.6 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'Would you print placeholders for your gaps?',
    post: 'Holo Folder prints card-sized placeholders for every empty pocket in your binder, to slide into a penny sleeve until you find the real card.',
    tags: '#pokemonbinder #pokemoncards #pokemontcg #pokemoncollection #pokemon151 #binder',
  },
  {
    name: 'binder-studio',
    hook: 'I gave my binder a full makeover.',
    coldOpen: { mark: 'studio', dur: 2.0 },
    steps: [
      { caption: 'Watch. Tap the menu, then Binder Studio.' },
      { tap: [...HEADER.more], after: 1.0 },
      { tapText: 'Binder Studio', after: 1.5 },
      { caption: "It's a proper 3D binder. Front, back, spine, and inside, with all my pockets." },
      { tapText: 'Back', after: 1.2 },
      { tapText: 'Spine', after: 1.2 },
      { tapText: 'Inside', after: 1.6 },
      { tapText: 'Front', after: 1.0 },
      { caption: 'Now the fun bit. Presets.' },
      { tapText: 'Presets', after: 1.2 },
      { caption: 'Magikarp? Bit much.' },
      { tapText: 'Magikarp', offset: [0, -45], after: 1.4 },
      { caption: "Mew. Yes. That's the one." },
      { tapText: 'Mew', offset: [0, -45], after: 1.2 },
      { mark: 'studio' },
      { caption: 'And you can add your own lettering and artwork too.' },
      { swipe: [220, 760, 220, 520], dur: 0.6, after: 1.0 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'Which cover would you pick?',
    post: 'Binder Studio in Holo Folder: a 3D binder you can dress up with cover presets, colours, lettering and your own artwork.',
    tags: '#pokemonbinder #pokemoncards #pokemontcg #pokemoncollection #mew #binder',
  },
  {
    name: 'search-everything',
    hook: 'I can find any card in my collection in two seconds.',
    coldOpen: { mark: 'found', dur: 2.0 },
    steps: [
      { caption: 'Watch. Tap Search, and type Charizard.' },
      { tapText: 'Search', after: 1.2 },
      { type: 'charizard', after: 1.5 },
      { mark: 'found' },
      { caption: 'Every Charizard card, right there.' },
      { swipe: [220, 760, 220, 520], dur: 0.6, after: 0.8 },
      { caption: "Tap Missing, for the ones I haven't got." },
      { tapText: 'Missing', after: 1.2 },
      { caption: "Wanted, for the ones I'm hunting." },
      { tapText: 'Wanted', after: 1.2 },
      { caption: "And Upgrades, for pockets where I'd still like a better card." },
      { tapText: 'Upgrades', after: 1.2 },
      { caption: "That's my evening sorted." },
      { wait: 0.5 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'What card would you search first?',
    post: 'Search in Holo Folder finds any card, set or artist, and filters it down to what is missing, wanted or worth upgrading in your binder.',
    tags: '#pokemoncards #pokemontcg #charizard #pokemoncollection #pokemonbinder #tcguk',
  },
  {
    name: 'api-deal-check',
    hook: "I checked a card's price from my terminal.",
    coldOpen: { mark: 'deal', dur: 2.0 },
    terminal: true,
    steps: [
      { caption: "Watch. Holo Folder has a developer API. Let's find that Blastoise from the 151 set." },
      {
        cmd: `curl -s \\\n  "$HF/cards?q=blastoise+ex+sir" \\\n  -H "Authorization: Bearer $HF_KEY" \\\n  | jq '.data[0] | {id, name, set: .set.name}'`,
        expect: 'sv03.5-200',
        after: 1.2,
      },
      { caption: "Now, the seller wants £150. Let's ask." },
      {
        cmd: `curl -s "$HF/deals/check" \\\n  -H "Authorization: Bearer $HF_KEY" \\\n  -d '{"cardId": "sv03.5-200",\n       "askingPrice": 150,\n       "currency": "GBP",\n       "language": "en"}' \\\n  | jq '.verdict.label'`,
        expect: 'Walk away',
        after: 0.6,
      },
      { caption: "Walk away! Way over. So let's try £75..." },
      {
        cmd: `curl -s "$HF/deals/check" \\\n  -H "Authorization: Bearer $HF_KEY" \\\n  -d '{"cardId": "sv03.5-200",\n       "askingPrice": 75,\n       "currency": "GBP",\n       "language": "en"}' \\\n  | jq '.verdict.label'`,
        expect: 'Fair price',
        after: 0.3,
      },
      { mark: 'deal' },
      { caption: 'Fair price. Deal!' },
      { wait: 0.3 },
      { caption: "And there's an MCP server too, so AI assistants can do all of this for you." },
      { wait: 0.3 },
      { caption: "Holo Folder. Link's in the bio." },
      { wait: 0.5 },
    ],
    question: 'What would you build with it?',
    post: 'Holo Folder has a developer API and an MCP server: look up any card, check an asking price against the market, or manage your binders from your own scripts and AI tools. Docs at holofolder.com/app/docs.',
    tags: '#pokemoncards #pokemontcg #api #developer #mcp #pokemon151',
  },
];
