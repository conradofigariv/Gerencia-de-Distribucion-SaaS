import { supabase } from "./supabaseClient";

export interface ReminderConfig {
  section_id: string;
  section_name: string;
  frequency_days: number;
  reminder_time: string | null;
  last_updated_at: string | null;
  enabled: boolean;
}

export interface OverdueReminder extends ReminderConfig {
  label: string;
  section: string;
  days_overdue: number;
}

export async function fetchReminders(keys: string[]): Promise<ReminderConfig[]> {
  const { data, error } = await supabase
    .from("section_reminders")
    .select("section_id, section_name, frequency_days, reminder_time, last_updated_at, enabled")
    .in("section_id", keys);
  if (error) throw error;
  return (data ?? []) as ReminderConfig[];
}

export async function upsertConfig(
  key: string,
  name: string,
  frequencyDays: number,
  reminderTime: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("section_reminders")
    .upsert(
      {
        section_id: key,
        section_name: name,
        frequency_days: frequencyDays,
        reminder_time: reminderTime || null,
        last_updated_by: userId,
        enabled: true,
      },
      { onConflict: "section_id" }
    );
  if (error) throw error;
}

export async function markUpdated(key: string, name: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("section_reminders")
    .upsert(
      {
        section_id: key,
        section_name: name,
        last_updated_at: now,
        last_updated_by: userId,
        enabled: true,
      },
      { onConflict: "section_id" }
    );
  if (error) throw error;
}

const DAY_MS = 1000 * 60 * 60 * 24;

export function computeOverdue(
  reminders: ReminderConfig[],
  allKeys: { key: string; label: string; section: string }[]
): OverdueReminder[] {
  const now = new Date();
  const nowMs = now.getTime();

  return allKeys.flatMap(({ key, label, section }) => {
    const cfg = reminders.find(r => r.section_id === key);

    if (cfg && cfg.enabled === false) return [];

    if (!cfg || !cfg.last_updated_at) {
      const base: ReminderConfig = cfg ?? {
        section_id: key, section_name: label, frequency_days: 7,
        reminder_time: null, last_updated_at: null, enabled: true,
      };
      return [{ ...base, label, section, days_overdue: Infinity }];
    }

    const daysSince = (nowMs - new Date(cfg.last_updated_at).getTime()) / DAY_MS;
    if (daysSince < cfg.frequency_days) return [];

    // Only surface after reminder_time today
    if (cfg.reminder_time) {
      const [h, m] = cfg.reminder_time.split(":").map(Number);
      const triggerToday = new Date(now);
      triggerToday.setHours(h, m, 0, 0);
      if (now < triggerToday) return [];
    }

    return [{ ...cfg, label, section, days_overdue: Math.floor(daysSince) }];
  });
}
