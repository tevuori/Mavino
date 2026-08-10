import { api } from "./api";

export type SubscriptionPlan = "paid" | "pro";

export interface SubscriptionStatus {
  plan: SubscriptionPlan | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  stripeConfigured: boolean;
}

export interface CheckoutResult {
  url: string;
}

export interface AdminPrices {
  paidPriceId: string | null;
  proPriceId: string | null;
  stripeConfigured: boolean;
}

export const subscriptionsApi = {
  getStatus: () => api.get<SubscriptionStatus>("/api/subscriptions"),
  checkout: (plan: SubscriptionPlan) =>
    api.post<CheckoutResult | { error: string }>("/api/subscriptions/checkout", { plan }),
  portal: () =>
    api.post<CheckoutResult | { error: string }>("/api/subscriptions/portal", {}),
  cancel: () =>
    api.post<{ ok: boolean } | { error: string }>("/api/subscriptions/cancel", {}),
  // Admin
  getPrices: () => api.get<AdminPrices>("/api/subscriptions/admin/prices"),
  setPrice: (plan: SubscriptionPlan, priceId: string) =>
    api.put<{ ok: boolean }>("/api/subscriptions/admin/prices", { plan, priceId }),
};
