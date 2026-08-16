// ===== Circle: shared study spaces service (Pro tier) =====
// Opt-in shared spaces where a small group of classmates can share flashcard
// decks, notes folders, and collaborate. One student creates a group,
// invites others via an invite code, and shared resources become accessible
// to all members. Each member's SM-2 review state is private; only the deck
// content is shared.
//
// Models:
//   - StudyGroup: owned by a user, has members + shared resources
//   - StudyGroupMember: user → group mapping with role (owner/admin/member)
//   - SharedDeck: links a FlashcardDeck to a group (read or write)
//   - SharedNoteFolder: links a NoteFolder to a group (read or write)
//
// Access control: only the deck/folder owner can share it. Members can
// access shared resources based on permission level. Write permission
// allows editing the deck/folder content but not deleting the share.

import prisma from "../db/client";
import { deliverNotification } from "./notifications";

// ----- types -----

export interface StudyGroupSummary {
  id: string;
  name: string;
  description: string;
  inviteCode: string;
  status: string;
  memberCount: number;
  sharedDeckCount: number;
  sharedFolderCount: number;
  role: string; // the requesting user's role in the group
  createdAt: string;
  updatedAt: string;
}

export interface StudyGroupDetail extends StudyGroupSummary {
  members: GroupMember[];
  sharedDecks: SharedDeckDetail[];
  sharedNoteFolders: SharedNoteFolderDetail[];
  ownerName: string;
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

// ----- helpers -----

function generateInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ----- group CRUD -----

export async function listGroups(userId: string): Promise<StudyGroupSummary[]> {
  // Groups the user is a member of (including owned).
  const memberships = await prisma.studyGroupMember.findMany({
    where: { userId },
    include: {
      group: {
        include: {
          _count: {
            select: { members: true, sharedDecks: true, sharedNoteFolders: true },
          },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });
  return memberships.map((m) => serializeGroupSummary(m.group, m.role, m.group._count));
}

export async function getGroup(userId: string, groupId: string): Promise<StudyGroupDetail | null> {
  // Verify membership.
  const membership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId },
  });
  if (!membership) return null;

  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    include: {
      members: { include: { user: { select: { username: true, displayName: true, avatarColor: true } } }, orderBy: { joinedAt: "asc" } },
      sharedDecks: true,
      sharedNoteFolders: true,
      owner: { select: { username: true, displayName: true } },
    },
  });
  if (!group) return null;

  // Enrich shared decks with deck info.
  const deckIds = group.sharedDecks.map((d) => d.deckId);
  const decks = deckIds.length > 0
    ? await prisma.flashcardDeck.findMany({
        where: { id: { in: deckIds } },
        include: { _count: { select: { cards: true } } },
      })
    : [];
  const deckMap = new Map(decks.map((d) => [d.id, d]));

  // Enrich shared folders with folder info.
  const folderIds = group.sharedNoteFolders.map((f) => f.folderId);
  const folders = folderIds.length > 0
    ? await prisma.noteFolder.findMany({
        where: { id: { in: folderIds } },
        include: { _count: { select: { notes: true } } },
      })
    : [];
  const folderMap = new Map(folders.map((f) => [f.id, f]));

  // Get sharer names.
  const sharerIds = new Set([
    ...group.sharedDecks.map((d) => d.sharedBy),
    ...group.sharedNoteFolders.map((f) => f.sharedBy),
  ]);
  const sharers = sharerIds.size > 0
    ? await prisma.user.findMany({ where: { id: { in: [...sharerIds] } }, select: { id: true, username: true, displayName: true } })
    : [];
  const sharerMap = new Map(sharers.map((s) => [s.id, s]));

  const counts = {
    members: group.members.length,
    sharedDecks: group.sharedDecks.length,
    sharedNoteFolders: group.sharedNoteFolders.length,
  };

  return {
    ...serializeGroupSummary(group, membership.role, counts),
    ownerName: group.owner.displayName || group.owner.username,
    members: group.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      username: m.user.username,
      displayName: m.user.displayName,
      avatarColor: m.user.avatarColor,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
    sharedDecks: group.sharedDecks.map((d) => {
      const deck = deckMap.get(d.deckId);
      const sharer = sharerMap.get(d.sharedBy);
      return {
        id: d.id,
        deckId: d.deckId,
        deckName: deck?.name ?? "Deleted deck",
        deckColor: deck?.color ?? "#6366f1",
        cardCount: deck?._count.cards ?? 0,
        sharedByName: sharer?.displayName || sharer?.username || "Unknown",
        permission: d.permission,
        createdAt: d.createdAt.toISOString(),
      };
    }),
    sharedNoteFolders: group.sharedNoteFolders.map((f) => {
      const folder = folderMap.get(f.folderId);
      const sharer = sharerMap.get(f.sharedBy);
      return {
        id: f.id,
        folderId: f.folderId,
        folderName: folder?.name ?? "Deleted folder",
        noteCount: folder?._count.notes ?? 0,
        sharedByName: sharer?.displayName || sharer?.username || "Unknown",
        permission: f.permission,
        createdAt: f.createdAt.toISOString(),
      };
    }),
  };
}

