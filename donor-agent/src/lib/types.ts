export type Role = "manager" | "teammate";
export type Channel = "whatsapp" | "email" | "instagram" | "linkedin" | "other";
export type DonorStatus = "todo" | "sent" | "replied" | "skipped";

export interface Donor {
  id: string;
  name: string;
  channel: Channel;
  contact: string;
  note: string;
  status: DonorStatus;
  sentAt?: string;
  repliedAt?: string;
  /** Pasted reply from the donor. Required when the teammate marks "replied". */
  replyText?: string;
  /** When the teammate copied or opened the message for this donor. */
  preparedAt?: string;
  /** Reasons the "sent" mark looks unreliable. Empty means no concern. */
  flags: string[];
  /** Screenshot of the sent DM (image id) and what the check found. */
  proofImg?: string;
  proofCheck?: { verdict: "match" | "mismatch" | "unclear" | "unchecked"; reason: string };
  updatedAt: string;
  /** Set only when the teammate changes the status. Used to measure activity. */
  touchedAt?: string;
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
  kind?: "checkin" | "kickoff";
}

export type TaskStatus = "open" | "review" | "done" | "missed" | "cancelled";

export interface Task {
  id: string;
  title: string;
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
  /** A small goal for the next check-in: reach `count` DMs by `by`. Set by the agent or by her own promise. */
  goal?: { count: number; by: string; fromHer?: boolean };
  /** Small goals missed in a row. */
  goalMisses?: number;
  /** The manager was already told she is too slow to finish on time. */
  paceWarned?: boolean;
  midpointSent?: boolean;
  preDeadlineSent?: boolean;
  note?: string;
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
}

export interface Db {
  /** Screenshot fingerprints, to catch the same image used twice. hash -> label. */
  hashes: Record<string, string>;
  settings: Settings;
  donors: Donor[];
  tasks: Task[];
  messages: ChatMessage[];
  subs: PushSub[];
  agent: AgentState;
}
