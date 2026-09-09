/* ============================================================================
   THE FIELD INTERVIEW — prompt catalogue for Ch.11 (Partner Dossier)

   Transcribed from "A Little World About Them — A personal profile guide for
   a partner-focused website", the six-part questionnaire this chapter's
   interview section is built on. The document's own running order is
   preserved: Who They Are → Their Favorites → Their Personality → Their
   Memories → Their Dreams → Us.

   Prompt wording is kept VERBATIM from that document, American spellings and
   all. It is the subject's own source material, not app chrome, so it is not
   re-voiced to match the rest of the UI.

   ⚠️ PROMPT IDS ARE POSITIONAL — `<volume>-<index>`. An answer in
   `partner_vault` is keyed by that id, so REORDERING OR REMOVING A PROMPT
   SILENTLY REASSIGNS SOMEBODY'S ANSWER TO A DIFFERENT QUESTION. Only ever
   append to the end of a volume. If a prompt must be retired, blank its text
   rather than splicing it out, and filter it at render time.
   ========================================================================== */

export interface InterviewPrompt {
  id: string;
  q: string;
  /** Render as a textarea rather than a single line. */
  long: boolean;
}

export interface InterviewVolume {
  id: string;
  roman: string;
  title: string;
  kicker: string;
  /** Emoji marker for the divider tab. */
  mark: string;
  prompts: InterviewPrompt[];
}

/* Open-ended prompts want room to write; "Shoe size" does not. Decided from
   the shape of the question rather than tagged by hand across 269 entries. */
const LONG_STARTS = [
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "something",
  "a memory",
  "do they",
  "if ",
  "one thing",
  "one word",
  "three words",
];

function isLong(q: string): boolean {
  const lower = q.toLowerCase();
  if (LONG_STARTS.some((s) => lower.startsWith(s))) return true;
  /* A trailing question mark on a short either/or ("Stubborn?") is still a
     one-liner; only genuinely open questions get the bigger box. */
  return q.length > 46;
}

function volume(
  id: string,
  roman: string,
  title: string,
  kicker: string,
  mark: string,
  questions: string[]
): InterviewVolume {
  return {
    id,
    roman,
    title,
    kicker,
    mark,
    prompts: questions.map((q, i) => ({ id: `${id}-${i}`, q, long: isLong(q) })),
  };
}

