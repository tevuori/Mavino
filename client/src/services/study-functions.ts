// ===== Study Hub function settings API =====

import { api } from "./api";

export interface StudyFunctionDef {
  id: string;
  label: string;
  description: string;
}

export interface StudyFunctionTierConfig {
  free: boolean;
  paid: boolean;
}

export type StudyFunctionConfig = Record<string, StudyFunctionTierConfig>;

export interface AdminConfigResponse {
  functions: StudyFunctionDef[];
  config: StudyFunctionConfig;
}

export interface MyFunctionsResponse {
  enabled: string[];
}

export const studyFunctionsApi = {
  getAdminConfig: () => api.get<AdminConfigResponse>("/api/study-functions/admin"),
  setAdminConfig: (config: StudyFunctionConfig) =>
    api.put<AdminConfigResponse>("/api/study-functions/admin", config),
  getMyFunctions: () => api.get<MyFunctionsResponse>("/api/study-functions"),
};