function serializeGroupSummary(group: any, role: string, counts: any): StudyGroupSummary {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    inviteCode: group.inviteCode,
    status: group.status,
    memberCount: counts.members,
    sharedDeckCount: counts.sharedDecks,
    sharedFolderCount: counts.sharedNoteFolders,
    role,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export async function createGroup(
  userId: string,
  data: { name: string; description?: string }
): Promise<{ id: string; name: string; inviteCode: string }> {
  const group = await prisma.studyGroup.create({
    data: {
      ownerId: userId,
      name: data.name.trim(),
      description: data.description?.trim() ?? "",
      inviteCode: generateInviteCode(),
      members: {
        create: { userId, role: "owner" },
      },
    },
  });
  return { id: group.id, name: group.name, inviteCode: group.inviteCode };
}

export async function updateGroup(
  userId: string,
  groupId: string,
  data: { name?: string; description?: string }
): Promise<void> {
  // Only owner or admin can update.
  const membership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId, role: { in: ["owner", "admin"] } },
  });
  if (!membership) throw new Error("Only group owners or admins can update the group");
  const update: any = {};
  if (data.name !== undefined) update.name = data.name.trim();
  if (data.description !== undefined) update.description = data.description;
  await prisma.studyGroup.update({ where: { id: groupId }, data: update });
}

export async function deleteGroup(userId: string, groupId: string): Promise<void> {
  // Only owner can delete.
  const group = await prisma.studyGroup.findFirst({
    where: { id: groupId, ownerId: userId },
  });
  if (!group) throw new Error("Only the group owner can delete the group");
  await prisma.studyGroup.delete({ where: { id: groupId } });
}

// ----- joining / leaving -----

export async function joinGroup(userId: string, inviteCode: string): Promise<{ id: string; name: string }> {
  const group = await prisma.studyGroup.findUnique({
    where: { inviteCode: inviteCode.toUpperCase().trim() },
  });
  if (!group) throw new Error("Invalid invite code");
  if (group.status !== "active") throw new Error("This group is no longer active");

  // Check if already a member.
  const existing = await prisma.studyGroupMember.findFirst({
    where: { groupId: group.id, userId },
  });
  if (existing) throw new Error("You're already a member of this group");

  await prisma.studyGroupMember.create({
    data: { groupId: group.id, userId, role: "member" },
  });

  // Notify all existing members that a new member joined.
  const joiner = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true },
  });
  const existingMembers = await prisma.studyGroupMember.findMany({
    where: { groupId: group.id, userId: { not: userId } },
    select: { userId: true },
  });
  const joinerName = joiner?.displayName || joiner?.username || "Someone";
  for (const m of existingMembers) {
    void deliverNotification(m.userId, {
      category: "circle_join",
      title: `New member in ${group.name}`,
      body: `${joinerName} joined your study group.`,
      icon: "Users",
      linkApp: "circle",
      linkPayload: JSON.stringify({ groupId: group.id }),
      tags: "users",
    }).catch(() => {});
  }

  return { id: group.id, name: group.name };
}

export async function leaveGroup(userId: string, groupId: string): Promise<void> {
  const membership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId },
  });
  if (!membership) throw new Error("You're not a member of this group");
  if (membership.role === "owner") throw new Error("The owner cannot leave the group. Transfer ownership or delete the group instead.");
  await prisma.studyGroupMember.delete({ where: { id: membership.id } });
}

