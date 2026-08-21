import { startOfWeek } from "date-fns";
import { authorized } from "@/lib/api-server";
import { getTasks } from "@/lib/firestore/tasks";
import { getTeamMembers } from "@/lib/firestore/teamMembers";

export async function GET() {
  return authorized(async (user) => {
    const [tasks, members] = await Promise.all([getTasks(), getTeamMembers()]);
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
    const open = tasks.filter((task) => task.status !== "completed");
    const completed = tasks.filter((task) => task.status === "completed");
    const matchingMember = members.find(
      (member) => member.email?.toLowerCase() === user.email.toLowerCase(),
    );

    return {
      user,
      summary: {
        openTasks: open.length,
        dueToday: open.filter((task) => task.dueDate === today).length,
        overdue: open.filter((task) => task.dueDate && task.dueDate < today).length,
        completedThisWeek: completed.filter(
          (task) => task.completedAt && task.completedAt >= weekStart,
        ).length,
        activeMembers: members.filter((member) => member.active).length,
      },
      matchingMember: matchingMember ?? null,
      myTasks: matchingMember
        ? open.filter((task) => task.assignedToId === matchingMember.id).slice(0, 6)
        : [],
      openTasks: open.slice(0, 8),
      recentlyCompleted: completed.slice(0, 6),
      team: members
        .filter((member) => member.active)
        .map((member) => ({
          ...member,
          activeTaskCount: open.filter((task) => task.assignedToId === member.id).length,
        })),
    };
  });
}
