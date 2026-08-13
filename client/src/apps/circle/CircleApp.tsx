// ===== Circle app (Pro-tier shared study spaces) =====
// Shared spaces where a small group of classmates can share flashcard decks,
// notes folders, and collaborate. One student creates a group, invites
// others via an invite code, and shared resources become accessible to all.
//
// UI: two-state layout —
//   1. Group list: shows all groups the user is in + "Create" / "Join" buttons
//   2. Group detail: shows members, shared decks, shared note folders,
//      and management actions (share, unshare, remove member, leave/delete)
//
// Integrates with Flashcards (deck sharing) and Notes (folder sharing).

import { useState, useEffect, useCallback } from "react";
import {
  Users, Plus, Trash2, RefreshCw, Loader2, AlertCircle, X,
  ChevronLeft, Copy, Check, UserPlus, LogOut, Crown, Shield,
  FolderOpen, Layers, BookOpen, Lock, Unlock, UserX, Sparkles,
} from "lucide-react";
import {
  circleApi,
  type StudyGroupSummary, type StudyGroup,
} from "../../services/circle";
import { flashcardsApi } from "../../services/flashcards";
import { notesApi } from "../../services/notes";
import type { WindowInstance } from "../../store/windows";

// ----- main component -----

export default function CircleApp({ win }: { win: WindowInstance }) {
  const [groups, setGroups] = useState<StudyGroupSummary[]>([]);
  const [activeGroup, setActiveGroup] = useState<StudyGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await circleApi.listGroups();
      setGroups(res.groups);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGroup = useCallback(async (groupId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await circleApi.getGroup(groupId);
      setActiveGroup(res.group);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load group");
    } finally {
      setLoading(false);
    }
  }, []);

  // Focus on a specific group (from Athena open_circle client action).
  useEffect(() => {
    const focusGroupId = sessionStorage.getItem(`circle:focus:${win.id}`);
    if (focusGroupId) {
      sessionStorage.removeItem(`circle:focus:${win.id}`);
      loadGroup(focusGroupId);
    } else {
      loadGroups();
    }
  }, [win.id, loadGroups, loadGroup]);

  const handleLeaveGroup = async () => {
    if (!activeGroup || !confirm("Leave this group? You'll lose access to shared resources.")) return;
    try {
      await circleApi.leaveGroup(activeGroup.id);
      setActiveGroup(null);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to leave group");
    }
  };

  const handleDeleteGroup = async () => {
    if (!activeGroup || !confirm("Delete this group? All shared resources will be unshared. This cannot be undone.")) return;
    try {
      await circleApi.deleteGroup(activeGroup.id);
      setActiveGroup(null);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete group");
    }
  };

  if (loading && !activeGroup && groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (error && !activeGroup) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="text-red-400" size={32} />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => { setError(null); loadGroups(); }}
          className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs hover:brightness-110"
        >
          Retry
        </button>
      </div>
    );
  }

  if (activeGroup) {
    return (
      <GroupDetailView
        group={activeGroup}
        onBack={() => { setActiveGroup(null); loadGroups(); }}
        onLeave={handleLeaveGroup}
        onDelete={handleDeleteGroup}
        onRefresh={() => loadGroup(activeGroup.id)}
      />
    );
  }

  return (
    <GroupListView
      groups={groups}
      onOpen={loadGroup}
      onCreate={() => setShowCreate(true)}
      onJoin={() => setShowJoin(true)}
      onRefresh={loadGroups}
    >
      {showCreate && (
        <CreateGroupDialog
          onComplete={(groupId) => { setShowCreate(false); loadGroup(groupId); }}
          onCancel={() => setShowCreate(false)}
        />
      )}
      {showJoin && (
        <JoinGroupDialog
          onComplete={(groupId) => { setShowJoin(false); loadGroup(groupId); }}
          onCancel={() => setShowJoin(false)}
        />
      )}
    </GroupListView>
  );
}

// ----- group list view -----