export async function updateMemberRole(
  userId: string,
  groupId: string,
  memberUserId: string,
  role: string
): Promise<void> {
  // Only owner can change roles.
  const requesterMembership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId, role: "owner" },
  });
  if (!requesterMembership) throw new Error("Only the group owner can change member roles");
  if (!["admin", "member"].includes(role)) throw new Error("Role must be 'admin' or 'member'");
  await prisma.studyGroupMember.updateMany({
    where: { groupId, userId: memberUserId },
    data: { role },
  });
}

export async function removeMember(
  userId: string,
  groupId: string,
  memberUserId: string
): Promise<void> {
  // Only owner or admin can remove members.
  const requesterMembership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId, role: { in: ["owner", "admin"] } },
  });
  if (!requesterMembership) throw new Error("Only group owners or admins can remove members");
  if (userId === memberUserId) throw new Error("Use leaveGroup to remove yourself");
  await prisma.studyGroupMember.deleteMany({
    where: { groupId, userId: memberUserId },
  });
}

// ----- sharing decks -----

export async function shareDeck(
  userId: string,
  groupId: string,
  deckId: string,
  permission: "read" | "write" = "read"
): Promise<void> {
  // Verify the user is a member of the group.
  const membership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId },
  });
  if (!membership) throw new Error("You're not a member of this group");

  // Verify the user owns the deck.
  const deck = await prisma.flashcardDeck.findFirst({
    where: { id: deckId, userId },
  });
  if (!deck) throw new Error("Deck not found or you don't own it");

  // Check if already shared.
  const existing = await prisma.sharedDeck.findFirst({
    where: { groupId, deckId },
  });
  if (existing) {
    // Update permission.
    await prisma.sharedDeck.update({
      where: { id: existing.id },
      data: { permission },
    });
    return;
  }

  await prisma.sharedDeck.create({
    data: { groupId, deckId, sharedBy: userId, permission },
  });

  // Notify all group members (except the sharer) about the new shared deck.
  const members = await prisma.studyGroupMember.findMany({
    where: { groupId, userId: { not: userId } },
    select: { userId: true },
  });
  const group = await prisma.studyGroup.findUnique({ where: { id: groupId }, select: { name: true } });
  for (const m of members) {
    void deliverNotification(m.userId, {
      category: "circle_share",
      title: `New deck shared in ${group?.name ?? "group"}`,
      body: `${deck.name} was shared to the group (${permission} access).`,
      icon: "Layers",
      linkApp: "circle",
      linkPayload: JSON.stringify({ groupId, deckId }),
      tags: "layers",
    }).catch(() => {});
  }
}

export async function unshareDeck(userId: string, groupId: string, deckId: string): Promise<void> {
  // Verify membership.
  const membership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId },
  });
  if (!membership) throw new Error("You're not a member of this group");
  await prisma.sharedDeck.deleteMany({
    where: { groupId, deckId },
  });
}

// ----- sharing note folders -----

export async function shareNoteFolder(
  userId: string,
  groupId: string,
  folderId: string,
  permission: "read" | "write" = "read"
): Promise<void> {
  const membership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId },
  });
  if (!membership) throw new Error("You're not a member of this group");

  // Verify the user owns the folder.
  const folder = await prisma.noteFolder.findFirst({
    where: { id: folderId, userId },
  });
  if (!folder) throw new Error("Folder not found or you don't own it");

  const existing = await prisma.sharedNoteFolder.findFirst({
    where: { groupId, folderId },
  });
  if (existing) {
    await prisma.sharedNoteFolder.update({
      where: { id: existing.id },
      data: { permission },
    });
    return;
  }

  await prisma.sharedNoteFolder.create({
    data: { groupId, folderId, sharedBy: userId, permission },
  });

  // Notify all group members (except the sharer) about the new shared folder.
  const members = await prisma.studyGroupMember.findMany({
    where: { groupId, userId: { not: userId } },
    select: { userId: true },
  });
  const group = await prisma.studyGroup.findUnique({ where: { id: groupId }, select: { name: true } });
  for (const m of members) {
    void deliverNotification(m.userId, {
      category: "circle_share",
      title: `New notes folder shared in ${group?.name ?? "group"}`,
      body: `${folder.name} was shared to the group (${permission} access).`,
      icon: "FolderOpen",
      linkApp: "circle",
      linkPayload: JSON.stringify({ groupId, folderId }),
      tags: "folder",
    }).catch(() => {});
  }
}

