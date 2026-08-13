// ===== Athena tools: Circle (Pro-tier shared study spaces) =====
// Lets Athena list groups, get group details, create groups, join groups,
// share decks/folders, and open the Circle app. Integrates with Flashcards
// (deck sharing) and Notes (folder sharing).

import type { ToolDef } from "./plugin";
import {
  listGroups,
  getGroup,
  createGroup,
  joinGroup,
  shareDeck,
  shareNoteFolder,
  getAccessibleDecks,
} from "../../circle";

export const circleTools: ToolDef[] = [
  {
    name: "circle_list_groups",
    description:
      "List the user's Circle study groups — shared spaces where they collaborate with classmates. Each group has a name, description, invite code, member count, and shared resource counts. Use this when the user asks about their study groups or shared spaces.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const groups = await listGroups(userId);
      if (groups.length === 0) {
        return { count: 0, groups: [], note: "No study groups yet. The user can create one with circle_create_group or join one with circle_join_group." };
      }
      return {
        count: groups.length,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          role: g.role,
          memberCount: g.memberCount,
          sharedDecks: g.sharedDeckCount,
          sharedFolders: g.sharedFolderCount,
          inviteCode: g.role === "owner" ? g.inviteCode : undefined,
        })),
      };
    },
  },
  {
    name: "circle_get_group",
    description:
      "Get details about a specific Circle study group — members (with usernames and roles), shared decks (with card counts), and shared note folders. Use this after circle_list_groups when the user asks about a specific group or wants to see who's in it.",
    proOnly: true,
    parameters: [
      { name: "groupId", type: "string", description: "The group id (from circle_list_groups)", required: true },
    ],
    handler: async (args, { userId }) => {
      const groupId = String(args.groupId ?? "").trim();
      if (!groupId) return { error: "groupId is required" };
      const group = await getGroup(userId, groupId);
      if (!group) return { error: "Group not found or you're not a member" };
      return {
        id: group.id,
        name: group.name,
        description: group.description,
        inviteCode: group.inviteCode,
        role: group.role,
        ownerName: group.ownerName,
        members: group.members.map((m) => ({
          username: m.username,
          displayName: m.displayName,
          role: m.role,
        })),
        sharedDecks: group.sharedDecks.map((d) => ({
          deckName: d.deckName,
          cardCount: d.cardCount,
          sharedBy: d.sharedByName,
          permission: d.permission,
        })),
        sharedNoteFolders: group.sharedNoteFolders.map((f) => ({
          folderName: f.folderName,
          noteCount: f.noteCount,
          sharedBy: f.sharedByName,
          permission: f.permission,
        })),
      };
    },
  },
  {
    name: "circle_create_group",
    description:
      "Create a new Circle study group. The user becomes the owner and can invite classmates via the invite code. Use this when the user asks to create a study group, start a shared space, or set up collaboration with classmates.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "name", type: "string", description: "Group name (e.g. 'Calculus Study Group')", required: true },
      { name: "description", type: "string", description: "Optional group description" },
    ],
    handler: async (args, { userId }) => {
      const name = String(args.name ?? "").trim();
      if (!name) return { error: "name is required" };
      try {
        const group = await createGroup(userId, {
          name,
          description: args.description ? String(args.description) : undefined,
        });
        return {
          ...group,
          message: `Created study group "${group.name}". Share the invite code "${group.inviteCode}" with classmates so they can join. Use open_circle to open the app.`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Creation failed" };
      }
    },
  },
  {
    name: "circle_join_group",
    description:
      "Join a Circle study group using an invite code. Use this when the user has an invite code from a classmate and wants to join their study group.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "inviteCode", type: "string", description: "The 6-character invite code shared by the group owner", required: true },
    ],
    handler: async (args, { userId }) => {
      const inviteCode = String(args.inviteCode ?? "").trim();
      if (!inviteCode) return { error: "inviteCode is required" };
      try {
        const group = await joinGroup(userId, inviteCode);
        return { ...group, message: `Joined study group "${group.name}". Use open_circle to see the shared resources.` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Join failed" };
      }
    },
  },
  {
    name: "circle_share_deck",
    description:
      "Share one of the user's flashcard decks to a Circle study group. The deck content becomes accessible to all group members. Use 'read' permission for view-only access or 'write' to let members edit the deck. Use this when the user wants to share their flashcards with a study group.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "groupId", type: "string", description: "The group id to share to", required: true },
      { name: "deckId", type: "string", description: "The deck id to share (must be owned by the user)", required: true },
      { name: "permission", type: "string", description: "Permission level: 'read' (default) or 'write'" },
    ],
    handler: async (args, { userId }) => {
      const groupId = String(args.groupId ?? "").trim();
      const deckId = String(args.deckId ?? "").trim();
      if (!groupId || !deckId) return { error: "groupId and deckId are required" };
      const permission = (args.permission === "write" ? "write" : "read") as "read" | "write";
      try {
        await shareDeck(userId, groupId, deckId, permission);
        return { ok: true, message: `Deck shared to the group with ${permission} permission.` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Share failed" };
      }
    },
  },
  {
    name: "circle_share_folder",
    description:
      "Share one of the user's note folders to a Circle study group. The folder's notes become accessible to all group members. Use 'read' permission for view-only access or 'write' to let members edit the notes. Use this when the user wants to share their notes with a study group.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "groupId", type: "string", description: "The group id to share to", required: true },
      { name: "folderId", type: "string", description: "The note folder id to share (must be owned by the user)", required: true },
      { name: "permission", type: "string", description: "Permission level: 'read' (default) or 'write'" },
    ],
    handler: async (args, { userId }) => {
      const groupId = String(args.groupId ?? "").trim();
      const folderId = String(args.folderId ?? "").trim();
      if (!groupId || !folderId) return { error: "groupId and folderId are required" };
      const permission = (args.permission === "write" ? "write" : "read") as "read" | "write";
      try {
        await shareNoteFolder(userId, groupId, folderId, permission);
        return { ok: true, message: `Note folder shared to the group with ${permission} permission.` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Share failed" };
      }
    },
  },
  {
    name: "circle_accessible_decks",
    description:
      "List all flashcard decks that are accessible to the user via Circle study groups (decks shared by other members). Use this when the user asks about shared flashcards or decks from their study groups.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const decks = await getAccessibleDecks(userId);
      if (decks.length === 0) {
        return { count: 0, decks: [], note: "No shared decks accessible. Join a study group or have a member share a deck." };
      }
      return {
        count: decks.length,
        decks: decks.map((d) => ({
          deckName: d.deckName,
          cardCount: d.cardCount,
          groupName: d.groupName,
          permission: d.permission,
        })),
      };
    },
  },
  {
    name: "open_circle",
    description:
      "Open the Circle app on the user's desktop, optionally focused on a specific study group. Use after creating/joining a group or when the user asks to manage their study spaces.",
    clientAction: true,
    proOnly: true,
    parameters: [
      { name: "groupId", type: "string", description: "Optional group id to focus on" },
    ],
    handler: async (args) => ({ action: "open_circle", groupId: args.groupId ? String(args.groupId) : undefined }),
  },
];
