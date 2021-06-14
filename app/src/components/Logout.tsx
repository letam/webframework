import React, { ReactElement, useCallback } from "react";
import { useHistory } from "react-router-dom";

import { BACKEND_HOST } from "api/constants";
import { csrfToken } from "api/csrf";
import { store } from "store";

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

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await logout(event.target as HTMLFormElement);
        store.remove("userId");
        store.remove("username");
        history.push("/");
        // TODO: Use mechanism (i.e. context) to update app state instead of doing hard reload
        window.location.reload();
      } catch {
        console.error("Failed to logout on server.");
      }
    },
    [history]
  );
  return (
    <form className="space-y-6" onSubmit={handleSubmit} method="POST">
      <button type="submit">Logout</button>
    </form>
  );
}
