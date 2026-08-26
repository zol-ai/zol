export type TaskStatus = "todo" | "in_progress" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type ClientStatus = "lead" | "active" | "paused" | "closed";
export type ClientColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";
export type WorkCardColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";
export type NoteColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

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
  color: ClientColor;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkCardTodo = {
  id: string;
  text: string;
  done: boolean;
};

export type WorkCard = {
  id: string;
  title: string;
  todos: WorkCardTodo[];
  color: WorkCardColor;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceNote = {
  id: string;
  title: string;
  body: string;
  color: NoteColor;
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

export type WorkCardDocument = Omit<WorkCard, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

export type WorkspaceNoteDocument = Omit<WorkspaceNote, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};
