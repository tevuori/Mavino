// ===== Circle API client (Pro-tier shared study spaces) =====

import { api } from "./api";

export interface StudyGroupSummary {
  id: string;
  name: string;
  description: string;
  inviteCode: string;
  status: string;
  memberCount: number;
  sharedDeckCount: number;
  sharedFolderCount: number;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  role: string;
  joinedAt: string;
}

export interface SharedDeckDetail {
  id: string;
  deckId: string;
  deckName: string;
  deckColor: string;
  cardCount: number;
  sharedByName: string;
  permission: string;
  createdAt: string;
}

export interface SharedNoteFolderDetail {
  id: string;
  folderId: string;
  folderName: string;
  noteCount: number;
  sharedByName: string;
  permission: string;
  createdAt: string;
}

export interface StudyGroup extends StudyGroupSummary {
  members: GroupMember[];
  sharedDecks: SharedDeckDetail[];
  sharedNoteFolders: SharedNoteFolderDetail[];
  ownerName: string;
}

export interface AccessibleDeck {
  deckId: string;
  deckName: string;
  deckColor: string;
  cardCount: number;
  groupName: string;
  permission: string;
}

export const circleApi = {
  listGroups: () => api.get<{ groups: StudyGroupSummary[] }>("/api/circle/groups"),

  createGroup: (data: { name: string; description?: string }) =>
    api.post<{ group: { id: string; name: string; inviteCode: string } }>("/api/circle/groups", data),

  getGroup: (id: string) => api.get<{ group: StudyGroup }>(`/api/circle/groups/${id}`),

  updateGroup: (id: string, data: { name?: string; description?: string }) =>
    api.patch<{ ok: boolean }>(`/api/circle/groups/${id}`, data),

  deleteGroup: (id: string) => api.delete<{ ok: boolean }>(`/api/circle/groups/${id}`),

  joinGroup: (inviteCode: string) =>
    api.post<{ group: { id: string; name: string } }>("/api/circle/groups/join", { inviteCode }),

  leaveGroup: (id: string) => api.post<{ ok: boolean }>(`/api/circle/groups/${id}/leave`),

  updateMemberRole: (groupId: string, memberUserId: string, role: "admin" | "member") =>
    api.patch<{ ok: boolean }>(`/api/circle/groups/${groupId}/members/${memberUserId}`, { role }),

  removeMember: (groupId: string, memberUserId: string) =>
    api.delete<{ ok: boolean }>(`/api/circle/groups/${groupId}/members/${memberUserId}`),

  shareDeck: (groupId: string, deckId: string, permission?: "read" | "write") =>
    api.post<{ ok: boolean }>(`/api/circle/groups/${groupId}/decks`, { deckId, permission }),

  unshareDeck: (groupId: string, deckId: string) =>
    api.delete<{ ok: boolean }>(`/api/circle/groups/${groupId}/decks/${deckId}`),

  shareFolder: (groupId: string, folderId: string, permission?: "read" | "write") =>
    api.post<{ ok: boolean }>(`/api/circle/groups/${groupId}/folders`, { folderId, permission }),

  unshareFolder: (groupId: string, folderId: string) =>
    api.delete<{ ok: boolean }>(`/api/circle/groups/${groupId}/folders/${folderId}`),

  accessibleDecks: () => api.get<{ decks: AccessibleDeck[] }>("/api/circle/decks"),
};
