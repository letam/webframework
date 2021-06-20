import React, { ReactElement, useCallback } from "react";
import { useHistory } from "react-router-dom";

import { BACKEND_HOST } from "api/constants";
import { csrfToken } from "api/csrf";
import { store } from "store";
import { useAuthContext } from "contexts/auth";

async function logout(eventTarget: HTMLFormElement) {
  return (
    await fetch(`${BACKEND_HOST}/auth/logout/`, {
      method: eventTarget.method,
      headers: { "X-CSRFToken": csrfToken.token },
    })
  ).json() as Promise<void>;
}

export default function Logout(): ReactElement {
  const history = useHistory();
  const auth = useAuthContext();

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await logout(event.target as HTMLFormElement);
        store.remove("userId");
        store.remove("username");
        auth.setIsAuthenticated(false);
        auth.setUsername("");
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
