import { AlertCircle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/core";
import type { Task, TaskPriority, TaskStatus } from "@/types";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-live="polite">
      <span className="sr-only">{label}</span>
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-xl border bg-white" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-white px-6 py-10 text-center">
      <Inbox className="mx-auto text-slate-300" size={32} />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
      <div className="flex items-center gap-2 font-semibold">
        <AlertCircle size={18} /> Could not load data
      </div>
      <p className="mt-1 text-sm">{message}</p>
      {retry ? (
        <button type="button" className="mt-3 text-sm font-medium underline" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

const statusLabels: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
};

const priorityTones: Record<TaskPriority, "slate" | "amber" | "red"> = {
  low: "slate",
  medium: "amber",
  high: "red",
};

export function TaskSummary({ task }: { task: Task }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="mt-1 text-xs text-slate-500">
          {task.assignedToName || "Unassigned"}
          {task.dueDate ? ` 뿯½ Due ${task.dueDate}` : " 뿯½ No due date"}
        </p>
      </div>
      <div className="flex gap-2">
        <Badge tone={task.status === "completed" ? "green" : "blue"}>
          {statusLabels[task.status]}
        </Badge>
        <Badge tone={priorityTones[task.priority]}>{task.priority}</Badge>
      </div>
    </div>
  );
}
