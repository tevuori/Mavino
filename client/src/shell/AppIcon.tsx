import * as Lucide from "lucide-react";
import { APP_MAP, type AppDefinition } from "../apps/registry";
import type { AppId } from "../store/windows";

interface RenderOptions {
  size?: number;
  className?: string;
}

function definitionFor(app: AppDefinition | AppId): AppDefinition | undefined {
  return typeof app === "string" ? APP_MAP[app as AppId] : app;
}

/** Render an app's launcher icon: either a Lucide icon or a brand image. */
export function renderAppIcon(
  app: AppDefinition | AppId | null | undefined,
  { size = 18, className = "" }: RenderOptions = {}
): React.ReactNode {
  const def = app ? definitionFor(app) : undefined;
  if (def?.imageIcon) {
    return (
      <img
        src={def.imageIcon}
        alt={def.name}
        width={size}
        height={size}
        draggable={false}
        className={`select-none object-contain ${className}`}
      />
    );
  }
  const iconName = def?.icon ?? "";
  const Icon =
    (
      Lucide as unknown as Record<
        string,
        React.ComponentType<{ size?: number; className?: string }>
      >
    )[iconName] ?? Lucide.AppWindow;
  return <Icon size={size} className={className} />;
}
