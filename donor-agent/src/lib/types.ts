export type Role = "manager" | "teammate";
export type Channel = "whatsapp" | "email" | "instagram" | "linkedin" | "other";
export type DonorStatus = "new" | "sent" | "replied" | "donated" | "no";

export interface Donor {
  id: string;
  name: string;
  /** WhatsApp number with country code, digits and a leading "+". Missing for most donors. */
  phone?: string;
  /** "UET Lahore", "Upwork", "D list", "WhatsApp", "Others": guessed from the name. */
  group: string;
  status: DonorStatus;
  /** How many times she messaged this donor. */
  sends: number;
  sentAt?: string;
  repliedAt?: string;
  donatedAt?: string;
  /** Total given, in rupees, when known. */
  amount?: number;
  note?: string;
  updatedAt: string;
  /** "f" when the name is clearly a woman's, so a DM says "Behen" instead of "Bhai". */
  gender?: "m" | "f";
  /** The case this donor already got a DM for. One DM per person per case. */
  caseId?: string;
  /** The donor before the last change, so one tap can undo it. */
  undo?: { status: DonorStatus; sends: number; sentAt?: string; repliedAt?: string; donatedAt?: string; amount?: number; counted?: boolean; taskId?: string; caseId?: string; caseGift?: number };
}

/** Case kinds from the GiveLife writing guide (Part 12). */
export type CaseType = "child" | "adult" | "death" | "orphans" | "needs";

/** The facts of one case (guide Part 2). Only real facts; nothing is guessed. */
export interface CaseFacts {
  type: CaseType;
  name: string;
  /** For his/her and Bhai/Behen wording. */
  gender: "m" | "f";
  age?: number;
  city?: string;
  /** What is happening, in easy words. */
  problem: string;
  illness?: string;
  /** The illness in easy words, shown in brackets. */
  illnessMeaning?: string;
  /** What will be lost, as the doctor or family said. */
  worstRisk?: string;
  /** One word in CAPITALS for the hook: LEG, KIDNEY, HOME. */
  riskWord?: string;
  /** The doctor's real words. Medical cases only. */
  doctorLine?: string;
  /** Real documents: "Aga Khan lab report + Nishtar doctor's diagnosis". */
  proof: string;
  amountLeft: number;
  askAmount: number;
  /** Only a real deadline from the hospital or family. */
  deadline?: string;
  /** Real costs: ration, rent, kafan. The app adds them up. */
  items?: { item: string; period?: string; amount: number }[];
  /** The family really said the pain is getting worse (allows the "feeling" reminder). */
  familySaidPain?: boolean;
}

export interface CasePost {
  kind: "main" | "dm" | "number" | "people" | "feeling" | "unity" | "proof" | "lastpush" | "tag" | "closing";
  text: string;
  at: string;
  amountLeft: number;
}

export interface CaseFile {
  id: string;
  facts: CaseFacts;
  status: "open" | "closed";
  createdAt: string;
  closedAt?: string;
  /** The written lines (hook, story), kept so the post stays the same when only the amount changes. */
  hook: string;
  story: string;
  verse: number;
  by: "ai" | "rules";
  /** Other good openings the AI wrote; the manager can switch with one tap. */
  options?: { hook: string; story: string }[];
  /** Texts the manager copied, newest last. Used so reminders never repeat. */
  posts: CasePost[];
}

/** Each person has one private thread with the agent. */
export interface ChatMessage {
  id: string;
  /** Whose thread this is. The manager can also read and write in the teammate's thread. */
  owner: Role;
  /** "user" is the owner of the thread. In the teammate's thread, "manager" is the manager writing directly. */
  from: "user" | "agent" | "manager";
  text: string;
  at: string;
  /** Screenshot attached to this message (image id). */
  img?: string;
  /** Set on check-in messages, so the agent knows a reply is an answer to it. */
  kind?: "checkin" | "kickoff" | "clarification" | "task" | "update" | "manager-input" | "agent" | "progress";
}

export interface PendingAssignment {
  kind: "dms" | "general";
  /** Everything the manager has said about this assignment so far. */
  request: string;
  title?: string;
  target?: number;
  deadlineAt?: string;
  checkEvery?: number;
  /** Minimum minutes between DMs requested by the manager. */
  gapMinutes?: number;
  instructions?: string;
  createdAt: string;
}

export type TaskStatus = "open" | "review" | "done" | "missed" | "cancelled";

