import { useMemo } from "react";
import { isPersonalTask, useJobs, type Job } from "@/src/lib/data";
import { formatDateShort, todayISO } from "@/src/lib/format";

export type TaskGroup = "late" | "today" | "tomorrow" | "later" | "someday" | "done";

export const GROUP_LABEL: Record<TaskGroup, string> = {
  late: "देर हो गई",
  today: "आज",
  tomorrow: "कल",
  later: "आगे",
  someday: "बिना तारीख",
  done: "पूरे हुए",
};

const GROUP_ORDER: TaskGroup[] = ["late", "today", "tomorrow", "later", "someday", "done"];

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function taskGroup(t: Job, today = todayISO()): TaskGroup {
  if (t.status === "done") return "done";
  if (!t.dueDate) return "someday";
  if (t.dueDate < today) return "late";
  if (t.dueDate === today) return "today";
  if (t.dueDate === todayISO(1)) return "tomorrow";
  return "later";
}

/** Important first, then the earliest day and time; finished ones newest first. */
export function compareTasks(a: Job, b: Job): number {
  if (a.status === "done" && b.status === "done") return b.dueDate.localeCompare(a.dueDate) || b.createdAt.localeCompare(a.createdAt);
  const pa = a.priority === "high" ? 0 : 1;
  const pb = b.priority === "high" ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || (a.time || "99").localeCompare(b.time || "99") || a.createdAt.localeCompare(b.createdAt);
}

export function groupTasks(list: Job[], today = todayISO()): { group: TaskGroup; data: Job[] }[] {
  const by = new Map<TaskGroup, Job[]>();
  for (const t of list) {
    const g = taskGroup(t, today);
    by.set(g, [...(by.get(g) ?? []), t]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ group: g, data: by.get(g)!.sort(compareTasks) }));
}

export function formatTime(hm?: string): string {
  if (!hm || !TIME_RE.test(hm)) return "";
  const [h, m] = hm.split(":").map(Number);
  const part = h < 12 ? "सुबह" : h < 16 ? "दोपहर" : h < 20 ? "शाम" : "रात";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${part} ${h12}:${String(m).padStart(2, "0")}`;
}

export function whenLabel(t: Job, today = todayISO()): string {
  const day = !t.dueDate ? "" : t.dueDate === today ? "आज" : t.dueDate === todayISO(1) ? "कल" : t.dueDate === todayISO(-1) ? "कल (बीता)" : formatDateShort(t.dueDate);
  return [day, formatTime(t.time)].filter(Boolean).join(" · ");
}

export function usePersonalTasks() {
  const q = useJobs();
  const all = q.data;
  const tasks = useMemo(() => (all ?? []).filter(isPersonalTask), [all]);
  return { tasks, query: q };
}
