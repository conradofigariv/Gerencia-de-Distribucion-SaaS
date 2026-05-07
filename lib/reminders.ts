import { supabase } from "./supabaseClient";

export interface ReminderConfig {
  reminder_key: string;
  frequency_days: number;
  last_updated_at: string | null;
  updated_at: string | null;
}

export interface OverdueReminder extends ReminderConfig {
  label: string;
  section: string;
  days_overdue: number;
}

export async function fetchReminders(keys: string[]): Promise<ReminderConfig[]> {
  const { data, error } = await supabase
    .from("section_reminders")
    .select("reminder_key, frequency_days, last_updated_at, updated_at")
    .in("reminder_key", keys);
  if (error) throw error;
  return (data ?? []) as ReminderConfig[];
}

export async function upsertFrequency(key: string, days: number, userId: string): Promise<void> {
  const { error } = await supabase
    .from("section_reminders")
    .upsert(
      { reminder_key: key, frequency_days: days, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "reminder_key" }
    );
  if (error) throw error;
}

export async function markUpdated(key: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("section_reminders")
    .upsert(
      { reminder_key: key, last_updated_at: now, updated_by: userId, updated_at: now },
      { onConflict: "reminder_key" }
    );
  if (error) throw error;
}

const DAY_MS = 1000 * 60 * 60 * 24;

export function computeOverdue(
  reminders: ReminderConfig[],
  allKeys: { key: string; label: string; section: string }[]
): OverdueReminder[] {
  const now = Date.now();
  return allKeys.flatMap(({ key, label, section }) => {
    const cfg = reminders.find(r => r.reminder_key === key);
    if (!cfg || !cfg.last_updated_at) {
      const base = cfg ?? { reminder_key: key, frequency_days: 7, last_updated_at: null, updated_at: null };
      return [{ ...base, label, section, days_overdue: Infinity }];
    }
    const daysSince = (now - new Date(cfg.last_updated_at).getTime()) / DAY_MS;
    if (daysSince >= cfg.frequency_days) {
      return [{ ...cfg, label, section, days_overdue: Math.floor(daysSince) }];
    }
    return [];
  });
}
