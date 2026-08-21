"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ListTodo,
  Plus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Task, TeamMember } from "@/types";
import { Card } from "@/components/ui/core";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  TaskSummary,
} from "@/components/shared";

type DashboardData = {
  user: { name: string; email: string };
  summary: {
    openTasks: number;
    dueToday: number;
    overdue: number;
    completedThisWeek: number;
    activeMembers: number;
  };
  matchingMember: TeamMember | null;
  myTasks: Task[];
  openTasks: Task[];
  recentlyCompleted: Task[];
  team: Array<TeamMember & { activeTaskCount: number }>;
};

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await apiFetch<DashboardData>("/api/dashboard"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <LoadingState label="Loading dashboard" />;

  const metrics = [
    { label: "Open tasks", value: data.summary.openTasks, icon: ListTodo, tone: "text-blue-600" },
    { label: "Due today", value: data.summary.dueToday, icon: CalendarClock, tone: "text-amber-600" },
    { label: "Overdue", value: data.summary.overdue, icon: AlertTriangle, tone: "text-red-600" },
    {
      label: "Completed this week",
      value: data.summary.completedThisWeek,
      icon: CheckCircle2,
      tone: "text-emerald-600",
    },
    { label: "Active team", value: data.summary.activeMembers, icon: Users, tone: "text-violet-600" },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome, ${data.user.name}`}
        description="Here’s what your team is working on today."
        actions={
          <>
            <Link className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white" href="/tasks?new=1">
              <Plus size={17} /> Add task
            </Link>
            <Link className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium" href="/team?new=1">
              <UserPlus size={17} /> Add member
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{label}</p>
              <Icon className={tone} size={19} />
            </div>
            <p className="mt-3 text-2xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">My Tasks</h2>
            <Link href="/tasks?view=my" className="text-sm font-medium text-blue-600">View all</Link>
          </div>
          {!data.matchingMember ? (
            <EmptyState
              title="No matching team member"
              description={`Add ${data.user.email} to a team member record to see assigned tasks here.`}
            />
          ) : data.myTasks.length ? (
            <div className="space-y-2">{data.myTasks.map((task) => <TaskSummary key={task.id} task={task} />)}</div>
          ) : (
            <EmptyState title="You’re all caught up" description="No open tasks are assigned to you." />
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Team Members</h2>
          <div className="space-y-3">
            {data.team.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                <div>
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="text-xs text-slate-500">{member.role || "Team member"}</p>
                </div>
                <span className="text-sm font-semibold">{member.activeTaskCount} open</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">All Open Tasks</h2>
            <Link href="/tasks" className="text-sm font-medium text-blue-600">View all tasks</Link>
          </div>
          {data.openTasks.length ? (
            <div className="space-y-2">{data.openTasks.map((task) => <TaskSummary key={task.id} task={task} />)}</div>
          ) : (
            <EmptyState title="No open tasks" description="Create a task to get your team moving." />
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Recently Completed</h2>
          {data.recentlyCompleted.length ? (
            <div className="space-y-2">{data.recentlyCompleted.map((task) => <TaskSummary key={task.id} task={task} />)}</div>
          ) : (
            <EmptyState title="Nothing completed yet" description="Completed tasks will appear here." />
          )}
        </Card>
      </div>
    </>
  );
}