export async function unshareNoteFolder(userId: string, groupId: string, folderId: string): Promise<void> {
  const membership = await prisma.studyGroupMember.findFirst({
    where: { groupId, userId },
  });
  if (!membership) throw new Error("You're not a member of this group");
  await prisma.sharedNoteFolder.deleteMany({
    where: { groupId, folderId },
  });
}

// ----- shared resource access -----

/** Get the shared decks accessible to a user (from all their groups). */
export async function getAccessibleDecks(userId: string): Promise<{ deckId: string; deckName: string; deckColor: string; cardCount: number; groupName: string; permission: string }[]> {
  const memberships = await prisma.studyGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  if (memberships.length === 0) return [];
  const groupIds = memberships.map((m) => m.groupId);
  const shared = await prisma.sharedDeck.findMany({
    where: { groupId: { in: groupIds } },
    include: { group: { select: { name: true } } },
  });
  const deckIds = shared.map((s) => s.deckId);
  const decks = deckIds.length > 0
    ? await prisma.flashcardDeck.findMany({
        where: { id: { in: deckIds } },
        include: { _count: { select: { cards: true } } },
      })
    : [];
  const deckMap = new Map(decks.map((d) => [d.id, d]));
  return shared
    .map((s) => {
      const deck = deckMap.get(s.deckId);
      if (!deck) return null;
      return {
        deckId: s.deckId,
        deckName: deck.name,
        deckColor: deck.color,
        cardCount: deck._count.cards,
        groupName: s.group.name,
        permission: s.permission,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Check if a user has access to a shared deck (via group membership). */
export async function checkDeckAccess(userId: string, deckId: string): Promise<{ hasAccess: boolean; permission: "read" | "write" | null }> {
  const memberships = await prisma.studyGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  if (memberships.length === 0) return { hasAccess: false, permission: null };
  const groupIds = memberships.map((m) => m.groupId);
  const shared = await prisma.sharedDeck.findFirst({
    where: { groupId: { in: groupIds }, deckId },
  });
  if (!shared) return { hasAccess: false, permission: null };
  return { hasAccess: true, permission: shared.permission as "read" | "write" };
}

/** Get the shared note folders accessible to a user (from all their groups). */
export async function getAccessibleFolders(userId: string): Promise<{ folderId: string; folderName: string; noteCount: number; groupName: string; sharedByName: string; permission: string }[]> {
  const memberships = await prisma.studyGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  if (memberships.length === 0) return [];
  const groupIds = memberships.map((m) => m.groupId);
  const shared = await prisma.sharedNoteFolder.findMany({
    where: { groupId: { in: groupIds } },
    include: { group: { select: { name: true } } },
  });
  const folderIds = shared.map((s) => s.folderId);
  const folders = folderIds.length > 0
    ? await prisma.noteFolder.findMany({
        where: { id: { in: folderIds } },
        include: { _count: { select: { notes: true } } },
      })
    : [];
  const folderMap = new Map(folders.map((f) => [f.id, f]));
  // Sharer names.
  const sharerIds = [...new Set(shared.map((s) => s.sharedBy))];
  const sharers = sharerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: sharerIds } }, select: { id: true, username: true, displayName: true } })
    : [];
  const sharerMap = new Map(sharers.map((s) => [s.id, s]));
  return shared
    .map((s) => {
      const folder = folderMap.get(s.folderId);
      if (!folder) return null;
      const sharer = sharerMap.get(s.sharedBy);
      return {
        folderId: s.folderId,
        folderName: folder.name,
        noteCount: folder._count.notes,
        groupName: s.group.name,
        sharedByName: sharer?.displayName || sharer?.username || "Unknown",
        permission: s.permission,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Check if a user has access to a shared note folder (via group membership). */
export async function checkFolderAccess(userId: string, folderId: string): Promise<{ hasAccess: boolean; permission: "read" | "write" | null }> {
  const memberships = await prisma.studyGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  if (memberships.length === 0) return { hasAccess: false, permission: null };
  const groupIds = memberships.map((m) => m.groupId);
  const shared = await prisma.sharedNoteFolder.findFirst({
    where: { groupId: { in: groupIds }, folderId },
  });
  if (!shared) return { hasAccess: false, permission: null };
  return { hasAccess: true, permission: shared.permission as "read" | "write" };
}