function GroupListView({
  groups, onOpen, onCreate, onJoin, onRefresh, children,
}: {
  groups: StudyGroupSummary[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <Users className="text-emerald-400" size={18} />
          <h2 className="text-sm font-semibold text-ink">Circle</h2>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted">
            {groups.length} group{groups.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onJoin}
            className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs text-ink hover:brightness-110"
          >
            <UserPlus size={14} /> Join
          </button>
          <button
            onClick={onCreate}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500"
          >
            <Plus size={14} /> Create
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Users className="text-ink-muted" size={48} />
            <p className="text-sm text-ink-muted">No study groups yet.</p>
            <p className="text-xs text-ink-muted">Create a group and invite classmates, or join an existing group with an invite code.</p>
            <div className="flex gap-2">
              <button
                onClick={onCreate}
                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500"
              >
                <Plus size={14} /> Create Group
              </button>
              <button
                onClick={onJoin}
                className="flex items-center gap-1 rounded-lg bg-surface-3 px-3 py-1.5 text-xs text-ink hover:brightness-110"
              >
                <UserPlus size={14} /> Join with Code
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <div
                key={group.id}
                className="group cursor-pointer rounded-xl border border-surface-3 bg-surface-2 p-4 transition hover:border-emerald-500/50 hover:bg-surface-3"
                onClick={() => onOpen(group.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-ink">{group.name}</h3>
                    {group.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{group.description}</p>
                    )}
                  </div>
                  {group.role === "owner" && (
                    <Crown className="shrink-0 text-amber-400" size={14} />
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3 text-[10px] text-ink-muted">
                  <span className="flex items-center gap-1">
                    <Users size={10} /> {group.memberCount}
                  </span>
                  {group.sharedDeckCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Layers size={10} /> {group.sharedDeckCount} decks
                    </span>
                  )}
                  {group.sharedFolderCount > 0 && (
                    <span className="flex items-center gap-1">
                      <FolderOpen size={10} /> {group.sharedFolderCount} folders
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ----- group detail view -----

function GroupDetailView({
  group, onBack, onLeave, onDelete, onRefresh,
}: {
  group: StudyGroup;
  onBack: () => void;
  onLeave: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showShareDeck, setShowShareDeck] = useState(false);
  const [showShareFolder, setShowShareFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = group.role === "owner";
  const isAdmin = group.role === "owner" || group.role === "admin";

  const copyInviteCode = () => {
    navigator.clipboard.writeText(group.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemoveMember = async (memberUserId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from the group?`)) return;
    try {
      await circleApi.removeMember(group.id, memberUserId);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member");
    }
  };

  const handleUnshareDeck = async (deckId: string) => {
    try {
      await circleApi.unshareDeck(group.id, deckId);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unshare deck");
    }
  };

  const handleUnshareFolder = async (folderId: string) => {
    try {
      await circleApi.unshareFolder(group.id, folderId);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unshare folder");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <ChevronLeft size={14} /> Groups
          </button>
          <span className="text-ink-muted">/</span>
          <h2 className="truncate text-sm font-semibold text-ink">{group.name}</h2>
          {isOwner && <Crown className="text-amber-400" size={12} />}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          {isOwner ? (
            <button
              onClick={onDelete}
              className="rounded-lg p-1.5 text-ink-muted hover:bg-red-500/10 hover:text-red-400"
              title="Delete group"
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <button
              onClick={onLeave}
              className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs text-ink-muted hover:text-red-400"
            >
              <LogOut size={12} /> Leave
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Description + invite code */}
          {group.description && (
            <p className="text-sm text-ink-muted">{group.description}</p>
          )}

          <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3">
            <span className="text-xs text-ink-muted">Invite code:</span>
            <code className="rounded bg-surface-3 px-2 py-0.5 text-sm font-mono text-emerald-400">
              {group.inviteCode}
            </code>
            <button
              onClick={copyInviteCode}
              className="ml-auto flex items-center gap-1 rounded p-1 text-ink-muted hover:text-ink"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>

          {/* Members */}
          <section>
            <h3 className="mb-2 flex items-center gap-1 text-xs font-medium text-ink">
              <Users size={12} /> Members ({group.members.length})
            </h3>
            <div className="space-y-2">
              {group.members.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-center gap-3 rounded-lg bg-surface-2 p-3"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: m.avatarColor }}
                  >
                    {(m.displayName || m.username).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{m.displayName || m.username}</p>
                    <p className="text-[10px] text-ink-muted">@{m.username}</p>
                  </div>
                  {m.role === "owner" ? (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400">
                      <Crown size={10} /> Owner
                    </span>
                  ) : m.role === "admin" ? (
                    <span className="flex items-center gap-1 text-[10px] text-blue-400">
                      <Shield size={10} /> Admin
                    </span>
                  ) : (
                    <span className="text-[10px] text-ink-muted">Member</span>
                  )}
                  {isAdmin && m.role !== "owner" && (
                    <button
                      onClick={() => handleRemoveMember(m.userId, m.displayName || m.username)}
                      className="rounded p-1 text-ink-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                      title="Remove member"
                    >
                      <UserX size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Shared decks */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1 text-xs font-medium text-ink">
                <Layers size={12} /> Shared Decks ({group.sharedDecks.length})
              </h3>
              <button
                onClick={() => setShowShareDeck(true)}
                className="flex items-center gap-1 rounded bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted hover:brightness-110"
              >
                <Plus size={10} /> Share
              </button>
            </div>
            {group.sharedDecks.length === 0 ? (
              <p className="rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">No decks shared yet.</p>
            ) : (
              <div className="space-y-2">
                {group.sharedDecks.map((d) => (
                  <div key={d.id} className="group flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                    <div
                      className="h-8 w-8 shrink-0 rounded-lg"
                      style={{ backgroundColor: d.deckColor }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{d.deckName}</p>
                      <p className="text-[10px] text-ink-muted">
                        {d.cardCount} cards · shared by {d.sharedByName}
                      </p>
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] ${d.permission === "write" ? "text-emerald-400" : "text-ink-muted"}`}>
                      {d.permission === "write" ? <Unlock size={10} /> : <Lock size={10} />}
                      {d.permission}
                    </span>
                    <button
                      onClick={() => handleUnshareDeck(d.deckId)}
                      className="rounded p-1 text-ink-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                      title="Unshare"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Shared note folders */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1 text-xs font-medium text-ink">
                <FolderOpen size={12} /> Shared Note Folders ({group.sharedNoteFolders.length})
              </h3>
              <button
                onClick={() => setShowShareFolder(true)}
                className="flex items-center gap-1 rounded bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted hover:brightness-110"
              >
                <Plus size={10} /> Share
              </button>
            </div>
            {group.sharedNoteFolders.length === 0 ? (
              <p className="rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">No folders shared yet.</p>
            ) : (
              <div className="space-y-2">
                {group.sharedNoteFolders.map((f) => (
                  <div key={f.id} className="group flex items-center gap-3 rounded-lg bg-surface-2 p-3">
                    <BookOpen className="shrink-0 text-ink-muted" size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{f.folderName}</p>
                      <p className="text-[10px] text-ink-muted">
                        {f.noteCount} notes · shared by {f.sharedByName}
                      </p>
                    </div>
                    <span className={`flex items-center gap-1 text-[10px] ${f.permission === "write" ? "text-emerald-400" : "text-ink-muted"}`}>
                      {f.permission === "write" ? <Unlock size={10} /> : <Lock size={10} />}
                      {f.permission}
                    </span>
                    <button
                      onClick={() => handleUnshareFolder(f.folderId)}
                      className="rounded p-1 text-ink-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                      title="Unshare"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
          )}
        </div>
      </div>

      {showShareDeck && (
        <ShareDialog
          title="Share a Deck"
          kind="deck"
          groupId={group.id}
          onComplete={async () => { setShowShareDeck(false); await onRefresh(); }}
          onCancel={() => setShowShareDeck(false)}
        />
      )}
      {showShareFolder && (
        <ShareDialog
          title="Share a Note Folder"
          kind="folder"
          groupId={group.id}
          onComplete={async () => { setShowShareFolder(false); await onRefresh(); }}
          onCancel={() => setShowShareFolder(false)}
        />
      )}
    </div>
  );
}

// ----- create group dialog -----

function CreateGroupDialog({
  onComplete, onCancel,
}: {
  onComplete: (groupId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await circleApi.createGroup({ name: name.trim(), description: description.trim() || undefined });
      onComplete(res.group.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-surface-3 bg-surface-1 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Users className="text-emerald-400" size={16} /> Create Study Group
          </h3>
          <button onClick={onCancel} className="rounded p-1 text-ink-muted hover:bg-surface-3">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Group name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Calculus Study Group"
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this group for?"
              rows={2}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-emerald-500 focus:outline-none"
            />
          </div>
          {error && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-lg bg-surface-3 px-4 py-2 text-xs text-ink-muted hover:brightness-110">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !name.trim()}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- join group dialog -----

function JoinGroupDialog({
  onComplete, onCancel,
}: {
  onComplete: (groupId: string) => void;
  onCancel: () => void;
}) {
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await circleApi.joinGroup(inviteCode.trim());
      onComplete(res.group.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Join failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-surface-3 bg-surface-1 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <UserPlus className="text-emerald-400" size={16} /> Join Study Group
          </h3>
          <button onClick={onCancel} className="rounded p-1 text-ink-muted hover:bg-surface-3">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Invite code</label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABC123"
              maxLength={10}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm font-mono text-ink placeholder:text-ink-muted focus:border-emerald-500 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-ink-muted">Ask the group owner for the 6-character invite code.</p>
          </div>
          {error && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-lg bg-surface-3 px-4 py-2 text-xs text-ink-muted hover:brightness-110">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !inviteCode.trim()}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
              Join
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- share dialog (deck or folder) -----

function ShareDialog({
  title, kind, groupId, onComplete, onCancel,
}: {
  title: string;
  kind: "deck" | "folder";
  groupId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [permission, setPermission] = useState<"read" | "write">("read");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind === "deck") {
      flashcardsApi.listDecks().then((res) => setItems(res.decks.map((d) => ({ id: d.id, name: d.name })))).catch(() => {});
    } else {
      notesApi.listFolders().then((res) => setItems(res.folders.map((f) => ({ id: f.id, name: f.name })))).catch(() => {});
    }
  }, [kind]);

  const handleSubmit = async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      if (kind === "deck") {
        await circleApi.shareDeck(groupId, selectedId, permission);
      } else {
        await circleApi.shareFolder(groupId, selectedId, permission);
      }
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Share failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-surface-3 bg-surface-1 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="text-emerald-400" size={16} /> {title}
          </h3>
          <button onClick={onCancel} className="rounded p-1 text-ink-muted hover:bg-surface-3">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-muted">
              {kind === "deck" ? "Select a deck" : "Select a folder"}
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select...</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            {items.length === 0 && (
              <p className="mt-1 text-[10px] text-ink-muted">
                {kind === "deck" ? "You don't have any decks yet." : "You don't have any note folders yet."}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Permission</label>
            <div className="flex gap-2">
              <button
                onClick={() => setPermission("read")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg border p-2 text-xs ${
                  permission === "read" ? "border-emerald-500 bg-emerald-500/10 text-ink" : "border-surface-3 bg-surface-2 text-ink-muted"
                }`}
              >
                <Lock size={12} /> Read only
              </button>
              <button
                onClick={() => setPermission("write")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg border p-2 text-xs ${
                  permission === "write" ? "border-emerald-500 bg-emerald-500/10 text-ink" : "border-surface-3 bg-surface-2 text-ink-muted"
                }`}
              >
                <Unlock size={12} /> Read & Write
              </button>
            </div>
          </div>
          {error && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-lg bg-surface-3 px-4 py-2 text-xs text-ink-muted hover:brightness-110">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !selectedId}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
              Share
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
