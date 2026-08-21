export type TaskStatus = "todo" | "in_progress" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type ClientStatus = "lead" | "active" | "paused" | "closed";

export type TeamMember = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  assignedToId?: string;
  assignedToName?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  clientId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type Client = {
  id: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  status: ClientStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamMemberDocument = Omit<TeamMember, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

export type TaskDocument = Omit<
  Task,
  "id" | "createdAt" | "updatedAt" | "completedAt"
> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp | null;
};

export type ClientDocument = Omit<Client, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};
