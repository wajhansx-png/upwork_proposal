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
  updatedAt: string;
  /** Set only when the teammate changes the status. Used to measure activity. */
  touchedAt?: string;
}

/** Each person has one private thread with the agent. */
export interface ChatMessage {
  id: string;
  owner: Role;
  from: "user" | "agent";
  text: string;
  at: string;
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
  /** "ok", "off" (no key), or the last error. Shown to the manager. */
  llmStatus?: string;
}

export interface Db {
  settings: Settings;
  donors: Donor[];
  tasks: Task[];
  messages: ChatMessage[];
  subs: PushSub[];
  agent: AgentState;
}
