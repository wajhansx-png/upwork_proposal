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
  updatedAt: string;
  /** Set only when the teammate changes the status. Used to measure activity. */
  touchedAt?: string;
}

export interface ChatMessage {
  id: string;
  from: Role | "agent";
  /** Which inbox the message shows up in. */
  to: Role;
  text: string;
  at: string;
}

export interface Settings {
  teammateName: string;
  dailyTarget: number;
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  /** Hours of silence before the agent nudges. */
  stallHours: number;
  template: string;
}

export interface PushSub {
  role: Role;
  sub: { endpoint: string; keys: { p256dh: string; auth: string } };
}

export interface AgentState {
  lastRunAt?: string;
  lastNudgeAt?: string;
  /** Nudges sent since the teammate last did anything. */
  unansweredNudges: number;
  lastDigestDay?: string;
  teammateLastSeenAt?: string;
}

export interface Db {
  settings: Settings;
  donors: Donor[];
  messages: ChatMessage[];
  subs: PushSub[];
  agent: AgentState;
}
