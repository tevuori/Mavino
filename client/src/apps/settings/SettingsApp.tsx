import { useState } from "react";
import {
  Settings as SettingsIcon,
  Palette,
  Image,
  Film,
  User,
  Volume2,
  Sparkles,
  Plug,
  Bell,
  BellRing,
  Users as UsersIcon,
  Database,
  Info,
  BarChart3,
  Clock,
  Shield,
  LayoutGrid,
  AlertTriangle,
  GraduationCap,
  CreditCard,
  Puzzle,
  Keyboard,
  Activity,
} from "lucide-react";
import { useAuth } from "../../store/auth";
import type { WindowInstance } from "../../store/windows";
import CollapsibleSidebar from "../../wm/CollapsibleSidebar";
import AppearanceSection from "./sections/AppearanceSection";
import WallpaperSection from "./sections/WallpaperSection";
import AnimatedBgSection from "./sections/AnimatedBgSection";
import AccountSection from "./sections/AccountSection";
import SoundAthenaSection from "./sections/SoundAthenaSection";
import AthenaSection from "./sections/AthenaSection";
import IntegrationsSection from "./sections/IntegrationsSection";
import NotificationsSection from "./sections/NotificationsSection";
import ProactiveAlertsSection from "./sections/ProactiveAlertsSection";
import UsersSection from "./sections/UsersSection";
import AppsSection from "./sections/AppsSection";
import TiersSection from "./sections/TiersSection";
import PluginsAdminSection from "./sections/PluginsAdminSection";
import LlmAdminSection from "./sections/LlmAdminSection";
import StorageAdminSection from "./sections/StorageAdminSection";
import ErrorLogSection from "./sections/ErrorLogSection";
import AnalyticsSection from "./sections/AnalyticsSection";
import StudyHubSection from "./sections/StudyHubSection";
import DataStorageSection from "./sections/DataStorageSection";
import AboutSection from "./sections/AboutSection";
import DateTimeSection from "./sections/DateTimeSection";
import LegalSection from "./sections/LegalSection";
import ShortcutsSection from "./sections/ShortcutsSection";
import PerformanceAnalysisSection from "./sections/PerformanceAnalysisSection";

interface SectionDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Hidden from non-admin users. */
  adminOnly?: boolean;
  /** Visible to admins and managers (overrides adminOnly when true). */
  managerAllowed?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: "appearance", label: "Appearance", icon: <Palette size={15} /> },
  { id: "wallpaper", label: "Wallpaper", icon: <Image size={15} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={15} /> },
  { id: "animated-bg", label: "Animated BG", icon: <Film size={15} /> },
  { id: "account", label: "Account", icon: <User size={15} /> },
  { id: "date-time", label: "Date & Time", icon: <Clock size={15} /> },
  { id: "sound-athena", label: "Sound & Mavino", icon: <Volume2 size={15} /> },
  { id: "athena", label: "Mavino Assistant", icon: <Sparkles size={15} /> },
  { id: "integrations", label: "Integrations", icon: <Plug size={15} /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={15} /> },
  { id: "proactive-alerts", label: "Proactive Alerts", icon: <BellRing size={15} /> },
  { id: "users", label: "Users", icon: <UsersIcon size={15} />, managerAllowed: true },
  { id: "apps", label: "Apps", icon: <LayoutGrid size={15} />, adminOnly: true },
  { id: "plugins", label: "Plugins", icon: <Puzzle size={15} />, adminOnly: true },
  { id: "tiers", label: "Tiers & Plans", icon: <CreditCard size={15} />, adminOnly: true },
  { id: "llm-admin", label: "LLM Config", icon: <Sparkles size={15} />, adminOnly: true },
  { id: "storage-admin", label: "Storage Quotas", icon: <Database size={15} />, adminOnly: true },
  { id: "study-hub", label: "Study Hub", icon: <GraduationCap size={15} />, adminOnly: true },
  { id: "error-logs", label: "Error Logs", icon: <AlertTriangle size={15} />, adminOnly: true },
  { id: "performance", label: "Performance", icon: <Activity size={15} />, adminOnly: true },
  { id: "analytics", label: "Analytics", icon: <BarChart3 size={15} />, adminOnly: true },
  { id: "data", label: "Data & Storage", icon: <Database size={15} /> },
  { id: "legal", label: "Legal", icon: <Shield size={15} /> },
  { id: "about", label: "About", icon: <Info size={15} /> },
];

export default function SettingsApp({ win }: { win: WindowInstance }) {
  const { user } = useAuth();
  const [active, setActive] = useState<string | null>((win.payload?.section as string) || "appearance");
  const isAdmin = user?.role === "ADMIN";
  const isManager = user?.role === "MANAGER";
  const isAdminOrManager = isAdmin || isManager;

  const visibleSections = SECTIONS.filter((s) => {
    if (s.adminOnly && !s.managerAllowed) return isAdmin;
    if (s.managerAllowed) return isAdminOrManager;
    return true;
  });

  const renderSection = () => {
    if (active === null) return null;
    if (active === "appearance") return <AppearanceSection />;
    if (active === "wallpaper") return <WallpaperSection />;
    if (active === "shortcuts") return <ShortcutsSection />;
    if (active === "animated-bg") return <AnimatedBgSection />;
    if (active === "account") return <AccountSection />;
    if (active === "date-time") return <DateTimeSection />;
    if (active === "sound-athena") return <SoundAthenaSection />;
    if (active === "athena") return <AthenaSection />;
    if (active === "integrations") return <IntegrationsSection />;
    if (active === "notifications") return <NotificationsSection />;
    if (active === "proactive-alerts") return <ProactiveAlertsSection />;
    if (active === "users" && isAdminOrManager) return <UsersSection />;
    if (active === "apps" && isAdmin) return <AppsSection />;
    if (active === "plugins" && isAdmin) return <PluginsAdminSection />;
    if (active === "tiers" && isAdmin) return <TiersSection />;
    if (active === "llm-admin" && isAdmin) return <LlmAdminSection />;
    if (active === "storage-admin" && isAdmin) return <StorageAdminSection />;
    if (active === "study-hub" && isAdmin) return <StudyHubSection />;
    if (active === "error-logs" && isAdmin) return <ErrorLogSection />;
    if (active === "performance" && isAdmin) return <PerformanceAnalysisSection />;
    if (active === "analytics" && isAdmin) return <AnalyticsSection />;
    if (active === "data") return <DataStorageSection />;
    if (active === "legal") return <LegalSection />;
    if (active === "about") return <AboutSection />;
    return null;
  };


  // Desktop / tablet: sidebar + content
  return (
    <div className="relative flex h-full overflow-hidden">
      <CollapsibleSidebar
        side="left"
        width="w-44"
        showAt="@3xl"
        panelClassName="bg-surface-2 p-3"
        toggleIcon={<SettingsIcon size={14} />}
        toggleLabel="Settings"
      >
        <h2 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Settings
        </h2>
        <nav className="space-y-1 text-sm">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                active === s.id
                  ? "bg-surface-3 text-ink"
                  : "text-ink-muted hover:bg-surface-3 hover:text-ink"
              }`}
            >
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
      </CollapsibleSidebar>

      <div className="flex-1 overflow-y-auto p-6">{renderSection()}</div>
    </div>
  );
}
