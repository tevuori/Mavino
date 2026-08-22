// ===== Mobile Circle (Pro-tier shared study spaces) =====
// Mobile-optimized view of Circle — group list + create/join, group detail
// with members, shared decks/folders (tap through to Flashcards/Notes),
// sharing a deck/folder, and member/group management.

import { useState, useEffect, useCallback } from "react";
import {
  Users, Plus, Trash2, Loader2, AlertCircle,
  Copy, Check, UserPlus, LogOut, Crown, Shield,
  FolderOpen, Layers, Lock, Unlock, UserX, Sparkles,
} from "lucide-react";
import {
  circleApi,
  type StudyGroupSummary, type StudyGroup,
} from "../services/circle";
import { flashcardsApi } from "../services/flashcards";
import { notesApi } from "../services/notes";
import type { MobileTool } from "./MobileLauncher";
import {
  MobileContainer, MobileHeader, MobileEmpty, MobileLoading, MobileCard,
  MobileInput, MobileTextarea, MobileButton, MobileModal, MobileSelect,
} from "./MobileUi";

export default function MobileCircle({ onClose, onOpenTool }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
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

  const loadGroup = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await circleApi.getGroup(id);
      setActiveGroup(res.group);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load group");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadGroups(); }, [loadGroups]);

  const handleCreate = async (name: string, description: string) => {
    try {
      const res = await circleApi.createGroup({ name, description: description || undefined });
      setShowCreate(false);
      await loadGroup(res.group.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group");
    }
  };

  const handleJoin = async (inviteCode: string) => {
    try {
      const res = await circleApi.joinGroup(inviteCode);
      setShowJoin(false);
      await loadGroup(res.group.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join group");
    }
  };

  const handleLeave = async () => {
    if (!activeGroup || !confirm("Leave this group? You'll lose access to shared resources.")) return;
    try {
      await circleApi.leaveGroup(activeGroup.id);
      setActiveGroup(null);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to leave group");
    }
  };

  const handleDelete = async () => {
    if (!activeGroup || !confirm("Delete this group? All shared resources will be unshared. This cannot be undone.")) return;
    try {
      await circleApi.deleteGroup(activeGroup.id);
      setActiveGroup(null);
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete group");
    }
  };

  if (activeGroup) {
    return (
      <GroupDetail
        group={activeGroup}
        error={error}
        onBack={() => { setActiveGroup(null); void loadGroups(); }}
        onRefresh={() => loadGroup(activeGroup.id)}
        onLeave={handleLeave}
        onDelete={handleDelete}
        onOpenTool={onOpenTool}
        setError={setError}
      />
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Circle"
        subtitle="Shared study groups"
        onClose={onClose}
        right={
          <button
            onClick={() => setShowCreate(true)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-ink"
          >
            <Plus size={20} />
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <MobileButton className="flex-1" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Create
        </MobileButton>
        <MobileButton variant="ghost" className="flex-1" onClick={() => setShowJoin(true)}>
          <UserPlus size={16} /> Join
        </MobileButton>
      </div>

      {loading && groups.length === 0 ? (
        <MobileLoading />
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
            <Users size={32} className="text-accent" />
          </div>
          <p className="max-w-xs text-sm leading-6 text-ink-muted">
            Create a study group and invite classmates, or join an existing one with an invite code, to share flashcard decks and note folders.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <MobileCard key={g.id} onClick={() => loadGroup(g.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{g.name}</p>
                  {g.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{g.description}</p>}
                </div>
                {g.role === "owner" && <Crown size={16} className="shrink-0 text-amber-400" />}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-muted">
                <span className="flex items-center gap-1"><Users size={11} /> {g.memberCount}</span>
                {g.sharedDeckCount > 0 && <span className="flex items-center gap-1"><Layers size={11} /> {g.sharedDeckCount} decks</span>}
                {g.sharedFolderCount > 0 && <span className="flex items-center gap-1"><FolderOpen size={11} /> {g.sharedFolderCount} folders</span>}
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      <MobileModal open={showCreate} onClose={() => setShowCreate(false)} title="Create study group">
        <CreateGroupForm onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
      </MobileModal>

      <MobileModal open={showJoin} onClose={() => setShowJoin(false)} title="Join study group">
        <JoinGroupForm onSubmit={handleJoin} onCancel={() => setShowJoin(false)} />
      </MobileModal>
    </MobileContainer>
  );
}

function CreateGroupForm({ onSubmit, onCancel }: { onSubmit: (name: string, description: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="space-y-3">
      <MobileInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name *" />
      <MobileTextarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this group for? (optional)" rows={3} />
      <div className="flex justify-end gap-2 pt-1">
        <MobileButton variant="ghost" onClick={onCancel}>Cancel</MobileButton>
        <MobileButton onClick={() => onSubmit(name.trim(), description.trim())} disabled={!name.trim()}>
          <Plus size={16} /> Create
        </MobileButton>
      </div>
    </div>
  );
}

function JoinGroupForm({ onSubmit, onCancel }: { onSubmit: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="space-y-3">
      <MobileInput
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Invite code (e.g. ABC123)"
        maxLength={10}
      />
      <p className="text-[11px] text-ink-muted">Ask the group owner for the invite code.</p>
      <div className="flex justify-end gap-2 pt-1">
        <MobileButton variant="ghost" onClick={onCancel}>Cancel</MobileButton>
        <MobileButton onClick={() => onSubmit(code.trim())} disabled={!code.trim()}>
          <UserPlus size={16} /> Join
        </MobileButton>
      </div>
    </div>
  );
}

// ----- group detail -----

function GroupDetail({
  group, error, onBack, onRefresh, onLeave, onDelete, onOpenTool, setError,
}: {
  group: StudyGroup;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onLeave: () => void;
  onDelete: () => void;
  onOpenTool: (tool: MobileTool) => void;
  setError: (e: string | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showShareDeck, setShowShareDeck] = useState(false);
  const [showShareFolder, setShowShareFolder] = useState(false);
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
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member");
    }
  };

  const handleUnshareDeck = async (deckId: string) => {
    try {
      await circleApi.unshareDeck(group.id, deckId);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unshare deck");
    }
  };

  const handleUnshareFolder = async (folderId: string) => {
    try {
      await circleApi.unshareFolder(group.id, folderId);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unshare folder");
    }
  };

  return (
    <MobileContainer>
      <MobileHeader
        title={group.name}
        subtitle="Study group"
        onBack={onBack}
        right={
          isOwner ? (
            <button onClick={onDelete} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-red-300">
              <Trash2 size={20} />
            </button>
          ) : (
            <button onClick={onLeave} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-red-300">
              <LogOut size={20} />
            </button>
          )
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {group.description && <p className="mb-4 text-sm leading-6 text-ink-muted">{group.description}</p>}

      <div className="mb-5 flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 px-4 py-3">
        <span className="text-xs text-ink-muted">Invite code:</span>
        <code className="rounded-lg bg-surface-3 px-2 py-1 text-sm font-mono text-accent">{group.inviteCode}</code>
        <button onClick={copyInviteCode} className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted active:bg-surface-3">
          {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
        </button>
      </div>

      {/* Members */}
      <section className="mb-5">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Users size={14} /> Members ({group.members.length})
        </h3>
        <div className="space-y-2">
          {group.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: m.avatarColor }}
              >
                {(m.displayName || m.username).slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{m.displayName || m.username}</p>
                <p className="text-[11px] text-ink-muted">@{m.username}</p>
              </div>
              {m.role === "owner" ? (
                <span className="flex items-center gap-1 text-[11px] text-amber-400"><Crown size={11} /> Owner</span>
              ) : m.role === "admin" ? (
                <span className="flex items-center gap-1 text-[11px] text-blue-400"><Shield size={11} /> Admin</span>
              ) : (
                <span className="text-[11px] text-ink-muted">Member</span>
              )}
              {isAdmin && m.role !== "owner" && (
                <button
                  onClick={() => handleRemoveMember(m.userId, m.displayName || m.username)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ink-muted active:bg-red-500/10 active:text-red-400"
                  title="Remove member"
                >
                  <UserX size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Shared decks */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Layers size={14} /> Shared decks ({group.sharedDecks.length})
          </h3>
          <button onClick={() => setShowShareDeck(true)} className="flex items-center gap-1 rounded-full bg-surface-3 px-3 py-1 text-[11px] text-ink-muted active:bg-surface-2">
            <Plus size={11} /> Share
          </button>
        </div>
        {group.sharedDecks.length === 0 ? (
          <MobileEmpty text="No decks shared yet." />
        ) : (
          <div className="space-y-2">
            {group.sharedDecks.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3">
                <button onClick={() => onOpenTool("flashcards")} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="h-9 w-9 shrink-0 rounded-xl" style={{ backgroundColor: d.deckColor }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{d.deckName}</p>
                    <p className="text-[11px] text-ink-muted">{d.cardCount} cards · shared by {d.sharedByName}</p>
                  </div>
                </button>
                <span className={`flex shrink-0 items-center gap-1 text-[11px] ${d.permission === "write" ? "text-emerald-400" : "text-ink-muted"}`}>
                  {d.permission === "write" ? <Unlock size={11} /> : <Lock size={11} />}
                </span>
                <button onClick={() => handleUnshareDeck(d.deckId)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ink-muted active:bg-red-500/10 active:text-red-400">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Shared note folders */}
      <section className="mb-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <FolderOpen size={14} /> Shared note folders ({group.sharedNoteFolders.length})
          </h3>
          <button onClick={() => setShowShareFolder(true)} className="flex items-center gap-1 rounded-full bg-surface-3 px-3 py-1 text-[11px] text-ink-muted active:bg-surface-2">
            <Plus size={11} /> Share
          </button>
        </div>
        {group.sharedNoteFolders.length === 0 ? (
          <MobileEmpty text="No folders shared yet." />
        ) : (
          <div className="space-y-2">
            {group.sharedNoteFolders.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3">
                <button onClick={() => onOpenTool("notes")} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <FolderOpen size={20} className="shrink-0 text-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{f.folderName}</p>
                    <p className="text-[11px] text-ink-muted">{f.noteCount} notes · shared by {f.sharedByName}</p>
                  </div>
                </button>
                <span className={`flex shrink-0 items-center gap-1 text-[11px] ${f.permission === "write" ? "text-emerald-400" : "text-ink-muted"}`}>
                  {f.permission === "write" ? <Unlock size={11} /> : <Lock size={11} />}
                </span>
                <button onClick={() => handleUnshareFolder(f.folderId)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ink-muted active:bg-red-500/10 active:text-red-400">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <MobileModal open={showShareDeck} onClose={() => setShowShareDeck(false)} title="Share a deck">
        <ShareForm kind="deck" groupId={group.id} onComplete={() => { setShowShareDeck(false); onRefresh(); }} onCancel={() => setShowShareDeck(false)} />
      </MobileModal>
      <MobileModal open={showShareFolder} onClose={() => setShowShareFolder(false)} title="Share a note folder">
        <ShareForm kind="folder" groupId={group.id} onComplete={() => { setShowShareFolder(false); onRefresh(); }} onCancel={() => setShowShareFolder(false)} />
      </MobileModal>
    </MobileContainer>
  );
}

function ShareForm({
  kind, groupId, onComplete, onCancel,
}: {
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
    <div className="space-y-3">
      <div>
        <MobileSelect value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">{kind === "deck" ? "Select a deck…" : "Select a folder…"}</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </MobileSelect>
        {items.length === 0 && (
          <p className="mt-1.5 text-[11px] text-ink-muted">
            {kind === "deck" ? "You don't have any decks yet." : "You don't have any note folders yet."}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setPermission("read")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 text-sm ${
            permission === "read" ? "border-accent/60 bg-accent/10 text-ink" : "border-edge bg-surface-2 text-ink-muted"
          }`}
        >
          <Lock size={13} /> Read only
        </button>
        <button
          onClick={() => setPermission("write")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 text-sm ${
            permission === "write" ? "border-accent/60 bg-accent/10 text-ink" : "border-edge bg-surface-2 text-ink-muted"
          }`}
        >
          <Unlock size={13} /> Read & write
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <MobileButton variant="ghost" onClick={onCancel}>Cancel</MobileButton>
        <MobileButton onClick={handleSubmit} disabled={loading || !selectedId}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          Share
        </MobileButton>
      </div>
    </div>
  );
}
