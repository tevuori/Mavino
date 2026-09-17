import { Languages } from "lucide-react";
import { useState } from "react";
import { useLanguage, type LanguagePreference, type LanguageScope } from "../../../store/language";
import { Card, Field, SectionHeader, inputClass } from "../ui";
import { useI18n } from "../../../i18n";

const appLabels: { scope: LanguageScope; label: string }[] = [
  { scope: "study", label: "Study Hub" },
  { scope: "podcast", label: "Podcasts" },
  { scope: "teach", label: "Teach Me" },
  { scope: "lecture", label: "Lecture Notes" },
  { scope: "echo", label: "Echo" },
  { scope: "intelligent-upload", label: "Intelligent Upload" },
];

export default function LanguageSection() {
  const { t } = useI18n();
  const { language, overrides, setLanguage, setOverride, resetOverrides } = useLanguage();
  const [error, setError] = useState("");

  const changeLanguage = async (next: "en" | "cs") => {
    setError("");
    try {
      await setLanguage(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save language");
    }
  };

  return (
    <div className="max-w-2xl">
      <SectionHeader
        icon={<Languages size={18} className="text-accent" />}
        title={t("languageRegion")}
        description={t("languageDescription")}
      />
      <Card className="mb-4">
        <Field label={t("applicationLanguage")} hint={t("sourceLanguageHint")}>
          <select className={inputClass} value={language} onChange={(event) => void changeLanguage(event.target.value as "en" | "cs")}>
            <option value="en">{t("english")}</option>
            <option value="cs">{t("czech")}</option>
          </select>
        </Field>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </Card>
      <Card>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">{t("appOverrides")}</p>
            <p className="text-xs text-ink-muted">{t("overrideDescription")}</p>
          </div>
          <button type="button" onClick={resetOverrides} className="shrink-0 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink">
            {t("resetAll")}
          </button>
        </div>
        <div className="space-y-3">
          {appLabels.map(({ scope, label }) => (
            <Field key={scope} label={label}>
              <select className={inputClass} value={overrides[scope]} onChange={(event) => setOverride(scope, event.target.value as LanguagePreference)}>
                <option value="global">Use global — {language === "cs" ? "Čeština" : "English"}</option>
                <option value="en">English</option>
                <option value="cs">Čeština</option>
              </select>
            </Field>
          ))}
        </div>
      </Card>
    </div>
  );
}
