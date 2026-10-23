/** Company identity used across the app (titles, headers, login, assistant). */
export const COMPANY_NAME = "TrioVision Composite Technologies Pvt. Ltd.";
export const COMPANY_SHORT = "TrioVision";
export const COMPANY_SUFFIX = "Composite Technologies Pvt. Ltd.";
export const APP_NAME = "Production Tracker";
export const ASSISTANT_NAME = "Trio AI Assistant";
export const ASSISTANT_SUBTITLE = "Your AI-powered production intelligence assistant.";
export const COMPANY_ADDRESS =
  "Mega Industrial Park, Plot No. 176, Kopparthi, Kopparthy, Ambavaram, Andhra Pradesh 516005, India.";
export const SITE_DESCRIPTION = `${COMPANY_NAME} — production tracking: projects, sets, panels, production stages, quality control, weights and analytics.`;

/** Browser tab title for a page. */
export const pageTitle = (page: string) => `${page} | ${COMPANY_NAME}`;

export const WELCOME = {
  reader: {
    title: "Welcome to TrioVision Production Tracking",
    body: "Access real-time production progress, project information, panel status, quality control updates, and production analytics.",
    note: "Reader access is strictly view-only.",
  },
  admin: {
    title: "Welcome to TrioVision Production Management",
    body: "Manage projects, sets, panels, production stages, quality control, weight tracking, and production performance.",
    note: "Admin access provides authorized production management capabilities.",
  },
} as const;
