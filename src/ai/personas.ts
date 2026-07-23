import type { GameState, Move } from '../engine/types';
import { fromAlg, fileOf, rankOf, sq, offsetOf } from '../engine/board';
import { legalMoves } from '../engine/legal';
import { chooseBotMove } from './bot';
import type { BotLevel } from './bot';

export type QuipEvent =
  | 'start'
  | 'botCaptures'
  | 'botLosesPiece'
  | 'corrosionSpawns'
  | 'corrosionKills'
  | 'check'
  | 'botWins'
  | 'botLoses'
  | 'idle';

export interface PersonaOpening {
  /** [fromAlg, toAlg] pairs, expressed in 8x8 algebraic coordinates. Scanned
   * in order; translated to the live board size (see choosePersonaMove)
   * before being checked against legalMoves. */
  prefs: [string, string][];
  /** Probability of consulting the opening book at all on a given turn. */
  prob: number;
}

export interface Persona {
  id: string;
  name: string;
  rating: number;
  tagline: string;
  avatar: string; // 'avatars/<id>.png'
  level: BotLevel;
  blunderChance: number; // probability of playing a uniform-random legal move
  evalNoiseNote?: string; // documented, implemented via blunderChance only in v1
  opening?: PersonaOpening;
  quips: Record<QuipEvent, string[]>;
  /** UI grouping for the selection screen (not part of the plan's literal
   * interface, but the cheapest way to let botselect.ts render "Family &
   * Pets" vs "The Bobs" vs "Coach" without re-deriving it from id/name
   * string shape). */
  group: 'family' | 'bob' | 'coach';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * Piecewise strength curve used for every Bob (and Joe): rating <=200 plays
 * at level 1 (already uniform-random, so blunderChance is moot and left at
 * 0); 201-900 is level 2 with blunderChance sliding 0.4 -> 0.05; above 900 is
 * level 3 with blunderChance sliding 0.05 -> 0 as rating approaches the
 * game's ~2000 ceiling.
 */
export function paramsForRating(rating: number): { level: BotLevel; blunderChance: number } {
  if (rating <= 200) return { level: 1, blunderChance: 0 };
  if (rating <= 900) {
    const t = clamp01((rating - 201) / (900 - 201));
    return { level: 2, blunderChance: lerp(0.4, 0.05, t) };
  }
  const t = clamp01((rating - 901) / (2000 - 901));
  return { level: 3, blunderChance: lerp(0.05, 0, t) };
}

// Translates an 8x8-algebraic square to the live board: same file/rank offset
// by offsetOf(size) in both directions. Identity on the 8x8 board itself
// (offsetOf(8) === 0), so a single code path covers both board sizes rather
// than hardcoding an 8x8 book and a separate 12x12 book.
function translateSquare(alg: string, size: number): number {
  const s8 = fromAlg(alg, 8);
  const off = offsetOf(size);
  return sq(fileOf(s8, 8) + off, rankOf(s8, 8) + off, size);
}

/**
 * Chooses a persona's move for `state`. Order of decision:
 * 1. Opening book: if `p.opening` is set and `rng() < prob`, scan `prefs` in
 *    order (translated to the live board size) and play the first pair
 *    that's currently legal.
 * 2. Blunder: else if `rng() < blunderChance`, play a uniform-random legal
 *    move.
 * 3. Else defer to the frozen engine bot at the persona's level.
 */
export function choosePersonaMove(state: GameState, p: Persona, rng: () => number = Math.random): Move {
  const legal = legalMoves(state);

  if (p.opening && rng() < p.opening.prob) {
    for (const [fromAlgStr, toAlgStr] of p.opening.prefs) {
      const from = translateSquare(fromAlgStr, state.size);
      const to = translateSquare(toAlgStr, state.size);
      const match = legal.find(m => m.from === from && m.to === to);
      if (match) return match;
    }
  }

  if (rng() < p.blunderChance) {
    const idx = Math.min(Math.floor(rng() * legal.length), legal.length - 1);
    return legal[idx];
  }

  return chooseBotMove(state, p.level, rng);
}

export function pickQuip(p: Persona, ev: QuipEvent, rng: () => number = Math.random): string {
  const lines = p.quips[ev];
  const idx = Math.min(Math.floor(rng() * lines.length), lines.length - 1);
  return lines[idx];
}

// --- Family & Pets --------------------------------------------------------

const TOBY_BASE = paramsForRating(100); // level 1
const BELLA_BASE = paramsForRating(250); // level 2 (blunderChance overridden per table)
const MOM_BASE = paramsForRating(250);
const DAD_BASE = paramsForRating(2000);
const ADDIE_BASE = paramsForRating(700);
const THEO_BASE = paramsForRating(1300); // level 3 (blunderChance overridden per table)

const TOBY: Persona = {
  id: 'toby',
  name: 'Toby',
  rating: 100,
  tagline: 'Obsessed with treats',
  avatar: 'avatars/toby.png',
  level: TOBY_BASE.level,
  blunderChance: 0.2, // table override: "L1 (random) + 20% pure-random override"
  group: 'family',
  quips: {
    start: ['Woof! Is this treat-flavored chess?', 'Sniffing out the best move...', 'Ready to fetch some pawns!'],
    botCaptures: ['Got it! Like catching a treat!', 'Yoink! Mine now.', 'Snack time for Toby!'],
    botLosesPiece: ['Aw, dropped my treat.', 'Ruff, lost that one.', 'Was that piece made of bacon? No? Dang.'],
    corrosionSpawns: ['Ooh, weird purple bone.', 'Something smells... rusty.', 'Is that edible? No? Okay.'],
    corrosionKills: ['Whoa, the rust ate it!', 'That corrosion has teeth!', 'Bad rust! No treat for you!'],
    check: ['Check! Like a squirrel alert!', "Uh oh, king's cornered!", 'Is your king stuck up a tree?'],
    botWins: ['Good boy! I mean, good game!', 'Victory treats for everyone!', 'Toby wins! Tail wagging intensifies.'],
    botLoses: ['Aw, ruff game.', "I'll get the next treat -- I mean game.", 'Good game, human!'],
    idle: ['Is the rook made of bacon?', '*sniffs board thoughtfully*', 'So many squares, so few treats.'],
  },
};

const BELLA: Persona = {
  id: 'bella',
  name: 'Bella',
  rating: 250,
  tagline: "Obsessed with the four-move checkmate",
  avatar: 'avatars/bella.png',
  level: BELLA_BASE.level,
  blunderChance: 0.35,
  group: 'family',
  opening: {
    prob: 0.85,
    prefs: [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['d1', 'h5'],
      ['d8', 'f6'],
      ['f1', 'c4'],
      ['f8', 'c5'],
      ['h5', 'f7'],
      ['f6', 'f2'],
    ],
  },
  quips: {
    start: ["Four moves. That's all I need.", "Watch closely, this won't take long.", "Scholar's mate incoming!"],
    botCaptures: ["Right on schedule!", "That's the plan working perfectly.", "Piece of cake, literally."],
    botLosesPiece: ["Fine, minor detour.", "Still four moves from glory.", "A sacrifice for the greater mate."],
    corrosionSpawns: ["Cute, but I'm still faster.", "Rust can't stop the four-move plan.", "Ignoring that, mate's still coming."],
    corrosionKills: ["Ha! The rust does my dirty work.", "Even corrosion respects the plan.", "One less obstacle to my mate."],
    check: ["Check! Four moves, remember?", "Told you this was fast.", "Almost there!"],
    botWins: ["Scholar's mate! Every time!", "Four moves. Called it.", "Bella wins again -- shocking, I know."],
    botLoses: ["Okay, FIVE moves would've worked.", "Rare miscalculation. Rematch!", "You got lucky this time."],
    idle: ["Plotting move three already.", "Qh5 is a beautiful square.", "Everyone underestimates the fork."],
  },
};

const MOM: Persona = {
  id: 'mom',
  name: 'Mom',
  rating: 250,
  tagline: 'Obsessed with gardening and flowers',
  avatar: 'avatars/mom.png',
  level: MOM_BASE.level,
  blunderChance: 0.35,
  group: 'family',
  quips: {
    start: ["Let's tend this little garden of a board.", 'Time to plant some strategy.', 'Every game blooms differently, dear.'],
    botCaptures: ['Weeded that one out!', 'Pruned right on schedule.', 'That piece needed trimming.'],
    botLosesPiece: ['Oh, lost a bloom there.', 'Even gardens have setbacks, sweetie.', 'That one wilted a bit early.'],
    corrosionSpawns: ["Careful, dear, that patch looks rusty.", "That's not the good kind of mulch.", 'Hm, some odd growth over there.'],
    corrosionKills: ['The rust took care of the weeds for me.', "Nature's pruning, I suppose.", 'That corrosion is quite the gardener.'],
    check: ["Careful, your king's pruning is showing.", 'Check, dear -- mind the thorns.', 'Your king needs better shelter.'],
    botWins: ['Your pawns needed pruning, dear.', 'A lovely harvest today!', 'The garden blooms in my favor.'],
    botLoses: ['Well, even the best gardens have frost.', 'You out-bloomed me today, dear.', "I'll fertilize my strategy for next time."],
    idle: ['Your pawns need pruning, dear.', 'This board could use more flowers.', 'Thinking about my tulips, mostly.'],
  },
};

const DAD: Persona = {
  id: 'dad',
  name: 'Dad',
  rating: 2000,
  tagline: 'Likes to talk about chess',
  avatar: 'avatars/dad.png',
  level: DAD_BASE.level,
  blunderChance: DAD_BASE.blunderChance,
  group: 'family',
  quips: {
    start: ["You know, in '92 I almost went pro.", 'Let me tell you about the Sicilian sometime.', 'Ready when you are, kiddo.'],
    botCaptures: ['Textbook capture, if I do say so.', "That's Reti-approved, I think.", 'Nice and clean, just like the books say.'],
    botLosesPiece: ['Ah, a classic blunder. Learning experience!', 'Even Capablanca had off days.', "That's a story for the car ride home."],
    corrosionSpawns: ["Now THIS wasn't in my chess book.", "Corrosion, huh? Wish I'd read about that.", 'New variant, same old dad jokes.'],
    corrosionKills: ['Well, the rust called that one.', "Didn't see that in any opening theory.", "That's one way to simplify the position."],
    check: ["Check! Just like Fischer would've called it.", "Careful now, that's a real threat.", 'King safety, son. Always king safety.'],
    botWins: ['Checkmate! Just like I drew it up.', "Now THAT'S a game for the scrapbook.", "Good game -- let's talk about it over dinner."],
    botLoses: ["Well played! I'll study up for next time.", 'Guess I need to reread my chess book.', 'Good game, good game -- rematch soon?'],
    idle: ['Did I ever tell you about my college chess club?', 'Thinking... thinking... thinking...', 'Chess is really a metaphor for life, you know.'],
  },
};

const ADDIE: Persona = {
  id: 'addie',
  name: 'Addie',
  rating: 700,
  tagline: 'Likes to talk about candy and sweets',
  avatar: 'avatars/addie.png',
  level: ADDIE_BASE.level,
  blunderChance: 0.1,
  evalNoiseNote: 'Table specifies evalNoise +/-0.5; implemented via blunderChance only in v1.',
  group: 'family',
  quips: {
    start: ['Winner gets a lollipop!', 'I had TWO cupcakes before this game.', 'These pieces look like chocolates. Yum.'],
    botCaptures: ['Got one! Sweet as candy.', 'Snatched it like the last gummy bear.', 'That piece? Mine now. Like sprinkles.'],
    botLosesPiece: ['Hey! That was my caramel piece!', "It's okay, I still have my candy stash.", 'You owe me a jellybean for that.'],
    corrosionSpawns: ['Ooh, is that green frosting? ...No? Ew.', 'That is NOT candy. Do not lick it.', 'Looks like spilled soda. Fizzy!'],
    corrosionKills: ['The goo ate it like I eat gumdrops!', 'Whoa. Not sweet at all.', 'That square is sour. SUPER sour.'],
    check: ['Check! Your king is in a candy trap!', 'Uh oh, your king is stuck like taffy!', 'Careful! Sticky spot for your king!'],
    botWins: ['I win! Ice cream to celebrate!', 'Sweet, sweet victory. Like literally.', 'Winner winner, candy for dinner!'],
    botLoses: ['Aw. I need a cookie now.', 'Good game! Split a chocolate bar with me?', "Okay, rematch after my snack break."],
    idle: ['Thinking... about marshmallows.', 'Does the queen like licorice?', 'This would go faster with a milkshake.'],
  },
};

const THEO: Persona = {
  id: 'theo',
  name: 'Theo',
  rating: 1300,
  tagline: 'Likes gaming and treats',
  avatar: 'avatars/theo.png',
  level: THEO_BASE.level,
  blunderChance: 0.03,
  group: 'family',
  quips: {
    start: ["GG, let's queue this up!", 'Loading strategy... plus snacks.', 'Ready player Theo!'],
    botCaptures: ['Clutch capture, no cap.', "That's a sick combo!", 'EZ capture, GG.'],
    botLosesPiece: ['Ugh, lag spike or something.', "That's a rage-quit-worthy loss, almost.", 'Gone. RIP that piece.'],
    corrosionSpawns: ['Whoa, new debuff spawned!', 'Is that a status effect?', 'New mechanic unlocked: rust.'],
    corrosionKills: ['Corrosion got a kill streak!', "That's an environmental kill, nice.", 'RNG corrosion, absolutely savage.'],
    check: ["Check! That's a jump scare.", "King's getting third-partied!", 'Careful, that\'s basically a boss fight.'],
    botWins: ['GG EZ! Victory royale!', 'Clutch win, add to highlight reel.', 'Theo wins -- someone clip that!'],
    botLoses: ['GG, well played. Rematch?', 'Okay that was a real boss fight.', 'Respect, that was a good match.'],
    idle: ['Thinking... like picking a loadout.', 'Is there a snack break option?', 'Calculating my next big play.'],
  },
};

const KESTONY_BASE = paramsForRating(2400); // level 3, blunderChance 0 -- used as-is, no override

const KESTONY: Persona = {
  id: 'kestony',
  name: 'Coach Kestony',
  rating: 2400,
  tagline: 'Your toughest lesson yet',
  avatar: 'avatars/kestony.png',
  level: KESTONY_BASE.level,
  blunderChance: KESTONY_BASE.blunderChance,
  group: 'coach',
  quips: {
    start: ["Fundamentals first. Let's see what you've got.", 'This is your toughest lesson yet.', 'No shortcuts. We drill, then we play.', "Set up right, or don't set up at all."],
    botCaptures: ["Textbook. That's what preparation looks like.", 'Good technique. That capture was earned.', 'See? Fundamentals win games.', "Clean take. We'll review why it worked."],
    botLosesPiece: ["Even coaches drop a piece sometimes. Moving on.", "Noted. We'll review this later.", "That one's on me. Reset and refocus.", 'Small setback. The lesson continues.'],
    corrosionSpawns: ["Corrosion safety briefing: don't stand on the spawn square.", 'New hazard on the board. Adjust and adapt.', 'Treat that square like out of bounds.', 'Rule one of corrosion: respect the spawn.'],
    corrosionKills: ["That's why we teach corrosion safety.", 'Lesson learned the hard way -- for you.', "Should've read the safety briefing.", 'Textbook case of ignoring the hazard.'],
    check: ['Check. King safety is lesson one for a reason.', "That's your cue to protect the king. Always.", 'Drill this: check means act now.', 'King safety. We covered this.'],
    botWins: ['Checkmate. Fundamentals, every time.', "That's the lesson: preparation wins games.", 'Class dismissed. Good effort out there.', 'Textbook win. Take notes.'],
    botLoses: ['Well played. You earned that one.', "Good game. We'll review this later.", "That's real progress. Nice work.", 'You beat the coach. Respect.'],
    idle: ['Reviewing fundamentals in my head.', 'Patience. Every square has a purpose.', "We'll go over this one after the game.", 'Thinking three moves ahead, like always.'],
  },
};

export const FAMILY_PERSONAS: Persona[] = [TOBY, BELLA, MOM, DAD, ADDIE, THEO, KESTONY];

// --- The Bobs --------------------------------------------------------------

// Deadpan pool shared by every Bob -- identical personality is the joke.
const BOB_LINES = {
  intro: ['I\'m Bob.', 'Bob move.'],
  captures: ['Bob captures.'],
  loses: ['Rust happens.', 'This is fine.'],
  spawns: ['Rust happens.'],
  check: ['Check. Bob noticed.'],
  wins: ['Bob wins.'],
  loss: ['Bob loses. Bob is fine.'],
  idle: ['I\'m Bob.', 'Bob move.', 'This is fine.'],
} as const;

const BOB_QUIPS: Record<QuipEvent, string[]> = {
  start: [...BOB_LINES.intro],
  botCaptures: [...BOB_LINES.captures],
  botLosesPiece: [...BOB_LINES.loses],
  corrosionSpawns: [...BOB_LINES.spawns],
  corrosionKills: [...BOB_LINES.loses],
  check: [...BOB_LINES.check],
  botWins: [...BOB_LINES.wins],
  botLoses: [...BOB_LINES.loss],
  idle: [...BOB_LINES.idle],
};

const BOB_RATINGS = [150, 400, 600, 800, 1000, 1200, 1500, 2000];

function makeBob(rating: number): Persona {
  const { level, blunderChance } = paramsForRating(rating);
  return {
    id: `bob${rating}`,
    name: 'Bob',
    rating,
    tagline: "I'm Bob.",
    avatar: `avatars/bob${rating}.png`,
    level,
    blunderChance,
    group: 'bob',
    quips: BOB_QUIPS,
  };
}

const JOE_QUIPS: Record<QuipEvent, string[]> = {
  start: ["It's Joe. JOE.", 'Not a Bob. Repeat: not a Bob.', "Let's play -- and yes, I said Joe."],
  botCaptures: ['Joe takes it. Not Bob. Joe.', "Ha! Called it -- Joe's move.", "That's how Joe does it."],
  botLosesPiece: ['Even Joe has off days.', 'Ugh. Still not a Bob though.', 'Lost a piece, kept my identity.'],
  corrosionSpawns: ['There are so many Bobs, but only one rust patch.', 'New corrosion, still just Joe here.', 'Interesting -- and no, still not Bob.'],
  corrosionKills: ['The rust got one. Joe approves.', "Nice, corrosion did Joe's job for him.", "That'll teach it -- signed, Joe."],
  check: ["Check! And it's Joe who called it.", 'Careful -- Joe sees the threat.', 'That\'s check, from Joe, not a Bob.'],
  botWins: ['Joe wins! Not Bob! JOE!', 'Victory for Joe -- somebody tell the Bobs.', 'That\'s a win for the one and only Joe.'],
  botLoses: ['Lost the game, kept my name.', 'Good game. Still Joe, though.', 'Joe loses one, but never his identity.'],
  idle: ['There are so many Bobs.', 'Thinking, as Joe does.', 'Just Joe over here, plotting.'],
};

function makeJoe(): Persona {
  const { level, blunderChance } = paramsForRating(550);
  return {
    id: 'joe550',
    name: 'Joe',
    rating: 550,
    tagline: "There are so many Bobs.",
    avatar: 'avatars/joe550.png',
    level,
    blunderChance,
    group: 'bob',
    quips: JOE_QUIPS,
  };
}

// Ascending by rating, Joe (550) inserted between bob400 and bob600.
export const BOB_ARMY_PERSONAS: Persona[] = (() => {
  const joeIdx = BOB_RATINGS.findIndex(r => r > 550);
  const bobs = BOB_RATINGS.map(makeBob);
  bobs.splice(joeIdx, 0, makeJoe());
  return bobs;
})();

export const PERSONAS: Persona[] = [...FAMILY_PERSONAS, ...BOB_ARMY_PERSONAS];