export const INTERVIEW_VOLUMES: InterviewVolume[] = [
  volume("who", "I", "Who They Are", "THE BASICS ON RECORD", "🪪", [
    "Full name",
    "Preferred name",
    "Nicknames",
    "Nicknames they love",
    "Nicknames they dislike",
    "Birthday",
    "Age",
    "Birthplace",
    "Hometown",
    "Current city",
    "Zodiac sign",
    "Birthstone",
    "Favorite number",
    "Favorite letter",
    "Height",
    "Shoe size",
    "Clothing size",
    "Dominant hand",
    "Languages spoken",
    "Three words that describe them",
    "Three words you would use to describe them",
    "Fun fact",
    "Random fact",
    "Current obsession",
    "Something people often misunderstand about them",
  ]),

  volume("fav", "II", "Their Favorites", "EVERY LAST ONE OF THEM", "⭐", [
    "Favorite color",
    "Favorite color combination",
    "Favorite food",
    "Favorite cuisine",
    "Favorite restaurant",
    "Favorite fast food",
    "Favorite snack",
    "Favorite dessert",
    "Favorite cake",
    "Favorite ice cream flavor",
    "Favorite chocolate",
    "Favorite candy",
    "Favorite chips",
    "Favorite fruit",
    "Favorite drink",
    "Usual coffee order",
    "Favorite flower",
    "Favorite animal",
    "Favorite dog breed",
    "Favorite cat breed",
    "Favorite smell",
    "Favorite perfume/cologne",
    "Favorite season",
    "Favorite weather",
    "Favorite time of day",
    "Favorite day of the week",
    "Favorite month",
    "Favorite holiday",
    "Favorite artist",
    "Favorite singer",
    "Favorite band",
    "Favorite music genre",
    "Favorite song",
    "Current song on repeat",
    "All-time favorite song",
    "Favorite album",
    "Favorite love song",
    "Favorite sad song",
    "Favorite happy song",
    "Song that reminds them of you",
    "Favorite lyric",
    "Favorite movie",
    "Favorite movie genre",
    "Favorite TV show",
    "Favorite series",
    "Favorite anime",
    "Favorite cartoon",
    "Favorite animated movie",
    "Favorite fictional character",
    "Favorite villain",
    "Favorite hero",
    "Favorite fictional couple",
    "Movie they could rewatch forever",
    "Show they could rewatch forever",
    "Favorite video game",
    "Favorite game character",
    "Favorite hobby",
    "Favorite sport",
    "Favorite outdoor activity",
    "Favorite indoor activity",
    "Favorite thing to do when bored",
    "Favorite thing to do alone",
    "Favorite thing to do with friends",
    "Favorite thing to do with you",
    "Favorite clothing style",
    "Favorite outfit",
    "Favorite shoes",
    "Favorite bag",
    "Favorite accessory",
    "Favorite jewelry",
    "Gold or silver?",
    "Favorite aesthetic",
    "Favorite emoji",
    "Most-used emoji",
    "Favorite meme",
    "Favorite social media app",
    "Favorite app",
    "Favorite website",
    "Favorite YouTuber/creator",
  ]),

  volume("per", "III", "Their Personality", "HOW THEY ARE WIRED", "🧠", [
    "Biggest strength",
    "Biggest weakness",
    "Best quality",
    "Worst habit",
    "Best habit",
    "Weirdest habit",
    "Biggest pet peeve",
    "Biggest fear",
    "Biggest irrational fear",
    "Biggest motivation",
    "Biggest dream",
    "Biggest insecurity",
    "Something they are proud of",
    "Something they are currently improving",
    "Something they wish people understood about them",
    "What instantly makes them happy?",
    "What instantly makes them angry?",
    "What instantly makes them sad?",
    "What always makes them laugh?",
    "What makes them feel safe?",
    "What makes them feel loved?",
    "What makes them feel appreciated?",
    "What makes them feel confident?",
    "What makes them uncomfortable?",
    "Introvert or extrovert?",
    "Morning person or night owl?",
    "Spontaneous or organized?",
    "Emotional or logical?",
    "Competitive?",
    "Stubborn?",
    "Patient?",
    "Do they overthink?",
    "Do they get attached easily?",
    "Do they forgive easily?",
    "Do they hold grudges?",
    "Do they trust people easily?",
    "How do they react when stressed?",
    "How do they react when angry?",
    "How do they react when sad?",
    "How do they react when excited?",
    "How do they handle conflict?",
    "How do they handle criticism?",
    "What makes them feel understood?",
    "What makes them feel emotionally close to someone?",
    "What values matter most to them?",
  ]),

  volume("mem", "IV", "Their Memories", "BEFORE YOU, AND WITH YOU", "📼", [
    "Favorite childhood memory",
    "Funniest childhood memory",
    "Most embarrassing childhood memory",
    "Favorite childhood toy",
    "Favorite stuffed animal",
    "Favorite childhood food",
    "Favorite childhood snack",
    "Favorite childhood show",
    "Favorite childhood movie",
    "Favorite childhood cartoon",
    "Favorite childhood game",
    "Favorite childhood song",
    "Favorite childhood hobby",
    "Favorite childhood place",
    "Favorite childhood friend",
    "Childhood dream job",
    "Favorite school memory",
    "Favorite school subject",
    "Favorite teacher",
    "First celebrity crush",
    "First fictional crush",
    "First concert",
    "Favorite trip they've taken",
    "Favorite place they've visited",
    "Place they want to revisit",
    "Most nostalgic song",
    "Most nostalgic movie",
    "A memory that always makes them smile",
    "A memory they wish they could relive",
    "Favorite memory with you",
    "Funniest memory with you",
    "Sweetest memory with you",
    "Most embarrassing memory with you",
    "Favorite date you've had",
    "Favorite place you've gone together",
    "Favorite photo together",
    "Favorite photo of you",
    "Favorite meal you've shared",
    "Favorite ordinary moment with you",
  ]),

  volume("drm", "V", "Their Dreams", "WHERE THEY ARE HEADED", "🌠", [
    "Biggest life dream",
    "Biggest life goal",
    "Career goal",
    "Financial goal",
    "Personal goal",
    "Relationship goal",
    "Family goal",
    "Dream job",
    "Dream business",
    "Dream home",
    "Dream car",
    "Dream city",
    "Dream country",
    "Dream vacation",
    "Dream travel destination",
    "Bucket-list experience",
    "Skill they want to master",
    "Something they've always wanted to do",
    "Something they want to accomplish before 25",
    "Something they want to accomplish before 30",
    "Where they would live if money didn't matter",
    "What they would do if they didn't need to work",
    "What success means to them",
    "What happiness means to them",
    "What kind of life they want to build",
    "What they want their future to look like",
    "What they want people to remember about them",
    "What advice they would give their younger self",
    "What they want their future self to remember",
  ]),

  volume("us", "VI", "Us", "THE PART THAT IS BOTH OF YOU", "🕸️", [
    "When did we first meet?",
    "Where did we first meet?",
    "What was their first impression of you?",
    "What was your first impression of them?",
    "Who made the first move?",
    "Who fell first?",
    "When did they realize they liked you?",
    "What was the first thing they noticed about you?",
    "What was the first thing they liked about you?",
    "What made them fall for you?",
    "What is their favorite thing about you?",
    "Favorite thing about your personality",
    "Favorite physical feature of yours",
    "Something you do that makes them smile",
    "Something you do that they find cute",
    "Something you do that annoys them",
    "Favorite nickname you give them",
    "Favorite nickname they give you",
    "Favorite thing you say",
    "Favorite message you've sent them",
    "Favorite gift you've given them",
    "Favorite gift they've given you",
    "Favorite song associated with your relationship",
    "Your song",
    "Color that represents your relationship",
    "Aesthetic that represents your relationship",
    "Favorite memory together",
    "Favorite date",
    "Favorite place together",
    "Favorite photo together",
    "Favorite thing you do together",
    "Favorite way to spend time together",
    "Favorite type of affection",
    "Their love language",
    "How they like to receive affection",
    "How they like to give affection",
    "What makes them feel loved by you?",
    "What makes them feel appreciated by you?",
    "What makes them feel reassured by you?",
    "What do they value most about your relationship?",
    "What makes your relationship different?",
    "Something they hope never changes about you two",
    "Something they want you to experience together",
    "Dream date with you",
    "Dream trip together",
    "Something they want you both to do more often",
    "One thing they are grateful for about your relationship",
    "If your relationship were a song, what would it be?",
    "If your relationship were a movie, what would it be?",
    "If your relationship were a color, what would it be?",
    "If they could relive one moment with you, which one?",
    "One word they would use to describe your relationship",
  ]),
];

export const ALL_PROMPTS: InterviewPrompt[] = INTERVIEW_VOLUMES.flatMap((v) => v.prompts);

export const TOTAL_PROMPTS = ALL_PROMPTS.length;

/** Volume id → prompt id → prompt, for cheap lookup when rendering answers. */
export const PROMPT_BY_ID: Record<string, InterviewPrompt> = Object.fromEntries(
  ALL_PROMPTS.map((p) => [p.id, p])
);

export function volumeOfPrompt(promptId: string): InterviewVolume | undefined {
  const volId = promptId.split("-")[0];
  return INTERVIEW_VOLUMES.find((v) => v.id === volId);
}
