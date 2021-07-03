import React, { ReactElement, useCallback } from "react";
import { useHistory } from "react-router-dom";

import { store } from "store";
import { logout } from "api/auth";

import { useAuthContext, userUninitialized } from "contexts/auth";

export default function Logout(): ReactElement {
  const history = useHistory();
  const auth = useAuthContext();

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await logout();
        store.remove("user");
        auth.setIsAuthenticated(false);
        auth.setUser(userUninitialized);
        history.push("/");
      } catch {
        console.error("Failed to logout on server.");
      }
    },
    [history, auth]
  );
  return (
    <form
      className="space-y-6"
      style={{ display: "inline-block" }}
      onSubmit={handleSubmit}
      method="POST"
    >
      <button type="submit">Logout</button>
    </form>
  );
}
