export interface SourceNavigation {
  page?: number;
  slide?: number;
}

export interface SourceNavigationHistoryPatch {
  lastPage?: number;
  lastSlide?: number;
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

export function sourceNavigationFromAction(payload: Record<string, unknown>): SourceNavigation {
  const highlight = payload.highlight && typeof payload.highlight === "object"
    ? payload.highlight as Record<string, unknown>
    : undefined;
  return {
    page: positiveInteger(highlight?.scrollToPage) ?? positiveInteger(payload.scrollToPage),
    slide: positiveInteger(highlight?.scrollToSlide) ?? positiveInteger(payload.scrollToSlide),
  };
}

export function sourceNavigationFromCommand(payload: Record<string, unknown>): SourceNavigation {
  return {
    page: positiveInteger(payload.pageNumber),
    slide: positiveInteger(payload.slideNumber),
  };
}

export function sourceNavigationFromHistory(entry: { lastPage?: unknown; lastSlide?: unknown }): SourceNavigation {
  return {
    page: positiveInteger(entry.lastPage),
    slide: positiveInteger(entry.lastSlide),
  };
}

export function sourceNavigationHistoryPatch(
  navigation: SourceNavigation,
  hasTextAnchor: boolean,
): SourceNavigationHistoryPatch {
  if (navigation.page !== undefined) return { lastPage: navigation.page, lastSlide: undefined };
  if (navigation.slide !== undefined) return { lastPage: undefined, lastSlide: navigation.slide };
  return hasTextAnchor ? { lastPage: undefined, lastSlide: undefined } : {};
}
