"use client";

import {
  AlertTriangle,
  BriefcaseBusiness,
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
import { Card } from "@/components/ui/core";
import { CompanyBrainChat } from "@/components/company-brain/company-brain-chat";
import { TodaySchedule } from "@/components/dashboard/today-schedule";
import {
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/shared";

type DashboardData = {
  user: { name: string; email: string };
  summary: {
    openTasks: number;
    dueToday: number;
    overdue: number;
    completedThisWeek: number;
    activeMembers: number;
    clients: number;
  };
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
    { label: "Clients", value: data.summary.clients, icon: BriefcaseBusiness, tone: "text-cyan-600" },
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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

      <TodaySchedule />

      <CompanyBrainChat />
    </>
  );
}