export interface Task {
  id: string;
  title: string;
  /** Clean manager-approved context shown with the structured task. */
  brief?: string;
  /** "dms" is measured from donors marked sent. "general" is finished by the teammate and confirmed by the manager. */
  kind: "dms" | "general";
  target: number;
  createdAt: string;
  deadlineAt: string;
  status: TaskStatus;
  closedAt?: string;
  lastCheckAt?: string;
  /** Check-ins in a row with no sign of work or reply. */
  unanswered: number;
  /** Minutes between check-ins for this task, if the manager gave one ("check every 20 min"). */
  checkEvery?: number;
  /** Minimum minutes between DMs, if the manager set one. */
  gapMinutes?: number;
  /** Areeba can mute these, but the task remains active and the manager is told. */
  remindersEnabled?: boolean;
  timerEnabled?: boolean;
  lastReportAt?: string;
  lastReminderAt?: string;
  lastTimerAt?: string;
  reminderPausedUntil?: string;
  lastMilestone?: number;
  lastSilentAlertAt?: string;
  noUpdateMsgId?: string;
  /** Her question that waits for the manager's answer. */
  pendingAsk?: { kind: string; text: string; at: string };
  /** An approved break ends here; she then gets a "break is over" push. */
  breakUntil?: string;
  silentSince?: string;
  deadlineAlerted?: boolean;
  alertsProblemAt?: string;
  reminderCount?: number;
  pushReceipts?: { id: string; label: string; issuedAt: string; receivedAt?: string; openedAt?: string; missingAlertedAt?: string }[];
  /** A small goal for the next check-in: reach `count` DMs by `by`. Set by the agent or by her own promise. */
  goal?: { count: number; by: string; fromHer?: boolean };
  /** Small goals missed in a row. */
  goalMisses?: number;
  /** The manager was already told she is too slow to finish on time. */
  paceWarned?: boolean;
  midpointSent?: boolean;
  preDeadlineSent?: boolean;
  note?: string;
  /** Progress reported by the teammate for work completed outside this app (for example, WhatsApp DMs). */
  reportedDone?: number;
  /** The first time the teammate said she started. */
  startedAt?: string;
  /** Screenshots attached to this task's chat. */
  proofCount?: number;
  lastProofAt?: string;
  lastProgressAt?: string;
  blockedReason?: string;
  evidence?: {
    imageId: string;
    at: string;
    verdict: "supported" | "rejected" | "unclear";
    recipient?: string;
    reason: string;
    /** 1 to 5: how good the sent message is (polite, complete, follows the instructions). Set when an AI key reads it. */
    quality?: number;
    issues?: string[];
  }[];
  /** When she reported the work complete (task moved to review). */
  reviewAt?: string;
  /** Final-report requests sent after the deadline. After 3, the task closes as missed. */
  finalRequests?: number;
  /** The review written when the task is ready for the manager or missed. */
  evaluation?: TaskEvaluation;
  evaluatingAt?: string;
  nextCheckAt?: string;
  workflowRunId?: string;
  workflowError?: string;
  lastWorkerAt?: string;
  escalationSent?: boolean;
}

export interface TaskEvaluation {
  /** 0 to 10. */
  score: number;
  verdict: string;
  good: string[];
  problems: string[];
  advice: string;
  /** "ai" when GPT wrote it (kept within 1.5 points of the numbers), "rules" otherwise. */
  by: "ai" | "rules";
  at: string;
}

export interface Settings {
  teammateName: string;
  /** Default size of a DM task when the manager gives no number. */
  dailyTarget: number;
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  /** Minutes between check-ins while a task is open. */
  checkinMinutes: number;
  /** Mark sent needs a screenshot. */
  requireProof: boolean;
  /** Changing this makes the old teammate link stop working. */
  teammateKeyVersion: number;
  template: string;
}

export interface PushSub {
  role: Role;
  sub: { endpoint: string; keys: { p256dh: string; auth: string } };
}

export interface AgentState {
  lastRunAt?: string;
  lastDigestDay?: string;
  lastNoTaskPromptDay?: string;
  teammateLastSeenAt?: string;
  /** Wrong manager passwords in a row, and the lock time after too many. */
  loginFails?: number;
  /** Paid AI calls made today, to keep the bill small. */
  aiDay?: string;
  aiCalls?: number;
  loginLockUntil?: string;
  /** "ok", "off" (no key), or the last error. Shown to the manager. */
  llmStatus?: string;
  /** A manager-only draft. Nothing is sent to the teammate until required details are complete. */
  pendingAssignment?: PendingAssignment;
  /** Manager text that may be an answer to her question; sent only after he confirms. */
  heldAnswer?: string;
}

export interface Db {
  /** Screenshot fingerprints, to catch the same image used twice. hash -> label. */
  hashes: Record<string, string>;
  settings: Settings;
  donors: Donor[];
  cases: CaseFile[];
  tasks: Task[];
  messages: ChatMessage[];
  subs: PushSub[];
  agent: AgentState;
}
