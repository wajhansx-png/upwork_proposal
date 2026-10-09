/**
 * Fixed rules from "GiveLife Foundation: Case Text Writing Guide".
 * Reference lines are for style only: the AI must not copy them, and the app checks that it did not.
 */
import type { CaseType } from "./types";

export const PAY_NUMBER = "03097458815";
export const PAY_BLOCK = ["⚠️ Takes only 10 seconds", `📲 ${PAY_NUMBER} — Easypaisa/JazzCash`, "Wajdan Khan — GiveLife Foundation"];
export const PAY_SHORT = `${PAY_NUMBER} - Easypaisa/Jazzcash - Wajdan Khan (foundation account)`;
export const PROOF_ASK = "*Please send a screenshot when you do your part.*";
export const SIGN_OFF = "- Wajdan Khan Team - Givelife Foundation";
export const RETURN_LINE = "_Allah promises to multiply what you give. No bank gives that return._";
export const DIVIDER = "___________";

/** One verse or hadith per post, always with its reference. 5:32 is the Qur'an, never "The Prophet ﷺ said". */
export const VERSES = [
  "\"Who will lend Allah a good loan, so He may multiply it many times?\" — Qur'an 2:245",
  "Allah says in the Qur'an: \"Whoever saves one life, it is as if he has saved all of mankind.\" (5:32)",
  "\"Whoever relieves a believer's hardship, Allah will relieve his hardship on the Day of Judgement.\" — Muslim",
  "\"Save yourself from hellfire, even with half a date in charity.\" — Bukhari",
  "\"Sadqa extinguishes sin as water extinguishes fire.\" — Tirmidhi",
];

/** Words that sound like begging or a form (Part 9). */
export const BANNED = /\b(?:kindly|request(?:ing)? you|generous|contribution|needy)\b/i;
/** Time words: only allowed when the case has a real deadline (Part 10, check 4). */
export const DEADLINE_WORDS = /\b(?:\d+\s*hours?|hours? left|tonight only|by \d{1,2}\s*(?:am|pm)\b|by (?:today|tomorrow|tonight)|within \d+|\d+\s*days? left|only \d+\s*(?:days?|hours?))/i;
/** Strong claims: allowed only when the same word is in the facts the manager gave (Part 10, check 5). */
export const CLAIM_WORDS = /\b(?:die|dies|dying|death|dead|ventilator|last[- ]stage|critical|amputat\w*|cut (?:off|them|it)|remov\w*|paraly\w*|blind\w*|coma|cancer|surgery|operation|hours?|days?|weeks?|months?|tonight|today|tomorrow|bp|oxygen)\b/gi;

export const TYPE_LABEL: Record<CaseType, string> = {
  child: "Sick child",
  adult: "Sick adult or elder",
  death: "Death / janazah",
  orphans: "Orphans / family lost the earner",
  needs: "Basic needs (fan, ration, rent)",
};

/** Real trigger lines from older cases (Part 15). Shown to the AI as style; never to be copied. */
export const REFERENCE: Record<CaseType, string[]> = {
  child: [
    "This is not about money. This is about a child keeping his LEG or losing it. You decide.",
    "We could ask you to donate. But Affan needs more than money right now — he needs his hand and leg saved.",
    "Helpless Affan is bleeding inside, and blood is collecting in his knee and hand.",
    "A 12-year-old boy is fighting for his life.",
    "If you're seeing this, this is someone's son. Someone's life.",
    "Right now, tonight, a small child cannot sleep. Deep wounds cover his ear, his head, his arm, his chest.",
    "His father is a daily-wage labourer. He cannot pay for even one test.",
    "He was born eight weeks early.",
  ],
  adult: [
    "A mother's kidney is failing. She can't afford the surgery.",
    "She has been in pain for 5 months. She stayed quiet — the way mothers do.",
    "Everything is ready. Tests are done. Only money is missing.",
    "You woke up this Sunday. Adnan woke up with no legs.",
    "Both legs gone. Severe pain every single hour. Hospital bills screaming. And nobody coming.",
    "He has no one, and all left him alone at an old age home. He lost his leg as well.",
  ],
  death: [
    "Sohail has passed away — but his family cannot afford his final farewell.",
    "He fought cancer for months... but tonight, he returned to Allah.",
    "Imagine losing your father and not even having enough money to bury him.",
    "JANAZAH IS PENDING. WE STILL CAN'T BURY HIM.",
  ],
  orphans: [
    "She lost her mother, father, and grandmother.",
    "These 5 kids live alone in a house with no door. No one to care for them. No food in the kitchen.",
    "A family in Charsadda lost their only earner last week. Suddenly. No savings. No backup. Nothing.",
    "They buried their father. Now they are fighting to keep everything else.",
    "A loan their father died owing. A debt they never chose.",
  ],
  needs: [
    "Right now, as you read this — two children are lying awake in 50° heat. No fan. No sleep. No relief.",
    "They haven't felt a cool night all summer.",
    "This boy collects leftover rotis from scrap to feed his family.",
    "There is no ration left at home.",
  ],
};
