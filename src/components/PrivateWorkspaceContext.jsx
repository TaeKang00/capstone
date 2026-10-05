import { createContext } from "react";

// Portaled dialogs inherit this context so security locking remains reachable
// while a form is open, even when its normal close action is blocked by saving.
export const PrivateWorkspaceContext = createContext(null);
